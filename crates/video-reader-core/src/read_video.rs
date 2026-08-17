use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::Value;

use crate::agent_index::{build_agent_video_index, AgentVideoIndex};
use crate::envelope::build_read_video_envelope;
use crate::ffprobe::{is_ffprobe_available, run_ffprobe};
use crate::frames::{extract_keyframes, KeyframeEvidence};
use crate::hash::{build_cache_key, hash_source_file, CacheOptions};
use crate::scenes::{detect_scenes, SceneInfo};
use crate::subtitles::{extract_subtitles, SubtitleCue};
use crate::timeline::{assemble_probe_timeline, AssembleOptions, TIMELINE_ROUTE};
use crate::AgentEvidenceEnvelope;

pub const READ_VIDEO_ROUTE: &str = "rust-read-video-v1";
pub const SERVER_VERSION: &str = "0.1.0";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReadVideoErrorCode {
    InvalidParams,
    InvalidRequest,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReadVideoError {
    pub code: ReadVideoErrorCode,
    pub message: String,
}

impl ReadVideoError {
    pub(crate) fn invalid_params(message: impl Into<String>) -> Self {
        Self {
            code: ReadVideoErrorCode::InvalidParams,
            message: message.into(),
        }
    }

    pub(crate) fn invalid_request(message: impl Into<String>) -> Self {
        Self {
            code: ReadVideoErrorCode::InvalidRequest,
            message: message.into(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct TimelineProvenance {
    pub source: String,
    pub tool: &'static str,
    pub version: &'static str,
    pub extracted_at: String,
    pub source_hash: String,
    pub cache_key: String,
    pub assembly_route: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct TimelineDocument {
    pub provenance: TimelineProvenance,
    pub format: crate::timeline::FormatInfo,
    pub streams: Vec<crate::timeline::StreamInfo>,
    pub chapters: Vec<crate::timeline::ChapterInfo>,
    pub scenes: Vec<SceneInfo>,
    pub subtitles: Vec<SubtitleCue>,
    pub transcript: Vec<Value>,
    pub keyframes: Vec<KeyframeEvidence>,
    pub agent_index: AgentVideoIndex,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct VideoSourceResult {
    pub success: bool,
    pub source: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timeline: Option<TimelineDocument>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ReadVideoResponse {
    pub route: &'static str,
    pub engine: &'static str,
    pub results: Vec<VideoSourceResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub envelope: Option<AgentEvidenceEnvelope>,
}

#[derive(Debug, Clone)]
pub struct ReadVideoOptions {
    pub include_streams: bool,
    pub include_chapters: bool,
    pub include_subtitles: bool,
    pub include_scenes: bool,
    pub include_transcript: bool,
    pub include_keyframes: bool,
    pub include_keyframe_images: bool,
    pub keyframe_limit: u32,
    pub keyframe_max_dimension: Option<u32>,
    pub scene_threshold: f64,
}

impl Default for ReadVideoOptions {
    fn default() -> Self {
        Self {
            include_streams: true,
            include_chapters: true,
            include_subtitles: true,
            include_scenes: true,
            include_transcript: false,
            include_keyframes: false,
            include_keyframe_images: false,
            keyframe_limit: 8,
            keyframe_max_dimension: None,
            scene_threshold: 0.4,
        }
    }
}

pub fn read_video_source(path: &Path, options: &ReadVideoOptions) -> Result<TimelineDocument, ReadVideoError> {
    if !path.is_file() {
        return Err(ReadVideoError::invalid_request(format!(
            "Unable to read video at '{}': not a regular file.",
            path.display()
        )));
    }

    if !is_ffprobe_available() {
        return Err(ReadVideoError::invalid_request(
            "ffprobe is unavailable on the Rust read_video route. Install ffmpeg/ffprobe and retry.",
        ));
    }

    let ffprobe = run_ffprobe(path).map_err(ReadVideoError::invalid_request)?;
    let assembled = assemble_probe_timeline(
        &ffprobe,
        &AssembleOptions {
            include_streams: options.include_streams,
            include_chapters: options.include_chapters,
        },
    );

    let source_hash = hash_source_file(path).map_err(ReadVideoError::invalid_request)?;
    let cache_key = build_cache_key(
        &source_hash,
        &CacheOptions {
            include_streams: options.include_streams,
            include_chapters: options.include_chapters,
            include_subtitles: options.include_subtitles,
            include_scenes: options.include_scenes,
            include_transcript: options.include_transcript,
            include_keyframes: options.include_keyframes,
            include_keyframe_images: options.include_keyframe_images,
            keyframe_limit: options.keyframe_limit,
            keyframe_max_dimension: options.keyframe_max_dimension,
            scene_threshold: options.scene_threshold,
        },
    );

    let mut warnings = assembled.warnings.clone();
    let mut subtitles = Vec::new();
    let mut scenes = Vec::new();
    let mut keyframes = Vec::new();

    if options.include_subtitles {
        let extracted = extract_subtitles(path, &ffprobe);
        subtitles = extracted.subtitles;
        warnings.extend(extracted.warnings);
    }
    if options.include_scenes {
        match detect_scenes(path, options.scene_threshold) {
            Ok(detected) => scenes = detected,
            Err(message) => warnings.push(message),
        }
    }
    if options.include_transcript {
        warnings.push(
            "ASR transcript extraction is unavailable on the Rust read_video route; no transcript segments were produced.".into(),
        );
    }
    if options.include_keyframes {
        match extract_keyframes(
            path,
            options.keyframe_limit,
            options.include_keyframe_images,
            options.keyframe_max_dimension,
        ) {
            Ok(indexed) => keyframes = indexed,
            Err(message) => {
                warnings.push(format!("Keyframe extraction skipped: {}", message.message))
            }
        }
    }

    let agent_index = build_agent_video_index(
        &path.display().to_string(),
        &assembled.format,
        &assembled.streams,
        &assembled.chapters,
        &scenes,
        &subtitles,
        &keyframes,
        0,
        &warnings,
    );

    Ok(TimelineDocument {
        provenance: TimelineProvenance {
            source: path.display().to_string(),
            tool: "read_video",
            version: SERVER_VERSION,
            extracted_at: chrono_now_iso(),
            source_hash,
            cache_key,
            assembly_route: TIMELINE_ROUTE.into(),
        },
        format: assembled.format,
        streams: assembled.streams,
        chapters: assembled.chapters,
        scenes,
        subtitles,
        transcript: Vec::new(),
        keyframes,
        agent_index,
        warnings,
    })
}

pub fn read_video_from_value(input: &Value) -> Result<ReadVideoResponse, ReadVideoError> {
    let sources = input
        .get("sources")
        .and_then(Value::as_array)
        .ok_or_else(|| ReadVideoError::invalid_params("sources array is required"))?;

    if sources.is_empty() {
        return Err(ReadVideoError::invalid_params(
            "At least one source path is required.",
        ));
    }

    let options = ReadVideoOptions {
        include_streams: input
            .get("include_streams")
            .and_then(Value::as_bool)
            .unwrap_or(true),
        include_chapters: input
            .get("include_chapters")
            .and_then(Value::as_bool)
            .unwrap_or(true),
        include_subtitles: input
            .get("include_subtitles")
            .and_then(Value::as_bool)
            .unwrap_or(true),
        include_scenes: input
            .get("include_scenes")
            .and_then(Value::as_bool)
            .unwrap_or(true),
        include_transcript: input
            .get("include_transcript")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        include_keyframes: input
            .get("include_keyframes")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        include_keyframe_images: input
            .get("include_keyframe_images")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        keyframe_limit: input
            .get("keyframe_limit")
            .and_then(Value::as_u64)
            .map(|value| value as u32)
            .unwrap_or(8),
        keyframe_max_dimension: input
            .get("keyframe_max_dimension")
            .and_then(Value::as_u64)
            .map(|value| value as u32),
        scene_threshold: input
            .get("scene_threshold")
            .and_then(Value::as_f64)
            .unwrap_or(0.4),
    };

    if options.keyframe_limit == 0 || options.keyframe_limit > 64 {
        return Err(ReadVideoError::invalid_params(
            "keyframe_limit must be between 1 and 64.",
        ));
    }
    if options
        .keyframe_max_dimension
        .is_some_and(|max_dimension| max_dimension == 0)
    {
        return Err(ReadVideoError::invalid_params(
            "keyframe_max_dimension must be positive when provided.",
        ));
    }
    if !options.scene_threshold.is_finite() || !(0.0..=1.0).contains(&options.scene_threshold) {
        return Err(ReadVideoError::invalid_params(
            "scene_threshold must be a finite number between 0 and 1.",
        ));
    }

    let mut results = Vec::with_capacity(sources.len());
    for source in sources {
        let path = source
            .get("path")
            .and_then(Value::as_str)
            .ok_or_else(|| ReadVideoError::invalid_params("each source requires a path"))?;
        if path.trim().is_empty() {
            return Err(ReadVideoError::invalid_params(
                "each source requires a non-empty path",
            ));
        }

        match read_video_source(PathBuf::from(path).as_path(), &options) {
            Ok(timeline) => results.push(VideoSourceResult {
                success: true,
                source: path.to_string(),
                timeline: Some(timeline),
                error: None,
            }),
            Err(error) => results.push(VideoSourceResult {
                success: false,
                source: path.to_string(),
                timeline: None,
                error: Some(error.message),
            }),
        }
    }

    if results.iter().all(|result| !result.success) {
        let messages: Vec<_> = results
            .iter()
            .filter_map(|result| result.error.as_deref())
            .collect();
        return Err(ReadVideoError::invalid_request(format!(
            "All video sources failed to process: {}",
            messages.join("; ")
        )));
    }

    let primary = results
        .iter()
        .find(|result| result.success)
        .expect("at least one successful result");
    let primary_path = PathBuf::from(primary.source.as_str());
    let envelope = build_read_video_envelope(primary_path.as_path(), &ReadVideoResponse {
        route: READ_VIDEO_ROUTE,
        engine: crate::ENGINE_NAME,
        results: results.clone(),
        envelope: None,
    }, primary);

    Ok(ReadVideoResponse {
        route: READ_VIDEO_ROUTE,
        engine: crate::ENGINE_NAME,
        results,
        envelope: Some(envelope),
    })
}

fn chrono_now_iso() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let elapsed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    format!("{}Z", elapsed.as_secs())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::path::PathBuf;

    #[test]
    fn read_video_from_fixture_probe_when_ffprobe_available() {
        let fixture = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../test/fixtures/no-subtitle.mp4");
        if !fixture.is_file() || !is_ffprobe_available() {
            return;
        }

        let response = read_video_from_value(&serde_json::json!({
            "sources": [{ "path": fixture }],
            "include_subtitles": false,
            "include_scenes": false
        }))
        .expect("read_video");

        assert_eq!(response.route, READ_VIDEO_ROUTE);
        let result = response.results.first().expect("result");
        assert!(result.success);
        let timeline = result.timeline.as_ref().expect("timeline");
        assert_eq!(timeline.provenance.assembly_route, TIMELINE_ROUTE);
        assert_eq!(timeline.provenance.source_hash.len(), 64);
    }

    #[test]
    fn rejects_invalid_temporal_options_before_touching_sources() {
        for (field, value) in [
            ("keyframe_limit", json!(0)),
            ("keyframe_limit", json!(65)),
            ("keyframe_max_dimension", json!(0)),
            ("scene_threshold", json!(-0.1)),
            ("scene_threshold", json!(1.1)),
        ] {
            let mut input = json!({
                "sources": [{ "path": "/tmp/does-not-need-to-exist.mp4" }]
            });
            input[field] = value;
            let error =
                read_video_from_value(&input).expect_err("invalid options must fail at admission");
            assert_eq!(error.code, ReadVideoErrorCode::InvalidParams);
            assert!(error.message.contains(field), "{}", error.message);
        }
    }

    #[test]
    fn rejects_empty_source_paths_at_admission() {
        let error = read_video_from_value(&json!({
            "sources": [{ "path": "  " }]
        }))
        .expect_err("empty paths are not admissible");
        assert_eq!(error.code, ReadVideoErrorCode::InvalidParams);
        assert!(error.message.contains("non-empty path"));
    }
}