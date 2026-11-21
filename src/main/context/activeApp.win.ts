import type { AppRefNow } from './activeApp'

const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000

/** Pure helper: `C:\x\Code.exe` → { name: 'Code', id: 'Code.exe' }. */
export function exeBasename(fullPath: string): AppRefNow {
  const id = fullPath.split(/[\\/]/).pop() ?? fullPath
  return { name: id.replace(/\.exe$/i, ''), id }
}

type Win32 = {
  GetForegroundWindow(): unknown
  GetWindowThreadProcessId(hwnd: unknown, pid: number[]): number
  OpenProcess(access: number, inherit: boolean, pid: number): unknown
  QueryFullProcessImageNameW(h: unknown, flags: number, buf: Buffer, size: number[]): boolean
  CloseHandle(h: unknown): boolean
}

let cached: Win32 | null = null

function load(): Win32 | null {
  if (process.platform !== 'win32') return null
  if (cached) return cached
  // koffi is loaded lazily so the module is never required off Windows.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const koffi = require('koffi')
  const user32 = koffi.load('user32.dll')
  const kernel32 = koffi.load('kernel32.dll')
  cached = {
    GetForegroundWindow: user32.func('void *GetForegroundWindow()'),
    GetWindowThreadProcessId: user32.func(
      'uint32_t GetWindowThreadProcessId(void *hwnd, _Out_ uint32_t *pid)'
    ),
    OpenProcess: kernel32.func('void *OpenProcess(uint32_t access, bool inherit, uint32_t pid)'),
    QueryFullProcessImageNameW: kernel32.func(
      'bool QueryFullProcessImageNameW(void *h, uint32_t flags, _Out_ uint16_t *buf, _Inout_ uint32_t *size)'
    ),
    CloseHandle: kernel32.func('bool CloseHandle(void *h)')
  }
  return cached
}

function foregroundPid(w: Win32): number | null {
  const hwnd = w.GetForegroundWindow()
  if (!hwnd) return null
  const pid = [0]
  w.GetWindowThreadProcessId(hwnd, pid)
  return pid[0] || null
}

export function getActiveAppWin(): AppRefNow | null {
  try {
    const w = load()
    if (!w) return null
    const pid = foregroundPid(w)
    if (pid === null) return null
    const h = w.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
    if (!h) return null
    try {
      const chars = 1024
      const buf = Buffer.alloc(chars * 2)
      const size = [chars]
      if (!w.QueryFullProcessImageNameW(h, 0, buf, size)) return null
      return exeBasename(buf.toString('utf16le', 0, size[0] * 2))
    } finally {
      w.CloseHandle(h)
    }
  } catch {
    return null
  }
}

/** True when the foreground process cannot be opened (typically an elevated/admin process). */
export function isForegroundElevatedWin(): boolean {
  try {
    const w = load()
    if (!w) return false
    const pid = foregroundPid(w)
    if (pid === null) return false
    const h = w.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
    if (!h) return true
    w.CloseHandle(h)
    return false
  } catch {
    return false
  }
}
