import { contextBridge, ipcRenderer } from 'electron'

const prefix = '--yonder-system-languages='
let systemLanguages = []

try {
  const argument = process.argv.find((value) => value.startsWith(prefix))
  const value = JSON.parse(argument?.slice(prefix.length))
  if (Array.isArray(value) && value.every((language) => typeof language === 'string')) {
    systemLanguages = value
  }
} catch {
  // An unavailable system preference falls back to English in the renderer.
}

const api = Object.freeze({
  systemLanguages,
  chooseStorageFolderForOpening: (language) =>
    ipcRenderer.invoke('storage:choose-for-opening', language === 'ru' ? 'ru' : 'en'),
  recheckStorage: (storageId) => ipcRenderer.invoke('storage:recheck', storageId),
  chooseStorageFolderForCreation: (language) =>
    ipcRenderer.invoke('storage:choose-for-creation', language === 'ru' ? 'ru' : 'en'),
  createStorageConfig: (selectionId, name) =>
    ipcRenderer.invoke('storage:create-config', { selectionId, name })
})

contextBridge.exposeInMainWorld('yonder', api)
