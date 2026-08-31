# Recovering a quarantined local image

KOMYAKU Desktop keeps accepted local PNG data when the last saved document reference is removed. This is a recovery area, not a recycle-bin purge feature: the current application does not permanently delete quarantined image bytes.

## Restore an image

1. In the local editor, open **Quarantined local images**.
2. Choose **Review quarantine**. The application loads at most 100 newest records from the local database.
3. Select a record using its Asset ID, dimensions, size, and quarantine time.
4. Enter alternative text describing the image's content and purpose.
5. Choose **Restore to this document**.
6. Wait until the footer reports that the document has been automatically saved.

The selected image is inserted at the current editor selection. The second Yjs replica receives the same node. The Asset becomes active only after the validated Canonical checkpoint is committed. If KOMYAKU closes before that save succeeds, reopen the quarantine list and restore it again; the retained bytes remain available.

## Privacy and retention

The quarantine list returns metadata only. It does not return image bytes, old document text, filenames, storage paths, or content hashes. Opening the list does not preview, export, upload, reactivate, or delete an Asset.

There is intentionally no permanent-delete control yet. Permanent removal will require a documented retention window, audit records, bounded deletion, and proof that immutable originals or verified exports/archives cannot be lost.
