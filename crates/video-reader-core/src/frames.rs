//! Keyframe indexing and PNG thumbnail evidence via ffmpeg.

use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const KEYFRAME_ROUTE: &str = "rust-keyframe-png";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct KeyframeProvenance {
    pub method: String,
    pub pict_type: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct KeyframeEvidence {
    pub index: u32,
    pub time_ms: u64,
    pub provenance: KeyframeProvenance,
    pub route: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub frame_hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mime: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image_base64: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FrameErrorCode {
    InvalidParams,
    FfmpegUnavailable,
    ExtractionFailed,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FrameError {
    pub code: FrameErrorCode,
    pub message: String,
}

pub fn extract_keyframes(
    path: &Path,
    limit: u32,
    include_images: bool,
    max_dimension: Option<u32>,
) -> Result<Vec<KeyframeEvidence>, FrameError> {
    if limit == 0 {
        return Err(FrameError {
            code: FrameErrorCode::InvalidParams,
            message: "keyframe limit must be positive.".into(),
        });
    }

    if !path.is_file() {
        return Err(FrameError {
            code: FrameErrorCode::InvalidParams,
            message: format!("Video path '{}' is not a readable file.", path.display()),
        });
    }

    if !command_exists("ffmpeg") {
        return Err(FrameError {
            code: FrameErrorCode::FfmpegUnavailable,
            message: "ffmpeg is required for keyframe extraction but was not found on PATH.".into(),
        });
    }

    let bounded_limit = limit.min(64);
    let times_ms = index_keyframe_times(path, bounded_limit)?;
    let mut keyframes = Vec::with_capacity(times_ms.len());

    for (index, time_ms) in times_ms.into_iter().enumerate() {
        let mut evidence = KeyframeEvidence {
            index: index as u32,
            time_ms,
            provenance: KeyframeProvenance {
                method: "ffmpeg_keyframe_select".into(),
                pict_type: "I".into(),
            },
            route: KEYFRAME_ROUTE.into(),
            frame_hash: None,
            mime: None,
            width: None,
            height: None,
            image_base64: None,
        };

        if include_images {
            let thumbnail = render_keyframe_png(path, time_ms, max_dimension).map_err(|message| {
                FrameError {
                    code: FrameErrorCode::ExtractionFailed,
                    message,
                }
            })?;
            evidence.frame_hash = Some(thumbnail.frame_hash);
            evidence.mime = Some("image/png".into());
            evidence.width = Some(thumbnail.width);
            evidence.height = Some(thumbnail.height);
            evidence.image_base64 = Some(thumbnail.image_base64);
        }

        keyframes.push(evidence);
    }

    Ok(keyframes)
}

fn index_keyframe_times(path: &Path, limit: u32) -> Result<Vec<u64>, FrameError> {
    let mut child = Command::new("ffmpeg")
        .args([
            "-hide_banner",
            "-i",
        ])
        .arg(path)
        .args([
            "-vf",
            "select='eq(pict_type,I)',showinfo",
            "-vsync",
            "vfr",
            "-f",
            "null",
            "-",
        ])
        .stderr(Stdio::piped())
        .stdout(Stdio::null())
        .spawn()
        .map_err(|error| FrameError {
            code: FrameErrorCode::ExtractionFailed,
            message: format!("Failed to launch ffmpeg for keyframe indexing: {error}"),
        })?;

    let mut stderr = String::new();
    child
        .stderr
        .take()
        .expect("stderr")
        .read_to_string(&mut stderr)
        .map_err(|error| FrameError {
            code: FrameErrorCode::ExtractionFailed,
            message: format!("Failed to read ffmpeg keyframe stderr: {error}"),
        })?;

    let status = child.wait().map_err(|error| FrameError {
        code: FrameErrorCode::ExtractionFailed,
        message: format!("Failed to wait for ffmpeg keyframe indexing: {error}"),
    })?;

    if !status.success() {
        return Err(FrameError {
            code: FrameErrorCode::ExtractionFailed,
            message: "ffmpeg keyframe indexing exited with a non-zero status.".into(),
        });
    }

    Ok(parse_keyframe_times(&stderr, limit))
}

fn parse_keyframe_times(stderr: &str, limit: u32) -> Vec<u64> {
    let mut times = Vec::new();
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
        times.push((seconds * 1000.0).round() as u64);
        if times.len() >= limit as usize {
            break;
        }
    }
    times
}

struct ThumbnailPng {
    frame_hash: String,
    width: u32,
    height: u32,
    image_base64: String,
}

fn render_keyframe_png(
    path: &Path,
    time_ms: u64,
    max_dimension: Option<u32>,
) -> Result<ThumbnailPng, String> {
    let seconds = format!("{:.3}", time_ms as f64 / 1000.0);
    let scale_filter = match max_dimension {
        Some(limit) if limit > 0 => format!("scale='min({limit},iw)':-2"),
        _ => "scale=iw:ih".into(),
    };

    let output = Command::new("ffmpeg")
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-ss",
            &seconds,
            "-i",
        ])
        .arg(path)
        .args([
            "-frames:v",
            "1",
            "-vf",
            &scale_filter,
            "-f",
            "image2pipe",
            "-vcodec",
            "png",
            "-",
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|error| format!("Failed to launch ffmpeg for keyframe PNG: {error}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("ffmpeg keyframe PNG render failed: {stderr}"));
    }

    if output.stdout.is_empty() {
        return Err("ffmpeg produced an empty keyframe PNG.".into());
    }

    let (width, height) = png_dimensions(&output.stdout).unwrap_or((0, 0));
    let frame_hash = format!("{:x}", Sha256::digest(&output.stdout));

    Ok(ThumbnailPng {
        frame_hash,
        width,
        height,
        image_base64: base64_encode(&output.stdout),
    })
}

fn png_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    if bytes.len() < 24 || &bytes[0..8] != [137, 80, 78, 71, 13, 10, 26, 10] {
        return None;
    }

    let width = u32::from_be_bytes([bytes[16], bytes[17], bytes[18], bytes[19]]);
    let height = u32::from_be_bytes([bytes[20], bytes[21], bytes[22], bytes[23]]);
    Some((width, height))
}

fn base64_encode(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((bytes.len() + 2) / 3 * 4);
    let mut index = 0;

    while index + 3 <= bytes.len() {
        let chunk = u32::from(bytes[index]) << 16
            | u32::from(bytes[index + 1]) << 8
            | u32::from(bytes[index + 2]);
        out.push(TABLE[((chunk >> 18) & 63) as usize] as char);
        out.push(TABLE[((chunk >> 12) & 63) as usize] as char);
        out.push(TABLE[((chunk >> 6) & 63) as usize] as char);
        out.push(TABLE[(chunk & 63) as usize] as char);
        index += 3;
    }

    let remainder = bytes.len() - index;
    if remainder == 1 {
        let chunk = u32::from(bytes[index]) << 16;
        out.push(TABLE[((chunk >> 18) & 63) as usize] as char);
        out.push(TABLE[((chunk >> 12) & 63) as usize] as char);
        out.push('=');
        out.push('=');
    } else if remainder == 2 {
        let chunk = u32::from(bytes[index]) << 16 | u32::from(bytes[index + 1]) << 8;
        out.push(TABLE[((chunk >> 18) & 63) as usize] as char);
        out.push(TABLE[((chunk >> 12) & 63) as usize] as char);
        out.push(TABLE[((chunk >> 6) & 63) as usize] as char);
        out.push('=');
    }

    out
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
    fn parses_keyframe_pts_times_from_showinfo_stderr() {
        let stderr = "[Parsed_showinfo_0] n:   0 pts:      0 pts_time:0.000000 pict_type:I
[Parsed_showinfo_0] n:  24 pts:  48000 pts_time:2.000000 pict_type:I";

        let times = parse_keyframe_times(stderr, 8);
        assert_eq!(times, vec![0, 2000]);
    }
}