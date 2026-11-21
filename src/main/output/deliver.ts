import type { OutputAction } from '@shared/schemas/mode'
import type { ClipboardPort, KeySender } from '../context/selection'

export type DeliveryResult = {
  delivered: 'pasted' | 'copied'
  reason?: 'copy_action' | 'elevated' | 'modifiers_held'
}

const MODIFIER_POLL_MS = 20
const ENTER_DELAY_MS = 60

/**
 * Puts the final text into the user's app: paste (and optional Enter) with clipboard restore,
 * or clipboard-only when pasting would be unsafe. Never logs the text.
 */
export async function deliverText(
  text: string,
  opts: {
    action: OutputAction
    pressEnter: boolean
    restoreClipboard: boolean
    pasteDelayMs: number
    restoreDelayMs: number
  },
  deps: {
    clipboard: ClipboardPort
    keys: KeySender
    sleep(ms: number): Promise<void>
    isForegroundElevated(): boolean
    modifierWaitMs?: number
  }
): Promise<DeliveryResult> {
  const { clipboard, keys, sleep } = deps

  if (opts.action === 'copy') {
    clipboard.writeText(text)
    return { delivered: 'copied', reason: 'copy_action' }
  }

  if (deps.isForegroundElevated()) {
    clipboard.writeText(text)
    return { delivered: 'copied', reason: 'elevated' }
  }

  const modifierWaitMs = deps.modifierWaitMs ?? 1000
  let waited = 0
  while (keys.modifiersDown() && waited < modifierWaitMs) {
    await sleep(MODIFIER_POLL_MS)
    waited += MODIFIER_POLL_MS
  }
  if (keys.modifiersDown()) {
    clipboard.writeText(text)
    return { delivered: 'copied', reason: 'modifiers_held' }
  }

  const snapshot = opts.restoreClipboard ? clipboard.snapshot() : undefined
  const restoreIfOurs = (): void => {
    if (snapshot && clipboard.readText() === text) clipboard.restore(snapshot)
  }

  clipboard.writeText(text)
  try {
    await sleep(opts.pasteDelayMs)
    keys.paste()
    if (opts.pressEnter) {
      await sleep(ENTER_DELAY_MS)
      keys.enter()
    }
  } catch (err) {
    restoreIfOurs()
    throw err
  }

  if (snapshot) {
    await sleep(opts.restoreDelayMs)
    restoreIfOurs()
  }
  return { delivered: 'pasted' }
}
