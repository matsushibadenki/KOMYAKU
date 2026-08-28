# ADR-042: Local and BYOK AI Provider Gateway

- Status: Accepted and foundation implemented
- Date: 2026-08-28
- Owners: KOMYAKU architecture and security

## Context

Imported Conversationの任意地点からLocal ModelまたはUser所有APIへ会話を引き継ぐには、Provider SDKをCanonical Domainへ入れず、Userが確認した範囲だけを送信する境界が必要である。Imported TextはUntrusted Dataであり、送信範囲、Endpoint、Credential、Tool権限を変更できてはならない。

## Decision

- `@komyaku/ai-gateway`をProvider-neutralなReview／Send境界とする。
- Local Connectionは`localhost`、`127.0.0.1`、`[::1]`だけを許可する。
- BYOK ConnectionはHTTPSとCredential Referenceを必須にする。URL内Credential、Query、Fragmentを拒否する。
- Credential本体はConnection、Preview、Confirmed Handoff、Resultへ入れず、送信直前に`resolveCredential(reference)`から得る。
- 選択MessageはEdgeで連続する単一Branchでなければならず、Continuation元Messageを最後にする。
- Provider変換後RequestのHashとCanonical ContextのHashを別々に保存する。
- Confirmation後にCanonical Message、変換、Model、Attachment、Warningが変わった場合は送信せず再Reviewを要求する。
- 初期AdapterはOpenAI-compatible JSON APIとし、SDK依存を追加しない。
- 初期変換はTextを第一級とし、未対応Content PartとAssetを黙って送らずWarningへ変換する。
- Provider Error本文をDomain Errorへ持ち込まず、応答Sizeを制限する。
- AI応答は元Messageを上書きせず、`ai_continuation` Edgeを持つ新しいAssistant Messageとして追加する。

## Consequences

Ollama等のloopback compatible endpointと、User所有HTTPS APIを同じDomain境界で扱える。Desktop UI、OS KeychainへのProvider Key登録、Streaming、Cancel、Model discovery、Provider固有Retention表示は次の実装段階である。

## Multilingual summary

- 日本語：単一Branchの確認済みContextだけをLocal／BYOK Providerへ送り、応答を新Branchとして保存する。
- English: Send only a reviewed single-branch context to Local or BYOK providers and preserve the response as a new branch.
- 简体中文：仅将已审阅的单一分支Context发送到Local或BYOK Provider，并将响应保存为新分支。
