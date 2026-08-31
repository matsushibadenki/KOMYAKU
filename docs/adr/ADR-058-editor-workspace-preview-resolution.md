# ADR-058: Editor Workspace-bound preview resolution

## Status

Accepted

## Context

An Image Node contains an Asset identity but deliberately contains neither an Object Storage URL nor a Session credential. The editor therefore needs an explicit runtime Workspace authority to decide whether that identity is resolved from the local SQLite cache or the authenticated Cloud API. Resolver selection must not silently cross those boundaries.

## Decision

The application owns one editor Workspace state with two modes:

- `local`, which selects only the local accepted-PNG cache Resolver;
- `cloud`, which binds the Cloud Resolver to one non-empty in-memory Session token and one Workspace ID.

The existing Cloud connection workflow remains the source of authentication truth. It publishes only its current runtime Session and selected Workspace to the application; the editor does not reload or duplicate credentials. Login restoration, Workspace selection, logout, and session expiry update this state. The memoized Resolver is passed to both editor replicas and then injected into Image NodeViews.

An incomplete Cloud state is rejected. It does not fall back to local resolution, because the same opaque Asset ID must never be searched in a different authority domain after a Cloud authentication failure. The Session is supplied only at the Cloud API request boundary and is not written into Canonical documents, Yjs state, preview Descriptors, DOM attributes, logs, or local browser storage.

## Consequences

Image NodeViews now follow the currently selected editor Workspace while retaining the same static preview Descriptor boundary. Changing Workspace recreates the editor view with the newly bound Resolver; Relative Position selection capture and the shared Yjs working state preserve authored content. A future document-management layer should bind each opened document to its Workspace explicitly rather than deriving that association from the conversation-import screen.

