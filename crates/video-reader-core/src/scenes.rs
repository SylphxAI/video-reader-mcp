//! Deterministic scene-cut locators from ffmpeg's scene filter.

use std::path::Path;
use std::process::{Command, Stdio};

use serde::{Deserialize, Serialize};

pub const SCENE_ROUTE: &str = "rust-scene-filter";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SceneProvenance {
    pub method: String,
    pub threshold: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SceneInfo {
    pub index: u32,
    pub time_ms: u64,
    pub provenance: SceneProvenance,
}

/// Parse `showinfo` timestamps without treating frame sampling as a scene.
pub fn parse_scene_times(stderr: &str, threshold: f64) -> Vec<SceneInfo> {
    let mut scenes = Vec::new();
    for line in stderr.lines() {
        let Some(index) = line.find("pts_time:") else {
            continue;
        };
        let rest = &line[index + "pts_time:".len()..];
        let seconds = rest
            .split_whitespace()
            .next()
            .and_then(|value| value.parse::<f64>().ok());
        let Some(seconds) = seconds else {
            continue;
        };
        if !seconds.is_finite() || seconds < 0.0 {
            continue;
        }
        scenes.push(SceneInfo {
            index: scenes.len() as u32,
            time_ms: (seconds * 1000.0).round() as u64,
            provenance: SceneProvenance {
                method: "ffmpeg_scene_filter".into(),
                threshold,
            },
        });
    }
    scenes
}

pub fn detect_scenes(path: &Path, threshold: f64) -> Result<Vec<SceneInfo>, String> {
    if !command_exists("ffmpeg") {
        return Err("FFMPEG_UNAVAILABLE: ffmpeg is not installed; scene detection skipped.".into());
    }

    let filter = format!("select='gt(scene,{threshold:.6})',showinfo");
    let output = Command::new("ffmpeg")
        .args(["-hide_banner", "-loglevel", "info", "-i"])
        .arg(path)
        .args(["-vf", &filter, "-f", "null", "-"])
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .output()
        .map_err(|error| format!("SCENE_DETECTION_FAILED: failed to launch ffmpeg: {error}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(format!(
            "SCENE_DETECTION_FAILED: {}",
            if stderr.is_empty() {
                "ffmpeg scene detection exited with a non-zero status.".to_string()
            } else {
                stderr
            }
        ));
    }

    Ok(parse_scene_times(
        &String::from_utf8_lossy(&output.stderr),
        threshold,
    ))
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

    #[test]
    fn parses_scene_pts_times_and_preserves_threshold() {
        let stderr = "[showinfo] pts_time:0.000000\n[showinfo] pts_time:3.000000\n[showinfo] pts_time:6.125000";
        let scenes = parse_scene_times(stderr, 0.4);
        assert_eq!(scenes.len(), 3);
        assert_eq!(scenes[0].time_ms, 0);
        assert_eq!(scenes[1].time_ms, 3000);
        assert_eq!(scenes[2].time_ms, 6125);
        assert_eq!(scenes[1].index, 1);
        assert_eq!(scenes[1].provenance.method, "ffmpeg_scene_filter");
        assert!((scenes[1].provenance.threshold - 0.4).abs() < f64::EPSILON);
    }

    #[test]
    fn ignores_invalid_scene_timestamps() {
        let scenes = parse_scene_times(
            "pts_time:not-a-number\npts_time:-1.0\npts_time:2.5 extra",
            0.25,
        );
        assert_eq!(scenes.len(), 1);
        assert_eq!(scenes[0].time_ms, 2500);
    }
}
