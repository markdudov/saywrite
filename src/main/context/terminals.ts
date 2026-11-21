import type { Platform } from '@shared/platform'
import { SUGGESTED_APPS } from '@shared/modes/builtins'
import type { AppRefNow } from './activeApp'

const MAC_TERMINALS = [
  'com.apple.Terminal',
  'com.googlecode.iterm2',
  'dev.warp.Warp-Stable',
  'com.mitchellh.ghostty',
  'net.kovidgoyal.kitty',
  'io.alacritty'
]

const WIN_TERMINALS = [
  'WindowsTerminal.exe',
  'powershell.exe',
  'pwsh.exe',
  'cmd.exe',
  'conhost.exe',
  'wezterm-gui.exe',
  'alacritty.exe'
]

const EDITORS = SUGGESTED_APPS.prompt.filter((a) => a.name === 'VS Code' || a.name === 'Cursor')
const MAC_EDITORS = EDITORS.flatMap((a) => (a.macBundleId ? [a.macBundleId] : []))
const WIN_EDITORS = EDITORS.flatMap((a) => (a.winExeName ? [a.winExeName] : []))

function matches(id: string, macIds: string[], winIds: string[], platform: Platform): boolean {
  if (platform === 'darwin') return macIds.includes(id)
  const lower = id.toLowerCase()
  return winIds.some((w) => w.toLowerCase() === lower)
}

export function isTerminal(app: AppRefNow | null, platform: Platform): boolean {
  return !!app && matches(app.id, MAC_TERMINALS, WIN_TERMINALS, platform)
}

/** False for terminals, VS Code and Cursor, where an implicit copy would be unsafe or meaningless. */
export function allowsImplicitSelection(app: AppRefNow | null, platform: Platform): boolean {
  if (!app) return true
  if (isTerminal(app, platform)) return false
  return !matches(app.id, MAC_EDITORS, WIN_EDITORS, platform)
}
