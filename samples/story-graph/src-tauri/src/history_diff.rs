//! Grapheme-safe, bounded local comparison. No quadratic work on large manuscripts.
use serde::Serialize;
use unicode_segmentation::UnicodeSegmentation;

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Segment {
    kind: &'static str,
    text: String,
    omitted: usize,
}
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Diff {
    segments: Vec<Segment>,
    added: usize,
    removed: usize,
    context_before_omitted: usize,
    context_after_omitted: usize,
    coarse: bool,
}
fn segment(kind: &'static str, text: &[&str], budget: &mut usize) -> Segment {
    // A single grapheme may contain megabytes of combining marks. A grapheme
    // count alone does not bound IPC size; omit it whole rather than splitting it.
    let limit = 2048.min(*budget);
    let bytes = text.iter().try_fold(0usize, |sum, token| {
        let next = sum + token.len();
        if next > limit { None } else { Some(next) }
    });
    if text.len() <= 320
        && let Some(bytes) = bytes
    {
        *budget -= bytes;
        return Segment {
            kind,
            text: text.concat(),
            omitted: 0,
        };
    }
    if limit < 3 {
        return Segment {
            kind,
            text: String::new(),
            omitted: text.len(),
        };
    }
    let mut size = 3;
    let mut first = 0;
    let mut last = text.len();
    while first < text.len().min(160) && size + text[first].len() <= (limit + 3) / 2 {
        size += text[first].len();
        first += 1;
    }
    while last > first && text.len() - last < 160 && size + text[last - 1].len() <= limit {
        last -= 1;
        size += text[last].len();
    }
    *budget -= size;
    Segment {
        kind,
        text: format!("{}…{}", text[..first].concat(), text[last..].concat()),
        omitted: last - first,
    }
}
pub fn compare(before: &str, after: &str) -> Diff {
    let mut budget = 16_384;
    let a: Vec<_> = before.graphemes(true).collect();
    let b: Vec<_> = after.graphemes(true).collect();
    let prefix = a.iter().zip(&b).take_while(|(a, b)| a == b).count();
    let suffix = a[prefix..]
        .iter()
        .rev()
        .zip(b[prefix..].iter().rev())
        .take_while(|(a, b)| a == b)
        .count();
    let left = &a[prefix..a.len() - suffix];
    let right = &b[prefix..b.len() - suffix];
    let mut diff = Diff {
        segments: vec![],
        added: 0,
        removed: 0,
        context_before_omitted: prefix.saturating_sub(96),
        context_after_omitted: suffix.saturating_sub(96),
        coarse: false,
    };
    if left.is_empty() && right.is_empty() {
        diff.context_before_omitted = 0;
        diff.context_after_omitted = 0;
        return diff;
    }
    if prefix > 0 {
        diff.segments.push(segment(
            "equal",
            &a[prefix.saturating_sub(96)..prefix],
            &mut budget,
        ));
    }
    // Bound both the DP table and output segment count. A large replacement is
    // represented as one removed/added region, explicitly marked as coarse.
    if left.len() + right.len() > 1024 || (left.len() + 1).saturating_mul(right.len() + 1) > 65536 {
        diff.coarse = true;
        diff.removed = left.len();
        diff.added = right.len();
        if !left.is_empty() {
            diff.segments.push(segment("removed", left, &mut budget));
        }
        if !right.is_empty() {
            diff.segments.push(segment("added", right, &mut budget));
        }
    } else {
        let width = right.len() + 1;
        let mut lengths = vec![0u16; (left.len() + 1) * width];
        for i in (0..left.len()).rev() {
            for j in (0..right.len()).rev() {
                lengths[i * width + j] = if left[i] == right[j] {
                    lengths[(i + 1) * width + j + 1] + 1
                } else {
                    lengths[(i + 1) * width + j].max(lengths[i * width + j + 1])
                };
            }
        }
        let (mut i, mut j) = (0, 0);
        let mut runs: Vec<(&str, Vec<&str>)> = vec![];
        while i < left.len() || j < right.len() {
            let (kind, text) = if i < left.len() && j < right.len() && left[i] == right[j] {
                let text = left[i];
                i += 1;
                j += 1;
                ("equal", text)
            } else if i < left.len()
                && (j == right.len() || lengths[(i + 1) * width + j] >= lengths[i * width + j + 1])
            {
                let text = left[i];
                i += 1;
                diff.removed += 1;
                ("removed", text)
            } else {
                let text = right[j];
                j += 1;
                diff.added += 1;
                ("added", text)
            };
            if let Some(last) = runs.last_mut().filter(|last| last.0 == kind) {
                last.1.push(text);
            } else {
                runs.push((kind, vec![text]));
            }
        }
        for (kind, text) in runs {
            diff.segments.push(segment(
                match kind {
                    "added" => "added",
                    "removed" => "removed",
                    _ => "equal",
                },
                &text,
                &mut budget,
            ));
        }
    }
    if suffix > 0 {
        diff.segments.push(segment(
            "equal",
            &a[a.len() - suffix..a.len() - suffix + suffix.min(96)],
            &mut budget,
        ));
    }
    diff
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn precise_edits_reconstruct_both_texts_without_splitting_graphemes() {
        let before = "か\u{3099}👨‍👩‍👧‍👦は、青い駅で待った。\r\n灯は戻る。";
        let after = "か\u{3099}👨‍👩‍👧‍👦は、赤い駅で待つ。\r\n灯も戻る。";
        let diff = compare(before, after);
        assert!(!diff.coarse);
        assert_eq!(
            diff.segments
                .iter()
                .filter(|s| s.kind != "added")
                .map(|s| s.text.as_str())
                .collect::<String>(),
            before
        );
        assert_eq!(
            diff.segments
                .iter()
                .filter(|s| s.kind != "removed")
                .map(|s| s.text.as_str())
                .collect::<String>(),
            after
        );
        assert_eq!(diff.added, 3);
        assert_eq!(diff.removed, 4);
    }
    #[test]
    fn large_replacement_is_bounded_and_announced() {
        let diff = compare(&"あ".repeat(1_000_000), &"い".repeat(1_000_000));
        assert!(diff.coarse);
        assert_eq!(diff.added, 1_000_000);
        assert_eq!(diff.removed, 1_000_000);
        assert_eq!(diff.segments[0].omitted, 999680);
        assert!(serde_json::to_vec(&diff).unwrap().len() < 4096);
        let a = format!("{}旧{}", "あ".repeat(100_000), "い".repeat(100_000));
        let b = a.replace('旧', "新");
        let diff = compare(&a, &b);
        assert_eq!(diff.context_before_omitted, 99904);
        assert_eq!(diff.context_after_omitted, 99904);
        assert_eq!(diff.added, 1);
        assert_eq!(diff.removed, 1);
    }
    #[test]
    fn empty_and_identical_values_have_correct_counts() {
        assert!(compare("同じ", "同じ").segments.is_empty());
        assert_eq!(compare("", "🇯🇵👨‍👩‍👧‍👦").added, 2);
        assert_eq!(compare("か\u{3099}\r\n", "").removed, 2);
    }
    #[test]
    fn repeated_tokens_and_unicode_reconstruct_exhaustive_short_inputs() {
        let mut samples = vec![String::new()];
        for _ in 0..3 {
            let previous = samples.clone();
            for prefix in previous {
                for token in ["a", "b", "👩‍🚀", "か\u{3099}"] {
                    samples.push(format!("{prefix}{token}"));
                }
            }
        }
        samples.sort();
        samples.dedup();
        for before in &samples {
            for after in &samples {
                let diff = compare(before, after);
                if before == after {
                    assert_eq!(diff.added + diff.removed, 0);
                    continue;
                }
                assert_eq!(
                    diff.segments
                        .iter()
                        .filter(|s| s.kind != "added")
                        .map(|s| s.text.as_str())
                        .collect::<String>(),
                    *before
                );
                assert_eq!(
                    diff.segments
                        .iter()
                        .filter(|s| s.kind != "removed")
                        .map(|s| s.text.as_str())
                        .collect::<String>(),
                    *after
                );
            }
        }
    }
    #[test]
    fn enormous_single_graphemes_do_not_escape_the_byte_budget() {
        let before = format!("a{}", "\u{3099}".repeat(100_000));
        let after = format!("b{}", "\u{3099}".repeat(100_000));
        let diff = compare(&before, &after);
        assert_eq!(diff.added, 1);
        assert_eq!(diff.removed, 1);
        assert!(
            diff.segments
                .iter()
                .all(|s| s.omitted == 1 && s.text == "…")
        );
        assert!(serde_json::to_vec(&diff).unwrap().len() < 1024);
    }
}
