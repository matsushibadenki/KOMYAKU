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

現在、ImporterはApplication Serviceとして利用できるが、認証なしのHTTP Endpointは提供しない。ChatGPT、Claude、Gemini固有Exportは、実Export Fixtureを保守できる段階で個別Adapterとして追加する。

## English

The generic importer accepts either a top-level message array or an object containing `messages`. Omit `parentId` for an implicit linear link, use `null` for a root, or point multiple messages to the same parent to preserve branches. Exact UTF-8 source bytes are archived before parsing. The default limits are 10 MiB and 10,000 messages. Unknown roles and content parts are preserved; cycles are rejected; recoverable issues produce a `partial` import. AI training remains denied by default. No unauthenticated HTTP import endpoint is exposed.

## 简体中文

通用导入器接受顶层消息数组，或包含 `messages` 的对象。省略 `parentId` 时会连接到上一条消息，设为 `null` 表示根消息，多条消息指向同一父消息可保留分支。系统会在解析前以不可变方式保存原始 UTF-8 字节。默认限制为 10 MiB 和 10,000 条消息。未知角色和内容片段会被保留，循环关系会被拒绝，可恢复的问题会生成 `partial` 导入结果。AI 训练策略默认仍为拒绝，当前不会公开未认证的 HTTP 导入接口。
