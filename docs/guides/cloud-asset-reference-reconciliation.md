# Cloud Asset reference reconciliation

Cloud-connected documents reconcile Asset references automatically after each successful local Canonical checkpoint. The status appears with the checkpoint. Reconciling means the local draft is already saved. A matching status means Cloud references correspond to that checkpoint. An error means local work remains saved and a later checkpoint can retry safely.

Removing an Image or File Node does not immediately delete its original. Reconciliation soft-releases the logical reference. Retention and quarantine policy decide whether the unreferenced immutable object may eventually be removed.

Do not repair a mismatch by directly editing PostgreSQL or Object Storage. Preserve the local document, reconnect the same Workspace, and create another checkpoint. Repeated authorization, stale-revision, conflicting-revision, or unavailable-reference results require metadata-only operational investigation.
