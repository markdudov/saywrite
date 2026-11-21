import type { ClipboardSnapshot } from '../context/selection'

/** Descriptor for one ClipboardItem: MIME type -> bytes. Pure, so it can be tested without Electron. */
export function snapshotFromEntries(
  items: Array<Array<[type: string, bytes: Uint8Array | null]>>
): ClipboardSnapshot {
  const out: ClipboardSnapshot['items'] = []
  for (const entries of items) {
    const rec: Record<string, Uint8Array> = {}
    for (const [type, bytes] of entries) if (bytes) rec[type] = bytes
    if (Object.keys(rec).length > 0) out.push(rec)
  }
  return { items: out }
}

/** Splits a snapshot into per-item [type, bytes] lists, skipping empty items. */
export function entriesFromSnapshot(s: ClipboardSnapshot): Array<Array<[string, Uint8Array]>> {
  return s.items.map((rec) => Object.entries(rec)).filter((e) => e.length > 0)
}

const META_PREFIX = new TextEncoder().encode("<meta charset='utf-8'>")

/**
 * Chromium prepends exactly one `<meta charset='utf-8'>` to `text/html` on clipboard read/write, so a
 * snapshot/restore round trip would grow it each time. Remove that single prefix (byte-level, lossless);
 * a genuine meta that follows it, and raw platform HTML types, are left untouched.
 */
export function stripHtmlMeta(type: string, bytes: Uint8Array): Uint8Array {
  if (type !== 'text/html' || bytes.length < META_PREFIX.length) return bytes
  for (let i = 0; i < META_PREFIX.length; i++) if (bytes[i] !== META_PREFIX[i]) return bytes
  return bytes.subarray(META_PREFIX.length)
}
