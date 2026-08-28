# ADR-040: Reviewed Conversation Cloud Import

- Status: Accepted and implemented
- Date: 2026-08-28
- Owners: KOMYAKU architecture

## Context

DesktopはProvider Exportを端末内で解析し、Provider、会話数、Message数、SHA-256、復元Warningを表示できる。Cloud Import APIも認証、Workspace authorization、Raw-first archive、Idempotency、Private/AI-training-deny defaultsを持つ。残る境界は、Userがレビューした原文とCloudへ送る原文が同一であること、Sessionを不用意に永続化しないこと、Workspace IDをUser入力へ依存しないことである。

## Decision

- DesktopはEmail/Password LoginでSessionを取得し、そのSessionでアクセス可能なWorkspace一覧を取得する。
- Workspace一覧はServerがSession User、未取消Membership、Role、Email verificationから導出し、`canImportConversations`を返す。ClientがUUIDやRoleを自己申告しない。
- PasswordとSession TokenはReact実行中Memoryだけに保持し、Local Storage、SQLite、Canonical Draft、Log、Analyticsへ保存しない。PasswordはLogin完了または失敗後にStateから消去する。
- File選択時にRaw Bytesを一度Memoryへ読み、その同じ`Uint8Array`からLocal Previewを生成し、明示確認後に同じByte ObjectをAPI Clientへ渡す。送信直前にFile Systemから読み直さない。
- 新しいFile、Provider、Workspaceを選ぶとCloud確認、Import結果、Idempotency KeyをResetする。
- `partial` Warning確認とCloud送信確認を別々に要求する。
- Cloud送信確認にはRaw Byte数とConversation数を表示する。
- API ClientはBearer Session、Workspace path、Provider header、Idempotency key、Raw JSON bodyを一つのMethodで組み立てる。
- ImportはServerで常に`private`かつ`aiTrainingPolicy=deny`として作成する。
- 401ではSessionをMemoryから破棄して再接続を要求する。通常Failureでは同じIdempotency Keyと同じBytesでRetryできる。
- Logout APIが失敗してもLocal Session Materialを破棄する。

## Security boundary

- Workspace候補は認証済みEndpoint以外から取得しない。
- Viewer/Reviewerまたは未確認EmailのWorkspaceは表示できてもImport不可とし、Server authorizationを最終Authorityとする。
- API ErrorはStable CodeだけをUIへ渡し、Response本文、Password、Token、原文をError messageへ含めない。
- CORSは`X-KOMYAKU-Source-Provider`を明示的に許可する。
- BrowserやOSのPassword Managerによる保存はUser/Platformの機能であり、KOMYAKU自身のStorageとは分離する。

## Consequences

UserはWorkspace UUIDを扱わず、レビュー内容と送信内容のすり替わりを避けながらCloudへ保存できる。一方、App再起動後は再Loginが必要である。長期Sessionを保持する場合は、OS Secure Storage AdapterとThreat Modelを先に完成させる。

## Multilingual summary

- 日本語：認証済みWorkspaceをServerから選び、レビューに使用した同一Raw Bytesを別の明示確認後に送信する。PasswordとSessionはMemory以外へ保存しない。
- English: Select a server-authorized workspace and submit the exact bytes used for review after a separate confirmation; keep passwords and sessions memory-only.
- 简体中文：从Server授权的Workspace中选择，并在单独确认后发送与审阅完全相同的Raw Bytes；密码与Session仅保存在Memory中。
