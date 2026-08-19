# Content-addressed Asset Storage

Status: implemented domain and persistence foundation

KOMYAKU stores image, PDF, diagram preview, and generic-file bytes outside Canonical Document JSON. The implemented storage boundary deduplicates exact bytes inside one Workspace while keeping authorization, logical references, and deletion decisions separate.

## Write flow

```mermaid
flowchart TD
    A[Authorized Asset write] --> B[Enforce byte limit]
    B --> C[Compute SHA-256]
    C --> D[Workspace-scoped object key]
    D --> E{Conditional immutable PUT}
    E -->|created| F[Claim Asset row]
    E -->|already exists| G[HEAD and verify hash plus size]
    G --> F
    F --> H[Insert logical Asset reference]
```

The key format is:

```text
workspaces/{workspace_uuid}/assets/sha256/{first_two_hash_chars}/{sha256}
```

The Workspace UUID is part of the key. Equal bytes in different Workspaces therefore do not share an object and cannot become a cross-tenant existence oracle. Hash equality never grants read access.

The S3-compatible write uses `If-None-Match: *`. A concurrent winner creates the immutable object; a loser accepts reuse only after `HEAD` returns the expected `content-sha256` metadata and byte size. PostgreSQL independently enforces one active content-addressed Asset for a Workspace and hash.

## Reference accounting

`asset_references` records the logical owner of an Asset:

- Workspace and Asset identity;
- referrer type and UUID, such as a Document Node or Version;
- relation, such as `source`, `preview`, or `attachment`;
- creating user and timestamps;
- `released_at` for an auditable soft release.

An active-reference unique index makes repeated claims idempotent. Releasing a reference does not delete the object or Asset row. Physical deletion is a later retention operation and must consider all active references, trash and recovery windows, published Versions, archive policy, and legal holds.

## Failure and reconciliation model

Object Storage and PostgreSQL cannot share one atomic transaction. KOMYAKU writes the deterministic immutable object first and then claims the database Asset and reference. A database failure may therefore leave an unreferenced object. It must be found by an authorized prefix reconciliation job and quarantined through retention; request handlers must not delete it as rollback.

Existing conversation-import objects remain in `immutable-keyed` mode. New CAS objects use `content-addressed` mode, allowing migration without rewriting or weakening the immutable raw-import archive.

## Current boundary

Implemented:

- key construction, hashing, conditional write, and conflict verification;
- Workspace-scoped PostgreSQL uniqueness;
- transactional Asset/reference claim;
- idempotent active references and soft release;
- authorization-before-storage and configurable upload-size enforcement;
- unit tests and an opt-in PostgreSQL concurrency integration test.

Not yet exposed as a public upload route. Editor insertion, signed read URLs, malware/type inspection, reconciliation, retention garbage collection, and quota metering remain separate work.

## 日本語要約

同じWorkspace内で同一Byte列をSHA-256により再利用します。異なるWorkspaceではObjectを共有しません。参照解除は論理的に記録するだけで原本を即時削除せず、Retention、公開Version、法的保持を確認する後続処理に委ねます。

## 简体中文摘要

相同工作区内的相同字节通过 SHA-256 安全复用，不同工作区之间不共享对象。解除引用只记录逻辑状态，不会立即删除原始对象；物理清理由后续保留策略在检查发布版本、恢复期与法律保留后执行。
