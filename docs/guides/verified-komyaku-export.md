# Creating a verified `.komyaku` export

Connect a Cloud Workspace and create a current document checkpoint. Select **Create verified .komyaku export**. KOMYAKU gathers the exact accepted originals referenced by that Canonical document, creates the open ZIP Archive, rereads it from immutable storage, and verifies every identity, size, CRC32, and SHA-256.

Success means retention evidence was registered for the included Assets. Failure registers no evidence; the local document remains saved. The current workflow creates a durable Cloud artifact but does not yet expose a user download button or Version Graph history.

Third-party tools can inspect the Archive using the public specification and JSON Schema without contacting KOMYAKU.
