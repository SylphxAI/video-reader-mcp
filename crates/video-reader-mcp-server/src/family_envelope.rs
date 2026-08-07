use serde_json::{json, Value};
use crate::SERVER_VERSION;

pub fn with_family_envelope(tool: &str, route_path: &str, mut body: Value) -> Value {
    let obj = body.as_object_mut().expect("object");
    let warnings = obj.get("warnings").cloned().unwrap_or_else(|| json!([]));
    let gaps = obj.get("gaps").cloned().unwrap_or_else(|| json!([]));
    let status = obj
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or("ok")
        .to_string();
    obj.insert("envelope_version".into(), json!("1"));
    obj.insert("status".into(), json!(status));
    obj.insert("tool".into(), json!(tool));
    obj.insert("product".into(), json!("cue"));
    obj.insert("product_version".into(), json!(SERVER_VERSION));
    // Preserve legacy string route under domain_route.
    if let Some(r) = obj.get("route").cloned() {
        if r.is_string() {
            obj.insert("domain_route".into(), r);
        }
    }
    obj.insert(
        "route".into(),
        json!({ "engine": "rust-core", "path": route_path }),
    );
    obj.insert("warnings".into(), warnings);
    obj.insert("gaps".into(), gaps);
    obj.entry("confidence".to_string())
        .or_insert(json!({ "kind": "deterministic", "notes": [] }));
    if let Some(results) = obj.get("results").cloned() {
        obj.entry("payload".to_string()).or_insert(results);
    }
    body
}
