use rmcp::ServiceExt;
use video_reader_mcp_server::{VideoReaderMcp, SERVER_VERSION};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    if std::env::args().nth(1).as_deref() == Some("doctor") {
        eprintln!(
            "video-reader-mcp Rust MCP server {SERVER_VERSION} ({})",
            video_reader_core::ENGINE_NAME
        );
        return Ok(());
    }

    let service = VideoReaderMcp::new().serve(rmcp::transport::stdio()).await?;
    service.waiting().await?;
    Ok(())
}