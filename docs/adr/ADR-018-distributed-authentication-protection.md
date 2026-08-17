# ADR-018: Distributed Authentication Protection

- Status: Accepted
- Date: 2026-08-17

## Context

Register、Login、Email Verification、Password Resetを公開するには、Brute Force、Account Enumeration、Token漏えいを抑止する必要がある。Process MemoryだけのRate Limitは単体Serverでは動いても、将来API Replicaが増えるとInstanceを跨いで迂回できる。

## Decision

- Authentication Rate Limitの正本をPostgreSQLへ置く。
- `pg_advisory_xact_lock`とRow Lockで同じKeyの同時Attemptを直列化する。
- EmailやNetwork Identifierの原文はRate Limit Tableへ保存しない。
- `AUTH_RATE_LIMIT_SECRET`をKeyとしたHMAC-SHA-256で、Scopeごとに異なるKey Hashを作る。
- 初期PolicyはLogin Identifier 5回/15分、Login Network 30回/15分、Register Network 10回/1時間、Verification/Reset Identifier 5回/1時間とする。
- Email Verification TokenとPassword Reset TokenはCSPRNG 256 bitとし、DBにはSHA-256 Hashだけを保存する。
- Token再発行時は同じUserの古い未使用Tokenを失効させる。
- Email Verification Tokenは既定24時間、Password Reset Tokenは既定1時間で失効し、一度だけ使用できる。
- Password Reset成功時は全Sessionを同じDatabase Transactionで失効させる。
- Email未確認UserはSessionを持てるが、Conversation Import等の機密Workspace操作は許可しない。
- Password Reset要求はAccountの存在に関係なく同じ成功Responseを返す。
- Verification再送先はRequest Bodyを信用せず、認証済みUser IDからDatabase上のEmailを取得する。
- Email本文へ必要なRaw Tokenを通常Outbox PayloadやApplication Logへ保存しない。配送は専用Notification Interfaceへ渡す。

## Consequences

単体Serverから複数API Replicaへ移行しても共通Limitを維持できる。Rate Limit判定ごとにPostgreSQL Transactionが必要になるため、将来高負荷時はRedis等のAtomic Adapterを追加できるBoundaryを維持する。Mail Provider障害時の再送信はRaw Tokenを永続Queueへ平文保存せず、新しいTokenを再発行する。
