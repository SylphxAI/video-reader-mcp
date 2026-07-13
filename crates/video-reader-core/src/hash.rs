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
    #[serde(default)]
    pub include_keyframes: bool,
    #[serde(default)]
    pub include_keyframe_images: bool,
    #[serde(default = "default_keyframe_limit")]
    pub keyframe_limit: u32,
    #[serde(default)]
    pub keyframe_max_dimension: Option<u32>,
    #[serde(default = "default_scene_threshold")]
    pub scene_threshold: f64,
}

fn default_keyframe_limit() -> u32 {
    8
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
            include_keyframes: false,
            include_keyframe_images: false,
            keyframe_limit: 8,
            keyframe_max_dimension: None,
            scene_threshold: 0.4,
        };

        let first = build_cache_key("abc123", &options);
        let second = build_cache_key("abc123", &options);
        assert_eq!(first, second);
        assert_ne!(first, build_cache_key("def456", &options));
    }


    #[test]
    fn cache_key_changes_when_options_flip() {
        let base = CacheOptions {
            include_streams: true,
            include_chapters: true,
            include_subtitles: true,
            include_scenes: true,
            include_transcript: false,
            include_keyframes: false,
            include_keyframe_images: false,
            keyframe_limit: 8,
            keyframe_max_dimension: None,
            scene_threshold: 0.4,
        };
        let mut flipped = base.clone();
        flipped.include_transcript = true;
        let k1 = build_cache_key("src-hash", &base);
        let k2 = build_cache_key("src-hash", &flipped);
        assert_ne!(k1, k2);
        flipped.include_transcript = false;
        flipped.keyframe_limit = 16;
        assert_ne!(k1, build_cache_key("src-hash", &flipped));
        flipped.keyframe_limit = 8;
        flipped.scene_threshold = 0.2;
        assert_ne!(k1, build_cache_key("src-hash", &flipped));
    }

    #[test]
    fn bw7_cache_key_dimension_and_defaults_pure() {
        assert_eq!(default_keyframe_limit(), 8);
        assert!(default_true());
        assert!((default_scene_threshold() - 0.4).abs() < f64::EPSILON);
        let mut opts = CacheOptions {
            include_streams: true,
            include_chapters: true,
            include_subtitles: false,
            include_scenes: true,
            include_transcript: false,
            include_keyframes: false,
            include_keyframe_images: false,
            keyframe_limit: 8,
            keyframe_max_dimension: None,
            scene_threshold: 0.4,
        };
        let base = build_cache_key("h", &opts);
        opts.keyframe_max_dimension = Some(320);
        assert_ne!(base, build_cache_key("h", &opts));
        opts.keyframe_max_dimension = None;
        opts.include_keyframe_images = true;
        assert_ne!(base, build_cache_key("h", &opts));
    }


    #[test]
    fn bw8_cache_key_sensitive_to_each_flag() {
        let base = CacheOptions {
            include_streams: true,
            include_chapters: true,
            include_subtitles: true,
            include_scenes: true,
            include_transcript: false,
            include_keyframes: false,
            include_keyframe_images: false,
            keyframe_limit: 8,
            keyframe_max_dimension: None,
            scene_threshold: 0.4,
        };
        let k0 = build_cache_key("src", &base);
        let mut o = base.clone();
        o.include_streams = false;
        assert_ne!(k0, build_cache_key("src", &o));
        o = base.clone();
        o.include_chapters = false;
        assert_ne!(k0, build_cache_key("src", &o));
        o = base.clone();
        o.include_subtitles = false;
        assert_ne!(k0, build_cache_key("src", &o));
        o = base.clone();
        o.include_scenes = false;
        assert_ne!(k0, build_cache_key("src", &o));
        o = base.clone();
        o.include_keyframes = true;
        assert_ne!(k0, build_cache_key("src", &o));
        assert_eq!(default_keyframe_limit(), 8);
        assert!((default_scene_threshold() - 0.4).abs() < f64::EPSILON);
    }
}
