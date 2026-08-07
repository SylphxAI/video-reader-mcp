use rmcp::model::CallToolResult;
use serde_json::Value;
use video_reader_core::{video_evidence_from_value, VideoEvidenceErrorCode};

use crate::family_envelope::with_family_envelope;

pub fn video_evidence(args: Value) -> Result<CallToolResult, rmcp::ErrorData> {
    let response = video_evidence_from_value(&args).map_err(|error| match error.code {
        VideoEvidenceErrorCode::InvalidParams => {
            rmcp::ErrorData::invalid_params(error.message, None)
        }
        VideoEvidenceErrorCode::InvalidRequest => {
            rmcp::ErrorData::invalid_request(error.message, None)
        }
    })?;

    let structured = with_family_envelope(
        "video_evidence",
        "video_evidence",
        serde_json::json!({
            "tool": "video_evidence",
            "route": "video_evidence",
            "engine": video_reader_core::ENGINE_NAME,
            "results": response.results,
            "status": "ok",
            "warnings": [],
            "gaps": [],
        }),
    );

    Ok(CallToolResult::structured(structured))
}
