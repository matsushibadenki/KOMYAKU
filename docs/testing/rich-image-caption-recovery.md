# Structured Image caption recovery verification

The Playwright regression `edits rich image captions, synchronizes them, and restores their structure after restart` creates a caption containing bold text, one hard break, and one inline LaTeX node.

The test verifies:

1. both live Yjs replicas show the updated alternative text and caption;
2. the validated local Canonical checkpoint contains the exact node sequence `text`, `hard_break`, `math_inline`;
3. the text mark remains `{ type: "bold" }`;
4. the math source remains `E=mc^2` with its generated stable ID;
5. a page/app-state restart restores a Caption array deeply equal to the pre-restart array.

The responsive regression continues to cover 320, 375, 414, 768, and 1024 CSS-pixel widths after adding the structure controls.
