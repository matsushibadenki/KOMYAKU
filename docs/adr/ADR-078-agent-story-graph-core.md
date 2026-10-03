# ADR-078 — Agent-facing Story Graph core

Status: Accepted — 2026-09-26

## Context

As generative models improve, prose generation alone becomes less differentiating. Authors still need a durable answer to structural questions such as what a character knows at a given scene, whether two routes can rejoin, and which consequences follow from changing a fact. These answers must survive model changes and must not depend on an AI rereading the entire manuscript correctly each time.

KOMYAKU already separates mutable drafts, immutable Versions, Version Branches and reviewed merges. Story Graph adds the structure inside one work state. Story Paths and Version Branches remain different concepts.

## Decision

Use the following dependency direction:

```text
Agent
  → KOMYAKU application and policy boundary
    → Canonical Document + Story Graph workspace
      → Version / Branch / reviewed Merge
        → deterministic consistency and impact results
```

`@komyaku/story-graph` is a shared, UI-independent contract. A Story Graph references stable Canonical Node IDs instead of copying prose. Reading-flow edges form a DAG; semantic relations may contain cycles. Named Story Paths select an explicit reading route. Entities have bounded JSON state, and Story Nodes declare preconditions and effects. The deterministic engine evaluates these declarations without an AI provider.

An Agent may query the Graph and propose Graph commands or document edits. It does not mutate the authoritative state, choose a merge result, or write a Version directly. The author reviews a proposal; KOMYAKU validates the resulting Document and Graph; an accepted workspace becomes an immutable Version snapshot.

The composite Story Workspace is the future Version unit for Story Graph documents:

```text
Story Workspace Snapshot
  ├── Canonical Document
  └── Canonical Story Graph
```

Both parts must share one Document ID and are encoded deterministically. A Graph-only save paired with older prose is invalid.

For Tauri, Rust owns the authoritative Document, Story Graph state, persistence and command ordering. WebViews request commands and receive bounded viewport/read projections. Canvas rendering can move to Rust/wgpu when measurements justify it; large render buffers and full high-frequency state do not cross the Rust/JavaScript boundary.

## Consequences

- Questions backed by declared state, such as knowledge visibility and precondition failures, have reproducible answers independent of a model.
- Route comparison reports conflicting entity properties and consistency failures without claiming that prose is semantically correct.
- AI analysis remains useful for extracting candidate facts and proposing rules, but its output is provenance-bearing review material until accepted.
- Existing Canonical Document Version and History Archive v2 contracts cannot be called complete Story Workspace backups. Native composite persistence and a compatible Archive major version are required before Story Graph release.
- The sample application remains the reference UI. The schema and deterministic engine belong to KOMYAKU because Agents, other frontends and native persistence require the same contract.

## Initial implementation

`packages/story-graph` provides Story Graph v1 parsing, bounded reference/DAG/Path validation, deterministic Document+Graph snapshot encoding, state evaluation, knowledge queries, all-Path consistency checks, route-merge state comparison and conservative downstream impact closure over declared flow, state dependencies and semantic edges. It performs no persistence and no automatic merge write.
