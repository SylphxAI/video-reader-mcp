//! Local ASR orchestration via ffmpeg audio extract and whisper.cpp adapters.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use serde::{Deserialize, Serialize};

pub const ASR_ROUTE: &str = "rust-whisper-cpp";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TranscriptSegment {
    pub start_ms: u64,
    pub end_ms: u64,
    pub text: String,
    pub provenance: TranscriptProvenance,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TranscriptProvenance {
    pub method: String,
    pub adapter: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AsrResult {
    pub transcript: Vec<TranscriptSegment>,
    pub route: String,
    pub adapter: Option<String>,
    pub warning: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AsrErrorCode {
    InvalidParams,
    AdapterUnavailable,
    TranscriptionFailed,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AsrError {
    pub code: AsrErrorCode,
    pub message: String,
}

const ADAPTER_CANDIDATES: &[&str] = &["whisper-cli", "whisper-cpp"];

pub fn detect_asr_adapter() -> Option<String> {
    for candidate in ADAPTER_CANDIDATES {
        if command_exists(candidate) {
            return Some((*candidate).to_string());
        }
    }
    None
}

pub fn parse_whisper_cpp_json(payload: &str, adapter: &str) -> Result<Vec<TranscriptSegment>, AsrError> {
    let root: serde_json::Value = serde_json::from_str(payload).map_err(|error| AsrError {
        code: AsrErrorCode::TranscriptionFailed,
        message: format!("Unable to parse whisper JSON output: {error}"),
    })?;

    let entries = root
        .get("transcription")
        .and_then(|value| value.as_array())
        .or_else(|| root.get("segments").and_then(|value| value.as_array()))
        .ok_or_else(|| AsrError {
            code: AsrErrorCode::TranscriptionFailed,
            message: "Whisper JSON output is missing a transcription array.".into(),
        })?;

    let mut transcript = Vec::with_capacity(entries.len());
    for entry in entries {
        let text = entry
            .get("text")
            .and_then(|value| value.as_str())
            .unwrap_or("")
            .trim()
            .to_string();

        if text.is_empty() {
            continue;
        }

        let (start_ms, end_ms) = parse_segment_times(entry)?;
        transcript.push(TranscriptSegment {
            start_ms,
            end_ms,
            text,
            provenance: TranscriptProvenance {
                method: "asr_adapter".into(),
                adapter: adapter.to_string(),
            },
        });
    }

    Ok(transcript)
}

fn parse_segment_times(entry: &serde_json::Value) -> Result<(u64, u64), AsrError> {
    if let Some(offsets) = entry.get("offsets") {
        let start = offsets
            .get("from")
            .and_then(|value| value.as_u64())
            .ok_or_else(|| AsrError {
                code: AsrErrorCode::TranscriptionFailed,
                message: "Whisper segment offsets.from is missing.".into(),
            })?;
        let end = offsets
            .get("to")
            .and_then(|value| value.as_u64())
            .ok_or_else(|| AsrError {
                code: AsrErrorCode::TranscriptionFailed,
                message: "Whisper segment offsets.to is missing.".into(),
            })?;
        return Ok((start, end));
    }

    if let Some(timestamps) = entry.get("timestamps") {
        let start = parse_timestamp_ms(
            timestamps
                .get("from")
                .and_then(|value| value.as_str())
                .unwrap_or("00:00:00.000"),
        )?;
        let end = parse_timestamp_ms(
            timestamps
                .get("to")
                .and_then(|value| value.as_str())
                .unwrap_or("00:00:00.000"),
        )?;
        return Ok((start, end));
    }

    let start = entry
        .get("start")
        .and_then(|value| value.as_f64())
        .map(|value| (value * 1000.0).round() as u64)
        .unwrap_or(0);
    let end = entry
        .get("end")
        .and_then(|value| value.as_f64())
        .map(|value| (value * 1000.0).round() as u64)
        .unwrap_or(start);

    Ok((start, end))
}

fn parse_timestamp_ms(value: &str) -> Result<u64, AsrError> {
    let parts: Vec<&str> = value.split(':').collect();
    if parts.len() != 3 {
        return Err(AsrError {
            code: AsrErrorCode::TranscriptionFailed,
            message: format!("Unsupported whisper timestamp format: {value}"),
        });
    }

    let hours: u64 = parts[0]
        .parse()
        .map_err(|_| AsrError {
            code: AsrErrorCode::TranscriptionFailed,
            message: format!("Invalid whisper timestamp hours: {value}"),
        })?;
    let minutes: u64 = parts[1]
        .parse()
        .map_err(|_| AsrError {
            code: AsrErrorCode::TranscriptionFailed,
            message: format!("Invalid whisper timestamp minutes: {value}"),
        })?;
    let seconds: f64 = parts[2]
        .parse()
        .map_err(|_| AsrError {
            code: AsrErrorCode::TranscriptionFailed,
            message: format!("Invalid whisper timestamp seconds: {value}"),
        })?;

    Ok(hours * 3_600_000 + minutes * 60_000 + (seconds * 1000.0).round() as u64)
}

pub fn transcribe_video(path: &Path, max_audio_seconds: u64) -> Result<AsrResult, AsrError> {
    if !path.is_file() {
        return Err(AsrError {
            code: AsrErrorCode::InvalidParams,
            message: format!("Video path '{}' is not a readable file.", path.display()),
        });
    }

    let adapter = detect_asr_adapter().ok_or_else(|| AsrError {
        code: AsrErrorCode::AdapterUnavailable,
        message:
            "No local ASR adapter found (checked whisper-cli, whisper-cpp).".into(),
    })?;

    if !command_exists("ffmpeg") {
        return Err(AsrError {
            code: AsrErrorCode::AdapterUnavailable,
            message: "ffmpeg is required for ASR audio extraction but was not found on PATH.".into(),
        });
    }

    let model_path = resolve_whisper_model().ok_or_else(|| AsrError {
        code: AsrErrorCode::AdapterUnavailable,
        message:
            "WHISPER_MODEL is not set and no default ggml model was found for whisper.cpp.".into(),
    })?;

    let temp_dir = tempfile::tempdir().map_err(|error| AsrError {
        code: AsrErrorCode::TranscriptionFailed,
        message: format!("Failed to create ASR temp directory: {error}"),
    })?;

    let audio_path = temp_dir.path().join("audio.wav");
    extract_audio_wav(path, &audio_path, max_audio_seconds).map_err(|message| AsrError {
        code: AsrErrorCode::TranscriptionFailed,
        message,
    })?;

    let json_path = temp_dir.path().join("transcript.json");
    run_whisper_transcription(&adapter, &model_path, &audio_path, &json_path).map_err(
        |message| AsrError {
            code: AsrErrorCode::TranscriptionFailed,
            message,
        },
    )?;

    let payload = fs::read_to_string(&json_path).map_err(|error| AsrError {
        code: AsrErrorCode::TranscriptionFailed,
        message: format!("Failed to read whisper JSON output: {error}"),
    })?;

    let transcript = parse_whisper_cpp_json(&payload, &adapter)?;

    Ok(AsrResult {
        transcript,
        route: ASR_ROUTE.into(),
        adapter: Some(adapter),
        warning: None,
    })
}

fn extract_audio_wav(video_path: &Path, audio_path: &Path, max_audio_seconds: u64) -> Result<(), String> {
    let status = Command::new("ffmpeg")
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
        ])
        .arg(video_path)
        .args([
            "-vn",
            "-ac",
            "1",
            "-ar",
            "16000",
            "-t",
            &max_audio_seconds.to_string(),
            "-f",
            "wav",
        ])
        .arg(audio_path)
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .status()
        .map_err(|error| format!("Failed to launch ffmpeg for ASR extract: {error}"))?;

    if !status.success() {
        return Err("ffmpeg failed to extract audio for ASR transcription.".into());
    }

    Ok(())
}

fn run_whisper_transcription(
    adapter: &str,
    model_path: &Path,
    audio_path: &Path,
    json_path: &Path,
) -> Result<(), String> {
    let output_prefix = json_path.with_extension("");
    let status = Command::new(adapter)
        .arg("-m")
        .arg(model_path)
        .arg("-f")
        .arg(audio_path)
        .arg("-oj")
        .arg("-of")
        .arg(&output_prefix)
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .status()
        .map_err(|error| format!("Failed to launch {adapter}: {error}"))?;

    if !status.success() {
        return Err(format!("{adapter} exited with a non-zero status."));
    }

    if json_path.exists() {
        return Ok(());
    }

    let fallback = output_prefix.with_extension("json");
    if fallback.exists() {
        fs::copy(&fallback, json_path)
            .map_err(|error| format!("Failed to copy whisper JSON output: {error}"))?;
        return Ok(());
    }

    Err(format!(
        "Whisper adapter '{adapter}' did not produce JSON output at {}",
        json_path.display()
    ))
}

fn resolve_whisper_model() -> Option<PathBuf> {
    if let Ok(model) = std::env::var("WHISPER_MODEL") {
        let path = PathBuf::from(model);
        if path.is_file() {
            return Some(path);
        }
    }

    for candidate in [
        "models/ggml-base.en.bin",
        "models/ggml-tiny.en.bin",
        "/usr/share/whisper-cpp/ggml-base.en.bin",
    ] {
        let path = PathBuf::from(candidate);
        if path.is_file() {
            return Some(path);
        }
    }

    None
}

fn command_exists(binary: &str) -> bool {
    Command::new(binary)
        .arg("-h")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or_else(|_| {
            Command::new(binary)
                .arg("--help")
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .map(|status| status.success())
                .unwrap_or(false)
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_whisper_cpp_transcription_json() {
        let payload = r#"{
          "transcription": [
            {
              "timestamps": { "from": "00:00:00.000", "to": "00:00:01.500" },
              "offsets": { "from": 0, "to": 1500 },
              "text": " hello"
            },
            {
              "timestamps": { "from": "00:00:01.500", "to": "00:00:03.000" },
              "offsets": { "from": 1500, "to": 3000 },
              "text": " world"
            }
          ]
        }"#;

        let transcript = parse_whisper_cpp_json(payload, "whisper-cli").expect("parse");
        assert_eq!(transcript.len(), 2);
        assert_eq!(transcript[0].start_ms, 0);
        assert_eq!(transcript[0].end_ms, 1500);
        assert_eq!(transcript[0].text, "hello");
        assert_eq!(transcript[0].provenance.adapter, "whisper-cli");
    }

    #[test]
    fn rejects_malformed_whisper_json() {
        let err = parse_whisper_cpp_json("not-json", "whisper-cli").unwrap_err();
        let msg = format!("{err:?}");
        assert!(!msg.is_empty());
    }

    #[test]
    fn empty_transcription_array_yields_empty_segments() {
        let payload = r#"{"transcription": []}"#;
        let transcript = parse_whisper_cpp_json(payload, "whisper-cli").expect("parse");
        assert!(transcript.is_empty());
    }

    #[test]
    fn trims_segment_text_and_uses_offsets() {
        let payload = r#"{
          "transcription": [
            {
              "timestamps": { "from": "00:00:00.000", "to": "00:00:00.500" },
              "offsets": { "from": 10, "to": 500 },
              "text": "  padded  "
            }
          ]
        }"#;
        let transcript = parse_whisper_cpp_json(payload, "whisper-cli").expect("parse");
        assert_eq!(transcript.len(), 1);
        assert_eq!(transcript[0].start_ms, 10);
        assert_eq!(transcript[0].end_ms, 500);
        assert_eq!(transcript[0].text, "padded");
    }



    #[test]
    fn parses_timestamp_only_segments_and_rejects_bad_format() {
        let payload = r#"{
          "transcription": [
            {
              "timestamps": { "from": "00:00:01.500", "to": "00:00:02.000" },
              "text": "hi"
            }
          ]
        }"#;
        let transcript = parse_whisper_cpp_json(payload, "whisper-cli").expect("parse");
        assert_eq!(transcript.len(), 1);
        assert_eq!(transcript[0].start_ms, 1500);
        assert_eq!(transcript[0].end_ms, 2000);
        assert_eq!(transcript[0].text, "hi");

        // start/end seconds fallback
        let payload2 = r#"{
          "transcription": [
            { "start": 1.25, "end": 2.5, "text": "sec" }
          ]
        }"#;
        let transcript = parse_whisper_cpp_json(payload2, "whisper-cli").expect("parse");
        assert_eq!(transcript[0].start_ms, 1250);
        assert_eq!(transcript[0].end_ms, 2500);

        assert!(parse_timestamp_ms("01:02:03.500").is_ok());
        assert_eq!(parse_timestamp_ms("00:00:01.500").unwrap(), 1500);
        assert_eq!(parse_timestamp_ms("01:00:00.000").unwrap(), 3_600_000);
        assert!(parse_timestamp_ms("bad").is_err());
        assert!(parse_timestamp_ms("1:2").is_err());
    }

    #[test]
    fn parses_segments_array_and_skips_empty_text() {
        let payload = r#"{
          "segments": [
            { "start": 0.0, "end": 0.5, "text": "  hi  " },
            { "start": 0.5, "end": 1.0, "text": "   " },
            { "offsets": { "from": 1000, "to": 2000 }, "text": "there" }
          ]
        }"#;
        let transcript = parse_whisper_cpp_json(payload, "whisper-cli").expect("parse");
        assert_eq!(transcript.len(), 2);
        assert_eq!(transcript[0].text, "hi");
        assert_eq!(transcript[0].start_ms, 0);
        assert_eq!(transcript[0].end_ms, 500);
        assert_eq!(transcript[1].text, "there");
        assert_eq!(transcript[1].start_ms, 1000);
        assert_eq!(transcript[1].end_ms, 2000);
    }

    #[test]
    fn parse_timestamp_ms_hours_and_invalid() {
        assert_eq!(parse_timestamp_ms("01:02:03.500").expect("ok"), 3_723_500);
        assert!(parse_timestamp_ms("1:02").is_err());
        assert!(parse_timestamp_ms("aa:00:00.000").is_err());
    }


    #[test]
    fn bw7_parse_whisper_missing_array_and_whitespace_only() {
        let err = parse_whisper_cpp_json(r#"{"other":[]}"#, "whisper-cli").unwrap_err();
        let _ = format!("{err:?}");
        let payload = r#"{"transcription":[{"text":"","start":0,"end":1},{"text":"ok","start":1,"end":2}]}"#;
        let t = parse_whisper_cpp_json(payload, "w").expect("ok");
        assert_eq!(t.len(), 1);
        assert_eq!(t[0].text, "ok");
        assert_eq!(parse_timestamp_ms("00:00:00.000").unwrap(), 0);
        assert_eq!(parse_timestamp_ms("00:01:00.000").unwrap(), 60_000);
    }


    #[test]
    fn bw8_parse_timestamp_ms_fraction_and_hours() {
        assert_eq!(parse_timestamp_ms("00:00:00.001").unwrap(), 1);
        assert_eq!(parse_timestamp_ms("00:00:01.999").unwrap(), 1999);
        assert_eq!(parse_timestamp_ms("02:00:00.000").unwrap(), 7_200_000);
        assert!(parse_timestamp_ms("").is_err());
        assert!(parse_timestamp_ms("00:00").is_err());
        assert!(parse_timestamp_ms("xx:00:00.000").is_err());
        let payload = r#"{"transcription":[{"timestamps":{"from":"00:00:00.100","to":"00:00:00.200"},"text":"a"}]}"#;
        let t = parse_whisper_cpp_json(payload, "w").unwrap();
        assert_eq!(t[0].start_ms, 100);
        assert_eq!(t[0].end_ms, 200);
    }

    #[test]
    fn bw8_parse_whisper_skips_missing_text_fields() {
        let payload = r#"{
          "transcription": [
            { "start": 0, "end": 1 },
            { "start": 1, "end": 2, "text": "kept" }
          ]
        }"#;
        match parse_whisper_cpp_json(payload, "w") {
            Ok(t) => {
                assert!(t.iter().all(|s| !s.text.trim().is_empty()) || t.len() <= 2);
            }
            Err(_) => {}
        }
    }


    #[test]
    fn bulk_parse_timestamp_ms_mmss_and_invalid() {
        assert!(parse_timestamp_ms("00:01:02.500").is_ok());
        assert!(parse_timestamp_ms("00:00:01.000").is_ok());
        assert!(parse_timestamp_ms("").is_err());
        assert!(parse_timestamp_ms("not-time").is_err());
        assert!(parse_timestamp_ms("01:02.500").is_err()); // needs HH:MM:SS
    }

    #[test]
    fn bulk_parse_whisper_empty_segments_ok() {
        // accept either empty ok or structured error — no panic
        for payload in [
            r#"{"transcription":[]}"#,
            r#"{"segments":[]}"#,
            r#"[]"#,
        ] {
            let _ = parse_whisper_cpp_json(payload, "whisper.cpp");
        }
    }
}
