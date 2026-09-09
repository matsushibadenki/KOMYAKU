import { createEmptyDocument, parseCanonicalDocument } from '@komyaku/document-schema';
import { compareCanonicalDocuments, segmentGraphemes } from '@komyaku/diff-engine';
import { createKomyakuArchive, verifyKomyakuArchive } from '@komyaku/archive-core';
import { encodeVersionSnapshot } from '@komyaku/version-engine';
import { cpus, platform, arch } from 'node:os';

// Explicit diagnostic benchmark, not a timing-sensitive unit test or release gate.
const document = createEmptyDocument({ language: 'ja', metadata: { title: 'Performance fixture' } });
const phrase = '文a中e\u0301👩‍👩‍👧‍👦';
const text = phrase.repeat(20_000);
if (segmentGraphemes(text, 'ja').length !== 100_000) throw new Error('fixture_grapheme_count');
const before = parseCanonicalDocument({ ...document, content: [{
  id: crypto.randomUUID(), type: 'paragraph', schemaVersion: 1, attrs: { lang: 'ja', dir: 'auto' },
  metadata: {}, extensions: {}, renderArtifacts: [],
  content: [{ type: 'text', text, marks: [], metadata: {}, extensions: {} }]
}] });
const after = structuredClone(before);
after.content[0].content[0].text = text.slice(0, -phrase.length) + '文b中e\u0301👩‍👩‍👧‍👦';
const timings = { encode: [], compare: [], export: [], verify: [] };
let archiveBytes = 0;
let peakObservedRss = process.memoryUsage().rss;
for (let iteration = 0; iteration < 20; iteration++) {
  let started = performance.now();
  encodeVersionSnapshot(after);
  timings.encode.push(performance.now() - started);
  started = performance.now();
  const diff = compareCanonicalDocuments(before, after, { locale: 'ja' });
  timings.compare.push(performance.now() - started);
  if (diff.changes.length !== 1) throw new Error('fixture_diff_mismatch');
  started = performance.now();
  const archive = await createKomyakuArchive({ document: after, assets: [], createdAt: '2026-09-09T00:00:00.000Z' });
  timings.export.push(performance.now() - started);
  archiveBytes = archive.byteLength;
  started = performance.now();
  const restored = await verifyKomyakuArchive(archive);
  timings.verify.push(performance.now() - started);
  if (encodeVersionSnapshot(restored.document).json !== encodeVersionSnapshot(after).json) throw new Error('fixture_restore_mismatch');
  peakObservedRss = Math.max(peakObservedRss, process.memoryUsage().rss);
}
const result = Object.fromEntries(Object.entries(timings).map(([name, values]) => {
  values.sort((a, b) => a - b);
  return [name, { p50Ms: values[9], p95Ms: values[18] }];
}));
console.log(JSON.stringify({ platform: platform(), arch: arch(), cpu: cpus()[0]?.model,
  bun: Bun.version, graphemes: 100000, samples: 20, timings: result, archiveBytes,
  peakObservedRss, scope: 'in-process multilingual Canonical/Diff/v1 Archive; no UI, full-history Archive or native DB timing' }, null, 2));
