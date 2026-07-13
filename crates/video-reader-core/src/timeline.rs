use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const TIMELINE_ROUTE: &str = "rust-timeline";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FormatInfo {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub format_name: Option<String>,
    pub duration_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bit_rate: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tags: Option<serde_json::Map<String, Value>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StreamInfo {
    pub index: u64,
    pub codec_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub codec_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub channels: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sample_rate: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avg_frame_rate: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub r_frame_rate: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bit_rate: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub disposition: Option<serde_json::Map<String, Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tags: Option<serde_json::Map<String, Value>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ChapterInfo {
    pub id: u64,
    pub start_ms: u64,
    pub end_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ProbeTimeline {
    pub format: FormatInfo,
    pub streams: Vec<StreamInfo>,
    pub chapters: Vec<ChapterInfo>,
    pub warnings: Vec<String>,
    pub route: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AssembleOptions {
    #[serde(default = "default_true")]
    pub include_streams: bool,
    #[serde(default = "default_true")]
    pub include_chapters: bool,
}

fn default_true() -> bool {
    true
}

fn seconds_to_ms(value: Option<&Value>) -> u64 {
    let Some(value) = value else {
        return 0;
    };

    let seconds = match value {
        Value::Number(number) => number.as_f64(),
        Value::String(text) => text.parse::<f64>().ok(),
        _ => None,
    };

    let Some(seconds) = seconds else {
        return 0;
    };

    if !seconds.is_finite() {
        return 0;
    }

    (seconds * 1000.0).round() as u64
}

fn parse_u64(value: Option<&Value>) -> Option<u64> {
    let value = value?;
    if let Some(number) = value.as_u64() {
        return Some(number);
    }
    value.as_str()?.parse::<u64>().ok()
}

fn map_streams(streams: &[Value]) -> Vec<StreamInfo> {
    streams
        .iter()
        .filter_map(|stream| {
            let index = parse_u64(stream.get("index"))?;
            let codec_type = stream.get("codec_type")?.as_str()?.to_string();

            Some(StreamInfo {
                index,
                codec_type,
                codec_name: stream
                    .get("codec_name")
                    .and_then(|value| value.as_str())
                    .map(str::to_string),
                language: stream
                    .get("tags")
                    .and_then(|tags| tags.get("language"))
                    .and_then(|value| value.as_str())
                    .map(str::to_string),
                channels: parse_u64(stream.get("channels")),
                sample_rate: stream
                    .get("sample_rate")
                    .and_then(|value| value.as_str())
                    .and_then(|text| text.parse::<u64>().ok()),
                width: parse_u64(stream.get("width")),
                height: parse_u64(stream.get("height")),
                avg_frame_rate: stream
                    .get("avg_frame_rate")
                    .and_then(|value| value.as_str())
                    .map(str::to_string),
                r_frame_rate: stream
                    .get("r_frame_rate")
                    .and_then(|value| value.as_str())
                    .map(str::to_string),
                bit_rate: stream
                    .get("bit_rate")
                    .and_then(|value| value.as_str())
                    .and_then(|text| text.parse::<u64>().ok()),
                disposition: stream.get("disposition").and_then(|value| value.as_object().cloned()),
                tags: stream.get("tags").and_then(|value| value.as_object().cloned()),
            })
        })
        .collect()
}

fn map_chapters(chapters: &[Value]) -> Vec<ChapterInfo> {
    chapters
        .iter()
        .filter_map(|chapter| {
            let id = parse_u64(chapter.get("id"))?;
            let start_ms = seconds_to_ms(chapter.get("start"));
            let end_ms = seconds_to_ms(chapter.get("end"));

            Some(ChapterInfo {
                id,
                start_ms,
                end_ms,
                title: chapter
                    .get("tags")
                    .and_then(|tags| tags.get("title"))
                    .and_then(|value| value.as_str())
                    .map(str::to_string),
            })
        })
        .collect()
}

fn collect_probe_warnings(streams: &[Value], format: &Value, include_streams: bool) -> Vec<String> {
    let mut warnings = Vec::new();

    if include_streams {
        let video_streams: Vec<_> = streams
            .iter()
            .filter(|stream| stream.get("codec_type").and_then(|v| v.as_str()) == Some("video"))
            .collect();
        let audio_streams: Vec<_> = streams
            .iter()
            .filter(|stream| stream.get("codec_type").and_then(|v| v.as_str()) == Some("audio"))
            .collect();

        if video_streams.is_empty() {
            warnings.push("No video stream detected.".into());
        }
        if audio_streams.is_empty() {
            warnings.push("No audio stream detected.".into());
        }

        for stream in video_streams {
            let avg = stream.get("avg_frame_rate").and_then(|v| v.as_str());
            let r = stream.get("r_frame_rate").and_then(|v| v.as_str());
            if let (Some(avg), Some(r)) = (avg, r) {
                if avg != r {
                    let index = stream
                        .get("index")
                        .and_then(|v| v.as_u64())
                        .map(|v| v.to_string())
                        .unwrap_or_else(|| "?".into());
                    warnings.push(format!(
                        "Stream {index}: variable frame rate suspected (avg_frame_rate={avg}, r_frame_rate={r})."
                    ));
                }
            }
        }
    }

    let duration = format.get("duration");
    let duration_seconds = duration
        .and_then(|value| match value {
            Value::String(text) => text.parse::<f64>().ok(),
            Value::Number(number) => number.as_f64(),
            _ => None,
        })
        .unwrap_or(0.0);

    if duration_seconds <= 0.0 {
        warnings.push(
            "Duration unavailable or zero; timeline bounds may be incomplete.".into(),
        );
    }

    warnings
}

pub fn assemble_probe_timeline(ffprobe: &Value, options: &AssembleOptions) -> ProbeTimeline {
    let streams_value = ffprobe
        .get("streams")
        .and_then(|value| value.as_array())
        .cloned()
        .unwrap_or_default();
    let chapters_value = ffprobe
        .get("chapters")
        .and_then(|value| value.as_array())
        .cloned()
        .unwrap_or_default();
    let format_value = ffprobe.get("format").cloned().unwrap_or(Value::Object(Default::default()));

    let format = FormatInfo {
        format_name: format_value
            .get("format_name")
            .and_then(|value| value.as_str())
            .map(str::to_string),
        duration_ms: seconds_to_ms(format_value.get("duration")),
        bit_rate: format_value
            .get("bit_rate")
            .and_then(|value| value.as_str())
            .and_then(|text| text.parse::<u64>().ok()),
        size_bytes: format_value
            .get("size")
            .and_then(|value| value.as_str())
            .and_then(|text| text.parse::<u64>().ok()),
        tags: format_value.get("tags").and_then(|value| value.as_object().cloned()),
    };

    let warnings = collect_probe_warnings(&streams_value, &format_value, options.include_streams);

    ProbeTimeline {
        format,
        streams: if options.include_streams {
            map_streams(&streams_value)
        } else {
            Vec::new()
        },
        chapters: if options.include_chapters {
            map_chapters(&chapters_value)
        } else {
            Vec::new()
        },
        warnings,
        route: TIMELINE_ROUTE.into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn fixture_path(name: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../test/fixtures/probes")
            .join(name)
    }

    #[test]
    fn assembles_streams_chapters_and_warnings_from_probe_fixture() {
        let raw = std::fs::read_to_string(fixture_path("multi-stream.json")).expect("fixture");
        let ffprobe: Value = serde_json::from_str(&raw).expect("json");
        let timeline = assemble_probe_timeline(
            &ffprobe,
            &AssembleOptions {
                include_streams: true,
                include_chapters: true,
            },
        );

        assert_eq!(timeline.streams.len(), 3);
        assert_eq!(timeline.format.duration_ms, 125_500);
        assert_eq!(timeline.chapters[0].title.as_deref(), Some("Intro"));
        assert_eq!(timeline.route, TIMELINE_ROUTE);
    }

    #[test]
    fn flags_missing_audio_for_video_only_probe() {
        let raw = std::fs::read_to_string(fixture_path("no-subtitle.json")).expect("fixture");
        let ffprobe: Value = serde_json::from_str(&raw).expect("json");
        let timeline = assemble_probe_timeline(
            &ffprobe,
            &AssembleOptions {
                include_streams: true,
                include_chapters: true,
            },
        );

        assert!(timeline
            .warnings
            .iter()
            .any(|warning| warning.contains("No audio stream")));
    }

    #[test]
    fn assembles_subtitle_stream_probe_without_audio() {
        let raw = std::fs::read_to_string(fixture_path("subtitle-stream.json")).expect("fixture");
        let ffprobe: Value = serde_json::from_str(&raw).expect("json");
        let timeline = assemble_probe_timeline(
            &ffprobe,
            &AssembleOptions {
                include_streams: true,
                include_chapters: true,
            },
        );
        assert_eq!(timeline.format.duration_ms, 12_500);
        assert_eq!(timeline.streams.len(), 2);
        assert!(timeline
            .warnings
            .iter()
            .any(|w| w.contains("No audio stream")), "{:?}", timeline.warnings);
        assert_eq!(timeline.route, TIMELINE_ROUTE);
    }

}
