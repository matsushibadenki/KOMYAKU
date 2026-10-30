import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { mathSourceTransaction } from "@komyaku/editor-core";
import { renderLatexPreview, renderSymbioMathml } from "@komyaku/preview-core";
import { SandboxedStaticPreview } from "./SandboxedStaticPreview.jsx";
import { computeSymbioMath, exportSymbioMath, importSymbioMath, downloadSymbio, symbioAvailable,
  mathInput, mathTemplates, insertMathTemplate, nextMathSlot } from "../services/symbio-math.js";

export function SymbioMathPanel({ selection, viewRef, language, captureInsertionGuard, onClose, isComposing }) {
  const { t } = useTranslation();
  const text = (key) => t(`symbioMath.${key}`);
  const settings = selection?.extensions?.["dev.symbio.math"];
  const [source, setSource] = useState(selection?.source ?? "");
  const [variable, setVariable] = useState(settings?.variable ?? "x");
  const [bindings, setBindings] = useState("{}");
  const [assumptions, setAssumptions] = useState(JSON.stringify(settings?.assumptions ?? {}));
  const [result, setResult] = useState(null);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState(false);
  const sourceRef = useRef(null), fileRef = useRef(null), request = useRef(0), baseline = useRef(selection?.source);
  const currentInput = useRef("");
  const identity = JSON.stringify([source, variable, bindings, assumptions]); currentInput.current = identity;
  useEffect(() => { let active = true; const timer = setTimeout(() => {
    if (!active) return;
    try { setPreview(source ? renderLatexPreview(source, { language }) : null); }
    catch { setPreview(null); }
  }, 180); return () => { active = false; clearTimeout(timer); }; }, [source, language]);
  useEffect(() => () => { request.current++; }, []);
  const update = (value) => { setSource(value); setResult(null); setPreview(null); setError(""); setApplied(false); };
  const run = async (operation) => {
    const ticket = ++request.current, key = identity;
    setBusy(true); setResult(null); setError("");
    try {
      const value = await computeSymbioMath(mathInput(source, operation, variable, bindings, assumptions));
      if (ticket !== request.current || currentInput.current !== key) return;
      const descriptor = value.result_mathml ? renderSymbioMathml(value.result_mathml, { language }) : null;
      setResult({ value, descriptor, key });
    } catch (err) { if (ticket === request.current && currentInput.current === key) setError(String(err?.message ?? err)); }
    finally { if (ticket === request.current) setBusy(false); }
  };
  const apply = () => {
    try {
      if (isComposing()) throw new Error("math_composing");
      if (!captureInsertionGuard()()) throw new Error("math_source_changed");
      const view = viewRef.current; if (!view || view.isDestroyed) throw new Error("math_source_changed");
      const input = mathInput("", "compute", variable, bindings, assumptions);
      view.dispatch(mathSourceTransaction(view.state, { source, nodeId: selection?.nodeId,
        expectedSource: baseline.current, assumptions: input.assumptions, variable }));
      baseline.current = source; setApplied(true); setError("");
      // A newly inserted node must be re-selected before another insertion.
      if (!selection?.nodeId) onClose();
    } catch (err) { setError(String(err?.message ?? err)); }
  };
  const exportFile = async () => {
    const ticket = ++request.current, key = identity; setBusy(true); setError("");
    try {
      const view = viewRef.current;
      const documentId = view?.state.doc.attrs.documentId;
      const origin = selection?.nodeId && documentId ? { document_id: documentId, node_id: selection.nodeId } : null;
      const json = await exportSymbioMath(mathInput(source, "compute", variable, bindings, assumptions), origin);
      if (request.current === ticket && currentInput.current === key) downloadSymbio(json);
    } catch (err) { if (request.current === ticket) setError(String(err?.message ?? err)); }
    finally { if (request.current === ticket) setBusy(false); }
  };
  const readFile = async (event) => {
    const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
    const ticket = ++request.current, key = identity; setBusy(true); setError("");
    try {
      if (file.size > 8 * 1024 * 1024) throw new Error("resource_limit");
      const imported = await importSymbioMath(await file.text());
      if (request.current === ticket && currentInput.current === key) {
        update(imported.source); setAssumptions(JSON.stringify(imported.assumptions));
      }
    } catch (err) { if (request.current === ticket) setError(String(err?.message ?? err)); }
    finally { if (request.current === ticket) setBusy(false); }
  };
  const template = (value) => {
    const field = sourceRef.current;
    const edit = insertMathTemplate(source, field.selectionStart, field.selectionEnd, value);
    update(edit.value); requestAnimationFrame(() => { field.focus(); field.setSelectionRange(edit.start, edit.end); });
  };
  const operations = [["compute", "="], ["differentiate", "d/dx"], ["integrate", "∫"], ["solve", "x=?"],
    ["determinant", "det"], ["inverse", "A⁻¹"], ["transpose", "Aᵀ"], ["evaluate", "≈"]];
  const visibleResult = result?.key === identity ? result : null;
  return <section className="symbio-math-panel" aria-label={text("title")}>
    <header><strong>{text("title")}</strong><span title={text("help")} aria-label={text("help")}>ⓘ</span>
      <button type="button" title={text("close")} aria-label={text("close")} onClick={onClose}>×</button></header>
    <div className="symbio-math-keys">{mathTemplates.map(([id, label, code]) => <button key={id} type="button"
      title={text(id)} aria-label={text(id)} onClick={() => template(code)}>{label}</button>)}</div>
    <textarea ref={sourceRef} value={source} aria-label={text("source")} maxLength={20_000} spellCheck={false} autoCorrect="off" autoCapitalize="off"
      onChange={(e) => update(e.target.value)} onKeyDown={(e) => {
        if (e.key !== "Tab" || e.nativeEvent.isComposing) return;
        const slot = nextMathSlot(source, e.target.selectionStart, e.shiftKey);
        if (slot) { e.preventDefault(); e.target.setSelectionRange(slot.start, slot.end); }
      }} />
    {preview ? <SandboxedStaticPreview descriptor={preview} title={text("preview")} className="sandboxed-preview symbio-formula" /> : null}
    <div className="symbio-math-actions">{operations.map(([id, label]) => <button key={id} type="button"
      disabled={busy || !source || !symbioAvailable()} title={text(id)} aria-label={text(id)} onClick={() => run(id)}>{label}</button>)}</div>
    <details><summary>{text("settings")}</summary><label>{text("variable")}<input value={variable} onChange={(e) => setVariable(e.target.value)} /></label>
      <label>{text("assumptions")}<textarea spellCheck={false} autoCorrect="off" autoCapitalize="off" value={assumptions} onChange={(e) => setAssumptions(e.target.value)} /></label>
      <label>{text("bindings")}<textarea spellCheck={false} autoCorrect="off" autoCapitalize="off" value={bindings} onChange={(e) => setBindings(e.target.value)} /></label></details>
    {visibleResult ? <div className="symbio-math-result"><small>{visibleResult.value.output.engine} · {text(visibleResult.value.output.trust)}</small>
      {visibleResult.descriptor ? <SandboxedStaticPreview descriptor={visibleResult.descriptor} title={text("result")} className="sandboxed-preview symbio-formula" />
        : <output>{visibleResult.value.output.value}</output>}
      <small>{visibleResult.value.output.precision}</small>
      <ul>{visibleResult.value.output.conditions.map((condition) => <li key={condition}>{condition}</li>)}</ul></div> : null}
    <footer><button type="button" disabled={!source || busy} onClick={apply}>{text(selection?.nodeId ? "apply" : "insert")}</button>
      <button type="button" disabled={busy || !source || !symbioAvailable()} onClick={exportFile} title={text("export")}>↗ .symbio</button>
      <button type="button" disabled={busy || !symbioAvailable()} onClick={() => fileRef.current.click()} title={text("import")}>↙ .symbio</button>
      <input ref={fileRef} type="file" accept=".symbio,application/json" hidden onChange={readFile} /></footer>
    <p role="status">{busy ? text("busy") : applied ? text("applied") : ""}{!symbioAvailable() ? text("desktopOnly") : ""}</p>
    {error ? <p role="alert">{text("error")} <code>{error}</code></p> : null}
  </section>;
}
