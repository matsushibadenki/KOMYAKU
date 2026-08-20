# Asset Inspection and Delivery

Status: authenticated attachment-download foundation implemented

## 日本語

新しいContent-addressed Assetは`pending`から開始し、検査に合格するまで配信されない。Baseline inspectorはPNG、JPEG、GIF、WebP、PDFのMagic byteと宣言Media Typeを比較する。TextとJSONは全体が64KiB以内で完全に検査できる場合だけ受理する。SVG、未知Binary、64KiBを超えるTextはFail Closedで拒否する。このBaselineはFormat検査であり、AntivirusやMalware無害証明ではない。

検査を明示的に1 Batch実行する。

```sh
bun run --filter @komyaku/server maintenance:assets --action inspect
```

受理済みAssetのDownload URL APIは次の形式である。

```text
GET /api/v1/workspaces/{workspaceId}/assets/{assetId}/download-url
Authorization: Bearer SESSION_TOKEN
```

Verified Workspace memberだけが利用できる。URLは既定60秒で失効し、Object Storage応答は`attachment`、`application/octet-stream`、`private, no-store`に固定される。APIはStorage KeyやContent Hashを返さない。未認可、未検査、拒否、隔離、削除、存在しないAssetはすべて同じ`asset_not_available`になる。

## English

Every new content-addressed Asset starts as `pending` and cannot be delivered until accepted. The baseline inspector compares PNG, JPEG, GIF, WebP, and PDF signatures with the declared media type. Text and JSON are accepted only when the complete file fits in the 64 KiB inspection sample. SVG, unknown binary data, and larger text fail closed. This is format validation, not antivirus or a malware-free certification.

Run one explicit inspection batch with the command above. The authenticated endpoint issues a 60-second URL only to a verified, non-revoked Workspace member. Object Storage is forced to respond as an uncached attachment. Missing, unauthorized, unaccepted, quarantined, and deleted Assets share one opaque response.

## 简体中文

新的内容寻址 Asset 初始状态为`pending`，只有检查通过后才能下载。Baseline inspector会核对PNG、JPEG、GIF、WebP和PDF的文件签名与声明类型。Text与JSON仅在完整文件不超过64 KiB时接受。SVG、未知二进制以及更大的文本默认拒绝。该检查只是格式验证，不代表杀毒或无恶意软件认证。

使用上述命令执行一个检查批次。只有已验证且未撤销的Workspace成员才能获得默认60秒有效的下载URL。Object Storage响应被强制设为不可缓存的附件。不存在、无权限、未通过检查、已隔离或已删除的Asset都返回同一个不透明错误。
