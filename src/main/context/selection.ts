export type ClipboardSnapshot = {
  text?: string
  html?: string
  rtf?: string
  imagePng?: Uint8Array
  bookmark?: { title: string; url: string }
}

export interface ClipboardPort {
  snapshot(): ClipboardSnapshot
  restore(s: ClipboardSnapshot): void
  readText(): string
  writeText(t: string): void
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
  const snapshot = clipboard.snapshot()
  try {
    const sentinel = `saywrite-sentinel-${random()}`
    clipboard.writeText(sentinel)
    keys.copy()
    let text = clipboard.readText()
    let waited = 0
    while (text === sentinel && waited < timeoutMs) {
      await sleep(pollMs)
      waited += pollMs
      text = clipboard.readText()
    }
    if (text === sentinel || text.trim() === '') return null
    return text
  } finally {
    clipboard.restore(snapshot)
  }
}
