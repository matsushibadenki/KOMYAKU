# Loopback TLS fixtures

Test-only EC P-256 CA and localhost server certificate, generated 2026-11-09 with a ten-year validity. The private key is intentionally public test material. The root CA is passed only to test clients; production clients use WebPKI roots. No system trust store is modified. The server SAN contains only DNS:localhost, so requests using 127.0.0.1 must fail hostname verification even with the test CA. Regenerate all three DER files together before expiry.

日本語: ループバックTLS検証専用。テストCAは本番の信頼範囲に追加しません。

简体中文：仅用于回环 TLS 测试。测试 CA 不会添加到生产信任范围。
