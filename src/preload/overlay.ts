import { contextBridge, ipcRenderer } from 'electron'
import {
  OVERLAY_COMMAND_CHANNEL,
  OVERLAY_TO_MAIN_CHANNEL,
  type OverlayCommand,
  type OverlayToMain,
  type SaywriteOverlayApi
} from '../shared/ipc'

const api: SaywriteOverlayApi = {
  onCommand(cb) {
    const listener = (_e: Electron.IpcRendererEvent, c: OverlayCommand): void => cb(c)
    ipcRenderer.on(OVERLAY_COMMAND_CHANNEL, listener)
    return () => {
      ipcRenderer.removeListener(OVERLAY_COMMAND_CHANNEL, listener)
    }
  },
  send(msg: OverlayToMain) {
    ipcRenderer.send(OVERLAY_TO_MAIN_CHANNEL, msg)
  }
}

contextBridge.exposeInMainWorld('saywriteOverlay', api)
