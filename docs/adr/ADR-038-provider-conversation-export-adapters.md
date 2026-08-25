# ADR-038: Provider Conversation Export Adapters

- Status: Accepted and implemented
- Date: 2026-08-25
- Owners: KOMYAKU architecture

## Context

ChatGPT, Claude, and Gemini let users request or download conversation data, but their help documentation does not promise one stable shared JSON schema. Provider exports can contain multiple conversations, branches, provider-only parts, or flat activity records that cannot prove thread membership.

## Decision

- Keep exact UTF-8 source bytes and their SHA-256 as the provenance authority.
- Split one provider bundle into multiple Canonical Conversations while retaining one Import ID and source hash.
- Version each adapter independently.
- Preserve ChatGPT mapping edges instead of flattening branches.
- Map Claude `human` to Canonical `user`; retain other roles as supplied.
- Map structured Gemini `model` to Canonical `assistant`.
- Treat Google Takeout My Activity as lossy and flat. Do not invent conversation membership, execute safe HTML, or strip it into apparently authoritative text; preserve it as an unknown provider part and report `partial`.
- Detect only recognizable structures. Unknown JSON returns no provider instead of guessing.
- Maintain synthetic compatibility fixtures and never commit real user exports.
- Enforce byte and aggregate message limits before returning a bundle.

## Boundary

The package adapters and authenticated Cloud boundary are implemented. One immutable source archive and one `conversation_imports` record own an ordered set of `conversation_import_items`. All Canonical Conversations, Messages, Edges, associations, and the outbox event commit in one PostgreSQL transaction. The legacy `conversation_imports.conversation_id` remains the first conversation for backward compatibility; new consumers use `conversationIds`.

The API auto-detects only recognized provider shapes and otherwise uses the Generic JSON parser. Callers may explicitly select `generic`, `chatgpt`, `claude`, or `gemini`. A whole bundle succeeds atomically or no Canonical Conversation becomes visible. The immutable object can exist before a failed database transaction, so orphan-object reconciliation remains a separate operational requirement.

## References

- OpenAI data export: <https://help.openai.com/en/articles/7260999-how-do-i-export-my-chatgpt-history-and-data>
- Anthropic data export: <https://support.anthropic.com/en/articles/9450526-how-can-i-export-my-claude-data>
- Gemini Apps data export: <https://support.google.com/gemini/answer/16920332>

## Multilingual summary

- 日本語: Provider原本を正本としてHashを保持し、復元できるBranchだけをCanonical Graphへ変換する。不明な関係は推測しない。
- English: Retain the provider export as the provenance authority, convert only recoverable graph structure, and never guess unknown relationships.
- 简体中文：以Provider原始导出为来源依据，仅转换可恢复的Graph结构，不猜测未知关系。
