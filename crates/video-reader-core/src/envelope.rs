use std::path::Path;

use serde::Serialize;
use serde_json::Value;

use crate::read_video::{ReadVideoResponse, VideoSourceResult};
use crate::{ENGINE_NAME, READ_VIDEO_ROUTE};

pub const READER_EVIDENCE_CONTRACT_VERSION: &str = "reader-evidence-v1";
pub const PACKAGE_NAME: &str = "@sylphx/video-reader-mcp";
pub const TOOL_NAME: &str = "read_video";
pub const READER_CONTRACT_VERSION: &str = "0.1.0";

#[allow(non_snake_case)]
#[derive(Debug, Clone, Serialize)]
pub struct AgentEvidenceEnvelope {
    pub subject: String,
    pub source: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sourceHash: Option<String>,
    pub freshness: Freshness,
    pub locator: Locator,
    pub route: RouteInfo,
    pub confidence: &'static str,
    pub warnings: Vec<String>,
    pub nextActions: Vec<String>,
    pub delegation: DelegationBlock,
    pub routing: ReadVideoRouting,
    pub result: Value,
}

#[allow(non_snake_case)]
#[derive(Debug, Clone, Serialize)]
pub struct Freshness {
    pub indexedAt: String,
    pub stale: bool,
}

#[allow(non_snake_case)]
#[derive(Debug, Clone, Serialize)]
pub struct Locator {
    pub path: String,
    pub detectedFormat: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct RouteInfo {
    pub sniff: String,
    pub delegation: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct DelegationBlock {
    pub contract_version: String,
    pub source_path: String,
    pub detected_format: String,
    pub delegated_tool: String,
    pub reader_package: String,
    pub reader_contract_version: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ReadVideoRouting {
    pub contract_version: String,
    pub extract_route: String,
    pub timeline_route: String,
    pub launch_source: String,
    pub reader_package: String,
    pub engine: String,
}

pub fn build_read_video_envelope(
    source_path: &Path,
    response: &ReadVideoResponse,
    primary: &VideoSourceResult,
) -> AgentEvidenceEnvelope {
    let source = source_path.display().to_string();
    let timeline = primary.timeline.as_ref();
    let detected_format = timeline
        .and_then(|doc| doc.format.format_name.clone())
        .unwrap_or_else(|| "video/unknown".to_string());
    let source_hash = timeline.map(|doc| doc.provenance.source_hash.clone());
    let timeline_route = timeline
        .map(|doc| doc.provenance.assembly_route.clone())
        .unwrap_or_else(|| "unknown".to_string());
    let warnings = timeline
        .map(|doc| doc.warnings.clone())
        .unwrap_or_default();
    let sniff_route = timeline_route.clone();
    let result = serde_json::to_value(response).unwrap_or_else(|_| Value::Object(Default::default()));

    AgentEvidenceEnvelope {
        subject: source.clone(),
        source: source.clone(),
        sourceHash: source_hash,
        freshness: Freshness {
            indexedAt: now_iso(),
            stale: false,
        },
        locator: Locator {
            path: source,
            detectedFormat: detected_format.clone(),
        },
        route: RouteInfo {
            sniff: sniff_route,
            delegation: TOOL_NAME.to_string(),
        },
        confidence: "deterministic",
        warnings,
        nextActions: vec![
            "Re-run read_video after file changes to refresh sourceHash.".to_string(),
            "Use video_evidence for frame crops and citeable temporal locators.".to_string(),
        ],
        delegation: DelegationBlock {
            contract_version: READER_EVIDENCE_CONTRACT_VERSION.to_string(),
            source_path: source_path.display().to_string(),
            detected_format,
            delegated_tool: TOOL_NAME.to_string(),
            reader_package: PACKAGE_NAME.to_string(),
            reader_contract_version: READER_CONTRACT_VERSION.to_string(),
        },
        routing: ReadVideoRouting {
            contract_version: READER_EVIDENCE_CONTRACT_VERSION.to_string(),
            extract_route: READ_VIDEO_ROUTE.to_string(),
            timeline_route,
            launch_source: "local".to_string(),
            reader_package: PACKAGE_NAME.to_string(),
            engine: ENGINE_NAME.to_string(),
        },
        result,
    }
}

fn now_iso() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let elapsed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    format!("{}Z", elapsed.as_secs())
}