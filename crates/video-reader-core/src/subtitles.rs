//! Embedded subtitle extraction and timestamp parsing for the Rust read path.

use std::path::Path;
use std::process::{Command, Stdio};

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SubtitleProvenance {
    pub method: String,
    pub format: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SubtitleCue {
    pub index: u32,
    pub start_ms: u64,
    pub end_ms: u64,
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stream_index: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
    pub provenance: SubtitleProvenance,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SubtitleExtraction {
    pub subtitles: Vec<SubtitleCue>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SubtitleFormat {
    Srt,
    Vtt,
}

impl SubtitleFormat {
    fn codec_name(self) -> &'static str {
        match self {
            Self::Srt => "srt",
            Self::Vtt => "webvtt",
        }
    }

    fn wire_name(self) -> &'static str {
        match self {
            Self::Srt => "srt",
            Self::Vtt => "webvtt",
        }
    }
}

pub fn extract_subtitles(path: &Path, ffprobe: &Value) -> SubtitleExtraction {
    let streams = ffprobe
        .get("streams")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|stream| stream.get("codec_type").and_then(Value::as_str) == Some("subtitle"))
        .filter_map(|stream| {
            let index = stream.get("index").and_then(Value::as_u64)?;
            let language = stream
                .get("tags")
                .and_then(|tags| tags.get("language"))
                .and_then(Value::as_str)
                .map(str::to_string);
            let codec = stream
                .get("codec_name")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_ascii_lowercase();
            let format = if codec == "webvtt" || codec == "vtt" {
                SubtitleFormat::Vtt
            } else {
                SubtitleFormat::Srt
            };
            Some((index, language, format))
        })
        .collect::<Vec<_>>();

    if streams.is_empty() {
        return SubtitleExtraction {
            subtitles: Vec::new(),
            warnings: vec!["No embedded subtitle streams found.".into()],
        };
    }

    if !command_exists("ffmpeg") {
        return SubtitleExtraction {
            subtitles: Vec::new(),
            warnings: vec!["ffmpeg is not installed; subtitle extraction skipped.".into()],
        };
    }

    let mut subtitles = Vec::new();
    let mut warnings = Vec::new();
    for (stream_index, language, format) in streams {
        let map = format!("0:{stream_index}");
        let output = Command::new("ffmpeg")
            .args(["-hide_banner", "-loglevel", "error", "-i"])
            .arg(path)
            .args([
                "-map",
                &map,
                "-c:s",
                format.codec_name(),
                "-f",
                format.wire_name(),
                "-",
            ])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output();

        let output = match output {
            Ok(output) if output.status.success() => output,
            Ok(output) => {
                let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
                warnings.push(format!(
                    "Subtitle stream {stream_index} extraction failed: {}",
                    if stderr.is_empty() {
                        "ffmpeg exited with a non-zero status.".to_string()
                    } else {
                        stderr
                    }
                ));
                continue;
            }
            Err(error) => {
                warnings.push(format!(
                    "Subtitle stream {stream_index} extraction failed: {error}"
                ));
                continue;
            }
        };

        let content = match String::from_utf8(output.stdout) {
            Ok(content) => content,
            Err(error) => {
                warnings.push(format!(
                    "Subtitle stream {stream_index} extraction failed: output was not UTF-8 ({error})"
                ));
                continue;
            }
        };

        for mut cue in parse_subtitle_content_internal(&content, format) {
            cue.index = subtitles.len() as u32;
            cue.stream_index = Some(stream_index);
            cue.language = language.clone();
            subtitles.push(cue);
        }
    }

    SubtitleExtraction {
        subtitles,
        warnings,
    }
}

pub fn parse_subtitle_content(content: &str, format: SubtitleFormatForTest) -> Vec<SubtitleCue> {
    parse_blocks(content, format.into_internal())
}

