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

const META_PREFIX = /^(?:<meta charset='utf-8'>)+/

/**
 * Chromium prepends `<meta charset='utf-8'>` to HTML on every clipboard write, so a snapshot/restore
 * round trip would grow it each time. Strip it from HTML payloads when snapshotting.
 */
export function stripHtmlMeta(type: string, bytes: Uint8Array): Uint8Array {
  if (!/html/i.test(type)) return bytes
  const text = new TextDecoder().decode(bytes)
  return META_PREFIX.test(text) ? new TextEncoder().encode(text.replace(META_PREFIX, '')) : bytes
}
