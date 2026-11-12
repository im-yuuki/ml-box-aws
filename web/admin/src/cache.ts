export type Section<T> = { ok: true; data: T; fetchedAt: string } | { ok: false; error: string; fetchedAt: string };

const store = new Map<string, { expires: number; value: Section<unknown> }>();

/** Turns a failing collector into a result the UI can show, and caches the outcome briefly. */
export async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>, now = () => Date.now()): Promise<Section<T>> {
  const hit = store.get(key);
  if (hit && hit.expires > now()) return hit.value as Section<T>;
  let value: Section<T>;
  const fetchedAt = new Date(now()).toISOString();
  try {
    value = { ok: true, data: await load(), fetchedAt };
  } catch (error) {
    value = { ok: false, error: describeError(error), fetchedAt };
  }
  store.set(key, { expires: now() + (value.ok ? ttlMs : Math.min(ttlMs, 5000)), value });
  return value;
}

export function describeError(error: unknown): string {
  if (error instanceof Error) {
    const name = error.name && error.name !== "Error" ? `${error.name}: ` : "";
    return `${name}${error.message}`.slice(0, 300);
  }
  return "Unknown error";
}

export function clearCache(): void {
  store.clear();
}
