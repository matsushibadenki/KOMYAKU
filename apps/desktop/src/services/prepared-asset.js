// Cleanup credentials stay outside serializable Node attributes.
const releases = new WeakMap();

export function retainPreparedAsset(attributes, release) {
  releases.set(attributes, release);
  return attributes;
}

export function adoptPreparedAsset(attributes) {
  releases.delete(attributes);
}

export async function abandonPreparedAsset(attributes) {
  const release = releases.get(attributes);
  if (!release) return;
  await release();
  releases.delete(attributes);
}
