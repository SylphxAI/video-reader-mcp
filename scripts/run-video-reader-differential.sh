#!/usr/bin/env bash
# video-reader-mcp pure residual differential — TS pure-contract oracle vs Rust core/rmcp.
# Slices: pure-residual (default) | pure-hash | pure-cache-key | pure-timeline | all
# Fail-closed: requires bun OR node>=22 strip-types. No SKIP-as-pass.
# Explicit non-claims: read_video effect parity, ffmpeg/ffprobe effect, HTTP,
# parity_proven, authority_rust, ts_deleted. See rej-010 / BW2 residual.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRATCH="${SCRATCH_DIR:-/tmp/video-reader-mcp-differential}"
mkdir -p "$SCRATCH"
LOG="$SCRATCH/differential.log"
ORACLE_JSON="$SCRATCH/oracle.json"
SLICE_FILTER="pure-residual"
: >"$LOG"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --slice)
      SLICE_FILTER="${2:-}"
      shift 2
      ;;
    *)
      echo "::error::unknown argument: $1" | tee -a "$LOG"
      exit 1
      ;;
  esac
done

case "$SLICE_FILTER" in
  all|pure-residual|pure-hash|pure-cache-key|pure-timeline) ;;
  *)
    echo "::error::invalid --slice value: $SLICE_FILTER (supported: pure-residual|pure-hash|pure-cache-key|pure-timeline|all)" | tee -a "$LOG"
    exit 1
    ;;
esac

cd "$REPO_ROOT"

run_oracle() {
  local script="$REPO_ROOT/scripts/differential/video-reader-mcp-oracle.ts"
  if command -v bun >/dev/null 2>&1; then
    bun run "$script"
  elif command -v node >/dev/null 2>&1; then
    node --experimental-strip-types "$script"
  else
    echo "::error::bun or node>=22 required for video-reader-mcp differential — no SKIP-as-pass" | tee -a "$LOG"
    exit 1
  fi
}

echo "=== video-reader-mcp pure differential $(date -u +%Y-%m-%dT%H:%M:%SZ) slice=$SLICE_FILTER ===" | tee -a "$LOG"

echo "--- build Rust core + rmcp server ---" | tee -a "$LOG"
cargo build -p video-reader-core -p video-reader-mcp-server 2>&1 | tee -a "$LOG"

echo "--- TS pure-contract oracle ---" | tee -a "$LOG"
run_oracle >"$ORACLE_JSON" 2>>"$LOG"

run_rust_slice_test() {
  local label="$1"
  local test_name="$2"
  echo "--- Rust bounded slice: $label ---" | tee -a "$LOG"
  VIDEO_READER_MCP_ORACLE_JSON="$ORACLE_JSON" \
    cargo test -p video-reader-mcp-server --test video_reader_mcp_differential "$test_name" -- --nocapture 2>&1 | tee -a "$LOG"
}

case "$SLICE_FILTER" in
  pure-residual|pure-hash|pure-cache-key|pure-timeline)
    run_rust_slice_test "pure-residual" pure_residual_differential_matches_ts_oracle
    ;;
  all)
    run_rust_slice_test "all" video_reader_mcp_differential_matches_ts_oracle
    ;;
esac

CANDIDATE_SHA="${CANDIDATE_SHA:-$(git -C "$REPO_ROOT" rev-parse HEAD 2>/dev/null || echo unknown)}"
BASELINE_TS_SHA="$(git -C "$REPO_ROOT" log -1 --format=%H -- scripts/differential crates/video-reader-core/src/hash.rs crates/video-reader-core/src/timeline.rs crates/video-reader-mcp-server/src/tool_routes.rs 2>/dev/null || echo unknown)"
RUST_SHA="$CANDIDATE_SHA"
if command -v sha256sum >/dev/null 2>&1; then
  BEHAVIOR_SPEC_HASH="$(sha256sum "$REPO_ROOT/scripts/differential/fixtures/video-reader-mcp-corpus.json" | awk '{print $1}')"
else
  BEHAVIOR_SPEC_HASH="$(shasum -a 256 "$REPO_ROOT/scripts/differential/fixtures/video-reader-mcp-corpus.json" | awk '{print $1}')"
