# Managing and recovering `.komyaku` Archives

Cloud export listings contain only artifact ID, digest, byte size, Asset count, and verification time. Download links expire after 60 seconds and force the `.komyaku` media type as an attachment.

Invalidate an export when its external copy is lost, corrupt, or should no longer count as preservation evidence. Invalidation does not immediately delete immutable bytes, but it removes every retention-evidence contribution from that artifact. A new verified export can establish new evidence.

To recover locally, choose **Open .komyaku archive** and select the downloaded file. Verification happens locally before the working document changes. A successful import restores the Canonical document and stable Node/Asset identities. A failure imports nothing.

Archive v1 does not yet copy contained Asset bytes into local SQLite. Image and file nodes remain structurally recoverable, but previews can be unavailable until a later Asset-materialization workflow is completed.
