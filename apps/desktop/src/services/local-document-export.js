import {
  createKomyakuArchive,
  createKomyakuHistoryArchive,
  KOMYAKU_ARCHIVE_MEDIA_TYPE,
  verifyKomyakuArchive,
  verifyKomyakuHistoryArchive
} from "@komyaku/archive-core";
import { collectAssetIds, parseCanonicalDocument } from "@komyaku/document-schema";

const FORMATS = new Set(["txt", "md"]);

function inlineText(content, format, warnings) {
  return (content ?? []).map((node) => {
    if (node.type === "hard_break") return "\n";
    if (node.type === "math_inline") {
      warnings.add("math_source_only");
      return format === "md" ? `$${node.source}$` : node.source;
    }
    let value = node.text;
    if (format === "md") {
      for (const mark of node.marks ?? []) {
        if (mark.type === "bold") value = `**${value}**`;
        else if (mark.type === "italic") value = `*${value}*`;
        else if (mark.type === "strike") value = `~~${value}~~`;
        else if (mark.type === "code") value = `\`${value}\``;
        else if (mark.type === "link") value = `[${value}](${mark.href})`;
        else if (mark.type === "underline") warnings.add("underline_omitted");
      }
    } else if ((node.marks ?? []).length > 0) warnings.add("text_formatting_omitted");
    return value;
  }).join("");
}

function renderBlocks(nodes, format, warnings, depth = 0) {
  return nodes.map((node) => {
    switch (node.type) {
      case "paragraph": return inlineText(node.content, format, warnings);
      case "heading": return format === "md"
        ? `${"#".repeat(node.attrs.level)} ${inlineText(node.content, format, warnings)}`
        : inlineText(node.content, format, warnings);
      case "blockquote": {
        const body = renderBlocks(node.content, format, warnings, depth + 1);
        return format === "md" ? body.split("\n").map((line) => `> ${line}`).join("\n") : body;
      }
      case "bullet_list":
      case "ordered_list": return node.content.map((item, index) => {
        const marker = node.type === "ordered_list" ? `${node.attrs.start + index}.` : "-";
        const body = renderBlocks(item.content, format, warnings, depth + 1).replaceAll("\n", "\n  ");
        return `${"  ".repeat(depth)}${marker} ${body}`;
      }).join("\n");
      case "code_block": return format === "md"
        ? `\`\`\`${node.language ?? ""}\n${node.source}\n\`\`\`` : node.source;
      case "math_block":
        warnings.add("math_source_only");
        return format === "md" ? `$$\n${node.source}\n$$` : node.source;
      case "diagram":
        warnings.add("diagram_source_only");
        return format === "md" ? `\`\`\`${node.sourceType}\n${node.source}\n\`\`\`` : `${node.altText}\n${node.source}`;
      case "image":
        warnings.add("asset_bytes_omitted");
        return format === "md" ? `![${node.altText}](asset:${node.assetId})` : `[Image: ${node.altText || node.assetId}]`;
      case "file":
        warnings.add("asset_bytes_omitted");
        return `[File: ${node.title || node.fileName}; asset:${node.assetId}]`;
      case "table":
        warnings.add("table_layout_simplified");
        return node.content.map((row) => row.content.map((cell) =>
          renderBlocks(cell.content, format, warnings, depth + 1).replaceAll("\n", " ")).join(format === "md" ? " | " : "\t")).join("\n");
      case "horizontal_rule": return format === "md" ? "---" : "────────";
      default:
        warnings.add("unsupported_structure_omitted");
        return "";
    }
  }).filter(Boolean).join("\n\n");
}

export function renderLocalDocumentExport(input, format) {
  if (!FORMATS.has(format)) throw new Error("unsupported_local_export_format");
  const document = parseCanonicalDocument(input);
  const warnings = new Set();
  const text = `${renderBlocks(document.content, format, warnings)}\n`;
  return Object.freeze({ format, text, bytes: new TextEncoder().encode(text),
    mediaType: format === "md" ? "text/markdown;charset=utf-8" : "text/plain;charset=utf-8",
    extension: format, warnings: Object.freeze([...warnings].sort()) });
}

export async function createVerifiedLocalSnapshotExport(input, { assets = [], createdAt } = {}) {
  const document = parseCanonicalDocument(input);
  if (new Set(collectAssetIds(document)).size > 0 && assets.length === 0) {
    throw new Error("local_snapshot_assets_required");
  }
  const bytes = await createKomyakuArchive({ document, assets, createdAt });
  const verified = await verifyKomyakuArchive(bytes);
  if (verified.document.id !== document.id || verified.manifest.formatVersion !== 1) {
    throw new Error("invalid_local_snapshot_export");
  }
  return Object.freeze({ bytes, mediaType: KOMYAKU_ARCHIVE_MEDIA_TYPE,
    extension: "komyaku", archiveDigest: verified.archiveDigest, formatVersion: 1 });
}

export async function createVerifiedLocalHistoryExport(input, { createdAt } = {}) {
  const bytes = await createKomyakuHistoryArchive({ ...input, createdAt });
  const verified = await verifyKomyakuHistoryArchive(bytes);
  if (verified.documentId !== input.documentId
    || verified.currentBranchId !== input.currentBranchId
    || verified.currentVersionId !== input.currentVersionId
    || verified.versions.length !== input.versions.length
    || verified.branches.length !== input.branches.length
    || verified.assets.length !== input.assets.length) {
    throw new Error("invalid_local_history_export");
  }
  return Object.freeze({
    bytes,
    mediaType: KOMYAKU_ARCHIVE_MEDIA_TYPE,
    extension: "komyaku",
    archiveDigest: verified.archiveDigest,
    formatVersion: 2
  });
}

export function downloadLocalExport({ bytes, mediaType, fileName }, {
  documentRef = document, urlApi = URL
} = {}) {
  const url = urlApi.createObjectURL(new Blob([bytes], { type: mediaType }));
  try {
    const anchor = documentRef.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
  } finally { urlApi.revokeObjectURL(url); }
}

export function localExportFileName(title, extension) {
  const base = String(title || "untitled").normalize("NFC")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").trim().slice(0, 120) || "untitled";
  return `${base}.${extension}`;
}
