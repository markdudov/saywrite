export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? (T[K] extends unknown[] ? T[K] : DeepPartial<T[K]>) : T[K]
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Objects merge recursively; arrays and primitives in `patch` replace. Inputs are not mutated. */
export function deepMerge<T>(base: T, patch: DeepPartial<T>): T {
  if (!isPlainObject(base) || !isPlainObject(patch)) return patch as T
  const out: Record<string, unknown> = { ...base }
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue
    out[k] = isPlainObject(v) && isPlainObject(out[k]) ? deepMerge(out[k], v) : v
  }
  return out as T
}
