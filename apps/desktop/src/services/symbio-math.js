import { invoke } from "@tauri-apps/api/core";
export const symbioAvailable = () => Boolean(globalThis.window?.__TAURI_INTERNALS__);
export const computeSymbioMath = (input) => invoke("compute_symbio_math", { input });
export const exportSymbioMath = (input, origin) => invoke("export_symbio_math", { input, origin });
export const importSymbioMath = (json) => invoke("import_symbio_math", { json });
export function mathInput(source, operation, variable, bindings, assumptions) {
  if (typeof source !== "string" || new TextEncoder().encode(source).length > 2048) throw new Error("resource_limit");
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,47}$/.test(variable)) throw new Error("invalid_project");
  let values, domains;
  try { values = JSON.parse(bindings); domains = JSON.parse(assumptions); }
  catch { throw new Error("invalid_json"); }
  if (!values || !domains || Array.isArray(values) || Array.isArray(domains)
    || typeof values !== "object" || typeof domains !== "object") throw new Error("invalid_project");
  return { source, operation, variable, bindings: values, assumptions: domains };
}
export function downloadSymbio(json) {
  const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = "equation.symbio";
  anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const mathTemplates = Object.freeze([
  ["fraction", "a/b", "\\frac{□}{□}"], ["root", "√", "\\sqrt{□}"],
  ["power", "x²", "{□}^{2}"], ["integral", "∫", "\\int_{0}^{1}{□}\\,dx"],
  ["derivative", "d/dx", "\\frac{d}{dx}\\left(□\\right)"],
  ["matrix", "[A]", "\\begin{bmatrix}□ & □ \\\\ □ & □\\end{bmatrix}"],
  ["sum", "Σ", "\\sum_{i=1}^{□}{□}"], ["equation", "=", "□=0"]
]);
export function insertMathTemplate(source, start, end, template) {
  const selected = source.slice(start, end);
  const replacement = selected ? template.replace("□", () => selected) : template;
  const value = source.slice(0, start) + replacement + source.slice(end);
  const slot = value.indexOf("□", start);
  return { value, start: slot < 0 ? start + replacement.length : slot, end: slot < 0 ? start + replacement.length : slot + 1 };
}
export function nextMathSlot(value, start, backwards = false) {
  const slot = backwards ? value.lastIndexOf("□", start - 1) : value.indexOf("□", start + 1);
  return slot < 0 ? null : { start: slot, end: slot + 1 };
}
