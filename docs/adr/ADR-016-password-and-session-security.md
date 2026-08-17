# ADR-016: Password and Session Security

- Status: Accepted
- Date: 2026-08-16

## Context

KOMYAKUは非公開文書、限定共有文書、AI会話原本を扱うため、Account CredentialやSession Tokenの漏えいは本文漏えいへ直結する。また、初期は単体Serverでも、将来の水平分散時に各InstanceのMemoryへSession状態を閉じ込めてはならない。

## Decision

- PasswordはBun標準のArgon2idでHashし、独自暗号を実装しない。
- Argon2idは`m=19456 KiB, t=2, p=1`を初期値とし、Hash自身のPHC FormatへWork FactorとSaltを保存する。
- MFA未実装の初期Policyでは15 Unicode Code Point以上、最大1024 Code Pointを受け付ける。
- 大文字・数字・記号のComposition Rule、Trim、Unicode正規化、定期変更を要求しない。
- 将来、既知の漏えいPassword Blocklistを登録時と変更時に追加する。
- Login失敗はEmail不存在とPassword不一致で同じErrorを返し、Email不存在でもDummy Argon2 Verifyを行う。
- Session TokenはCSPRNGで256 bit生成し、平文は発行時に一度だけ返す。
- PostgreSQLにはSession TokenのSHA-256 Hashだけを保存する。Passwordと異なりTokenは機械生成された256 bit値なので、高速HashでもOffline Guessは現実的でない。
- SessionはPostgreSQLを正本とし、単一Session失効と全Session失効を可能にする。
- Bearer TokenはHeaderだけから受け取り、通常Logへ記録しない。
- `last_seen_at`更新は5分に一度へ抑え、認証ReadごとのWrite増幅を避ける。
- Public Register/Login Routeは、分散対応Rate Limit、Email Verification、Password Resetが整うまで有効化しない。

## Consequences

どのAPI Instanceでも同じSession失効状態を参照できる。Database漏えい時にも平文Passwordと平文Session Tokenは残らない。一方、認証ごとのPostgreSQL Readが発生するため、規模拡大時は短時間Cacheを追加しても、失効遅延の上限を明示する必要がある。
