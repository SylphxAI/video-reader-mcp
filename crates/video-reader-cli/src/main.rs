use std::io::{self, Read};
use std::path::PathBuf;

use serde::Deserialize;
use video_reader_core::asr::{transcribe_video, AsrErrorCode};
use video_reader_core::frames::{
    crop_frame, extract_keyframes, render_frame, CropRegion, FrameErrorCode,
};
use video_reader_core::hash::{build_cache_key, hash_source_file, CacheOptions};
use video_reader_core::timeline::{assemble_probe_timeline, AssembleOptions};
use video_reader_core::{
    read_video_from_value, video_evidence_from_value, ENGINE_NAME, ENGINE_VERSION, READ_VIDEO_ROUTE,
};

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
struct AsrSuccessEnvelope {
    status: &'static str,
    engine: &'static str,
    version: &'static str,
    asr: video_reader_core::asr::AsrResult,
}

#[derive(Debug, serde::Serialize)]
struct KeyframeSuccessEnvelope {
    status: &'static str,
    engine: &'static str,
    version: &'static str,
    keyframes: Vec<video_reader_core::frames::KeyframeEvidence>,
}

#[derive(Debug, serde::Serialize)]
struct FrameRenderSuccessEnvelope {
    status: &'static str,
    engine: &'static str,
    version: &'static str,
    frame: video_reader_core::frames::FrameRenderEvidence,
}

#[derive(Debug, serde::Serialize)]
struct ReadVideoSuccessEnvelope {
    status: &'static str,
    engine: &'static str,
    version: &'static str,
    route: &'static str,
    results: Vec<video_reader_core::read_video::VideoSourceResult>,
    envelope: Option<video_reader_core::AgentEvidenceEnvelope>,
}

#[derive(Debug, serde::Serialize)]
struct VideoEvidenceSuccessEnvelope {
    status: &'static str,
    engine: &'static str,
    version: &'static str,
    results: Vec<video_reader_core::video_evidence::VideoEvidenceSourceResult>,
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

fn read_video_code(code: video_reader_core::ReadVideoErrorCode) -> &'static str {
    match code {
        video_reader_core::ReadVideoErrorCode::InvalidParams => "INVALID_PARAMS",
        video_reader_core::ReadVideoErrorCode::InvalidRequest => "INVALID_REQUEST",
    }
}

fn video_evidence_code(code: video_reader_core::VideoEvidenceErrorCode) -> &'static str {
    match code {
        video_reader_core::VideoEvidenceErrorCode::InvalidParams => "INVALID_PARAMS",
        video_reader_core::VideoEvidenceErrorCode::InvalidRequest => "INVALID_REQUEST",
    }
}

fn frame_error_code(code: FrameErrorCode) -> &'static str {
    match code {
        FrameErrorCode::InvalidParams => "INVALID_PARAMS",
        FrameErrorCode::FfmpegUnavailable => "FFMPEG_UNAVAILABLE",
        FrameErrorCode::ExtractionFailed => "EXTRACTION_FAILED",
    }
}

fn parse_crop(input: &serde_json::Value) -> Result<CropRegion, ErrorEnvelope> {
    let crop = input.get("crop").ok_or_else(|| ErrorEnvelope {
        status: "error",
        code: "INVALID_PARAMS".into(),
        message: "crop is required".into(),
        next_action: "Pass crop with x, y, width, and height in video pixel coordinates.".into(),
    })?;

    #[derive(Deserialize)]
    struct CropWire {
        x: u32,
        y: u32,
        width: u32,
        height: u32,
    }

    let parsed: CropWire = serde_json::from_value(crop.clone()).map_err(|error| ErrorEnvelope {
        status: "error",
        code: "INVALID_PARAMS".into(),
        message: format!("Invalid crop payload: {error}"),
        next_action: "Use positive integer x, y, width, and height values.".into(),
    })?;

    Ok(CropRegion {
        x: parsed.x,
        y: parsed.y,
        width: parsed.width,
        height: parsed.height,
    })
}

