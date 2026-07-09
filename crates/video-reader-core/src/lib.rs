//! Rust timeline assembly, hashing, and cache policy for video-reader-mcp.

pub mod asr;
pub mod envelope;
pub mod ffprobe;
pub mod frames;
pub mod hash;
pub mod read_video;
pub mod timeline;
pub mod video_evidence;

pub use envelope::{build_read_video_envelope, AgentEvidenceEnvelope};
pub use read_video::{
    read_video_from_value, read_video_source, ReadVideoError, ReadVideoErrorCode, ReadVideoResponse,
    READ_VIDEO_ROUTE,
};
pub use video_evidence::{
    video_evidence_from_value, VideoEvidenceError, VideoEvidenceErrorCode, VideoEvidenceResponse,
};

pub const ENGINE_NAME: &str = "video-reader-core";
pub const ENGINE_VERSION: &str = "0.1.0";