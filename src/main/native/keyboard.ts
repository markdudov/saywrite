import { uIOhook, UiohookKey } from 'uiohook-napi'
import { MODIFIER_KEYS } from '@shared/keys'
import type { Platform } from '@shared/platform'
import type { KeySender } from '../context/selection'

export type KeyHook = {
  /** Returns false when the native hook could not start (e.g. missing permission). */
  start(): boolean
  stop(): void
  pressed(): ReadonlySet<number>
}

export function createKeyHook(
  onDown: (code: number, t: number) => void,
  onUp: (code: number, t: number) => void
): KeyHook {
  const down = new Set<number>()
  let running = false
  const handleDown = (e: { keycode: number }): void => {
    down.add(e.keycode)
    onDown(e.keycode, performance.now())
  }
  const handleUp = (e: { keycode: number }): void => {
    down.delete(e.keycode)
    onUp(e.keycode, performance.now())
  }
  return {
    start() {
      if (running) return true
      uIOhook.on('keydown', handleDown)
      uIOhook.on('keyup', handleUp)
      try {
        uIOhook.start()
      } catch {
        uIOhook.off('keydown', handleDown)
        uIOhook.off('keyup', handleUp)
        return false
      }
      running = true
      return true
    },
    stop() {
      if (!running) return
      running = false
      uIOhook.off('keydown', handleDown)
      uIOhook.off('keyup', handleUp)
      try {
        uIOhook.stop()
      } catch {
        // already stopped
      }
      down.clear()
    },
    pressed: () => down
  }
}

export function createKeySender(platform: Platform, hook: KeyHook): KeySender {
  const mod = platform === 'darwin' ? UiohookKey.Meta : UiohookKey.Ctrl
  return {
    paste: () => uIOhook.keyTap(UiohookKey.V, [mod]),
    copy: () => uIOhook.keyTap(UiohookKey.C, [mod]),
    enter: () => uIOhook.keyTap(UiohookKey.Enter),
    modifiersDown(): boolean {
      for (const k of hook.pressed()) if (MODIFIER_KEYS.has(k)) return true
      return false
    }
  }
}
