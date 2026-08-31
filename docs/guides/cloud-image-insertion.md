# Inserting an inspected Cloud image

1. Connect an authenticated KOMYAKU Cloud Workspace in the Desktop/Web workbench.
2. Enter required alternative text.
3. Choose a PNG no larger than 256 KiB.
4. Wait while the original bytes are stored and decoder-inspected.
5. The image appears only after the server accepts the complete decode.

The current client waits for up to 20 inspection checks at 750 ms intervals. Rejection, inspection error, or timeout leaves the document unchanged and requests release of its staging reference. Retrying creates a new stable Node identity unless the same operation is replayed internally.

Cloud image bytes do not enter Local Storage or Canonical JSON. Canonical state contains Asset identity, media type, required alternative text, inspected dimensions, caption data, and stable Node identity. Display bytes are fetched through the authenticated Cloud preview proxy and are never loaded from an Object Storage URL.

If the UI reports failure, confirm the file is a complete PNG within the limit and that the Workspace connection is still valid. Do not rename another file format to `.png`; the decoder, not the extension, decides acceptance.
