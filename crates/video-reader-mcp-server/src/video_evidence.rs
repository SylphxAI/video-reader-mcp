use rmcp::model::CallToolResult;
use serde_json::Value;
use video_reader_core::{video_evidence_from_value, VideoEvidenceErrorCode};

pub fn video_evidence(args: Value) -> Result<CallToolResult, rmcp::ErrorData> {
    let response = video_evidence_from_value(&args).map_err(|error| match error.code {
        VideoEvidenceErrorCode::InvalidParams => {
            rmcp::ErrorData::invalid_params(error.message, None)
        }
        VideoEvidenceErrorCode::InvalidRequest => {
            rmcp::ErrorData::invalid_request(error.message, None)
        }
    })?;

    let structured = serde_json::json!({
        "tool": "video_evidence",
        "engine": video_reader_core::ENGINE_NAME,
        "results": response.results,
    });

    Ok(CallToolResult::structured(structured))
}