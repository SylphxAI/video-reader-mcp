use rmcp::ServiceExt;
use video_reader_mcp_server::{http_transport, VideoReaderMcp, SERVER_VERSION};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    if std::env::args().nth(1).as_deref() == Some("doctor") {
        eprintln!(
            "video-reader-mcp Rust MCP server {SERVER_VERSION} ({})",
            video_reader_core::ENGINE_NAME
        );
        return Ok(());
    }

    if http_transport::transport_from_env().is_some() {
        return http_transport::serve_http(http_transport::HttpConfig::from_env()).await;
    }

    let service = VideoReaderMcp::new().serve(rmcp::transport::stdio()).await?;
    service.waiting().await?;
    Ok(())
}