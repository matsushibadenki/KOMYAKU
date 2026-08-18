# Generic JSON Conversation Import

## 日本語

### 対応形式

Top-level Array、または`messages`を持つObjectを受け付ける。

```json
{
  "title": "研究相談",
  "defaultLanguage": "ja",
  "schemaVersion": "1",
  "messages": [
    { "id": "m1", "parentId": null, "role": "user", "content": "質問" },
    { "id": "m2", "parentId": "m1", "role": "assistant", "content": "回答" }
  ]
}
```

`parentId`を省略したMessageは直前のMessageへ接続する。`parentId: null`はRootを示す。同じParentを指定すればBranchになる。`content`はString、Part Array、またはProvider固有Objectを受け付ける。未知Partは`unknown_provider_part`として原形を保持する。

### 保護と制限

- 既定上限は10 MiB、10,000 Message
- UTF-8 JSONのみ
- 原文StringをUnicode正規化しない
- Cycleと存在しないMessageへの内部EdgeはCanonical Validationで拒否
- 欠落Parent、重複Source ID、不正Timestampは`partial` Warning
- AI学習Policyは既定`deny`
- Raw Sourceは解析前にImmutable Archiveへ保存

### Cloud API

認証Routeを有効化したServerでは次を利用できる。

```text
POST /api/v1/workspaces/:workspaceId/conversation-imports
GET  /api/v1/workspaces/:workspaceId/conversation-imports/:importId
```

POST BodyにはEnvelopeを追加せず、上記形式のJSONそのものを送る。`Authorization: Bearer <session-token>`、`Idempotency-Key: <8〜200文字>`、`Content-Type: application/json`が必須。同じ処理を再送するときはKeyとBodyを両方同一にする。初期APIではImport結果を常にPrivate、AI学習拒否として作成する。Email確認済みOwner、Admin、Editorだけが作成できる。認証なしのEndpointは提供しない。

ChatGPT、Claude、Gemini固有Exportは、実Export Fixtureを保守できる段階で個別Adapterとして追加する。

## English

The generic importer accepts either a top-level message array or an object containing `messages`. Omit `parentId` for an implicit linear link, use `null` for a root, or point multiple messages to the same parent to preserve branches. Exact UTF-8 source bytes are archived before parsing. The default limits are 10 MiB and 10,000 messages. Unknown roles and content parts are preserved; cycles are rejected; recoverable issues produce a `partial` import. AI training remains denied by default.

When authentication routes are enabled, send the source JSON itself to `POST /api/v1/workspaces/:workspaceId/conversation-imports` with a bearer session, `Content-Type: application/json`, and an `Idempotency-Key` of 8–200 characters. Repeat both the same key and exact body after a timeout. Read status from `GET /api/v1/workspaces/:workspaceId/conversation-imports/:importId`. Only verified owners, admins, and editors may create imports. New imports are always private with AI training denied. No unauthenticated import endpoint exists.

## 简体中文

通用导入器接受顶层消息数组，或包含 `messages` 的对象。省略 `parentId` 时会连接到上一条消息，设为 `null` 表示根消息，多条消息指向同一父消息可保留分支。系统会在解析前以不可变方式保存原始 UTF-8 字节。默认限制为 10 MiB 和 10,000 条消息。未知角色和内容片段会被保留，循环关系会被拒绝，可恢复的问题会生成 `partial` 导入结果。AI 训练策略默认仍为拒绝。

启用认证路由后，可将原始 JSON 本身发送至`POST /api/v1/workspaces/:workspaceId/conversation-imports`，并提供 Bearer Session、`Content-Type: application/json`及 8–200 个字符的`Idempotency-Key`。超时重试时必须保持 Key 和 Body 完全一致。可通过`GET /api/v1/workspaces/:workspaceId/conversation-imports/:importId`读取状态。只有已验证邮箱的 Owner、Admin 和 Editor 可以创建导入；新导入始终为 Private 且拒绝 AI 训练。不会提供未认证的导入接口。
