# ADR-041: OS Secure Cloud Session

- Status: Accepted and implemented
- Date: 2026-08-28
- Owners: KOMYAKU architecture and security

## Context

Cloud ImportはSession TokenをReact Memoryだけに保持していたため、App再起動ごとにLoginが必要だった。永続Sessionには利便性がある一方、Local Storage、SQLite、設定JSON、LogへBearer Tokenを保存すると、原稿とは異なるCredential境界が失われる。

## Decision

- 永続化は明示的な「この端末に保存」選択時だけ行う。既定はMemory-onlyとする。
- WebViewは固定されたTauri Commandだけを呼び、任意のService名、Account名、Key名を渡せない。
- Native AdapterはmacOS Keychain Services、Windows Credential Manager、Linux Secret Serviceを使用する。
- Credential識別子はService `app.komyaku.desktop`、Account `cloud-session-v1`に固定する。
- 保存値はServerが発行する43文字のBase64URL Session Tokenだけとし、Password、Email、Workspace、原文を保存しない。
- Native側でもTokenの長さと文字集合を検証する。
- BlockingなOS Credential APIはTauri async runtimeのblocking taskへ隔離する。
- 起動時に保存Tokenを読み、`GET /auth/session`と`GET /auth/workspaces`を並行して検証する。認証成功前に接続済みUIを表示しない。
- 401は失効と判断し、OS StoreからTokenを削除する。Network障害や5xxではTokenを削除せず、次回検証を可能にする。
- LogoutはServer失敗にかかわらずMemoryとOS Storeの削除を試みる。OS Store削除失敗は成功として偽装せず、今後の専用Recovery UIで扱う。
- Native Error本文をWebView、Log、Analyticsへ渡さず、安定したError Codeだけを返す。

## Consequences

Userは任意で再Loginを減らせる。OS Accountへアクセスできる別Processや、実行中WebViewを完全に支配する攻撃への万能な防御ではない。SessionのServer-side expiry、revocation、CSP、署名済み配布、Dependency reviewは引き続き必要である。

## References

- [keyring v1 platform stores](https://docs.rs/keyring/latest/keyring/v1/index.html)
- [keyring Entry API](https://docs.rs/keyring/latest/keyring/v1/struct.Entry.html)

## Multilingual summary

- 日本語：明示選択されたCloud SessionだけをOS資格情報ストアへ保存し、起動時にServerで再検証する。
- English: Persist only explicitly selected Cloud sessions in the OS credential store and revalidate them with the server at startup.
- 简体中文：仅将用户明确选择的Cloud Session保存到OS凭据存储，并在启动时通过Server重新验证。