fn parse_subtitle_content_internal(content: &str, format: SubtitleFormat) -> Vec<SubtitleCue> {
    parse_blocks(content, format)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SubtitleFormatForTest {
    Srt,
    Vtt,
}

impl SubtitleFormatForTest {
    fn into_internal(self) -> SubtitleFormat {
        match self {
            Self::Srt => SubtitleFormat::Srt,
            Self::Vtt => SubtitleFormat::Vtt,
        }
    }
}

fn parse_blocks(content: &str, format: SubtitleFormat) -> Vec<SubtitleCue> {
    let normalized = content.replace("\r\n", "\n");
    normalized
        .split("\n\n")
        .map(str::trim)
        .filter(|block| !block.is_empty())
        .filter(|block| format != SubtitleFormat::Vtt || !block.starts_with("WEBVTT"))
        .filter_map(|block| parse_block(block, format))
        .enumerate()
        .map(|(index, (start_ms, end_ms, text))| SubtitleCue {
            index: index as u32,
            start_ms,
            end_ms,
            text,
            stream_index: None,
            language: None,
            provenance: SubtitleProvenance {
                method: "ffmpeg_extract".into(),
                format: match format {
                    SubtitleFormat::Srt => "srt",
                    SubtitleFormat::Vtt => "vtt",
                }
                .into(),
            },
        })
        .collect()
}

fn parse_block(block: &str, format: SubtitleFormat) -> Option<(u64, u64, String)> {
    if format == SubtitleFormat::Vtt && block.starts_with("NOTE") {
        return None;
    }
    let lines = block.lines().map(str::trim_end).collect::<Vec<_>>();
    let timing_index = lines.iter().position(|line| line.contains("-->"))?;
    let timing = lines[timing_index];
    let mut parts = timing.split("-->").map(str::trim);
    let start = parse_timestamp_ms(parts.next()?)?;
    let end = parse_timestamp_ms(parts.next()?.split_whitespace().next()?)?;
    if end < start {
        return None;
    }

    let text = lines
        .iter()
        .enumerate()
        .filter(|(index, _)| *index != timing_index && *index != 0)
        .map(|(_, line)| strip_tags(line))
        .filter(|line| !line.is_empty() && !(*line).chars().all(|c| c.is_ascii_digit()))
        .collect::<Vec<_>>()
        .join("\n");
    if text.is_empty() {
        return None;
    }
    Some((start, end, text))
}

fn parse_timestamp_ms(raw: &str) -> Option<u64> {
    let normalized = raw.trim().replace(',', ".");
    let parts = normalized.split(':').collect::<Vec<_>>();
    let (hours, minutes, seconds) = match parts.as_slice() {
        [minutes, seconds] => (
            0_u64,
            minutes.parse::<u64>().ok()?,
            seconds.parse::<f64>().ok()?,
        ),
        [hours, minutes, seconds] => (
            hours.parse::<u64>().ok()?,
            minutes.parse::<u64>().ok()?,
            seconds.parse::<f64>().ok()?,
        ),
        _ => return None,
    };
    if minutes >= 60 || !seconds.is_finite() || !(0.0..60.0).contains(&seconds) {
        return None;
    }
    Some((hours * 3_600_000 + minutes * 60_000) + (seconds * 1000.0).round() as u64)
}

fn strip_tags(text: &str) -> String {
    let mut output = String::with_capacity(text.len());
    let mut in_tag = false;
    for ch in text.chars() {
        match ch {
            '<' => in_tag = true,
            '>' if in_tag => in_tag = false,
            _ if !in_tag => output.push(ch),
            _ => {}
        }
    }
    output.trim().to_string()
}

fn command_exists(binary: &str) -> bool {
    Command::new(binary)
        .arg("-version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_srt_cues_with_tags_and_comma_millis() {
        let cues = parse_subtitle_content(
            "1\n00:00:01,200 --> 00:00:03,400\n<b>Hello</b> world\n\n2\n00:00:04.000 --> 00:00:05.000\nSecond cue\n",
            SubtitleFormatForTest::Srt,
        );
        assert_eq!(cues.len(), 2);
        assert_eq!(cues[0].start_ms, 1200);
        assert_eq!(cues[0].end_ms, 3400);
        assert_eq!(cues[0].text, "Hello world");
        assert_eq!(cues[0].provenance.format, "srt");
    }

    #[test]
    fn parses_webvtt_without_consuming_cue_identifiers_or_settings() {
        let cues = parse_subtitle_content(
            "WEBVTT\n\nintro\n00:01.000 --> 00:02.500 align:start\nWelcome\n",
            SubtitleFormatForTest::Vtt,
        );
        assert_eq!(cues.len(), 1);
        assert_eq!(cues[0].start_ms, 1000);
        assert_eq!(cues[0].end_ms, 2500);
        assert_eq!(cues[0].text, "Welcome");
        assert_eq!(cues[0].provenance.format, "vtt");
    }

    #[test]
    fn reports_missing_embedded_streams_without_invoking_ffmpeg() {
        let extraction = extract_subtitles(
            std::path::Path::new("/does/not/matter.mp4"),
            &json!({
                "streams": [{ "index": 0, "codec_type": "video" }]
            }),
        );
        assert!(extraction.subtitles.is_empty());
        assert_eq!(
            extraction.warnings,
            vec!["No embedded subtitle streams found."]
        );
    }
}
