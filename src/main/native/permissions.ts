import { shell, systemPreferences } from 'electron'
import type { Platform } from '@shared/platform'

export type PermissionState = {
  microphone: 'granted' | 'denied' | 'not-determined' | 'restricted' | 'unknown'
  accessibility: boolean | 'not-applicable'
}

export function getPermissions(platform: Platform): PermissionState {
  return {
    microphone: systemPreferences.getMediaAccessStatus('microphone'),
    accessibility:
      platform === 'darwin'
        ? systemPreferences.isTrustedAccessibilityClient(false)
        : 'not-applicable'
  }
}

export async function requestMicrophone(): Promise<PermissionState['microphone']> {
  if (process.platform === 'darwin') {
    await systemPreferences.askForMediaAccess('microphone')
  }
  return systemPreferences.getMediaAccessStatus('microphone')
}

export function promptAccessibility(): boolean {
  if (process.platform !== 'darwin') return true
  return systemPreferences.isTrustedAccessibilityClient(true)
}

export async function openPermissionSettings(
  kind: 'microphone' | 'accessibility',
  platform: Platform
): Promise<void> {
  if (platform === 'darwin') {
    const pane = kind === 'microphone' ? 'Privacy_Microphone' : 'Privacy_Accessibility'
    await shell.openExternal(`x-apple.systempreferences:com.apple.preference.security?${pane}`)
  } else if (kind === 'microphone') {
    await shell.openExternal('ms-settings:privacy-microphone')
  }
}
