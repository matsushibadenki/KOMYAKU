# Editing a structured Image caption

1. Select an Image Node in the local editor using the pointer or keyboard focus.
2. Keep the required alternative text concise and describe the image's content and purpose.
3. In **Visible caption**, add text, an inline equation, or an explicit line break.
4. Text segments can use bold, italic, underline, strike, and code formatting.
5. Equation segments store the entered LaTeX source. Enter only the formula source, for example `E=mc^2`; do not add `$` delimiters.
6. Use the arrow controls to reorder segments or remove a segment.
7. Choose **Save description** and wait for the local autosave status.

Alternative text serves users who cannot see the image and should not merely repeat a visible caption. A caption is visible document content and may include a title, explanation, source credit, or equation.

KOMYAKU stores the caption as Canonical inline nodes. It does not flatten marked text or equations into one string. The current preview displays safe text and LaTeX source; the authored LaTeX remains available for future isolated visual rendering and semantic Diff.
