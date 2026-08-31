import { describe, expect, test } from "bun:test";
import {
  PREVIEW_LIMITS,
  MERMAID_RENDER_CONFIG,
  PreviewError,
  createStaticPreviewDocument,
  renderLatexPreview,
  renderAcceptedPngPreview,
  renderMermaidPreview,
  renderSvgPreview,
  sanitizeSvg,
  validateMermaidSource,
  unsupportedPreview
} from "../src/index.js";

describe("isolated static preview foundation", () => {
  function pngHeader({ width = 1, height = 1 } = {}) {
    const bytes = new Uint8Array(33);
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    new DataView(bytes.buffer).setUint32(8, 13);
    bytes.set([0x49, 0x48, 0x44, 0x52], 12);
    new DataView(bytes.buffer).setUint32(16, width);
    new DataView(bytes.buffer).setUint32(20, height);
    return bytes;
  }

  test("renders untrusted LaTeX as script-free MathML with a deny-by-default CSP", () => {
    const preview = renderLatexPreview(String.raw`E^2 = p^2c^2 + m^2c^4`, { language: "ja" });
    expect(preview.kind).toBe("static-html");
    expect(preview.sandbox).toBe("");
    expect(preview.allow).toBe("");
    expect(preview.document).toContain("<math");
    expect(preview.document).toContain("default-src 'none'");
    expect(preview.document).toContain('referrer" content="no-referrer');
    expect(preview.document).not.toContain("<script");
  });

  test("rejects trusted HTML and prevents external-resource LaTeX from producing a fetch element", () => {
    expect(() => renderLatexPreview(String.raw`\htmlClass{owned}{x}`)).toThrow(PreviewError);
    const external = renderLatexPreview(String.raw`\includegraphics{https://example.com/a.png}`);
    expect(external.document).not.toContain("<img");
    expect(external.document).not.toContain("<image");
    expect(external.document).not.toContain("href=");
  });

  test("bounds source size and macro expansion", () => {
    expect(() => renderLatexPreview("x".repeat(PREVIEW_LIMITS.maxLatexCodeUnits + 1)))
      .toThrow(new PreviewError("latex_source_too_large"));
    expect(() => renderLatexPreview(String.raw`\def\a{\a}\a`)).toThrow(PreviewError);
  });

  test("escapes document metadata and refuses oversized wrapper documents", () => {
    const document = createStaticPreviewDocument({ title: "</title><script>bad()</script>", bodyHtml: "<p>safe</p>" });
    expect(document).not.toContain("<script>bad()");
    expect(document).toContain("&lt;/title&gt;");
    expect(() => createStaticPreviewDocument({
      title: "large", bodyHtml: "x".repeat(PREVIEW_LIMITS.maxDocumentBytes)
    })).toThrow(new PreviewError("preview_document_too_large"));
  });

  test("fails closed for renderers that have not reached their isolation gate", () => {
    for (const kind of ["image", "pdf"]) {
      expect(unsupportedPreview(kind)).toEqual({
        kind: "unavailable", reason: `${kind}_isolated_renderer_unavailable`, sourceMustRemainVisible: true
      });
    }
  });

  test("wraps only an accepted bounded PNG preview in a script-free static descriptor", () => {
    const bytes = pngHeader({ width: 640, height: 480 });
    const preview = renderAcceptedPngPreview({
      bytes,
      inspection: {
        status: "accepted", detectedMediaType: "image/png",
        byteSize: bytes.byteLength, width: 640, height: 480
      },
      altText: `Graph <script>alert(1)</script>`,
      language: "en"
    });
    expect(preview.sandbox).toBe("");
    expect(preview.document).toContain("data:image/png;base64,");
    expect(preview.document).toContain('width="640" height="480"');
    expect(preview.document).toContain("Graph &lt;script&gt;alert(1)&lt;/script&gt;");
    expect(preview.document).not.toContain("<script>");
    expect(preview.document).toContain("img-src data:");
  });

  test("rejects unaccepted, mismatched, oversized-pixel, and forged PNG previews", () => {
    const bytes = pngHeader({ width: 10, height: 20 });
    const accepted = {
      status: "accepted", detectedMediaType: "image/png",
      byteSize: bytes.byteLength, width: 10, height: 20
    };
    expect(() => renderAcceptedPngPreview({ bytes, inspection: { ...accepted, status: "pending" } }))
      .toThrow(new PreviewError("png_preview_not_accepted"));
    expect(() => renderAcceptedPngPreview({ bytes, inspection: { ...accepted, byteSize: 99 } }))
      .toThrow(new PreviewError("invalid_png_preview_bytes"));
    expect(() => renderAcceptedPngPreview({ bytes, inspection: { ...accepted, width: 11 } }))
      .toThrow(new PreviewError("png_preview_metadata_mismatch"));
    expect(() => renderAcceptedPngPreview({
      bytes: pngHeader({ width: 5_000, height: 5_000 }),
      inspection: { ...accepted, byteSize: 33, width: 5_000, height: 5_000 }
    })).toThrow(new PreviewError("png_preview_dimensions_exceeded"));
    expect(() => renderAcceptedPngPreview({
      bytes: new Uint8Array(33), inspection: { ...accepted }
    })).toThrow(new PreviewError("invalid_png_preview"));
  });

  test("rebuilds basic SVG through a static element and attribute allowlist", () => {
    const preview = renderSvgPreview(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40">
        <title>Safe diagram</title><rect id="box" x="1" y="2" width="90" height="30" fill="#fff"/>
        <text x="4" y="20">設計</text>
      </svg>`);
    expect(preview.document).toContain("Safe diagram");
    expect(preview.document).toContain("<rect");
    expect(preview.document).toContain("default-src 'none'");
  });

  test("removes script, foreign HTML, events, styles, external references, and unknown wrappers", () => {
    const sanitized = sanitizeSvg(`
      <svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)">
        <script href="https://evil.example/x.js">alert(1)</script>
        <foreignObject><body xmlns="http://www.w3.org/1999/xhtml">bad</body></foreignObject>
        <style>@import url(https://evil.example/x.css)</style>
        <image href="https://evil.example/x.png"/>
        <use href="https://evil.example/x.svg#id"/>
        <g style="background:url(https://evil.example/x)" onclick="bad()"><rect fill="url(https://evil.example/x)" stroke="u\\72l(//evil.example/x)"/></g>
      </svg>`);
    expect(sanitized).not.toContain("script");
    expect(sanitized).not.toContain("foreignObject");
    expect(sanitized).not.toContain("evil.example");
    expect(sanitized).not.toContain("onload");
    expect(sanitized).not.toContain("onclick");
    expect(sanitized).not.toContain("style=");
  });

  test("keeps bounded internal paint references but rejects declarations and malformed XML", () => {
    expect(sanitizeSvg(`<svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="paint"><stop offset="0" stop-color="#fff"/></linearGradient></defs><rect fill="url(#paint)"/></svg>`))
      .toContain("url(#paint)");
    expect(() => sanitizeSvg(`<!DOCTYPE svg><svg xmlns="http://www.w3.org/2000/svg"/>`))
      .toThrow(new PreviewError("unsafe_svg_declaration"));
    expect(() => sanitizeSvg(`<svg xmlns="http://www.w3.org/2000/svg"><g></svg>`)).toThrow(PreviewError);
  });

  test("validates Mermaid with fixed secure limits and no authored configuration", async () => {
    await expect(validateMermaidSource("flowchart LR\nA --> B")).resolves.toEqual({
      diagramType: "flowchart-v2"
    });
    expect(MERMAID_RENDER_CONFIG.securityLevel).toBe("strict");
    expect(MERMAID_RENDER_CONFIG.maxEdges).toBe(500);
    await expect(validateMermaidSource("---\nconfig:\n  securityLevel: loose\n---\nflowchart LR\nA-->B"))
      .rejects.toThrow(new PreviewError("mermaid_author_config_forbidden"));
    await expect(validateMermaidSource("%%{init: {'securityLevel': 'loose'}}%%\nflowchart LR\nA-->B"))
      .rejects.toThrow(new PreviewError("mermaid_author_config_forbidden"));
    await expect(validateMermaidSource("flowchart LR\nclick A href 'https://evil.example'"))
      .rejects.toThrow(new PreviewError("mermaid_interactive_style_forbidden"));
  });

  test("requires an isolated renderer and sanitizes its SVG output again", async () => {
    await expect(renderMermaidPreview("flowchart LR\nA-->B"))
      .rejects.toThrow(new PreviewError("mermaid_isolated_renderer_unavailable"));
    const preview = await renderMermaidPreview("flowchart LR\nA-->B", {
      isolatedRenderer: async ({ config }) => {
        expect(config.securityLevel).toBe("strict");
        return `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><path d="M0 0L2 2" onload="bad()"/></svg>`;
      }
    });
    expect(preview.document).toContain("<path");
    expect(preview.document).not.toContain("<script");
    expect(preview.document).not.toContain("onload");
  });
});