fi
FIXTURE_CORPUS_HASH="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["fixtureCorpusHash"])' "$ORACLE_JSON")"
CASE_COUNT="$(python3 -c 'import json,sys; print(len(json.load(open(sys.argv[1]))["cases"]))' "$ORACLE_JSON")"
PURE_HASH_COUNT="$(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(sum(1 for c in d["cases"] if c["slice"]=="pure-hash"))' "$ORACLE_JSON")"
PURE_CACHE_COUNT="$(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(sum(1 for c in d["cases"] if c["slice"]=="pure-cache-key"))' "$ORACLE_JSON")"
PURE_TIMELINE_COUNT="$(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(sum(1 for c in d["cases"] if c["slice"]=="pure-timeline"))' "$ORACLE_JSON")"

export CANDIDATE_SHA BASELINE_TS_SHA RUST_SHA BEHAVIOR_SPEC_HASH FIXTURE_CORPUS_HASH
export CASE_COUNT PURE_HASH_COUNT PURE_CACHE_COUNT PURE_TIMELINE_COUNT SLICE_FILTER SCRATCH

python3 - <<'PY'
import json, os, datetime, pathlib
scratch = pathlib.Path(os.environ["SCRATCH"])
payload = {
  "schemaVersion": 2,
  "slice": "video-reader-mcp.pure-residual|" + os.environ.get("SLICE_FILTER", "pure-residual"),
  "status": "differential_green",
  "verifiedAt": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
  "lastComparedMainSha": os.environ["CANDIDATE_SHA"],
  "mergeGroupSha": os.environ["CANDIDATE_SHA"],
  "baselineTsSha": os.environ.get("BASELINE_TS_SHA", "unknown"),
  "rustCandidateSha": os.environ.get("RUST_SHA", os.environ["CANDIDATE_SHA"]),
  "behaviorSpecHash": os.environ["BEHAVIOR_SPEC_HASH"],
  "fixtureCorpusHash": os.environ["FIXTURE_CORPUS_HASH"],
  "caseCount": int(os.environ["CASE_COUNT"]),
  "pureHashCaseCount": int(os.environ["PURE_HASH_COUNT"]),
  "pureCacheKeyCaseCount": int(os.environ["PURE_CACHE_COUNT"]),
  "pureTimelineCaseCount": int(os.environ["PURE_TIMELINE_COUNT"]),
  "harness": "scripts/run-video-reader-differential.sh",
  "differentialTest": "crates/video-reader-mcp-server/tests/video_reader_mcp_differential.rs#pure_residual_differential_matches_ts_oracle",
  "boundedSlices": {
    "pure-hash": "pure_residual_differential_matches_ts_oracle",
    "pure-cache-key": "pure_residual_differential_matches_ts_oracle",
    "pure-timeline": "pure_residual_differential_matches_ts_oracle",
    "tool-route-contract": "pure_residual_differential_matches_ts_oracle",
    "server-contract": "pure_residual_differential_matches_ts_oracle",
    "allow-list": "pure_residual_differential_matches_ts_oracle"
  },
  "oracle": "scripts/differential/video-reader-mcp-oracle.ts",
  "allowList": ["read_video", "video_evidence"],
  "promotionPolicy": "NO_PROMOTIONS — pure residual differential_green only; NOT read_video effect parity; NOT authority_rust; NOT HTTP; NOT ts_deleted; rej-010 hold remains for effect surfaces"
}
path = scratch / "verification.json"
path.write_text(json.dumps(payload, indent=2) + "\n")
print(f"verification artifact: {path}")
PY

mkdir -p "$REPO_ROOT/docs/specs/verification"
cp "$SCRATCH/verification.json" "$REPO_ROOT/docs/specs/verification/bw2-tip-pure-residual-differential.json"

echo "video-reader-mcp-differential: OK (slice=$SLICE_FILTER cases=$CASE_COUNT pure_hash=$PURE_HASH_COUNT pure_cache=$PURE_CACHE_COUNT pure_timeline=$PURE_TIMELINE_COUNT corpus=$FIXTURE_CORPUS_HASH)" | tee -a "$LOG"
echo "verification artifact: $SCRATCH/verification.json" | tee -a "$LOG"
