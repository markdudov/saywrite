import { KEY } from '../keys'

export type HotkeyAction = { kind: 'dictate'; modeId: string | null } | { kind: 'edit' }
export type HotkeyBinding = { keys: number[]; action: HotkeyAction }
export type ControllerEvent =
  { type: 'start'; action: HotkeyAction } | { type: 'stop' } | { type: 'cancel' }

/** A key whose last keydown is older than this is treated as a missed key-up. */
export const STALE_REPEAT_GAP_MS = 750

type Phase = 'idle' | 'pressing' | 'toggled'

export class HotkeyController {
  private bindings: HotkeyBinding[] = []
  private holdThresholdMs: number
  private phase: Phase = 'idle'
  private readonly pressed = new Set<number>()
  private readonly lastDown = new Map<number, number>()
  private activeKeys: ReadonlySet<number> = new Set()
  private pressStart = 0
  // False after a key-down stop/cancel until the keyboard is fully released, so the
  // rest of the same chord cannot immediately start a new session.
  private armed = true

  constructor(opts: { bindings: HotkeyBinding[]; holdThresholdMs: number }) {
    this.holdThresholdMs = opts.holdThresholdMs
    this.setBindings(opts.bindings)
  }

  keyDown(code: number, t: number): ControllerEvent | null {
    if (code === KEY.Escape) {
      if (this.phase === 'idle') return null
      this.phase = 'idle'
      this.armed = false
      return { type: 'cancel' }
    }

    const last = this.lastDown.get(code) as number // always set while the key is pressed
    this.lastDown.set(code, t)
    let fresh = false
    if (this.pressed.has(code)) {
      if (t - last <= STALE_REPEAT_GAP_MS) return null
      // Missed key-up: forget everything else and treat this as a fresh press.
      this.pressed.clear()
      this.armed = true
      fresh = true
    }
    this.pressed.add(code)

    // While deciding tap vs hold, extra keys joining the chord are ignored.
    if (this.phase === 'pressing' && !fresh) return null

    const binding = this.match()
    if (!binding) return null
    if (this.phase === 'idle') {
      if (!this.armed) return null
      this.phase = 'pressing'
      this.activeKeys = new Set(binding.keys)
      this.pressStart = t
      return { type: 'start', action: binding.action }
    }
    this.phase = 'idle'
    this.armed = false
    return { type: 'stop' }
  }

  keyUp(code: number, t: number): ControllerEvent | null {
    this.pressed.delete(code)
    if (this.pressed.size === 0) this.armed = true
    if (this.phase !== 'pressing' || !this.activeKeys.has(code)) return null
    if (t - this.pressStart >= this.holdThresholdMs) {
      this.phase = 'idle'
      return { type: 'stop' }
    }
    this.phase = 'toggled'
    return null
  }

  notifyStopped(): void {
    this.phase = 'idle'
  }

  /** Forget all pressed keys (e.g. after resume/unlock, when key-ups may have been missed). */
  reset(): void {
    this.pressed.clear()
    this.lastDown.clear()
    this.armed = true
  }

  setBindings(b: HotkeyBinding[], holdThresholdMs?: number): void {
    // Matching is exact-set, so order only matters between duplicate bindings (longer first).
    this.bindings = [...b].sort((x, y) => y.keys.length - x.keys.length)
    if (holdThresholdMs !== undefined) this.holdThresholdMs = holdThresholdMs
  }

  pressedKeys(): ReadonlySet<number> {
    return this.pressed
  }

  private match(): HotkeyBinding | undefined {
    return this.bindings.find(
      (b) => b.keys.length === this.pressed.size && b.keys.every((k) => this.pressed.has(k))
    )
  }
}
