use std::path::Path;
use std::process::Command;

use serde::Serialize;
use serde_json::Value;

use crate::frames::{crop_frame, render_frame, CropRegion, FrameErrorCode};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VideoEvidenceErrorCode {
    InvalidParams,
    InvalidRequest,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VideoEvidenceError {
    pub code: VideoEvidenceErrorCode,
    pub message: String,
}

impl VideoEvidenceError {
    pub(crate) fn invalid_params(message: impl Into<String>) -> Self {
        Self {
            code: VideoEvidenceErrorCode::InvalidParams,
            message: message.into(),
        }
    }

    pub(crate) fn invalid_request(message: impl Into<String>) -> Self {
        Self {
            code: VideoEvidenceErrorCode::InvalidRequest,
            message: message.into(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct FrameOcrLine {
    pub text: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct FrameOcrEvidence {
    pub available: bool,
    pub route: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skipped_reason: Option<String>,
    pub languages: Vec<String>,
    pub lines: Vec<FrameOcrLine>,
    pub line_count: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct VideoEvidenceSourceResult {
    pub source: String,
    pub success: bool,
    pub time_ms: u64,
    pub operation: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub route: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub frame: Option<crate::frames::FrameRenderEvidence>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ocr: Option<FrameOcrEvidence>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct VideoEvidenceResponse {
    pub engine: &'static str,
    pub results: Vec<VideoEvidenceSourceResult>,
}

pub fn video_evidence_from_value(input: &Value) -> Result<VideoEvidenceResponse, VideoEvidenceError> {
    let operation = input
        .get("operation")
        .and_then(Value::as_str)
        .ok_or_else(|| VideoEvidenceError::invalid_params("operation is required"))?;

    let sources = input
        .get("sources")
        .and_then(Value::as_array)
        .ok_or_else(|| VideoEvidenceError::invalid_params("sources array is required"))?;

    let max_dimension = input
        .get("max_dimension")
        .and_then(Value::as_u64)
        .map(|value| value as u32);

    let ocr_languages: Vec<String> = input
        .get("ocr_languages")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_else(|| vec!["eng".into()]);

    let mut results = Vec::with_capacity(sources.len());
    for source in sources {
        let path = source
            .get("path")
            .and_then(Value::as_str)
            .ok_or_else(|| VideoEvidenceError::invalid_params("each source requires a path"))?;
        let time_ms = source
            .get("time_ms")
            .and_then(Value::as_u64)
            .ok_or_else(|| VideoEvidenceError::invalid_params("each source requires time_ms"))?;

        match operation {
            "render_frame" => match render_frame(Path::new(path), time_ms, max_dimension) {
                Ok(frame) => results.push(ok_frame_result(path, time_ms, operation, frame, None)),
                Err(error) => results.push(failed_result(path, time_ms, operation, error)),
            },
            "crop_frame" => {
                let crop = parse_crop(source.get("crop").ok_or_else(|| {
                    VideoEvidenceError::invalid_params("crop is required for crop_frame")
                })?)?;
                match crop_frame(Path::new(path), time_ms, &crop, max_dimension) {
                    Ok(frame) => results.push(ok_frame_result(path, time_ms, operation, frame, None)),
                    Err(error) => results.push(failed_result(path, time_ms, operation, error)),
                }
            }
            "ocr_frame" => match render_frame(Path::new(path), time_ms, max_dimension) {
                Ok(mut frame) => {
                    let ocr = ocr_frame_png_base64(&frame.image_base64, &ocr_languages);
                    frame.image_base64 = String::new();
                    let route = if ocr.available {
                        "rust-frame-render+tesseract_frame".to_string()
                    } else {
                        "rust-frame-render+tesseract_unavailable".to_string()
                    };
                    let mut result = ok_frame_result(path, time_ms, operation, frame, Some(ocr));
                    result.route = Some(route);
                    results.push(result);
                }
                Err(error) => results.push(failed_result(path, time_ms, operation, error)),
            },
            other => {
                return Err(VideoEvidenceError::invalid_params(format!(
                    "Unsupported operation: {other}"
                )));
            }
        }
    }

    Ok(VideoEvidenceResponse {
        engine: crate::ENGINE_NAME,
        results,
    })
}

fn ok_frame_result(
    path: &str,
    time_ms: u64,
    operation: &str,
    frame: crate::frames::FrameRenderEvidence,
    ocr: Option<FrameOcrEvidence>,
) -> VideoEvidenceSourceResult {
    VideoEvidenceSourceResult {
        source: path.to_string(),
        success: true,
        time_ms,
        operation: operation.to_string(),
        route: Some(frame.route.clone()),
        frame: Some(frame),
        ocr,
        error: None,
        code: None,
    }
}

fn tesseract_available() -> bool {
    Command::new("tesseract")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

fn ocr_frame_png_base64(image_base64: &str, languages: &[String]) -> FrameOcrEvidence {
    let langs = if languages.is_empty() {
        vec!["eng".to_string()]
    } else {
        languages.to_vec()
    };
    if !tesseract_available() {
        return FrameOcrEvidence {
            available: false,
            route: "tesseract_frame".into(),
            skipped_reason: Some(
                "Tesseract is not installed or not available on PATH.".into(),
            ),
            languages: langs,
            lines: vec![],
            line_count: 0,
        };
    }

    let Ok(bytes) = base64_decode(image_base64) else {
        return FrameOcrEvidence {
            available: false,
            route: "tesseract_frame".into(),
            skipped_reason: Some("Failed to decode rendered frame base64.".into()),
            languages: langs,
            lines: vec![],
            line_count: 0,
        };
    };

    let tmp_dir = std::env::temp_dir().join(format!(
        "cue-ocr-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    ));
    let _ = std::fs::create_dir_all(&tmp_dir);
    let png_path = tmp_dir.join("frame.png");
    if std::fs::write(&png_path, bytes).is_err() {
        let _ = std::fs::remove_dir_all(&tmp_dir);
        return FrameOcrEvidence {
            available: false,
            route: "tesseract_frame".into(),
            skipped_reason: Some("Failed to write temporary frame PNG.".into()),
            languages: langs,
            lines: vec![],
            line_count: 0,
        };
    }

    let lang_arg = langs.join("+");
    let output = Command::new("tesseract")
        .args([
            png_path.to_string_lossy().as_ref(),
            "stdout",
            "-l",
            &lang_arg,
            "--psm",
            "6",
        ])
        .output();
    let _ = std::fs::remove_dir_all(&tmp_dir);

    match output {
        Ok(out) if out.status.success() => {
            let text = String::from_utf8_lossy(&out.stdout);
            let lines: Vec<FrameOcrLine> = text
                .lines()
                .map(str::trim)
                .filter(|l| !l.is_empty())
                .map(|l| FrameOcrLine {
                    text: l.to_string(),
                })
                .collect();
            let line_count = lines.len();
            FrameOcrEvidence {
                available: true,
                route: "tesseract_frame".into(),
                skipped_reason: None,
                languages: langs,
                lines,
                line_count,
            }
        }
        Ok(out) => {
            let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
            FrameOcrEvidence {
                available: false,
                route: "tesseract_frame".into(),
                skipped_reason: Some(if stderr.is_empty() {
                    format!("Tesseract exited with status {:?}", out.status.code())
                } else {
                    stderr
                }),
                languages: langs,
                lines: vec![],
                line_count: 0,
            }
        }
        Err(err) => FrameOcrEvidence {
            available: false,
            route: "tesseract_frame".into(),
            skipped_reason: Some(format!("Tesseract failed to start: {err}")),
            languages: langs,
            lines: vec![],
            line_count: 0,
        },
    }
}

fn base64_decode(input: &str) -> Result<Vec<u8>, ()> {
    const TABLE: &[u8; 64] =
        b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut rev = [255u8; 256];
    for (i, &c) in TABLE.iter().enumerate() {
        rev[c as usize] = i as u8;
    }
    let clean: Vec<u8> = input
        .bytes()
        .filter(|b| !b.is_ascii_whitespace() && *b != b'=')
        .collect();
    if clean.len() % 4 == 1 {
        return Err(());
    }
    let mut out = Vec::with_capacity(clean.len() * 3 / 4);
    let mut i = 0;
    while i + 4 <= clean.len() {
        let a = rev[clean[i] as usize];
        let b = rev[clean[i + 1] as usize];
        let c = rev[clean[i + 2] as usize];
        let d = rev[clean[i + 3] as usize];
        if a == 255 || b == 255 || c == 255 || d == 255 {
            return Err(());
        }
        out.push((a << 2) | (b >> 4));
        out.push((b << 4) | (c >> 2));
        out.push((c << 6) | d);
        i += 4;
    }
    let rem = clean.len() - i;
    if rem == 2 {
        let a = rev[clean[i] as usize];
        let b = rev[clean[i + 1] as usize];
        if a == 255 || b == 255 {
            return Err(());
        }
        out.push((a << 2) | (b >> 4));
    } else if rem == 3 {
        let a = rev[clean[i] as usize];
        let b = rev[clean[i + 1] as usize];
        let c = rev[clean[i + 2] as usize];
        if a == 255 || b == 255 || c == 255 {
            return Err(());
        }
        out.push((a << 2) | (b >> 4));
        out.push((b << 4) | (c >> 2));
    }
    Ok(out)
}

fn failed_result(
    path: &str,
    time_ms: u64,
    operation: &str,
    error: crate::frames::FrameError,
) -> VideoEvidenceSourceResult {
    let code = match error.code {
        FrameErrorCode::InvalidParams => "INVALID_PARAMS",
        FrameErrorCode::FfmpegUnavailable => "FFMPEG_UNAVAILABLE",
        FrameErrorCode::ExtractionFailed => "EXTRACTION_FAILED",
    };
    VideoEvidenceSourceResult {
        source: path.to_string(),
        success: false,
        time_ms,
        operation: operation.to_string(),
        route: None,
        frame: None,
        ocr: None,
        error: Some(error.message),
        code: Some(code.into()),
    }
}

fn parse_crop(value: &Value) -> Result<CropRegion, VideoEvidenceError> {
    let x = value
        .get("x")
        .and_then(Value::as_u64)
        .ok_or_else(|| VideoEvidenceError::invalid_params("crop.x is required"))?;
    let y = value
        .get("y")
        .and_then(Value::as_u64)
        .ok_or_else(|| VideoEvidenceError::invalid_params("crop.y is required"))?;
    let width = value
        .get("width")
        .and_then(Value::as_u64)
        .ok_or_else(|| VideoEvidenceError::invalid_params("crop.width is required"))?;
    let height = value
        .get("height")
        .and_then(Value::as_u64)
        .ok_or_else(|| VideoEvidenceError::invalid_params("crop.height is required"))?;

    Ok(CropRegion {
        x: x as u32,
        y: y as u32,
        width: width as u32,
        height: height as u32,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ocr_frame_is_supported_and_honest_without_video() {
        let result = video_evidence_from_value(&serde_json::json!({
            "operation": "ocr_frame",
            "sources": [{ "path": "/tmp/definitely-missing-cue.mp4", "time_ms": 0 }]
        }))
        .expect("ocr_frame should not hard-reject as unsupported");
        assert_eq!(result.results.len(), 1);
        assert!(!result.results[0].success);
    }

    #[test]
    fn ocr_tesseract_unavailable_honesty_unit() {
        let ocr = ocr_frame_png_base64("not-valid-base64!!!", &["eng".into()]);
        assert!(!ocr.available);
        assert_eq!(ocr.route, "tesseract_frame");
        assert!(ocr.skipped_reason.is_some());
    }

    #[test]
    fn render_frame_route_constant_is_stable() {
        assert_eq!(crate::frames::RENDER_FRAME_ROUTE, "rust-frame-render");
    }

    #[test]
    fn parse_crop_requires_positive_dims() {
        use serde_json::json;
        let crop = parse_crop(&json!({"x":1,"y":2,"width":3,"height":4})).expect("ok");
        assert_eq!(crop.x, 1);
        assert_eq!(crop.y, 2);
        assert_eq!(crop.width, 3);
        assert_eq!(crop.height, 4);
        assert!(parse_crop(&json!({"x":0,"y":0,"width":0,"height":1})).is_ok());
        assert!(parse_crop(&json!({"x":0,"y":0,"width":1})).is_err());
        assert!(parse_crop(&json!({})).is_err());
        assert!(parse_crop(&json!({"x":"no","y":0,"width":1,"height":1})).is_err());
    }

    #[test]
    fn bw7_parse_crop_missing_fields_matrix() {
        use serde_json::json;
        assert!(parse_crop(&json!({"y":0,"width":1,"height":1})).is_err());
        assert!(parse_crop(&json!({"x":0,"width":1,"height":1})).is_err());
        assert!(parse_crop(&json!({"x":0,"y":0,"height":1})).is_err());
        assert!(parse_crop(&json!({"x":0,"y":0,"width":1})).is_err());
        let ok = parse_crop(&json!({"x":10,"y":20,"width":30,"height":40})).unwrap();
        assert_eq!((ok.x, ok.y, ok.width, ok.height), (10, 20, 30, 40));
    }

    #[test]
    fn bw8_parse_crop_zero_and_large_u64_cast() {
        use serde_json::json;
        let c = parse_crop(&json!({"x":0,"y":0,"width":0,"height":0})).unwrap();
        assert_eq!((c.x, c.y, c.width, c.height), (0, 0, 0, 0));
        let c = parse_crop(&json!({"x":100,"y":200,"width":300,"height":400})).unwrap();
        assert_eq!((c.x, c.y, c.width, c.height), (100, 200, 300, 400));
        assert!(parse_crop(&json!({"x":1.5,"y":0,"width":1,"height":1})).is_err());
    }

    #[test]
    fn bulk_parse_crop_valid_minimal() {
        use serde_json::json;
        let c = parse_crop(&json!({"x":0,"y":0,"width":10,"height":10})).expect("crop");
        assert_eq!(c.width, 10);
        assert_eq!(c.height, 10);
        let zero = parse_crop(&json!({"x":0,"y":0,"width":0,"height":10}));
        match zero {
            Ok(c) => assert_eq!(c.width, 0),
            Err(_) => {}
        }
        assert!(parse_crop(&json!({"x":0,"y":0})).is_err());
    }

    #[test]
    fn base64_roundtrip_small() {
        let decoded = base64_decode("aGk=").expect("decode");
        assert_eq!(decoded, b"hi");
    }
}
