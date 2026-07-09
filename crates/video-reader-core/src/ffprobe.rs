use std::path::Path;
use std::process::{Command, Stdio};

use serde_json::Value;

pub fn run_ffprobe(path: &Path) -> Result<Value, String> {
    let output = Command::new("ffprobe")
        .args([
            "-v",
            "quiet",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
            "-show_chapters",
        ])
        .arg(path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|err| format!("FFPROBE_UNAVAILABLE: {err}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("FFPROBE_FAILED: {stderr}"));
    }

    let stdout = String::from_utf8(output.stdout).map_err(|err| format!("FFPROBE_UTF8: {err}"))?;
    serde_json::from_str(&stdout).map_err(|err| format!("FFPROBE_JSON: {err}"))
}

pub fn is_ffprobe_available() -> bool {
    Command::new("ffprobe")
        .arg("-version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}