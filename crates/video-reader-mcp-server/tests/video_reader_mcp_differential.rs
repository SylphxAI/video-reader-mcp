//! TRUE pure differential parity residual: TS pure-contract oracle vs Rust core/rmcp SSOT.
//!
//! Fail-closed — no SKIP-as-pass. Bounded pure slices only (BW2 residual):
//! - tool-route-contract / allow-list / server-contract
//! - pure-hash / pure-cache-key / pure-timeline (probe fixtures)
//!
//! Explicitly NOT claimed: read_video ffprobe effect, video_evidence ffmpeg effect,
//! HTTP transport, parity_proven, authority_rust, ts_deleted.
//! See scripts/run-video-reader-differential.sh.

use serde::Deserialize;
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use video_reader_core::hash::{build_cache_key, hash_source_file, CacheOptions};
use video_reader_core::timeline::{assemble_probe_timeline, AssembleOptions};
use video_reader_mcp_server::tool_routes::{route_for_tool, ToolRoute};
use video_reader_mcp_server::{VideoReaderMcp, SERVER_NAME, SERVER_VERSION};

const PURE_HASH_SLICE: &str = "pure-hash";
const PURE_CACHE_KEY_SLICE: &str = "pure-cache-key";
const PURE_TIMELINE_SLICE: &str = "pure-timeline";

fn repo_root() -> PathBuf {
    fs::canonicalize(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.."))
        .expect("canonicalize repo root")
}

fn corpus_fixture_path() -> PathBuf {
    repo_root().join("scripts/differential/fixtures/video-reader-mcp-corpus.json")
}

fn fixtures_root() -> PathBuf {
    repo_root().join("test/fixtures")
}

#[derive(Debug, Deserialize)]
struct OracleCase {
    id: String,
    slice: String,
    domain: String,
    input: Value,
    output: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OracleCorpus {
    corpus_version: u32,
    fixture_corpus_hash: String,
    cases: Vec<OracleCase>,
}

fn run_ts_oracle() -> OracleCorpus {
    if let Ok(path) = std::env::var("VIDEO_READER_MCP_ORACLE_JSON") {
        let raw = fs::read_to_string(&path)
            .unwrap_or_else(|error| panic!("read VIDEO_READER_MCP_ORACLE_JSON at {path}: {error}"));
        return serde_json::from_str(&raw).expect("oracle JSON must be valid");
    }

    let script = repo_root().join("scripts/differential/video-reader-mcp-oracle.ts");
    let output = spawn_oracle(&script);

    assert!(
        output.status.success(),
        "TS pure oracle failed:\nstdout: {}\nstderr: {}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );

    serde_json::from_slice(&output.stdout).expect("oracle output must be valid JSON")
}

fn spawn_oracle(script: &Path) -> std::process::Output {
    // Prefer bun when present; fall back to Node 22+ strip-types (codex-remote has no bun).
    if Command::new("bun")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
    {
        return Command::new("bun")
            .arg("run")
            .arg(script)
            .current_dir(repo_root())
            .output()
            .unwrap_or_else(|error| panic!("spawn bun oracle at {}: {error}", script.display()));
    }

    Command::new("node")
        .arg("--experimental-strip-types")
        .arg(script)
        .current_dir(repo_root())
        .output()
        .unwrap_or_else(|error| panic!("spawn node oracle at {}: {error}", script.display()))
}

fn compare_tool_route_case(case: &OracleCase) {
    let tool = case.input["tool"].as_str().expect("tool route tool");
    let route = route_for_tool(tool).expect("tool must be routed");
    let route_name = match route {
        ToolRoute::RustCore => "RustCore",
        ToolRoute::LegacyOptIn => "LegacyOptIn",
    };
    let native = json!({ "route": route_name });
    assert_eq!(native, case.output, "tool route mismatch for case {}", case.id);
}

fn compare_server_contract_case(case: &OracleCase) {
    let tools = VideoReaderMcp::new().tool_router.list_all();
    let mut names: Vec<String> = tools.iter().map(|tool| tool.name.to_string()).collect();
    names.sort();

    let expected_tools = case.input["tools"]
        .as_array()
        .expect("server contract tools")
        .iter()
        .map(|value| value.as_str().expect("tool name").to_string())
        .collect::<Vec<_>>();

    let mut expected_sorted = expected_tools.clone();
    expected_sorted.sort();
    assert_eq!(
        names, expected_sorted,
        "rmcp tool allow-list mismatch (fail-closed)"
    );

    let native = json!({
        "name": SERVER_NAME,
        "version": SERVER_VERSION,
        "tools": case.input["tools"],
    });
    assert_eq!(
        native, case.output,
        "server contract mismatch for case {}",
        case.id
    );
}

fn compare_allow_list_case(case: &OracleCase) {
    let tools = VideoReaderMcp::new().tool_router.list_all();
    let mut names: Vec<String> = tools.iter().map(|tool| tool.name.to_string()).collect();
    names.sort();
    let mut expected = case.output["tools"]
        .as_array()
        .expect("allow-list tools")
        .iter()
        .map(|value| value.as_str().expect("tool").to_string())
        .collect::<Vec<_>>();
    expected.sort();
    assert_eq!(
        names, expected,
        "allow-list tools must match exactly for {}",
        case.id
    );
}

fn compare_hash_case(case: &OracleCase) {
    let fixture = case.input["fixture"].as_str().expect("hash fixture");
    let path = fixtures_root().join(fixture);
    let source_hash = hash_source_file(&path)
        .unwrap_or_else(|error| panic!("{}: hash_source_file failed: {error}", case.id));
    let native = json!({ "status": "ok", "source_hash": source_hash });
    assert_eq!(native, case.output, "hash differential mismatch for {}", case.id);
}

fn compare_cache_key_case(case: &OracleCase) {
    let source_hash = case.input["source_hash"]
        .as_str()
        .expect("source_hash")
        .to_string();
    let options: CacheOptions = serde_json::from_value(case.input["options"].clone())
        .unwrap_or_else(|error| panic!("{}: parse CacheOptions: {error}", case.id));
    let cache_key = build_cache_key(&source_hash, &options);
    let native = json!({ "status": "ok", "cache_key": cache_key });
    assert_eq!(
        native, case.output,
        "cache_key differential mismatch for {}",
        case.id
    );
}

fn compare_timeline_case(case: &OracleCase) {
    let probe_fixture = case.input["probe_fixture"]
        .as_str()
        .expect("probe_fixture");
    let path = fixtures_root().join(probe_fixture);
    let raw = fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("{}: read probe: {error}", case.id));
    let ffprobe: Value = serde_json::from_str(&raw).expect("probe json");
    let options: AssembleOptions = serde_json::from_value(case.input["options"].clone())
        .unwrap_or_else(|error| panic!("{}: parse AssembleOptions: {error}", case.id));
    let timeline = assemble_probe_timeline(&ffprobe, &options);

    let chapter_title = timeline
        .chapters
        .first()
        .and_then(|chapter| chapter.title.clone());
    let native = json!({
        "status": "ok",
        "route": timeline.route,
        "duration_ms": timeline.format.duration_ms,
        "stream_count": timeline.streams.len(),
        "chapter_title": chapter_title,
        "warnings": timeline.warnings,
    });

    assert_eq!(
        native, case.output,
        "timeline differential mismatch for {}",
        case.id
    );
}

fn assert_oracle_metadata(oracle: &OracleCorpus) {
    assert_eq!(oracle.corpus_version, 1);
    assert!(!oracle.fixture_corpus_hash.is_empty());
    assert!(!oracle.cases.is_empty(), "oracle must emit cases");
}

fn assert_slice_metadata(case: &OracleCase) {
    match case.slice.as_str() {
        PURE_HASH_SLICE => assert_eq!(case.domain, "hash"),
        PURE_CACHE_KEY_SLICE => assert_eq!(case.domain, "cacheKey"),
        PURE_TIMELINE_SLICE => assert_eq!(case.domain, "timeline"),
        "tool-route-contract" => assert_eq!(case.domain, "toolRouteContract"),
        "server-contract" => assert_eq!(case.domain, "serverContract"),
        "allow-list" => assert_eq!(case.domain, "allowList"),
        other => panic!("unknown slice {other} for case {}", case.id),
    }
}

fn compare_case(case: &OracleCase) {
    match case.domain.as_str() {
        "toolRouteContract" => compare_tool_route_case(case),
        "serverContract" => compare_server_contract_case(case),
        "allowList" => compare_allow_list_case(case),
        "hash" => compare_hash_case(case),
        "cacheKey" => compare_cache_key_case(case),
        "timeline" => compare_timeline_case(case),
        other => panic!("unknown oracle domain {other} in case {}", case.id),
    }
}

fn cases_for_slice<'a>(oracle: &'a OracleCorpus, slice: &str) -> Vec<&'a OracleCase> {
    oracle
        .cases
        .iter()
        .filter(|case| case.slice == slice)
        .collect()
}

