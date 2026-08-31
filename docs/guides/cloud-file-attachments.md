# Cloud source-file attachments

Connect a KOMYAKU Cloud Workspace, then choose **Attach a source file** below the image controls. Current supported originals are TXT, Markdown, CSV, Mermaid source, and JSON, with a 1 MiB maximum.

KOMYAKU stores the exact original using a content hash and adds the File Node only after server inspection succeeds. Renaming a binary file does not make it acceptable. JSON must parse as complete JSON; all supported text must be valid UTF-8 and contain no NUL bytes.

The document stores only stable Node identity, Asset identity, declared media type, display filename, title, and description. It does not embed the file bytes or expose the internal Object Storage key. A failed inspection leaves the document unchanged and requests release of the temporary reference.

PDF, DOCX, EPUB, archives, executables, SVG, and unknown formats are intentionally unavailable until their inspection and malware-scanning policies are implemented.
