# Provider Conversation Export Compatibility

- Status: Adapter foundation implemented
- Updated: 2026-08-25
- Decision: `docs/adr/ADR-038-provider-conversation-export-adapters.md`

## Public package API

```text
detectConversationExportProvider(raw)
importChatGptExport(raw, options)
importClaudeExport(raw, options)
importGeminiExport(raw, options)
```

Each importer returns a bundle containing `provider`, `conversations[]`, one `importId`, the SHA-256 `sourceHash` of the exact original bytes, aggregate `warnings`, `status`, and `rawBytes`. Default boundaries are 10 MiB and 10,000 messages across the complete bundle.

The authenticated Cloud API stores that bundle atomically. `conversation_import_items` retains its ordered membership, while the legacy singular `conversation_id` and response `conversationId` refer to the first item. New integrations must read `conversationIds`. Auto-detection can be overridden with the validated `X-KOMYAKU-Source-Provider` header.

## Compatibility matrix

| Provider | Recognized shape | Preserved structure | Known limitation |
|---|---|---|---|
| ChatGPT | Conversation array with `mapping` | Message-bearing ancestor edges and branches | Provider-only content becomes an unknown part |
| Claude | Conversation array with `chat_messages` | Linear message order, timestamps, attachments/files metadata | No branch is inferred without exported parent data |
| Gemini | `conversations[].entries` | Linear entries, roles, timestamps, unknown parts | Shape is compatibility-fixture based, not a promised public schema |
| Gemini My Activity | Flat activity array with Gemini markers | Each activity entry as an isolated partial conversation | Thread membership and complete response availability are not inferred |

## Fixture policy

Fixtures live in `packages/conversation-importer/test/fixtures`. They are synthetic and contain no user data. A provider-format change requires:

1. a redacted synthetic reproduction;
2. a parser-version review and usually a version bump;
3. regression tests for raw-hash provenance, roles, content, edges, and warnings;
4. documentation of losses and whether re-import is required.

Raw HTML, tool data, and unknown objects are data, never instructions. Renderers must not execute unknown parts. Logs must contain only identifiers, sizes, parser versions, status, and warning codes—not authored content or raw provider payloads.

## Multilingual summary

- 日本語: 元ExportのBytesとHashを保持し、対応できる構造だけを変換する。Fixtureは合成データのみとする。
- English: Preserve original bytes and hashes, convert only supported structures, and use synthetic fixtures exclusively.
- 简体中文：保留原始Bytes与Hash，只转换受支持的结构，并且只使用合成Fixture。
