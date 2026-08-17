# ADR-010: Documentの公開範囲、限定共有、公開Version

- Status: Accepted
- Date: 2026-08-13

## Context

作成したDocumentを非公開の制作物として保持しながら、許可したUser、秘密URLを知る閲覧者、または一般へ、選択した完成版だけを共有できる必要がある。Document全体の公開設定だけでは、Draft、Recovery Snapshot、別案、過去Versionまで誤って露出する危険がある。

## Decision

- Documentの公開範囲は`private`、`restricted`、`unlisted`、`public`を持ち、新規作成時は必ず`private`とする。
- `restricted`は認証済みUserを`document_shares`へ明示的に登録し、閲覧権限を検証する。
- `unlisted`は推測困難で失効可能な秘密共有URLを使用する。生Tokenは作成時だけ返し、DatabaseにはHashを保存する。
- 秘密共有URLはリンク単位で失効でき、有効期限と任意の利用回数制限を設定可能にする。
- 一般公開する内容は、Documentとは別に指定する`published_version_id`のSnapshotに限定する。
- Draft、Recovery Snapshot、非公開Branch、Version Graph、Audit Logは暗黙に公開しない。
- 公開用識別子は推測困難な`public_slug`とし、Document titleや連番IDを使わない。
- 公開、非公開化、公開Version変更を権限検証し、Audit Logへ記録する。
- 非公開化したときは公開APIを即時拒否し、Cacheを無効化する。
- 公開Versionが参照するAssetだけを、公開可否検証後に配信する。
- 秘密共有TokenをLog、Analytics、Referer、検索Indexへ漏らさない。

## Consequences

制作履歴を非公開に保ったまま完成版を限定共有または一般公開できる。公開状態とVersion headが独立するため、編集を続けても意図せず共有内容は変化しない。一方で、User ACL、秘密Token、有効期限、失効、Cache、Asset参照を一貫して検証するApplication Serviceが必要になる。
