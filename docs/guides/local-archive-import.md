# Local `.komyaku` Import

In the packaged Desktop, choose **Open .komyaku archive** while using Local mode. KOMYAKU verifies the complete Archive, then atomically stores its Canonical Document, supported original Asset bytes, content-addressed identities, and references in local SQLite. Imported PNG files are decoded natively and become immediately available to the static preview resolver.

Supported originals are PNG up to 256 KiB and TXT, Markdown, CSV, Mermaid, or JSON up to 1 MiB each. The complete Archive is limited to 50 MiB and 5,000 entries. A valid Archive with another Asset type is not damaged or rewritten; the current application rejects it and imports nothing.

Importing identical bytes again is safe. If an Archive uses a Document UUID already present in the library, KOMYAKU does not overwrite local work: choose **Open existing** or **Import as copy**. A copy receives fresh Document and Node identities while immutable Asset identities remain reusable.

The web development build has no native SQLite authority. It verifies the Archive and can restore Canonical structure for evaluation, but does not claim durable Asset materialization.