fn parse_time_ms(input: &serde_json::Value) -> Result<u64, ErrorEnvelope> {
    input
        .get("time_ms")
        .and_then(|value| value.as_u64())
        .ok_or_else(|| ErrorEnvelope {
            status: "error",
            code: "INVALID_PARAMS".into(),
            message: "time_ms is required".into(),
            next_action: "Pass a non-negative timestamp in milliseconds.".into(),
        })
}

fn parse_max_dimension(input: &serde_json::Value) -> Option<u32> {
    input
        .get("max_dimension")
        .and_then(|value| value.as_u64())
        .map(|value| value as u32)
}

fn handle_render_frame(input: &serde_json::Value) -> Result<FrameRenderSuccessEnvelope, ErrorEnvelope> {
    let path = input
        .get("path")
        .and_then(|value| value.as_str())
        .ok_or_else(|| ErrorEnvelope {
            status: "error",
            code: "INVALID_PARAMS".into(),
            message: "path is required".into(),
            next_action: "Pass a readable local video file path.".into(),
        })?;

    let time_ms = parse_time_ms(input)?;
    let max_dimension = parse_max_dimension(input);

    match render_frame(PathBuf::from(path).as_path(), time_ms, max_dimension) {
        Ok(frame) => Ok(FrameRenderSuccessEnvelope {
            status: "ok",
            engine: ENGINE_NAME,
            version: ENGINE_VERSION,
            frame,
        }),
        Err(error) => Err(ErrorEnvelope {
            status: "error",
            code: frame_error_code(error.code).into(),
            message: error.message,
            next_action: "Install ffmpeg and provide a readable video with decodable frames.".into(),
        }),
    }
}

fn handle_crop_frame(input: &serde_json::Value) -> Result<FrameRenderSuccessEnvelope, ErrorEnvelope> {
    let path = input
        .get("path")
        .and_then(|value| value.as_str())
        .ok_or_else(|| ErrorEnvelope {
            status: "error",
            code: "INVALID_PARAMS".into(),
            message: "path is required".into(),
            next_action: "Pass a readable local video file path.".into(),
        })?;

    let time_ms = parse_time_ms(input)?;
    let crop = parse_crop(input)?;
    let max_dimension = parse_max_dimension(input);

    match crop_frame(
        PathBuf::from(path).as_path(),
        time_ms,
        &crop,
        max_dimension,
    ) {
        Ok(frame) => Ok(FrameRenderSuccessEnvelope {
            status: "ok",
            engine: ENGINE_NAME,
            version: ENGINE_VERSION,
            frame,
        }),
        Err(error) => Err(ErrorEnvelope {
            status: "error",
            code: frame_error_code(error.code).into(),
            message: error.message,
            next_action: "Install ffmpeg and provide valid crop bounds for the requested timestamp.".into(),
        }),
    }
}

fn handle_extract_keyframes(
    input: &serde_json::Value,
) -> Result<KeyframeSuccessEnvelope, ErrorEnvelope> {
    let path = input
        .get("path")
        .and_then(|value| value.as_str())
        .ok_or_else(|| ErrorEnvelope {
            status: "error",
            code: "INVALID_PARAMS".into(),
            message: "path is required".into(),
            next_action: "Pass a readable local video file path.".into(),
        })?;

    let limit = input
        .get("limit")
        .and_then(|value| value.as_u64())
        .unwrap_or(8) as u32;

    let include_images = input
        .get("include_images")
        .and_then(|value| value.as_bool())
        .unwrap_or(false);

    let max_dimension = input
        .get("max_dimension")
        .and_then(|value| value.as_u64())
        .map(|value| value as u32);

    match extract_keyframes(
        PathBuf::from(path).as_path(),
        limit,
        include_images,
        max_dimension,
    ) {
        Ok(keyframes) => Ok(KeyframeSuccessEnvelope {
            status: "ok",
            engine: ENGINE_NAME,
            version: ENGINE_VERSION,
            keyframes,
        }),
        Err(error) => Err(ErrorEnvelope {
            status: "error",
            code: frame_error_code(error.code).into(),
            message: error.message,
            next_action: "Install ffmpeg and provide a readable video with decodable I-frames.".into(),
        }),
    }
}

