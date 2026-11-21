import type { EnvironmentInfo } from '@shared/schemas/recording'
import type { Settings } from '@shared/schemas/settings'

export function environmentInfo(settings: Settings, now: Date): EnvironmentInfo {
  const resolved = Intl.DateTimeFormat().resolvedOptions()
  return {
    userName: settings.userName,
    nowIso: now.toISOString(),
    timeZone: resolved.timeZone,
    osLocale: resolved.locale
  }
}
