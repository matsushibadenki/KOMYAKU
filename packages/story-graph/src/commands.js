import { z } from "zod";
import { encodeStoryWorkspaceSnapshot, StoryGraphError } from "./schema.js";

export const STORY_COMMAND_LIMITS = Object.freeze({ maxOperations: 100, maxBytes: 24 * 1024 * 1024 });
const collections = ["nodes", "edges", "paths", "entities"];
const operationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("replace-document"), document: z.record(z.string(), z.json()) }).strict(),
  z.object({ type: z.literal("put"), collection: z.enum(collections), value: z.record(z.string(), z.json()) }).strict(),
  z.object({ type: z.literal("remove"), collection: z.enum(collections), id: z.string().uuid() }).strict()
]);
const commandSchema = z.object({
  documentId: z.string().uuid(),
  graphId: z.string().uuid(),
  expectedRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 1),
  operations: z.array(operationSchema).min(1).max(STORY_COMMAND_LIMITS.maxOperations)
}).strict();
const fail = (code) => { throw new StoryGraphError(code); };

/** A pure reference contract, not an authority or persistence implementation.
 * The Rust owner must compare revision and commit the complete result in one transaction.
 */
export function applyStoryWorkspaceCommand(current, input) {
  if (!current || !Number.isSafeInteger(current.revision) || current.revision < 0
    || current.revision >= Number.MAX_SAFE_INTEGER) fail("invalid_story_workspace_revision");
  // Bound the envelope before parsing deeply nested JSON payloads.
  let json;
  try { json = JSON.stringify(input); } catch { fail("invalid_story_command"); }
  if (typeof json !== "string") fail("invalid_story_command");
  if (new TextEncoder().encode(json).byteLength > STORY_COMMAND_LIMITS.maxBytes) {
    fail("story_command_too_large");
  }
  const parsed = commandSchema.safeParse(input);
  if (!parsed.success) fail("invalid_story_command");
  const command = parsed.data;
  if (command.expectedRevision !== current.revision) fail("stale_story_workspace_revision");
  const original = encodeStoryWorkspaceSnapshot(current.workspace).workspace;
  if (command.documentId !== original.document.id || command.graphId !== original.graph.id) {
    fail("story_command_workspace_mismatch");
  }
  const workspace = structuredClone(original);
  for (const operation of command.operations) {
    if (operation.type === "replace-document") {
      if (operation.document.id !== original.document.id) fail("story_command_workspace_mismatch");
      workspace.document = structuredClone(operation.document);
      continue;
    }
    const items = workspace.graph[operation.collection];
    const id = operation.type === "put" ? operation.value.id : operation.id;
    if (typeof id !== "string") fail("invalid_story_command");
    const index = items.findIndex((item) => item.id === id);
    if (operation.type === "remove") {
      if (index < 0) fail("missing_story_command_target");
      items.splice(index, 1);
    } else if (index < 0) {
      items.push(structuredClone(operation.value));
    } else {
      items[index] = structuredClone(operation.value);
    }
  }
  // Validate only the final composite: references may be repaired within this batch.
  // No cascade deletion, implicit Path rewrite, or mutation of the caller's state.
  const snapshot = encodeStoryWorkspaceSnapshot(workspace);
  return Object.freeze({ revision: current.revision + 1, ...snapshot });
}

const transactionSchema = z.object({
  operationId: z.string().uuid(), command: commandSchema
}).strict();

function ordered(value) {
  if (Array.isArray(value)) return value.map(ordered);
  if (value && typeof value === "object") return Object.fromEntries(
    Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, ordered(item)]));
  return value;
}

/** Pure transaction reference. A native owner must atomically persist the returned
 * state and receipt, and supply only its own previously persisted receipt.
 * Replay never reapplies a command or rolls current state back to the receipt revision.
 */
export function applyStoryWorkspaceTransaction(current, input, receipt = null) {
  let envelope;
  try { envelope = JSON.stringify(input); } catch { fail("invalid_story_transaction"); }
  if (typeof envelope !== "string") fail("invalid_story_transaction");
  if (new TextEncoder().encode(envelope).byteLength > STORY_COMMAND_LIMITS.maxBytes) fail("story_command_too_large");
  const parsed = transactionSchema.safeParse(input);
  if (!parsed.success) fail("invalid_story_transaction");
  const request = parsed.data;
  const requestJson = JSON.stringify(ordered(request));
  if (receipt) {
    if (receipt.operationId !== request.operationId || receipt.requestJson !== requestJson) {
      fail("story_operation_collision");
    }
    const workspace = encodeStoryWorkspaceSnapshot(current.workspace).workspace;
    if (workspace.document.id !== request.command.documentId || workspace.graph.id !== request.command.graphId) {
      fail("story_command_workspace_mismatch");
    }
    if (!Number.isSafeInteger(current.revision) || !Number.isSafeInteger(receipt.revision)
      || receipt.revision !== request.command.expectedRevision + 1
      || current.revision < receipt.revision) fail("invalid_story_transaction_receipt");
    return Object.freeze({ state: current, receipt, replayed: true });
  }
  const state = applyStoryWorkspaceCommand(current, request.command);
  return Object.freeze({ state, receipt: Object.freeze({ operationId: request.operationId,
    requestJson, revision: state.revision }), replayed: false });
}
