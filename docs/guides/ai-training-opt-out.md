# AI学習拒否設定 / AI Training Opt-out / AI 训练拒绝设置

## 日本語

KOMYAKUはAI学習利用を既定で拒否する。`.env`の`AI_TRAINING_DEFAULT=deny`を維持すると、Serverは拒否意思を示すHeaderを返し、公開Frontendの`robots.txt`は主要AI Crawlerを拒否する。

この設定は第三者Crawlerの遵守を保証しない。また、KOMYAKUの設定だけではCodex、ChatGPT、その他外部サービスのAccount設定は変更できない。利用する外部サービス側でもData Controlsを確認すること。

## English

KOMYAKU denies AI training use by default. Keep `AI_TRAINING_DEFAULT=deny` to return machine-readable refusal headers, while the public frontend’s `robots.txt` rejects major AI crawlers. These signals cannot guarantee third-party compliance and do not change account-level controls in Codex, ChatGPT, or other external services.

## 简体中文

KOMYAKU 默认拒绝将内容用于 AI 训练。保持 `AI_TRAINING_DEFAULT=deny` 后，服务器会返回机器可读的拒绝标头，公开前端的 `robots.txt`也会拒绝主要 AI 爬虫。这些信号无法保证第三方一定遵守，也不会更改 Codex、ChatGPT 或其他外部服务的账户级设置。

## Implemented controls

- `AI_TRAINING_DEFAULT=deny`
- `X-Robots-Tag: noai, noimageai`
- `TDM-Reservation: 1`
- AI crawler rules in `apps/desktop/public/robots.txt`
- No URL path logging, preventing secret share tokens from entering ordinary request logs

