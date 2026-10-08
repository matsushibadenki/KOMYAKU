
### Native Metal frame benchmark (2026-10-08)

[Done] `benchmark_native_gpu_graphs` renders synthetic 1,000 / 5,000 / 10,000-node graphs at logical 1100×800, scale 1 / 2, zoom 1 / 0.1. Apple M4 / Metal, release build, 2 warm-up frames and 20 measured frames per case. CPU scene preparation, uploads, GPU submission and mapped readback completion are included: p50 2.723–9.002 ms; p95 3.127–10.261 ms. These are offscreen blocking frames, not application FPS or display latency. The application node limit remains unchanged.

[Pending] GPU-only timing: this adapter returned zero or reversed render-pass timestamps in 13–20 of 20 samples per case. The benchmark reports NaN instead of treating invalid samples as valid GPU durations. Validation error scope passed. Reliable GPU-only timing requires a working counter backend; no performance guarantee follows from these measurements.

[Done] Offscreen authoring controls now retain only their edited display values and measured geometry, rather than serializing escaped textarea HTML. Remount restores edited Unicode text, canonical offsets, and manual/automatic dialogue width. Focused/IME-active controls remain pinned. A regression test rejects any attempt to serialize offscreen manuscript HTML. This reduces duplicate string/markup allocation; total placeholder count is still a separate unfinished optimization.

[Done] Reading canonical copy includes headings and dialogue-cell endpoints, in forward or reverse selection, with unmounted intermediate blocks reconstructed from the source. Dialogue columns use a tab separator; canonical CRLF within cells is preserved. Native clipboard QA remains to be completed.

### Follow-up measurements

[Done] Local opt-in WebKit frame sampling (`STORY_GRAPH_PERFORMANCE_QA=1`, debug builds only) measures requestAnimationFrame intervals without logging manuscript/account data. Million-character unbroken paragraph: 120 samples after a 2,000-page wheel movement. Vertical p50 17ms / p95 18ms / max 18ms; horizontal p50 17ms / p95 18ms / max 24ms; neither run had a >50ms interval. This includes the post-input sampling window and is not a continuous scrolling FPS guarantee.

[Done] Above 1,024 graph nodes, cache a 40×25 semantic density overview for the small minimap per document revision. Tiny overview edges are omitted; selected markers and full graph geometry remain exact. At 10,000 nodes / zoom 1, geometry count falls from 21,070 to 2,071 quads; at zoom 0.1 from 48,792 to 29,793. Same M4 benchmark after the change: 10,000 nodes, scale 2, zoom 1 p50 2.783ms / p95 4.186ms; zoom 0.1 p50 7.405ms / p95 8.787ms. Runs at unchanged 1,000 nodes also varied, so elapsed differences should not be attributed entirely to this change. GPU-only timestamp results remain invalid on this adapter.
