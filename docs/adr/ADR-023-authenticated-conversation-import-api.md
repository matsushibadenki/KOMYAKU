# ADR-023: Authenticated Conversation Import API

- Status: Accepted
- Date: 2026-08-18

## Context

Generic JSON Importer、Raw-first Archive、Workspace Authorization、Session、Idempotencyが実装されたため、安全なCloud Import Endpointへ接続できる。EnvelopeへRaw Sourceと管理Metadataを混在させると原本Byte列が変わるため、保存境界を明確にする必要がある。

## Decision

- 作成Routeを`POST /api/v1/workspaces/:workspaceId/conversation-imports`とする。
- Request BodyはImport元のUTF-8 JSON Byte列そのものとする。Workspace IDはPathへ置く。
- `Authorization: Bearer`と`Idempotency-Key`を必須とする。
- UserはEmail確認済みで、対象WorkspaceのOwner、Admin、Editorのいずれかでなければならない。
- Idempotency ScopeをUser IDとWorkspace IDへBindingする。同じKeyのReplay時もDatabaseでWorkspace Membershipを再検証する。
- `Content-Type`は`application/json`だけを受け付け、上限は10 MiBとする。
- 初期Routeでは`sourceProvider=generic`、Visibility=`private`、AI Training Policy=`deny`へ固定する。
- 解析前にRaw BytesをImmutable Object Storageへ保存する。
- Parsing失敗は`422`とImport IDを返し、その失敗ArchiveもIdempotentな結果として参照できる。
- Import状態取得を`GET /api/v1/workspaces/:workspaceId/conversation-imports/:importId`で提供し、SessionとMembershipを再検証する。
- Public Authentication Feature Gateが無効な場合はImport RouteもMountしない。

## Consequences

ClientはTimeout時に同じKeyと同じBodyを安全に再送でき、Raw SourceのHashも変化しない。Public共有やAI学習許可をImport Requestから指定できないため、意図しない公開を防げる。ChatGPT、Claude、Gemini固有AdapterとAttachment Uploadは別Endpointまたは明示的なProvider選択が必要になる。
