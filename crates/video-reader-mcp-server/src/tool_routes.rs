//! Explicit shipped routing table for video-reader-mcp primary tools.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToolRoute {
    RustCore,
    LegacyOptIn,
}

pub fn route_for_tool(tool: &str) -> Option<ToolRoute> {
    match tool {
        "read_video"
        | "video_evidence"
        | "assemble_probe_timeline"
        | "hash_source"
        | "build_cache_key"
        | "render_frame"
        | "crop_frame" => Some(ToolRoute::RustCore),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_primary_tools_to_rust_core() {
        assert_eq!(route_for_tool("read_video"), Some(ToolRoute::RustCore));
        assert_eq!(route_for_tool("video_evidence"), Some(ToolRoute::RustCore));
        assert_eq!(route_for_tool("hash_source"), Some(ToolRoute::RustCore));
    }
}