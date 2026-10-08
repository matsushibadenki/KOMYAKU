# Large text performance — 2026-10-08

These are individual local runs, not controlled cross-machine comparisons.

## Rust borrowed projections

100 tree projections of a million-character fixture: borrowed read 3.093 ms total, former snapshot read 7.903 ms total. The test asserts a bounded tree projection under 20 KiB and exact Canonical Unicode in the Reading response without a duplicate plain-text body. Rust retains authoritative ownership and the read callback runs under the engine state lock.

## Compact save structure cache

Cached Node properties now contain typed structural SHA-256 digests, rather than another copy of manuscript strings. Paragraph identity and before/after digests must match exactly. Document extensions participate in the unchanged envelope: simultaneous paragraph and extension edits force full serialization, avoiding extension loss. Journal checksums, full candidate validation and durable fsync acknowledgements remain enforced.

Release real-file benchmark, 1,000 paragraphs and about a million characters, ten edits:

| Path | Median |
| --- | ---: |
| Full snapshot | 17.172 ms |
| Uncached journal | 49.633 ms |
| Cached journal | 23.140 ms |

Checkpoint 3,012,822 bytes, journal 2,995 bytes, retained serialized buffer capacity 3,013,853 bytes. Maximum Rust test RSS 32,096,256 bytes; peak footprint 23,495,232 bytes.

Separate paragraph serialization run: full serializer 17.877 ms, paragraph serializer 19.321 ms; maximum RSS 54,050,816 bytes and footprint 45,220,440 bytes. This does not establish a release speed advantage for delta persistence. The improvement reduces repeated file replay and body retention; hashing and complete-document validation still traverse the manuscript. Earlier debug results must not be used as release predictions.

## Native Reading View

An isolated macOS/Tauri profile contained 1,045,893 UTF-16 units across 1,000 paragraphs, with explicit newlines and emoji. The reader groups whole paragraphs into at most 32 blocks / approximately 32 Ki UTF-16 chunks, mounts near the viewport and retains measured placeholder extents outside it. Horizontal scrolling reached later chunks and returned to the first paragraph. Vertical wheel scrolling reached paragraphs 991–1,000 and the final scene headings, then returned to paragraphs 1–29. No whole-document input DOM is created. Selection endpoints pin mounted chunks.

The timed debug native process reached maximum RSS 188,563,456 bytes and peak footprint 222,496,112 bytes. This excludes WebKit child processes and includes application startup/other projections, so it is not a complete reader memory measurement. Frame time was not measured. A single huge unbroken paragraph deliberately remains a single layout unit to preserve continuous wrapping; optimize that case separately. Arbitrary selections spanning unmounted paragraphs remain unfinished.

## Follow-up: borrowed saving and comparison

The normal edit/save/retry path, background autosave, immutable version recording and current-document version comparison now borrow the engine document instead of cloning it. Scene text/structure comparisons extract only the requested scene before releasing the gate. This removes a full object-tree copy, but holds the engine read lock during serialization/filesystem persistence; it does not claim zero editing latency during disk I/O. Existing immutable historical snapshots remain standalone.

A follow-up release paragraph serializer benchmark (1,000 paragraphs / one million characters / ten saves) reported full serializer median 12.751 ms and paragraph serializer median 13.742 ms. This still does not establish a release speed advantage; differences between runs are not controlled measurements. The normal non-IME range replacement path now also skips preparation of every fragment string. Real IME and cross-paragraph selection remain separately unfinished.

## Unbroken paragraph native probe

A separate generated profile contained one 1,000,000-character Japanese paragraph. Horizontal Reading displayed continuous wrapping and a 2,000-page scroll reached the following scene headings. Switching to vertical displayed correct initial columns, but the subsequent 2,000-page scroll timed out and the isolated QA application stopped responding to Quit. The probe was terminated. This is a failed stress probe, not a frame-time measurement or a passed vertical performance test. The generated profile remains separate from user manuscripts. Large unbroken vertical paragraphs still need bounded layout.

## Bounded native Reading follow-up

The reader now measures at most 8,192 UTF-16 units at a time using WebKit Range rectangles. It retains the sample's unfinished final visual line/column for the next sample; canonical text receives no new newline. Each measurement yields to requestAnimationFrame and can be cancelled when the view changes. Viewport span changes invalidate the measured cuts. Only near-viewport chunks mount text. Copy within one original paragraph uses canonical offsets, including CRLF conversion, rather than DOM paragraph separators.

With the same isolated million-character paragraph, native vertical Reading reached the following final scene headings with a 2,000-page scroll and returned to the first heading with the reverse operation. Both operations responded in the native QA instead of timing out. Initial columns matched the earlier display. This confirms that stress scenario; it does not measure GPU frame time, WebKit child memory, or establish every Unicode/kinsoku boundary. Those checks remain open.

## Engine revision certified paragraph saves

The host records the Engine revision of a successful save. Only an immediately subsequent Rust-created Paragraphs command, observed at exactly revision + 1, can reuse that certification. The cached checkpoint/journal file stamps must also match; external changes, ordinary untracked Store calls, revision discontinuities or failure invalidate certification. This avoids re-hashing every unchanged paragraph while retaining exact old-paragraph matching, bounded patches, whole resulting snapshot checksum, domain validation at command application, durable writes and recovery verification. Graph edits and other commands use the full comparison path.

Release benchmark: one million characters / 1,000 paragraphs / 10 durable edits, median full serializer 12.881 ms, independently verified paragraph serializer 13.913 ms, Engine-certified serializer 11.797 ms. This is a single local run (about 8% faster than full serialization), not a portable performance guarantee. Every result was reloaded and compared exactly. Whole resulting-file SHA-256 remains; the broader allocation and save performance work is unfinished.
