# ADR-061: Accessible Image metadata authoring

## Status

Accepted

## Context

KOMYAKU already requires alternative text before a decoder-verified local PNG can become a Canonical Image Node. Authors must also be able to correct that text after insertion and add a visible caption without bypassing collaboration, autosave, or stable Node identity. Canonical captions are inline-node arrays and can represent richer content than a plain textarea.

## Decision

Selecting a local editor Image Node opens a localized metadata form. Alternative text is required and trimmed; a visible plain-text caption is optional. Both inputs have a 10,000-character defensive boundary.

The form retains only the selected stable Node ID and editable field values in React state. Saving locates that Image Node in the current ProseMirror document and applies `setNodeMarkup` through one transaction. The existing Yjs binding then synchronizes the change to other replicas, and the normal validated Canonical checkpoint persists it. The preview DOM is never treated as document authority.

The initial plain-text editor accepted only captions composed of unmarked text and hard breaks. ADR-063 supersedes that UI with structured authoring for marked text, hard breaks, and stable-ID inline LaTeX while retaining this transaction and checkpoint boundary.

The Image NodeView renders the visible caption as a real `figcaption`, remains keyboard focusable, and retains the visible Asset identity and alternative text when preview resolution fails. Labels and status messages are available in Japanese, English, and Simplified Chinese.

## Consequences

Alternative-text corrections and captions follow the same collaboration and restart-recovery guarantees as the rest of the document. ADR-063 adds the structured rich-caption editor without changing the authority boundary defined here.
