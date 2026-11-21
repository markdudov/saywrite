import type { Platform } from './platform'

/** libuiohook virtual key codes. */
export const KEY = {
  Escape: 1,
  Enter: 28,
  Ctrl: 29,
  Shift: 42,
  ShiftRight: 54,
  Alt: 56,
  Space: 57,
  C: 46,
  V: 47,
  Digit1: 2,
  Digit9: 10,
  CtrlRight: 3613,
  AltRight: 3640,
  Meta: 3675,
  MetaRight: 3676
} as const

export const MODIFIER_KEYS: ReadonlySet<number> = new Set([
  KEY.Ctrl,
  KEY.CtrlRight,
  KEY.Shift,
  KEY.ShiftRight,
  KEY.Alt,
  KEY.AltRight,
  KEY.Meta,
  KEY.MetaRight
])

export function keyLabel(code: number, platform: Platform): string {
  const mac = platform === 'darwin'
  switch (code) {
    case KEY.Escape:
      return 'Esc'
    case KEY.Enter:
      return 'Enter'
    case KEY.Space:
      return 'Space'
    case KEY.Ctrl:
      return 'Ctrl'
    case KEY.CtrlRight:
      return 'Right Ctrl'
    case KEY.Shift:
      return mac ? '⇧' : 'Shift'
    case KEY.ShiftRight:
      return mac ? 'Right ⇧' : 'Right Shift'
    case KEY.Alt:
      return mac ? '⌥' : 'Alt'
    case KEY.AltRight:
      return mac ? 'Right ⌥' : 'Right Alt'
    case KEY.Meta:
      return mac ? '⌘' : 'Win'
    case KEY.MetaRight:
      return mac ? 'Right ⌘' : 'Right Win'
    case KEY.C:
      return 'C'
    case KEY.V:
      return 'V'
  }
  if (code >= KEY.Digit1 && code <= KEY.Digit9) return String(code - KEY.Digit1 + 1)
  return `Key ${code}`
}
