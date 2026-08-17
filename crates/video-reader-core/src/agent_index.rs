//! Text-first timeline outline for agents that cannot inspect pixels directly.

use serde::Serialize;

use crate::frames::KeyframeEvidence;
use crate::scenes::SceneInfo;
use crate::subtitles::SubtitleCue;
use crate::timeline::{ChapterInfo, FormatInfo, StreamInfo};

pub const AGENT_INDEX_POLICY: &str = "agent_video_index_v1";

#[derive(Debug, Clone, Serialize)]
pub struct AgentVideoIndex {
    pub policy: &'static str,
    pub source: String,
    pub duration_ms: u64,
    pub outline: String,
    pub scene_count: u32,
    pub keyframe_count: u32,
    pub subtitle_cue_count: u32,
    pub transcript_segment_count: u32,
    pub audio_stream_count: u32,
    pub video_stream_count: u32,
}

pub fn build_agent_video_index(
    source: &str,
    format: &FormatInfo,
    streams: &[StreamInfo],
    chapters: &[ChapterInfo],
    scenes: &[SceneInfo],
    subtitles: &[SubtitleCue],
    keyframes: &[KeyframeEvidence],
    transcript_segment_count: usize,
    warnings: &[String],
) -> AgentVideoIndex {
    let audio_streams = streams
        .iter()
        .filter(|stream| stream.codec_type == "audio")
        .collect::<Vec<_>>();
    let video_streams = streams
        .iter()
        .filter(|stream| stream.codec_type == "video")
        .collect::<Vec<_>>();

    let mut lines = vec![
        format!("# Video index: {source}"),
        format!("- duration_ms: {}", format.duration_ms),
        format!(
            "- container: {}",
            format.format_name.as_deref().unwrap_or("unknown")
        ),
        format!("- video_streams: {}", video_streams.len()),
        format!("- audio_streams: {}", audio_streams.len()),
        format!("- chapters: {}", chapters.len()),
        format!("- scenes: {}", scenes.len()),
        format!("- timestamp_keyframes: {}", keyframes.len()),
        format!("- subtitle_cues: {}", subtitles.len()),
        format!("- transcript_segments: {transcript_segment_count}"),
    ];

    if !chapters.is_empty() {
        lines.extend(["".into(), "## Chapter segments".into()]);
        for chapter in chapters.iter().take(40) {
            lines.push(format!(
                "- {}ms..{}ms: {}",
                chapter.start_ms,
                chapter.end_ms,
                chapter.title.as_deref().unwrap_or("untitled")
            ));
        }
        if chapters.len() > 40 {
            lines.push(format!("- ... {} more chapters", chapters.len() - 40));
        }
    }

    if !scenes.is_empty() {
        lines.extend(["".into(), "## Scene cut timestamps".into()]);
        for scene in scenes.iter().take(40) {
            lines.push(format!(
                "- scene cut {}: {}ms",
                scene.index + 1,
                scene.time_ms
            ));
        }
        if scenes.len() > 40 {
            lines.push(format!("- ... {} more scene cuts", scenes.len() - 40));
        }
    }

    if !subtitles.is_empty() {
        lines.extend(["".into(), "## Embedded subtitle cues".into()]);
        for cue in subtitles.iter().take(24) {
            lines.push(format!(
                "- {}ms..{}ms: {}",
                cue.start_ms, cue.end_ms, cue.text
            ));
        }
        if subtitles.len() > 24 {
            lines.push(format!("- ... {} more subtitle cues", subtitles.len() - 24));
        }
    }

    if !keyframes.is_empty() {
        lines.extend(["".into(), "## I-frame timestamp locators".into()]);
        for keyframe in keyframes.iter().take(32) {
            lines.push(format!(
                "- kf {}: t={}ms{}",
                keyframe.index + 1,
                keyframe.time_ms,
                keyframe
                    .frame_hash
                    .as_deref()
                    .map(|hash| { format!(" hash={}", hash.chars().take(12).collect::<String>()) })
                    .unwrap_or_default()
            ));
        }
        if keyframes.len() > 32 {
            lines.push(format!("- ... {} more keyframes", keyframes.len() - 32));
        }
    }

    if !warnings.is_empty() {
        lines.extend(["".into(), "## Warnings".into()]);
        lines.extend(warnings.iter().map(|warning| format!("- {warning}")));
    }

    lines.extend([
        "".into(),
        "## Agent guidance".into(),
        "- Use chapter, scene, subtitle, and keyframe timestamps as locators; do not invent a fixed sampling grid.".into(),
        "- Follow up with video_evidence at a locator time_ms for pixel claims.".into(),
        "- Optional ASR or vision remains non-authoritative unless explicitly configured and evidenced.".into(),
    ]);

    AgentVideoIndex {
        policy: AGENT_INDEX_POLICY,
        source: source.into(),
        duration_ms: format.duration_ms,
        outline: lines.join("\n"),
        scene_count: scenes.len() as u32,
        keyframe_count: keyframes.len() as u32,
        subtitle_cue_count: subtitles.len() as u32,
        transcript_segment_count: transcript_segment_count as u32,
        audio_stream_count: audio_streams.len() as u32,
        video_stream_count: video_streams.len() as u32,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::frames::{KeyframeProvenance, KEYFRAME_ROUTE};
    use crate::scenes::SceneProvenance;
    use crate::subtitles::{SubtitleCue, SubtitleProvenance};
    use serde_json::json;

    #[test]
    fn builds_repeatable_outline_with_timestamped_segments() {
        let format = FormatInfo {
            format_name: Some("mp4".into()),
            duration_ms: 5000,
            bit_rate: None,
            size_bytes: None,
            tags: None,
        };
        let streams = vec![
            StreamInfo {
                index: 0,
                codec_type: "video".into(),
                codec_name: Some("h264".into()),
                language: None,
                channels: None,
                sample_rate: None,
                width: Some(160),
                height: Some(120),
                avg_frame_rate: None,
                r_frame_rate: None,
                bit_rate: None,
                disposition: None,
                tags: None,
            },
            StreamInfo {
                index: 1,
                codec_type: "audio".into(),
                codec_name: Some("aac".into()),
                language: None,
                channels: Some(2),
                sample_rate: Some(48_000),
                width: None,
                height: None,
                avg_frame_rate: None,
                r_frame_rate: None,
                bit_rate: None,
                disposition: None,
                tags: None,
            },
        ];
        let chapters = vec![ChapterInfo {
            id: 1,
            start_ms: 0,
            end_ms: 5000,
            title: Some("Intro".into()),
        }];
        let scenes = vec![SceneInfo {
            index: 0,
            time_ms: 1250,
            provenance: SceneProvenance {
                method: "ffmpeg_scene_filter".into(),
                threshold: 0.4,
            },
        }];
        let subtitles = vec![SubtitleCue {
            index: 0,
            start_ms: 100,
            end_ms: 900,
            text: "Hello".into(),
            stream_index: Some(2),
            language: Some("en".into()),
            provenance: SubtitleProvenance {
                method: "ffmpeg_extract".into(),
                format: "srt".into(),
            },
        }];
        let keyframes = vec![KeyframeEvidence {
            index: 0,
            time_ms: 0,
            provenance: KeyframeProvenance {
                method: "ffmpeg_keyframe_select".into(),
                pict_type: "I".into(),
            },
            route: KEYFRAME_ROUTE.into(),
            frame_hash: Some("abcdef0123456789".into()),
            mime: None,
            width: None,
            height: None,
            image_base64: None,
        }];

        let index = build_agent_video_index(
            "/tmp/demo.mp4",
            &format,
            &streams,
            &chapters,
            &scenes,
            &subtitles,
            &keyframes,
            0,
            &["ffmpeg unavailable".into()],
        );
        assert_eq!(index.policy, AGENT_INDEX_POLICY);
        assert_eq!(index.scene_count, 1);
        assert_eq!(index.subtitle_cue_count, 1);
        assert!(index.outline.contains("0ms..5000ms: Intro"));
        assert!(index.outline.contains("1250ms"));
        assert!(index.outline.contains("100ms..900ms: Hello"));
        assert!(index.outline.contains("video_evidence"));
        let serialized = serde_json::to_value(index).expect("serialize");
        assert_eq!(serialized["duration_ms"], json!(5000));
    }
}
