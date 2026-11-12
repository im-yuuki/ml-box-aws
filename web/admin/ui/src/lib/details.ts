/** Splits a resource detail key such as `targetGroup:dashtg-dev:3000` into its identifier and its parameter. */
export function parseDetailKey(key: string): { base: string; param: string } {
  const colon = key.indexOf(":");
  if (colon === -1) return { base: key, param: "" };
  return { base: key.slice(0, colon), param: key.slice(colon + 1) };
}
