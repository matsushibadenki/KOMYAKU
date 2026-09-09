// Keep preparation and delivery separate so edits during asynchronous archive
// creation cannot deliver a file presented as the current draft.
export async function runCheckpointedExport({ prepare, build, deliver }) {
  const prepared = await prepare();
  if (prepared?.checkpoint?.durable !== true || typeof prepared.isCurrent !== "function") {
    throw new Error("durable_checkpoint_required");
  }
  if (!prepared.isCurrent()) throw new Error("local_edit_changed");
  const output = await build(prepared.checkpoint);
  if (!prepared.isCurrent()) throw new Error("local_edit_changed");
  await deliver(output);
  return output;
}
