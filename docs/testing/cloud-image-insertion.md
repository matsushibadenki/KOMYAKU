# Cloud image insertion verification

Automated coverage crosses four boundaries:

1. Asset route tests verify Session authentication, exact PNG bytes, Workspace/Node logical reference creation, pending inspection response, accepted status reads, 256 KiB and media-type rejection, and exact reference release.
2. API-client tests verify the raw byte body, Bearer header, Node-ID header, bounded response validation, and absence of storage URLs.
3. Desktop service tests verify that pending inspection cannot create insertion attributes and that rejected staging releases its reference.
4. Playwright connects a memory-only Cloud Session, uploads a real decodable 1 × 1 PNG, observes `pending` then decoder-backed `accepted`, inserts the same stable Node ID into both Yjs replicas, and resolves two authorized static preview frames.

The inspection runner test confirms immediate startup, bounded summary logging, and graceful stop. Repository integration tests cover PostgreSQL inspection leases and accepted delivery when the opt-in integration environment is available.
