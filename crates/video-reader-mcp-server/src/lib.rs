pub mod http_transport;
pub mod read_video;
pub mod tool_routes;
pub mod video_evidence;

use rmcp::{
    handler::server::router::tool::ToolRouter,
    handler::server::wrapper::Parameters,
    model::{Implementation, ServerCapabilities, ServerInfo},
    tool, tool_handler, tool_router, ErrorData, ServerHandler,
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

/// Free-form MCP tool args object (root type=object required by rmcp ≥1.8 schema gate).
#[derive(Debug, Clone, Default, Serialize, Deserialize, JsonSchema)]
#[serde(transparent)]
struct FreeformToolArgs(Map<String, Value>);

impl FreeformToolArgs {
    fn into_value(self) -> Value {
        Value::Object(self.0)
    }
}

pub const SERVER_NAME: &str = "video-reader-mcp";
pub const SERVER_VERSION: &str = "0.1.0";
pub const SERVER_INSTRUCTIONS: &str =
    "Evidence-first video reader MCP server (Rust rmcp transport). Use read_video for ffprobe timelines and video_evidence for render_frame or crop_frame follow-ups without per-frame vision LLM.";

#[derive(Clone)]
pub struct VideoReaderMcp {
    pub tool_router: ToolRouter<Self>,
}

impl VideoReaderMcp {
    pub fn new() -> Self {
        Self {
            tool_router: Self::tool_router(),
        }
    }
}

#[tool_router]
impl VideoReaderMcp {
    #[tool(
        description = "Primary video reader. Returns a timeline document with ffprobe metadata, embedded subtitles, optional scene boundaries, and warnings — no per-frame vision LLM."
    )]
    fn read_video(
        &self,
        Parameters(args): Parameters<FreeformToolArgs>,
    ) -> Result<rmcp::model::CallToolResult, ErrorData> {
        read_video::read_video(args.into_value())
    }

    #[tool(
        description = "Runs focused video evidence follow-up operations: render_frame, crop_frame, or ocr_frame with timestamp locators after read_video."
    )]
    fn video_evidence(
        &self,
        Parameters(args): Parameters<FreeformToolArgs>,
    ) -> Result<rmcp::model::CallToolResult, ErrorData> {
        video_evidence::video_evidence(args.into_value())
    }
}

#[tool_handler]
impl ServerHandler for VideoReaderMcp {
    fn get_info(&self) -> ServerInfo {
        // rmcp >=1.8: ServerInfo/Implementation are #[non_exhaustive] — use builders only.
        ServerInfo::new(ServerCapabilities::builder().enable_tools().build())
            .with_server_info(
                Implementation::new(SERVER_NAME, SERVER_VERSION)
                    .with_description(
                        "Rust-native MCP server for video-reader-mcp (modelcontextprotocol/rust-sdk rmcp)",
                    )
                    .with_website_url("https://github.com/SylphxAI/video-reader-mcp"),
            )
            .with_instructions(SERVER_INSTRUCTIONS)
    }
}

#[cfg(test)]
mod tests {
    use super::VideoReaderMcp;
    #[test]
    fn exposes_primary_tool_surface() {
        let tools = VideoReaderMcp::new().tool_router.list_all();
        let names: Vec<_> = tools.iter().map(|tool| tool.name.to_string()).collect();
        assert!(names.contains(&"read_video".to_string()));
        assert!(names.contains(&"video_evidence".to_string()));
    }
}
