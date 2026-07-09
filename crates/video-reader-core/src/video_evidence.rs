use std::path::Path;

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

    if operation == "ocr_frame" {
        return Err(VideoEvidenceError::invalid_request(
            "ocr_frame is not available on the default Rust video_evidence route.",
        ));
    }

    let sources = input
        .get("sources")
        .and_then(Value::as_array)
        .ok_or_else(|| VideoEvidenceError::invalid_params("sources array is required"))?;

    let max_dimension = input
        .get("max_dimension")
        .and_then(Value::as_u64)
        .map(|value| value as u32);

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
                Ok(frame) => results.push(VideoEvidenceSourceResult {
                    source: path.to_string(),
                    success: true,
                    time_ms,
                    operation: operation.to_string(),
                    route: Some(frame.route.clone()),
                    frame: Some(frame),
                    error: None,
                    code: None,
                }),
                Err(error) => results.push(failed_result(path, time_ms, operation, error)),
            },
            "crop_frame" => {
                let crop = parse_crop(source.get("crop").ok_or_else(|| {
                    VideoEvidenceError::invalid_params("crop is required for crop_frame")
                })?)?;
                match crop_frame(Path::new(path), time_ms, &crop, max_dimension) {
                    Ok(frame) => results.push(VideoEvidenceSourceResult {
                        source: path.to_string(),
                        success: true,
                        time_ms,
                        operation: operation.to_string(),
                        route: Some(frame.route.clone()),
                        frame: Some(frame),
                        error: None,
                        code: None,
                    }),
                    Err(error) => results.push(failed_result(path, time_ms, operation, error)),
                }
            }
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
    fn rejects_ocr_frame_on_default_route() {
        let err = video_evidence_from_value(&serde_json::json!({
            "operation": "ocr_frame",
            "sources": [{ "path": "/tmp/a.mp4", "time_ms": 0 }]
        }))
        .expect_err("ocr");

        assert_eq!(err.code, VideoEvidenceErrorCode::InvalidRequest);
    }

    #[test]
    fn render_frame_route_constant_is_stable() {
        assert_eq!(crate::frames::RENDER_FRAME_ROUTE, "rust-frame-render");
    }
}