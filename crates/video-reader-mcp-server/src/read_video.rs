use rmcp::model::CallToolResult;
use serde_json::Value;
use video_reader_core::{read_video_from_value, ReadVideoErrorCode, READ_VIDEO_ROUTE};

pub fn read_video(args: Value) -> Result<CallToolResult, rmcp::ErrorData> {
    let response = read_video_from_value(&args).map_err(|error| match error.code {
        ReadVideoErrorCode::InvalidParams => rmcp::ErrorData::invalid_params(error.message, None),
        ReadVideoErrorCode::InvalidRequest => {
            rmcp::ErrorData::invalid_request(error.message, None)
        }
    })?;

    let structured = serde_json::json!({
        "tool": "read_video",
        "route": READ_VIDEO_ROUTE,
        "engine": video_reader_core::ENGINE_NAME,
        "results": response.results,
        "envelope": response.envelope,
    });

    Ok(CallToolResult::structured(structured))
}