//! Opt-in local frame diagnostics; never enabled in normal sessions.
use super::*;
fn enabled() -> bool {
    cfg!(debug_assertions)
        && std::env::var_os("STORY_GRAPH_PERFORMANCE_QA").is_some_and(|value| value == "1")
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Sample {
    samples: u32,
    p50: f64,
    p95: f64,
    max: f64,
    over50: u32,
    kind: String,
    vertical: bool,
    #[serde(default)]
    blocks: u32,
    #[serde(default)]
    batches: u32,
    #[serde(default)]
    inputs: u32,
}
impl Sample {
    fn valid(&self) -> bool {
        self.blocks <= 200_000
            && self.batches <= 200_000
            && self.inputs <= 200_000
            && (8..=120).contains(&self.samples)
            && self.over50 <= self.samples
            && [self.p50, self.p95, self.max]
                .iter()
                .all(|v| v.is_finite() && (0. ..=60000.).contains(v))
            && self.p50 <= self.p95
            && self.p95 <= self.max
            && ["idle", "wheel", "resize", "scroll", "input", "paste"].contains(&self.kind.as_str())
    }
}
#[tauri::command]
pub fn performance_qa_enabled(window: tauri::WebviewWindow) -> std::result::Result<bool, String> {
    allowed(&window)?;
    Ok(enabled())
}
#[tauri::command]
pub fn performance_qa_sample(
    window: tauri::WebviewWindow,
    sample: Sample,
) -> std::result::Result<(), String> {
    allowed(&window)?;
    if !enabled() || !sample.valid() {
        return Err("diagnostic_disabled".into());
    }
    eprintln!(
        "QA_FRAME window={} kind={} vertical={} samples={} p50_ms={:.3} p95_ms={:.3} max_ms={:.3} over50={} blocks={} batches={} inputs={}",
        window.label(),
        sample.kind,
        sample.vertical,
        sample.samples,
        sample.p50,
        sample.p95,
        sample.max,
        sample.over50,
        sample.blocks,
        sample.batches,
        sample.inputs
    );
    Ok(())
}
fn latency_valid(kind: &str, milliseconds: f64) -> bool {
    ["wheel", "resize", "scroll", "input", "paste"].contains(&kind)
        && milliseconds.is_finite()
        && (0. ..=60000.).contains(&milliseconds)
}
#[tauri::command]
pub fn performance_qa_latency(
    window: tauri::WebviewWindow,
    kind: String,
    milliseconds: f64,
) -> std::result::Result<(), String> {
    allowed(&window)?;
    if !enabled() || !latency_valid(&kind, milliseconds) {
        return Err("diagnostic_disabled".into());
    }
    eprintln!(
        "QA_EVENT window={} kind={} first_frame_ms={:.3}",
        window.label(),
        kind,
        milliseconds
    );
    Ok(())
}
#[tauri::command]
pub fn performance_qa_caret(
    window: tauri::WebviewWindow,
    values: Vec<f64>,
) -> std::result::Result<(), String> {
    allowed(&window)?;
    if !enabled()
        || values.len() != 10
        || values
            .iter()
            .any(|v| !v.is_finite() || v.abs() > 100_000_000.)
    {
        return Err("diagnostic_disabled".into());
    }
    eprintln!("QA_CARET window={} values={:?}", window.label(), values);
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn latency_accepts_only_bounded_diagnostics() {
        assert!(latency_valid("paste", 450.));
        for value in [f64::NAN, f64::INFINITY, -1., 60001.] {
            assert!(!latency_valid("input", value));
        }
        assert!(!latency_valid("manuscript", 20.));
    }
    #[test]
    fn rejects_invalid_samples() {
        let mut sample = Sample {
            samples: 120,
            p50: 16.,
            p95: 20.,
            max: 40.,
            over50: 0,
            kind: "wheel".into(),
            vertical: true,
            blocks: 32,
            batches: 4,
            inputs: 2,
        };
        assert!(sample.valid());
        sample.p50 = f64::NAN;
        assert!(!sample.valid());
        sample.p50 = 22.;
        assert!(!sample.valid());
        sample.p50 = 16.;
        sample.kind = "private text".into();
        assert!(!sample.valid());
    }
}
