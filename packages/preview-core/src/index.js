import katex from "katex";
import mermaid from "mermaid";
import { DOMImplementation, DOMParser, XMLSerializer } from "@xmldom/xmldom";

export const PREVIEW_LIMITS = Object.freeze({
  maxLatexCodeUnits: 20_000,
  maxMacroExpansions: 500,
  maxRenderedSizeEm: 20,
  maxDocumentBytes: 512 * 1024,
  maxSvgBytes: 1024 * 1024,
  maxSvgNodes: 5_000,
  maxSvgDepth: 64,
  maxSvgAttributes: 10_000
});

export const MERMAID_RENDER_CONFIG = Object.freeze({
  startOnLoad: false,
  securityLevel: "strict",
  secure: Object.freeze([
    "secure", "securityLevel", "startOnLoad", "maxTextSize", "suppressErrorRendering", "maxEdges"
  ]),
  maxTextSize: 20_000,
  maxEdges: 500,
  suppressErrorRendering: true,
  htmlLabels: false
});

export const STATIC_PREVIEW_SANDBOX = "";

export class PreviewError extends Error {
  constructor(code, options) {
    super(code, options);
    this.name = "PreviewError";
    this.code = code;
  }
}

function escapeHtml(value) {
  return value.replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function byteLength(value) {
  return new TextEncoder().encode(value).byteLength;
}

export function createStaticPreviewDocument({ title, bodyHtml, language = "und" }) {
  if (typeof title !== "string" || typeof bodyHtml !== "string" || typeof language !== "string") {
    throw new PreviewError("invalid_preview_document");
  }
  const document = `<!doctype html><html lang="${escapeHtml(language)}"><head>`
    + `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; navigate-to 'none'">`
    + `<meta name="referrer" content="no-referrer"><meta name="color-scheme" content="light dark">`
    + `<title>${escapeHtml(title)}</title><style>html{font-family:system-ui,sans-serif}body{margin:0;padding:1rem;overflow-wrap:anywhere}.preview-error{color:#9b2c2c}math{font-size:1.2rem}</style>`
    + `</head><body>${bodyHtml}</body></html>`;
  if (byteLength(document) > PREVIEW_LIMITS.maxDocumentBytes) {
    throw new PreviewError("preview_document_too_large");
  }
  return document;
}

export function renderLatexPreview(source, { displayMode = true, language = "und" } = {}) {
  if (typeof source !== "string" || source.length === 0) throw new PreviewError("invalid_latex_source");
  if (source.length > PREVIEW_LIMITS.maxLatexCodeUnits) throw new PreviewError("latex_source_too_large");
  let mathml;
  try {
    mathml = katex.renderToString(source, {
      displayMode,
      output: "mathml",
      throwOnError: true,
      strict: "error",
      trust: false,
      maxExpand: PREVIEW_LIMITS.maxMacroExpansions,
      maxSize: PREVIEW_LIMITS.maxRenderedSizeEm,
      globalGroup: false
    });
  } catch (error) {
    throw new PreviewError("latex_render_failed", { cause: error });
  }
  return Object.freeze({
    kind: "static-html",
    mediaType: "text/html; charset=utf-8",
    sandbox: STATIC_PREVIEW_SANDBOX,
    allow: "",
    referrerPolicy: "no-referrer",
    document: createStaticPreviewDocument({ title: "Math preview", bodyHtml: mathml, language })
  });
}

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const SVG_ELEMENTS = new Set([
  "svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon",
  "text", "tspan", "title", "desc", "defs", "linearGradient", "radialGradient",
  "stop", "clipPath", "mask", "pattern", "marker"
]);
const SVG_ATTRIBUTES = new Set([
  "id", "viewBox", "width", "height", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy",
  "r", "rx", "ry", "d", "points", "transform", "fill", "fill-opacity", "fill-rule",
  "stroke", "stroke-width", "stroke-opacity", "stroke-linecap", "stroke-linejoin",
  "stroke-dasharray", "stroke-dashoffset", "opacity", "clip-path", "mask", "marker-start",
  "marker-mid", "marker-end", "gradientUnits", "gradientTransform", "offset", "stop-color",
  "stop-opacity", "patternUnits", "patternContentUnits", "patternTransform", "markerWidth",
  "markerHeight", "refX", "refY", "orient", "preserveAspectRatio", "text-anchor",
  "dominant-baseline", "font-family", "font-size", "font-style", "font-weight", "letter-spacing"
]);
const SVG_ID = /^[A-Za-z][A-Za-z0-9_.-]{0,127}$/;
const SVG_FRAGMENT_REFERENCE = /^url\(#[A-Za-z][A-Za-z0-9_.-]{0,127}\)$/;
const SVG_REFERENCE_ATTRIBUTES = new Set(["clip-path", "mask", "marker-start", "marker-mid", "marker-end"]);
const SVG_PAINT_ATTRIBUTES = new Set(["fill", "stroke", "stop-color"]);
const SVG_STATIC_PAINT = /^(?:none|transparent|currentColor|#[A-Fa-f0-9]{3,8}|[A-Za-z]{1,32}|(?:rgb|rgba|hsl|hsla)\([0-9.,%+ -]{1,100}\))$/;

function safeSvgAttribute(name, value) {
  if (!SVG_ATTRIBUTES.has(name) || value.length > 2_048 || /[\u0000-\u001f<>"'\\]/u.test(value)) return false;
  if (name === "id") return SVG_ID.test(value);
  if (SVG_REFERENCE_ATTRIBUTES.has(name)) return SVG_FRAGMENT_REFERENCE.test(value);
  if (SVG_PAINT_ATTRIBUTES.has(name)) return SVG_STATIC_PAINT.test(value) || SVG_FRAGMENT_REFERENCE.test(value);
  if (/url\s*\(/iu.test(value)) return false;
  return !/(?:javascript|data|https?|file|blob)\s*:/iu.test(value);
}

function parseSvg(source) {
  const errors = [];
  let document;
  try {
    const parser = new DOMParser({
      onError(level) { errors.push(level); }
    });
    document = parser.parseFromString(source, "image/svg+xml");
  } catch (error) {
    throw new PreviewError("invalid_svg_source", { cause: error });
  }
  if (errors.length > 0 || !document.documentElement
    || document.documentElement.localName !== "svg"
    || document.documentElement.namespaceURI !== SVG_NAMESPACE) {
    throw new PreviewError("invalid_svg_source");
  }
  return document.documentElement;
}

export function sanitizeSvg(source) {
  if (typeof source !== "string" || source.length === 0) throw new PreviewError("invalid_svg_source");
  if (byteLength(source) > PREVIEW_LIMITS.maxSvgBytes) throw new PreviewError("svg_source_too_large");
  if (/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/iu.test(source)) throw new PreviewError("unsafe_svg_declaration");
  const root = parseSvg(source);
  const output = new DOMImplementation().createDocument(SVG_NAMESPACE, "svg", null);
  const targetRoot = output.documentElement;
  let nodes = 0;
  let attributes = 0;

  function copy(sourceNode, targetNode, depth) {
    if (depth > PREVIEW_LIMITS.maxSvgDepth) throw new PreviewError("svg_too_deep");
    if (++nodes > PREVIEW_LIMITS.maxSvgNodes) throw new PreviewError("svg_has_too_many_nodes");
    for (let index = 0; index < sourceNode.attributes.length; index += 1) {
      const attribute = sourceNode.attributes.item(index);
      if (!safeSvgAttribute(attribute.name, attribute.value)) continue;
      if (++attributes > PREVIEW_LIMITS.maxSvgAttributes) throw new PreviewError("svg_has_too_many_attributes");
      targetNode.setAttribute(attribute.name, attribute.value);
    }
    for (let child = sourceNode.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === 3) {
        targetNode.appendChild(output.createTextNode(child.data));
        continue;
      }
      if (child.nodeType !== 1 || child.namespaceURI !== SVG_NAMESPACE || !SVG_ELEMENTS.has(child.localName)) continue;
      const targetChild = output.createElementNS(SVG_NAMESPACE, child.localName);
      targetNode.appendChild(targetChild);
      copy(child, targetChild, depth + 1);
    }
  }

  copy(root, targetRoot, 0);
  targetRoot.setAttribute("xmlns", SVG_NAMESPACE);
  targetRoot.setAttribute("role", "img");
  targetRoot.setAttribute("focusable", "false");
  return new XMLSerializer().serializeToString(targetRoot);
}

export function renderSvgPreview(source, { language = "und" } = {}) {
  const svg = sanitizeSvg(source);
  return Object.freeze({
    kind: "static-html",
    mediaType: "text/html; charset=utf-8",
    sandbox: STATIC_PREVIEW_SANDBOX,
    allow: "",
    referrerPolicy: "no-referrer",
    document: createStaticPreviewDocument({ title: "SVG preview", bodyHtml: svg, language })
  });
}

let mermaidValidationQueue = Promise.resolve();

function preflightMermaidSource(source) {
  if (typeof source !== "string" || source.trim().length === 0) throw new PreviewError("invalid_mermaid_source");
  if (source.length > MERMAID_RENDER_CONFIG.maxTextSize) throw new PreviewError("mermaid_source_too_large");
  if (source.split("\n").length > 2_000) throw new PreviewError("mermaid_source_too_many_lines");
  if (/^\s*---(?:\r?\n|$)/u.test(source) || /%%\s*\{/u.test(source)) {
    throw new PreviewError("mermaid_author_config_forbidden");
  }
  if (/^\s*(?:click|classDef|style|linkStyle)\b/imu.test(source)) {
    throw new PreviewError("mermaid_interactive_style_forbidden");
  }
}

export async function validateMermaidSource(source) {
  preflightMermaidSource(source);
  const operation = mermaidValidationQueue.then(async () => {
    try {
      mermaid.initialize(MERMAID_RENDER_CONFIG);
      const result = await mermaid.parse(source, { suppressErrors: false });
      return Object.freeze({ diagramType: result.diagramType });
    } catch (error) {
      throw new PreviewError("mermaid_parse_failed", { cause: error });
    }
  });
  mermaidValidationQueue = operation.catch(() => {});
  return operation;
}

// This low-level renderer must only run inside a disposable, capability-minimized
// browser document. Callers still need renderMermaidPreview to validate and
// sanitize the returned SVG before it is displayed.
export async function renderMermaidSvgInCurrentDocument({ source, config, renderId }) {
  if (typeof document === "undefined") throw new PreviewError("mermaid_dom_unavailable");
  if (typeof renderId !== "string" || !/^komyaku-mermaid-[a-f0-9-]{1,64}$/u.test(renderId)) {
    throw new PreviewError("invalid_mermaid_render_id");
  }
  mermaid.initialize(config);
  const result = await mermaid.render(renderId, source);
  return result.svg;
}

export async function renderMermaidPreview(source, {
  isolatedRenderer,
  language = "und"
} = {}) {
  const validation = await validateMermaidSource(source);
  if (typeof isolatedRenderer !== "function") throw new PreviewError("mermaid_isolated_renderer_unavailable");
  let rendered;
  try {
    rendered = await isolatedRenderer({
      source,
      diagramType: validation.diagramType,
      config: MERMAID_RENDER_CONFIG
    });
  } catch (error) {
    throw new PreviewError("mermaid_render_failed", { cause: error });
  }
  if (typeof rendered !== "string") throw new PreviewError("invalid_mermaid_render_output");
  return renderSvgPreview(rendered, { language });
}

export function unsupportedPreview(kind) {
  if (!new Set(["image", "pdf"]).has(kind)) {
    throw new PreviewError("unknown_preview_kind");
  }
  return Object.freeze({
    kind: "unavailable",
    reason: `${kind}_isolated_renderer_unavailable`,
    sourceMustRemainVisible: true
  });
}
