# Local Document Library

After the first durable checkpoint, a Local document appears in the library below the editor. Use **Open** to switch documents, edit the title and choose **Rename** to update both the library and Canonical Document, or choose **Archive** to hide it from normal active work without deleting it. **Restore** reverses that state.

Documents imported from `.komyaku` display the first twelve characters of their verified source Archive digest. Importing the same identity offers two explicit choices: open the existing local Document, or import a copy with new Document and Node identities. Asset identities remain content-addressed and may be safely reused.

The library returns at most 200 metadata summaries at a time. Document bodies are loaded only after an explicit Open action. Current browser builds remain a feasibility environment and do not expose the native library.
