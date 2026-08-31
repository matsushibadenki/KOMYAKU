# ADR-054: Decoder-backed PNG inspection

## Status

Accepted

## Context

The baseline media inspector recognizes file signatures from a bounded prefix. That is sufficient to reject obvious MIME mismatches but cannot establish that a complete PNG decodes safely or provide trusted dimensions for the isolated preview gate in ADR-053.

## Decision

Asset maintenance uses a server-only `sharp`/libvips inspector for declared PNG content. The policy:

- requires the complete object to fit within a 1 MiB inspection read;
- configures a 16-million-pixel input limit before decoding;
- requires the decoder to identify PNG and no more than one page;
- requires positive integer width and height within the same pixel budget;
- fully decodes the image to bounded raw RGBA output rather than trusting metadata alone;
- rejects truncated, forged, decoder-warning, mismatched, oversized, and unreadable input without persisting decoder error text;
- records policy version `decoder-backed-png-v1` and inspected dimensions in the same lease-guarded completion update.

Migration `0012_asset_inspected_dimensions` adds nullable paired width and height fields. A failed or retried inspection clears the detected type, policy version, and dimensions together. Non-PNG formats continue through the conservative baseline policy and cannot use the PNG preview Descriptor.

## Consequences

The `sharp` native dependency exists only in `@komyaku/server`; it is not bundled into the Tauri application. PNG Assets larger than 1 MiB are not accepted by this first decoder-backed policy. A future pipeline should generate a small immutable preview representation from accepted originals instead of increasing inline preview budgets. Malware scanning remains an independent production gate and is not replaced by image decoding.
