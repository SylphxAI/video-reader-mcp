use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CacheOptions {
    #[serde(default = "default_true")]
    pub include_streams: bool,
    #[serde(default = "default_true")]
    pub include_chapters: bool,
    #[serde(default = "default_true")]
    pub include_subtitles: bool,
    #[serde(default = "default_true")]
    pub include_scenes: bool,
    #[serde(default)]
    pub include_transcript: bool,
    #[serde(default = "default_scene_threshold")]
    pub scene_threshold: f64,
}

fn default_true() -> bool {
    true
}

fn default_scene_threshold() -> f64 {
    0.4
}

pub fn hash_source_file(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|err| format!("READ_FAILED: {err}"))?;
    Ok(format!("{:x}", Sha256::digest(bytes)))
}

pub fn build_cache_key(source_hash: &str, options: &CacheOptions) -> String {
    let canonical = serde_json::to_string(options).unwrap_or_else(|_| "{}".into());
    let payload = format!("{source_hash}:{canonical}");
    format!("{:x}", Sha256::digest(payload.as_bytes()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn hashes_file_bytes_deterministically() {
        let temp = tempfile::tempdir().expect("tempdir");
        let path = temp.path().join("clip.mp4");
        let mut file = fs::File::create(&path).expect("create");
        file.write_all(b"demo-bytes").expect("write");

        let first = hash_source_file(&path).expect("hash");
        let second = hash_source_file(&path).expect("hash");
        assert_eq!(first, second);
        assert_eq!(first.len(), 64);
    }

    #[test]
    fn builds_stable_cache_keys_from_hash_and_options() {
        let options = CacheOptions {
            include_streams: true,
            include_chapters: true,
            include_subtitles: false,
            include_scenes: true,
            include_transcript: false,
            scene_threshold: 0.4,
        };

        let first = build_cache_key("abc123", &options);
        let second = build_cache_key("abc123", &options);
        assert_eq!(first, second);
        assert_ne!(first, build_cache_key("def456", &options));
    }
}