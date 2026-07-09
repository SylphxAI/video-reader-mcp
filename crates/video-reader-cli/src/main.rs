use std::io::{self, Read};
use std::path::PathBuf;

use serde::Deserialize;
use video_reader_core::hash::{build_cache_key, hash_source_file, CacheOptions};
use video_reader_core::timeline::{assemble_probe_timeline, AssembleOptions};
use video_reader_core::{ENGINE_NAME, ENGINE_VERSION};

#[derive(Debug, Deserialize)]
struct Request {
    tool: String,
    input: serde_json::Value,
}

#[derive(Debug, serde::Serialize)]
struct TimelineSuccessEnvelope {
    status: &'static str,
    engine: &'static str,
    version: &'static str,
    timeline: video_reader_core::timeline::ProbeTimeline,
}

#[derive(Debug, serde::Serialize)]
struct HashSuccessEnvelope {
    status: &'static str,
    engine: &'static str,
    version: &'static str,
    source_hash: String,
}

#[derive(Debug, serde::Serialize)]
struct CacheKeySuccessEnvelope {
    status: &'static str,
    engine: &'static str,
    version: &'static str,
    cache_key: String,
}

#[derive(Debug, serde::Serialize)]
struct ErrorEnvelope {
    status: &'static str,
    code: String,
    message: String,
    next_action: String,
}

fn handle_assemble_probe_timeline(
    input: &serde_json::Value,
) -> Result<TimelineSuccessEnvelope, ErrorEnvelope> {
    let ffprobe = input.get("ffprobe").ok_or_else(|| ErrorEnvelope {
        status: "error",
        code: "INVALID_PARAMS".into(),
        message: "ffprobe payload is required".into(),
        next_action: "Pass parsed ffprobe JSON under input.ffprobe.".into(),
    })?;

    let options: AssembleOptions = input
        .get("options")
        .map(|value| serde_json::from_value(value.clone()))
        .transpose()
        .map_err(|error| ErrorEnvelope {
            status: "error",
            code: "INVALID_PARAMS".into(),
            message: format!("Invalid assemble options: {error}"),
            next_action: "Use include_streams/include_chapters booleans.".into(),
        })?
        .unwrap_or(AssembleOptions {
            include_streams: true,
            include_chapters: true,
        });

    let timeline = assemble_probe_timeline(ffprobe, &options);
    Ok(TimelineSuccessEnvelope {
        status: "ok",
        engine: ENGINE_NAME,
        version: ENGINE_VERSION,
        timeline,
    })
}

fn handle_hash_source(input: &serde_json::Value) -> Result<HashSuccessEnvelope, ErrorEnvelope> {
    let path = input
        .get("path")
        .and_then(|value| value.as_str())
        .ok_or_else(|| ErrorEnvelope {
            status: "error",
            code: "INVALID_PARAMS".into(),
            message: "path is required".into(),
            next_action: "Pass a readable local video file path.".into(),
        })?;

    let source_hash = hash_source_file(PathBuf::from(path).as_path()).map_err(|message| {
        ErrorEnvelope {
            status: "error",
            code: "HASH_FAILED".into(),
            message,
            next_action: "Provide a readable local video file.".into(),
        }
    })?;

    Ok(HashSuccessEnvelope {
        status: "ok",
        engine: ENGINE_NAME,
        version: ENGINE_VERSION,
        source_hash,
    })
}

fn handle_build_cache_key(
    input: &serde_json::Value,
) -> Result<CacheKeySuccessEnvelope, ErrorEnvelope> {
    let source_hash = input
        .get("source_hash")
        .and_then(|value| value.as_str())
        .ok_or_else(|| ErrorEnvelope {
            status: "error",
            code: "INVALID_PARAMS".into(),
            message: "source_hash is required".into(),
            next_action: "Hash the source file before building cache keys.".into(),
        })?;

    let options: CacheOptions = input
        .get("options")
        .map(|value| serde_json::from_value(value.clone()))
        .transpose()
        .map_err(|error| ErrorEnvelope {
            status: "error",
            code: "INVALID_PARAMS".into(),
            message: format!("Invalid cache options: {error}"),
            next_action: "Pass include_* booleans and scene_threshold.".into(),
        })?
        .unwrap_or(CacheOptions {
            include_streams: true,
            include_chapters: true,
            include_subtitles: true,
            include_scenes: true,
            include_transcript: false,
            include_keyframes: false,
            keyframe_limit: 8,
            scene_threshold: 0.4,
        });

    Ok(CacheKeySuccessEnvelope {
        status: "ok",
        engine: ENGINE_NAME,
        version: ENGINE_VERSION,
        cache_key: build_cache_key(source_hash, &options),
    })
}

fn main() {
    let mut payload = String::new();
    if io::stdin().read_to_string(&mut payload).is_err() {
        eprintln!("Failed to read stdin");
        std::process::exit(1);
    }

    let request: Request = match serde_json::from_str(&payload) {
        Ok(value) => value,
        Err(error) => {
            let envelope = ErrorEnvelope {
                status: "error",
                code: "INVALID_REQUEST".into(),
                message: format!("Invalid JSON request: {error}"),
                next_action: "Send {\"tool\":\"assemble_probe_timeline\",\"input\":{...}} on stdin."
                    .into(),
            };
            println!("{}", serde_json::to_string(&envelope).expect("serialize"));
            std::process::exit(1);
        }
    };

    let output = match request.tool.as_str() {
        "assemble_probe_timeline" => match handle_assemble_probe_timeline(&request.input) {
            Ok(success) => serde_json::to_string(&success).expect("serialize"),
            Err(error) => serde_json::to_string(&error).expect("serialize"),
        },
        "hash_source" => match handle_hash_source(&request.input) {
            Ok(success) => serde_json::to_string(&success).expect("serialize"),
            Err(error) => serde_json::to_string(&error).expect("serialize"),
        },
        "build_cache_key" => match handle_build_cache_key(&request.input) {
            Ok(success) => serde_json::to_string(&success).expect("serialize"),
            Err(error) => serde_json::to_string(&error).expect("serialize"),
        },
        other => serde_json::to_string(&ErrorEnvelope {
            status: "error",
            code: "UNSUPPORTED_TOOL".into(),
            message: format!("Unsupported tool: {other}"),
            next_action: "Use assemble_probe_timeline, hash_source, or build_cache_key.".into(),
        })
        .expect("serialize"),
    };

    println!("{output}");
}