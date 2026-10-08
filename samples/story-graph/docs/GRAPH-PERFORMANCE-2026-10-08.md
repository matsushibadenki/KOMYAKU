# Graph CPU rendering baseline — 2026-10-08

[Done] Release fixture: 1,000 / 5,000 / 10,000 story nodes, N−1 narrative connections, Japanese/English/Chinese titles, 1100×800 viewport, 100 frames per zoom. Includes the Rust minimap. Fixtures are generated directly for the generic renderer; the authoring app still enforces its 256-node limit.

| Nodes | Index ms | Scene p50 ms, zoom 1 | Scene p95 ms, zoom 1 | Scene p50 ms, zoom 0.1 | Scene p95 ms, zoom 0.1 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1,000 | 2.260 | 0.106 | 0.169 | 1.363 | 1.841 |
| 5,000 | 14.106 | 0.269 | 0.521 | 4.654 | 8.394 |
| 10,000 | 30.067 | 0.270 | 0.650 | 4.981 | 6.245 |

Second isolated release run measured with `/usr/bin/time -l`: 136,445,952 bytes maximum resident set (about 130 MiB), 77,431,384 bytes peak footprint. This includes fixture generation, serialization, parsing and every size in one process. Results vary with desktop load; they are measurements rather than CI thresholds.

At zoom 1 the viewport shows at most 36 nodes. At zoom 0.1 it shows 880 / 2,244 / 2,244 nodes. Full minimap geometry increases maximum quad counts to 3,220 / 11,220 / 21,220 at zoom 1; a cached or clustered minimap could reduce work further.

[Pending] GPU frame times, font atlas cost, app mutation/save costs and native DPI changes at those graph sizes. CPU scene assembly is not a measurement of end-to-end FPS. Raising the application cap requires those additional checks.

Reproduce: `cargo test -p unge-render benchmark_large_story_graphs --release --locked -- --ignored --nocapture`.
