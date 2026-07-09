pub mod read_video;
pub mod tool_routes;
pub mod video_evidence;

use rmcp::{
    handler::server::router::tool::ToolRouter,
    handler::server::wrapper::Parameters,
    model::{Implementation, ServerCapabilities, ServerInfo},
    tool, tool_handler, tool_router, ErrorData, ServerHandler,
};
use serde_json::Value;

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
    pub fn read_video(
        &self,
        Parameters(args): Parameters<Value>,
    ) -> Result<rmcp::model::CallToolResult, ErrorData> {
        read_video::read_video(args)
    }

    #[tool(
        description = "Runs focused video evidence follow-up operations: render_frame, crop_frame, or ocr_frame with timestamp locators after read_video."
    )]
    pub fn video_evidence(
        &self,
        Parameters(args): Parameters<Value>,
    ) -> Result<rmcp::model::CallToolResult, ErrorData> {
        video_evidence::video_evidence(args)
    }
}

#[tool_handler]
impl ServerHandler for VideoReaderMcp {
    fn get_info(&self) -> ServerInfo {
        ServerInfo {
            protocol_version: rmcp::model::ProtocolVersion::default(),
            capabilities: ServerCapabilities::builder().enable_tools().build(),
            server_info: Implementation {
                name: SERVER_NAME.into(),
                title: None,
                version: SERVER_VERSION.into(),
                description: Some(
                    "Rust-native MCP server for video-reader-mcp (modelcontextprotocol/rust-sdk rmcp)"
                        .into(),
                ),
                icons: None,
                website_url: Some("https://github.com/SylphxAI/video-reader-mcp".into()),
            },
            instructions: Some(SERVER_INSTRUCTIONS.into()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::VideoReaderMcp;
    use std::fs;
    use std::path::PathBuf;

    #[test]
    fn rmcp_server_sources_route_primary_tools_through_rust_core() {
        let src_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src");
        let lib_rs = fs::read_to_string(src_dir.join("lib.rs")).expect("read lib.rs");
        let production_lib = lib_rs.split("#[cfg(test)]").next().unwrap_or(&lib_rs);
        assert!(production_lib.contains("read_video::read_video"));
        assert!(production_lib.contains("video_evidence::video_evidence"));

        let routes = fs::read_to_string(src_dir.join("tool_routes.rs")).expect("read tool_routes");
        assert!(routes.contains("read_video"));
        assert!(routes.contains("video_evidence"));
    }

    #[test]
    fn exposes_primary_tool_surface() {
        let tools = VideoReaderMcp::new().tool_router.list_all();
        let names: Vec<_> = tools.iter().map(|tool| tool.name.to_string()).collect();
        assert!(names.contains(&"read_video".to_string()));
        assert!(names.contains(&"video_evidence".to_string()));
    }
}