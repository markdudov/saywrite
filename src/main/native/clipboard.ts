import { clipboard, ClipboardItem } from 'electron'
import type { ClipboardPort, ClipboardSnapshot } from '../context/selection'
import { entriesFromSnapshot, snapshotFromEntries, stripHtmlMeta } from './clipboardItems'

export function electronClipboard(): ClipboardPort {
  return {
    async snapshot(): Promise<ClipboardSnapshot> {
      const items = await clipboard.read()
      const entries = await Promise.all(
        items.map(async (item) => {
          const row: Array<[string, Uint8Array | null]> = []
          for (const type of item.types) {
            try {
              const value = await item.getType(type)
              // Non-Blob payloads (e.g. the bookmark object) carry no raw bytes; skip them.
              if (value instanceof Blob) {
                row.push([type, stripHtmlMeta(type, new Uint8Array(await value.arrayBuffer()))])
              }
            } catch {
              // type not readable: skip it
            }
          }
          return row
        })
      )
      return snapshotFromEntries(entries)
    },
    async restore(s: ClipboardSnapshot): Promise<void> {
      const entries = entriesFromSnapshot(s)
      if (entries.length === 0) {
        clipboard.clear()
        return
      }
      await clipboard.write(
        entries.map(
          (row) =>
            new ClipboardItem(
              Object.fromEntries(
                row.map(([type, bytes]) => [
                  type,
                  new Blob([bytes as Uint8Array<ArrayBuffer>], { type })
                ])
              )
            )
        )
      )
    },
    readText: () => clipboard.readText(),
    writeText: (t: string) => clipboard.writeText(t)
  }
}
