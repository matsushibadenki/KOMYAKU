# ADR-053: Accepted raster preview Descriptor

## Status

Accepted

## Context

KOMYAKU Image Nodes refer to immutable Assets. The existing Cloud download path returns a short-lived forced attachment URL and requires Bearer authentication before issuing it. Putting that URL directly into an editor image element would mix download and preview policy, expose a signed storage URL to the document DOM, and depend on Object Storage response behavior. Browser image decoding also needs explicit byte and decoded-pixel limits.

## Decision

The first raster preview boundary accepts only a small PNG preview representation after media inspection has reached `accepted`. `renderAcceptedPngPreview` requires:

- a `Uint8Array`, never an external, `blob:`, `file:`, or authored URL;
- an exact detected media type of `image/png`;
- an exact byte-size match with the inspection record;
- at most 256 KiB of encoded preview data;
- a valid PNG signature and first `IHDR` chunk;
- positive dimensions totaling at most 16 million decoded pixels;
- required inspected dimensions that exactly match the PNG header.

The bytes are embedded as a `data:image/png` URL inside the existing fixed static HTML Descriptor. Alternative text is HTML-escaped. The Desktop displays the Descriptor only through `SandboxedStaticPreview`, whose iframe has an empty sandbox token set, no referrer, no permissions, and a CSP whose only image source is `data:`.

This function is for an inspected, generated preview representation, not an arbitrary original Asset. SVG remains on its separate sanitizer path. JPEG, GIF, WebP, PDF, external URLs, and unaccepted or mismatched Assets fail closed until their own parsing and resource-budget policies exist.

## Consequences

The image decoder remains a platform component, but malformed content has no application DOM, storage, credential, network, or Tauri capability. Encoded bytes and inspection-confirmed decoded dimensions are bounded before iframe creation. ADR-054 implements the decoder-backed server inspection and persists its dimensions; the baseline signature policy still cannot unlock this renderer. Cloud and local Asset resolvers still need to fetch an authorized accepted preview, verify its inspection envelope, and pass only bytes plus metadata to this function. Image insertion and caption/alternative-text authoring remain separate editor work.
