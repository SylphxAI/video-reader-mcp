//! Rust timeline assembly, hashing, and cache policy for video-reader-mcp.

pub mod asr;
pub mod hash;
pub mod timeline;

pub const ENGINE_NAME: &str = "video-reader-core";
pub const ENGINE_VERSION: &str = "0.1.0";