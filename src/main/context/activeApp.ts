import type { Platform } from '@shared/platform'
import { getActiveAppMac } from './activeApp.mac'
import { getActiveAppWin, isForegroundElevatedWin } from './activeApp.win'

/** id = macOS bundle id or Windows exe basename. */
export type AppRefNow = { name: string; id: string }

export async function getActiveApp(platform: Platform): Promise<AppRefNow | null> {
  return platform === 'darwin' ? getActiveAppMac() : getActiveAppWin()
}

/** Windows only: the foreground process cannot be opened (elevated). Always false on macOS. */
export function isForegroundElevated(): boolean {
  return process.platform === 'win32' ? isForegroundElevatedWin() : false
}
