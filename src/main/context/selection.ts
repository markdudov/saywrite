/** One record per clipboard item, keyed by MIME type; values are the raw bytes. */
export type ClipboardSnapshot = { items: Array<Record<string, Uint8Array>> }

export interface ClipboardPort {
  snapshot(): Promise<ClipboardSnapshot>
  restore(s: ClipboardSnapshot): Promise<void>
  readText(): Promise<string>
  writeText(t: string): Promise<void>
}

export interface KeySender {
  paste(): void
  copy(): void
  enter(): void
  modifiersDown(): boolean
}

/**
 * Copies the current selection via the clipboard and restores the previous clipboard contents.
 * Never logs the captured text.
 */
export async function captureSelection(
  deps: {
    clipboard: ClipboardPort
    keys: KeySender
    sleep(ms: number): Promise<void>
    random(): string
  },
  opts: { timeoutMs?: number; pollMs?: number } = {}
): Promise<string | null> {
  const timeoutMs = opts.timeoutMs ?? 300
  const pollMs = opts.pollMs ?? 15
  const { clipboard, keys, sleep, random } = deps
  const snapshot = await clipboard.snapshot()
  try {
    const sentinel = `saywrite-sentinel-${random()}`
    await clipboard.writeText(sentinel)
    keys.copy()
    let text = await clipboard.readText()
    let waited = 0
    while (text === sentinel && waited < timeoutMs) {
      await sleep(pollMs)
      waited += pollMs
      text = await clipboard.readText()
    }
    if (text === sentinel || text.trim() === '') return null
    return text
  } finally {
    await clipboard.restore(snapshot)
  }
}
