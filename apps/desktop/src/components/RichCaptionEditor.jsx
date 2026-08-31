import { createNodeId } from "@komyaku/document-schema";

const TEXT_MARKS = ["bold", "italic", "underline", "strike", "code"];

function newText() {
  return { type: "text", text: "", marks: [], metadata: {}, extensions: {} };
}

function newMath() {
  return {
    id: createNodeId(), schemaVersion: 1, metadata: {}, extensions: {}, renderArtifacts: [],
    type: "math_inline", sourceType: "latex", source: ""
  };
}

export function RichCaptionEditor({ caption, labels, onChange }) {
  const update = (index, inline) => onChange(caption.map((current, currentIndex) =>
    currentIndex === index ? inline : current));
  const remove = (index) => onChange(caption.filter((_, currentIndex) => currentIndex !== index));
  const move = (index, offset) => {
    const target = index + offset;
    if (target < 0 || target >= caption.length) return;
    const next = [...caption];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };
  const toggleMark = (index, inline, type) => {
    const exists = inline.marks.some((mark) => mark.type === type);
    update(index, { ...inline, marks: exists
      ? inline.marks.filter((mark) => mark.type !== type)
      : [...inline.marks, { type }] });
  };

  return (
    <fieldset className="rich-caption-editor">
      <legend>{labels.caption}</legend>
      {caption.length === 0 ? <p>{labels.captionEmpty}</p> : null}
      <ol>
        {caption.map((inline, index) => (
          <li key={inline.type === "math_inline" ? inline.id : `${inline.type}-${index}`}>
            <div className="rich-caption-row-heading">
              <strong>{inline.type === "text" ? labels.captionTextSegment
                : inline.type === "math_inline" ? labels.captionMathSegment : labels.captionLineBreak}</strong>
              <div>
                <button type="button" aria-label={labels.moveUp} disabled={index === 0} onClick={() => move(index, -1)}>↑</button>
                <button type="button" aria-label={labels.moveDown} disabled={index === caption.length - 1} onClick={() => move(index, 1)}>↓</button>
                <button type="button" onClick={() => remove(index)}>{labels.removeSegment}</button>
              </div>
            </div>
            {inline.type === "text" ? (
              <>
                <textarea
                  value={inline.text}
                  maxLength={10000}
                  aria-label={`${labels.captionTextSegment} ${index + 1}`}
                  onChange={(event) => update(index, { ...inline, text: event.target.value })}
                />
                <div className="rich-caption-marks" aria-label={labels.textFormatting}>
                  {TEXT_MARKS.map((type) => (
                    <button
                      key={type}
                      type="button"
                      aria-pressed={inline.marks.some((mark) => mark.type === type)}
                      onClick={() => toggleMark(index, inline, type)}
                    >{labels.marks[type]}</button>
                  ))}
                </div>
              </>
            ) : inline.type === "math_inline" ? (
              <label>
                <span>{labels.latexSource}</span>
                <textarea
                  value={inline.source}
                  maxLength={10000}
                  spellCheck="false"
                  onChange={(event) => update(index, { ...inline, source: event.target.value })}
                />
              </label>
            ) : <p aria-label={labels.captionLineBreak}>↵</p>}
          </li>
        ))}
      </ol>
      <div className="rich-caption-add">
        <button type="button" disabled={caption.length >= 256} onClick={() => onChange([...caption, newText()])}>{labels.addText}</button>
        <button type="button" disabled={caption.length >= 256} onClick={() => onChange([...caption, newMath()])}>{labels.addMath}</button>
        <button type="button" disabled={caption.length >= 256} onClick={() => onChange([...caption, { type: "hard_break" }])}>{labels.addLineBreak}</button>
      </div>
    </fieldset>
  );
}