fn run_bounded_slice(slice: &str, min_cases: usize) {
    let _ = fs::read_to_string(corpus_fixture_path()).expect("read video-reader-mcp corpus fixture");
    let oracle = run_ts_oracle();
    assert_oracle_metadata(&oracle);

    let cases = cases_for_slice(&oracle, slice);
    assert!(
        cases.len() >= min_cases,
        "slice {slice} expected at least {min_cases} cases, got {}",
        cases.len()
    );

    for case in &cases {
        assert_slice_metadata(case);
        compare_case(case);
    }
}

fn run_all_oracle_cases() {
    let _ = fs::read_to_string(corpus_fixture_path()).expect("read video-reader-mcp corpus fixture");
    let oracle = run_ts_oracle();
    assert_oracle_metadata(&oracle);

    for case in &oracle.cases {
        assert_slice_metadata(case);
        compare_case(case);
    }
}

#[test]
fn pure_residual_differential_matches_ts_oracle() {
    run_bounded_slice(PURE_HASH_SLICE, 1);
    run_bounded_slice(PURE_CACHE_KEY_SLICE, 1);
    run_bounded_slice(PURE_TIMELINE_SLICE, 1);
    run_bounded_slice("tool-route-contract", 2);
    run_bounded_slice("server-contract", 1);
    run_bounded_slice("allow-list", 1);
}

#[test]
fn video_reader_mcp_differential_matches_ts_oracle() {
    run_all_oracle_cases();
}
