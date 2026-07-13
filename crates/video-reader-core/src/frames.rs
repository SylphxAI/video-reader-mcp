//! Keyframe indexing and PNG thumbnail evidence via ffmpeg.

use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const KEYFRAME_ROUTE: &str = "rust-keyframe-png";
pub const RENDER_FRAME_ROUTE: &str = "rust-frame-render";
pub const CROP_FRAME_ROUTE: &str = "rust-frame-crop";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CropRegion {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FrameRenderProvenance {
    pub method: String,
    pub time_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FrameRenderEvidence {
    pub time_ms: u64,
    pub route: String,
    pub frame_hash: String,
    pub mime: String,
    pub width: u32,
    pub height: u32,
    pub image_base64: String,
    pub provenance: FrameRenderProvenance,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub crop: Option<CropRegion>,
}

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

pub fn render_frame(
    path: &Path,
    time_ms: u64,
    max_dimension: Option<u32>,
) -> Result<FrameRenderEvidence, FrameError> {
    ensure_video_file(path)?;
    ensure_ffmpeg_available()?;

    let thumbnail = render_frame_png(path, time_ms, max_dimension, None).map_err(|message| {
        FrameError {
            code: FrameErrorCode::ExtractionFailed,
            message,
        }
    })?;

    Ok(FrameRenderEvidence {
        time_ms,
        route: RENDER_FRAME_ROUTE.into(),
        frame_hash: thumbnail.frame_hash,
        mime: "image/png".into(),
        width: thumbnail.width,
        height: thumbnail.height,
        image_base64: thumbnail.image_base64,
        provenance: FrameRenderProvenance {
            method: "ffmpeg_seek_render".into(),
            time_ms,
        },
        crop: None,
    })
}

pub fn crop_frame(
    path: &Path,
    time_ms: u64,
    crop: &CropRegion,
    max_dimension: Option<u32>,
) -> Result<FrameRenderEvidence, FrameError> {
    if crop.width == 0 || crop.height == 0 {
        return Err(FrameError {
            code: FrameErrorCode::InvalidParams,
            message: "crop width and height must be positive.".into(),
        });
    }

    ensure_video_file(path)?;
    ensure_ffmpeg_available()?;

    let thumbnail = render_frame_png(path, time_ms, max_dimension, Some(crop)).map_err(|message| {
        FrameError {
            code: FrameErrorCode::ExtractionFailed,
            message,
        }
    })?;

    Ok(FrameRenderEvidence {
        time_ms,
        route: CROP_FRAME_ROUTE.into(),
        frame_hash: thumbnail.frame_hash,
        mime: "image/png".into(),
        width: thumbnail.width,
        height: thumbnail.height,
        image_base64: thumbnail.image_base64,
        provenance: FrameRenderProvenance {
            method: "ffmpeg_seek_crop_render".into(),
            time_ms,
        },
        crop: Some(crop.clone()),
    })
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

    ensure_video_file(path)?;
    ensure_ffmpeg_available()?;

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
            let thumbnail = render_frame_png(path, time_ms, max_dimension, None).map_err(|message| {
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

fn ensure_video_file(path: &Path) -> Result<(), FrameError> {
    if !path.is_file() {
        return Err(FrameError {
            code: FrameErrorCode::InvalidParams,
            message: format!("Video path '{}' is not a readable file.", path.display()),
        });
    }
    Ok(())
}

fn ensure_ffmpeg_available() -> Result<(), FrameError> {
    if !command_exists("ffmpeg") {
        return Err(FrameError {
            code: FrameErrorCode::FfmpegUnavailable,
            message: "ffmpeg is required for frame evidence but was not found on PATH.".into(),
        });
    }
    Ok(())
}

fn render_frame_png(
    path: &Path,
    time_ms: u64,
    max_dimension: Option<u32>,
    crop: Option<&CropRegion>,
) -> Result<ThumbnailPng, String> {
    let seconds = format!("{:.3}", time_ms as f64 / 1000.0);
    let filter = build_frame_filter(max_dimension, crop);

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
            &filter,
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

fn build_frame_filter(max_dimension: Option<u32>, crop: Option<&CropRegion>) -> String {
    let mut filters = Vec::new();
    if let Some(region) = crop {
        filters.push(format!(
            "crop={}:{}:{}:{}",
            region.width, region.height, region.x, region.y
        ));
    }
    match max_dimension {
        Some(limit) if limit > 0 => filters.push(format!("scale='min({limit},iw)':-2")),
        _ if crop.is_some() => filters.push("scale=iw:ih".into()),
        _ => return "scale=iw:ih".into(),
    };
    filters.join(",")
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
    fn build_frame_filter_includes_crop_and_scale() {
        let crop = CropRegion {
            x: 10,
            y: 20,
            width: 80,
            height: 60,
        };
        let filter = build_frame_filter(Some(320), Some(&crop));
        assert!(filter.contains("crop=80:60:10:20"));
        assert!(filter.contains("scale='min(320,iw)':-2"));
    }

    #[test]
    fn parses_keyframe_pts_times_from_showinfo_stderr() {
        let stderr = "[Parsed_showinfo_0] n:   0 pts:      0 pts_time:0.000000 pict_type:I
[Parsed_showinfo_0] n:  24 pts:  48000 pts_time:2.000000 pict_type:I";

        let times = parse_keyframe_times(stderr, 8);
        assert_eq!(times, vec![0, 2000]);
    }

    #[test]
    fn parse_keyframe_times_and_frame_filter_pure() {
        let stderr = "n:0 pts_time:0.000\nn:1 pts_time:1.250 foo\nn:2 pts_time:2.5\nbad line\nn:3 pts_time:3.0\n";
        assert_eq!(parse_keyframe_times(stderr, 2), vec![0, 1250]);
        assert_eq!(parse_keyframe_times(stderr, 10), vec![0, 1250, 2500, 3000]);
        assert!(parse_keyframe_times("no times", 5).is_empty());
        assert_eq!(build_frame_filter(None, None), "scale=iw:ih");
        assert_eq!(
            build_frame_filter(Some(320), None),
            "scale='min(320,iw)':-2"
        );
        let crop = CropRegion {
            x: 1,
            y: 2,
            width: 10,
            height: 20,
        };
        assert_eq!(
            build_frame_filter(None, Some(&crop)),
            "crop=10:20:1:2,scale=iw:ih"
        );
        assert_eq!(
            build_frame_filter(Some(0), Some(&crop)),
            "crop=10:20:1:2,scale=iw:ih"
        );
        assert_eq!(
            build_frame_filter(Some(64), Some(&crop)),
            "crop=10:20:1:2,scale='min(64,iw)':-2"
        );
    }

    #[test]
    fn png_dimensions_and_base64_encode_pure() {
        // minimal IHDR layout: 8-byte sig + length/type + width/height
        let mut bytes = vec![137, 80, 78, 71, 13, 10, 26, 10];
        bytes.extend_from_slice(&[0, 0, 0, 13]); // length
        bytes.extend_from_slice(b"IHDR");
        bytes.extend_from_slice(&12u32.to_be_bytes());
        bytes.extend_from_slice(&8u32.to_be_bytes());
        // pad to 24+
        while bytes.len() < 24 {
            bytes.push(0);
        }
        assert_eq!(png_dimensions(&bytes), Some((12, 8)));
        assert_eq!(png_dimensions(&[]), None);
        assert_eq!(png_dimensions(&[0u8; 30]), None);
        assert_eq!(base64_encode(b""), "");
        assert_eq!(base64_encode(b"f"), "Zg==");
        assert_eq!(base64_encode(b"fo"), "Zm8=");
        assert_eq!(base64_encode(b"foo"), "Zm9v");
    }



    #[test]
    fn bw7_parse_keyframe_times_limit_zero_and_bad_tokens() {
        let stderr = "pts_time:1.0\npts_time:notanumber\npts_time:2.5 extra\n";
        // Honest contract: limit is checked after push (`len >= limit`), so limit=0
        // still records the first parsed time then breaks (1 >= 0).
        assert_eq!(parse_keyframe_times(stderr, 0), vec![1000]);
        assert_eq!(parse_keyframe_times(stderr, 1), vec![1000]);
        assert_eq!(parse_keyframe_times(stderr, 10), vec![1000, 2500]);
        assert_eq!(build_frame_filter(Some(0), None), "scale=iw:ih");
    }

    #[test]
    fn bw7_png_dimensions_short_and_base64_pad() {
        assert_eq!(png_dimensions(&[137, 80, 78, 71]), None);
        let bad_sig = vec![0u8; 24];
        assert_eq!(png_dimensions(&bad_sig), None);
        assert_eq!(base64_encode(b""), "");
        assert_eq!(base64_encode(b"f"), "Zg==");
        assert_eq!(base64_encode(b"fo"), "Zm8=");
        assert_eq!(base64_encode(b"foo"), "Zm9v");
    }


    #[test]
    fn bw8_parse_keyframe_times_rounding_and_limit() {
        let stderr = "pts_time:0.0004\npts_time:0.0006\npts_time:1.9996\n";
        assert_eq!(parse_keyframe_times(stderr, 10), vec![0, 1, 2000]);
        assert_eq!(parse_keyframe_times(stderr, 2), vec![0, 1]);
        assert_eq!(parse_keyframe_times("pts_time:\n", 5), Vec::<u64>::new());
        assert_eq!(build_frame_filter(Some(0), None), "scale=iw:ih");
        assert_eq!(build_frame_filter(None, None), "scale=iw:ih");
    }

    #[test]
    fn bw8_png_dimensions_1x1_and_base64_multi() {
        let mut bytes = vec![137, 80, 78, 71, 13, 10, 26, 10];
        bytes.extend_from_slice(&[0, 0, 0, 13]);
        bytes.extend_from_slice(b"IHDR");
        bytes.extend_from_slice(&1u32.to_be_bytes());
        bytes.extend_from_slice(&1u32.to_be_bytes());
        while bytes.len() < 24 {
            bytes.push(0);
        }
        assert_eq!(png_dimensions(&bytes), Some((1, 1)));
        assert_eq!(base64_encode(b"foobar"), "Zm9vYmFy");
        assert_eq!(base64_encode(b"foob"), "Zm9vYg==");
        assert_eq!(base64_encode(b"fooba"), "Zm9vYmE=");
    }
}
