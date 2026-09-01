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
  createStorageConfig: (selectionId, name, openAfterCreation) =>
    ipcRenderer.invoke('storage:create-config', {
      selectionId,
      name,
      openAfterCreation: openAfterCreation === true
    }),
  chooseConnectionDraftSource: (storageId, language) =>
    ipcRenderer.invoke('connection:choose-draft-source', {
      storageId,
      language: language === 'ru' ? 'ru' : 'en'
    }),
  chooseConnectionDraftTargetParent: (storageId, language) =>
    ipcRenderer.invoke('connection:choose-draft-target-parent', {
      storageId,
      language: language === 'ru' ? 'ru' : 'en'
    }),
  previewConnectionDraft: (storageId, sourceSelectionId, targetSelectionId, name, id, linkName) =>
    ipcRenderer.invoke('connection:preview-draft', {
      storageId,
      sourceSelectionId,
      targetSelectionId,
      name,
      id,
      linkName
    }),
  prepareConnectionDraftWrite: (
    storageId,
    sourceSelectionId,
    targetSelectionId,
    name,
    id,
    linkName
  ) =>
    ipcRenderer.invoke('connection:prepare-draft-write', {
      storageId,
      sourceSelectionId,
      targetSelectionId,
      name,
      id,
      linkName
    }),
  confirmConnectionDraftWrite: (token) =>
    ipcRenderer.invoke('connection:confirm-draft-write', token),
  cancelConnectionDraftWrite: (token) => ipcRenderer.invoke('connection:cancel-draft-write', token),
  prepareConnectionApply: (storageId, connectionId) =>
    ipcRenderer.invoke('connection:prepare-apply', { storageId, connectionId }),
  confirmConnectionApply: (token) => ipcRenderer.invoke('connection:confirm-apply', token),
  cancelConnectionApply: (token) => ipcRenderer.invoke('connection:cancel-apply', token)
})

contextBridge.exposeInMainWorld('yonder', api)