fn asr_error_code(code: AsrErrorCode) -> &'static str {
    match code {
        AsrErrorCode::InvalidParams => "INVALID_PARAMS",
        AsrErrorCode::AdapterUnavailable => "ADAPTER_UNAVAILABLE",
        AsrErrorCode::TranscriptionFailed => "TRANSCRIPTION_FAILED",
    }
}

fn handle_transcribe_asr(input: &serde_json::Value) -> Result<AsrSuccessEnvelope, ErrorEnvelope> {
    let path = input
        .get("path")
        .and_then(|value| value.as_str())
        .ok_or_else(|| ErrorEnvelope {
            status: "error",
            code: "INVALID_PARAMS".into(),
            message: "path is required".into(),
            next_action: "Pass a readable local video file path.".into(),
        })?;

    let max_audio_seconds = input
        .get("max_audio_seconds")
        .and_then(|value| value.as_u64())
        .unwrap_or(300);

    match transcribe_video(PathBuf::from(path).as_path(), max_audio_seconds) {
        Ok(asr) => Ok(AsrSuccessEnvelope {
            status: "ok",
            engine: ENGINE_NAME,
            version: ENGINE_VERSION,
            asr,
        }),
        Err(error) => Err(ErrorEnvelope {
            status: "error",
            code: asr_error_code(error.code).into(),
            message: error.message,
            next_action:
                "Install ffmpeg plus whisper-cli/whisper-cpp and set WHISPER_MODEL to a ggml model."
                    .into(),
        }),
    }
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
            include_keyframe_images: false,
            keyframe_limit: 8,
            keyframe_max_dimension: None,
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
        "read_video" => match read_video_from_value(&request.input) {
            Ok(response) => serde_json::to_string(&ReadVideoSuccessEnvelope {
                status: "ok",
                engine: ENGINE_NAME,
                version: ENGINE_VERSION,
                route: READ_VIDEO_ROUTE,
                results: response.results,
                envelope: response.envelope,
            })
            .expect("serialize"),
            Err(error) => serde_json::to_string(&ErrorEnvelope {
                status: "error",
                code: read_video_code(error.code).into(),
                message: error.message,
                next_action: "Provide readable local video sources and ensure ffprobe is installed.".into(),
            })
            .expect("serialize"),
        },
        "video_evidence" => match video_evidence_from_value(&request.input) {
            Ok(response) => serde_json::to_string(&VideoEvidenceSuccessEnvelope {
                status: "ok",
                engine: ENGINE_NAME,
                version: ENGINE_VERSION,
                results: response.results,
            })
            .expect("serialize"),
            Err(error) => serde_json::to_string(&ErrorEnvelope {
                status: "error",
                code: video_evidence_code(error.code).into(),
                message: error.message,
                next_action: "Use render_frame or crop_frame with ffmpeg available.".into(),
            })
            .expect("serialize"),
        },
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
        "transcribe_asr" => match handle_transcribe_asr(&request.input) {
            Ok(success) => serde_json::to_string(&success).expect("serialize"),
            Err(error) => serde_json::to_string(&error).expect("serialize"),
        },
        "extract_keyframes" => match handle_extract_keyframes(&request.input) {
            Ok(success) => serde_json::to_string(&success).expect("serialize"),
            Err(error) => serde_json::to_string(&error).expect("serialize"),
        },
        "render_frame" => match handle_render_frame(&request.input) {
            Ok(success) => serde_json::to_string(&success).expect("serialize"),
            Err(error) => serde_json::to_string(&error).expect("serialize"),
        },
        "crop_frame" => match handle_crop_frame(&request.input) {
            Ok(success) => serde_json::to_string(&success).expect("serialize"),
            Err(error) => serde_json::to_string(&error).expect("serialize"),
        },
        other => serde_json::to_string(&ErrorEnvelope {
            status: "error",
            code: "UNSUPPORTED_TOOL".into(),
            message: format!("Unsupported tool: {other}"),
            next_action:
                "Use read_video, video_evidence, assemble_probe_timeline, hash_source, build_cache_key, transcribe_asr, extract_keyframes, render_frame, or crop_frame."
                    .into(),
        })
        .expect("serialize"),
    };

    println!("{output}");
}