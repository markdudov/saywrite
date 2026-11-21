import { BrowserWindow, ipcMain, screen } from 'electron'
import { join } from 'path'
import {
  OVERLAY_COMMAND_CHANNEL,
  OVERLAY_TO_MAIN_CHANNEL,
  type OverlayCommand,
  type OverlayToMain
} from '../../shared/ipc'
import type { SettingsStore } from '../stores/settingsStore'

const WIDTH = 360
const HEIGHT = 220
const BOTTOM_MARGIN = 80

export type OverlayHandle = {
  win: BrowserWindow
  send(c: OverlayCommand): void
  showAtCursorDisplay(): void
  hide(): void
  /** Subscribe to renderer messages other than 'interactive' / 'moved' (handled here). */
  onMessage(cb: (m: OverlayToMain) => void): () => void
}

function savedPositionIsVisible(x: number, y: number): boolean {
  const probe = { x, y, width: WIDTH, height: HEIGHT }
  return screen.getAllDisplays().some((d) => {
    const b = d.workArea
    return (
      probe.x < b.x + b.width &&
      probe.x + probe.width > b.x &&
      probe.y < b.y + b.height &&
      probe.y + probe.height > b.y
    )
  })
}

export function createOverlayWindow(settings: SettingsStore): OverlayHandle {
  const win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    focusable: false,
    skipTaskbar: true,
    hasShadow: false,
    resizable: false,
    ...(process.platform === 'darwin' ? { type: 'panel' as const } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/overlay.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })

  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  // Click-through by default; the renderer reports `interactive` while the pointer is over the pill.
  win.setIgnoreMouseEvents(true, { forward: true })

  // Drag regions swallow mouse events in the page, so the renderer cannot see the drag end.
  // Main persists on the window's own 'moved' event instead, ignoring our programmatic moves.
  let positioning = false
  const persistPosition = (): void => {
    if (positioning || win.isDestroyed()) return
    const [x, y] = win.getPosition()
    settings.update({ overlay: { x, y } })
  }
  win.on('moved', persistPosition)

  const listeners = new Set<(m: OverlayToMain) => void>()

  const onIpc = (e: Electron.IpcMainEvent, msg: OverlayToMain): void => {
    if (e.sender !== win.webContents) return
    if (msg.type === 'interactive') {
      if (msg.value) win.setIgnoreMouseEvents(false)
      else win.setIgnoreMouseEvents(true, { forward: true })
      return
    }
    if (msg.type === 'moved') {
      persistPosition()
      return
    }
    for (const cb of listeners) cb(msg)
  }
  ipcMain.on(OVERLAY_TO_MAIN_CHANNEL, onIpc)
  win.on('closed', () => {
    ipcMain.removeListener(OVERLAY_TO_MAIN_CHANNEL, onIpc)
    listeners.clear()
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/overlay.html`)
  } else {
    void win.loadFile(join(__dirname, '../renderer/overlay.html'))
  }

  function position(): void {
    positioning = true
    try {
      place()
    } finally {
      setTimeout(() => (positioning = false), 300)
    }
  }

  function place(): void {
    const { x, y } = settings.get().overlay
    if (x !== null && y !== null && savedPositionIsVisible(x, y)) {
      win.setPosition(Math.round(x), Math.round(y))
      return
    }
    const wa = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
    win.setPosition(
      Math.round(wa.x + (wa.width - WIDTH) / 2),
      Math.round(wa.y + wa.height - HEIGHT - BOTTOM_MARGIN)
    )
  }

  return {
    win,
    send(c) {
      if (!win.isDestroyed()) win.webContents.send(OVERLAY_COMMAND_CHANNEL, c)
    },
    showAtCursorDisplay() {
      position()
      win.showInactive()
    },
    hide() {
      if (!win.isDestroyed()) win.hide()
    },
    onMessage(cb) {
      listeners.add(cb)
      return () => listeners.delete(cb)
    }
  }
}
