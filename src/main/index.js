import { randomUUID } from 'node:crypto'
import { app, BrowserWindow, dialog, ipcMain, session } from 'electron'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openApplyJournal } from './apply-journal.js'
import { ConnectionApplyError, createConnectionApplyController } from './connection-apply.js'
import {
  ConnectionAuthoringError,
  createConnectionAuthoringController
} from './connection-authoring.js'
import {
  ConnectionDisconnectError,
  createConnectionDisconnectController
} from './connection-disconnect.js'
import { ConnectionDraftError, createConnectionDraftController } from './connection-draft.js'
import { inspectStorage, StorageInspectionError } from './inspection.js'
import { createStorageConfig, inspectStorageDirectory, StorageCreationError } from './storage.js'
import { CONFIG_FILENAME } from '../shared/config.js'

let mainWindow
let pendingCreation
let activeStorage
let applyController
let draftController
let authoringController
let disconnectController
let pendingApplyStorageId = ''
let pendingDraftStorageId = ''
let pendingDisconnectStorageId = ''
const devUrl = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined
const nativeHelperPath = fileURLToPath(
  new URL('../../build/native/yonder-link-helper', import.meta.url)
)

app.setName('Yonder')
const ownsSingleInstance = app.requestSingleInstanceLock()
if (!ownsSingleInstance) app.quit()

if (devUrl) {
  const url = new URL(devUrl)
  const loopbackHosts = ['127.0.0.1', 'localhost', '[::1]']
  if (url.protocol !== 'http:' || !loopbackHosts.includes(url.hostname)) {
    throw new Error('Development renderer must use a loopback HTTP origin')
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    title: 'Yonder',
    width: 720,
    height: 520,
    minWidth: 600,
    minHeight: 520,
    backgroundColor: '#e5e9f0',
    show: false,
    webPreferences: {
      preload: fileURLToPath(new URL('../preload/index.cjs', import.meta.url)),
      additionalArguments: [
        '--yonder-system-languages=' + JSON.stringify(app.getPreferredSystemLanguages())
      ],
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false
    }
  })

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault())
  mainWindow.webContents.on('will-attach-webview', (event) => event.preventDefault())
  mainWindow.on('ready-to-show', () => mainWindow.show())
  mainWindow.on('closed', () => {
    applyController?.clear()
    draftController?.clear()
    authoringController?.clear()
    disconnectController?.clear()
    pendingApplyStorageId = ''
    pendingDraftStorageId = ''
    pendingDisconnectStorageId = ''
    mainWindow = undefined
    pendingCreation = undefined
    activeStorage = undefined
  })

  if (devUrl) mainWindow.loadURL(devUrl)
  else mainWindow.loadFile(fileURLToPath(new URL('../renderer/index.html', import.meta.url)))
}

function isTrustedIpcEvent(event) {
  return event.sender === mainWindow?.webContents && event.senderFrame === event.sender.mainFrame
}

async function clearPendingApply() {
  pendingApplyStorageId = ''
  await applyController?.clear()
}

async function clearPendingDisconnect() {
  pendingDisconnectStorageId = ''
  await disconnectController?.clear()
}

function clearPendingDraft() {
  pendingDraftStorageId = ''
  authoringController?.clear()
  draftController?.clear()
}

function clearPendingAuthoring() {
  pendingDraftStorageId = ''
  authoringController?.clear()
}

function installStorageHandlers() {
  ipcMain.handle('storage:choose-for-opening', async (event, language) => {
    if (!isTrustedIpcEvent(event)) return { status: 'unavailable' }
    await clearPendingApply()
    await clearPendingDisconnect()
    clearPendingDraft()

    const result = await dialog.showOpenDialog(mainWindow, {
      title: language === 'ru' ? 'Выберите хранилище Yonder' : 'Choose a Yonder storage',
      properties: ['openDirectory']
    })
    if (result.canceled || result.filePaths.length !== 1) return { status: 'cancelled' }

    try {
      const storage = await inspectStorage(result.filePaths[0], {
        homeDirectory: app.getPath('home'),
        systemPlatform: process.platform
      })
      activeStorage = { id: randomUUID(), folderPath: storage.folderPath }
      return { status: 'opened', storageId: activeStorage.id, storage }
    } catch (error) {
      return {
        status: error instanceof StorageInspectionError ? error.code : 'unavailable',
        folderPath: result.filePaths[0],
        configPath: join(result.filePaths[0], CONFIG_FILENAME)
      }
    }
  })

  ipcMain.handle('storage:recheck', async (event, storageId) => {
    if (!isTrustedIpcEvent(event)) return { status: 'unavailable' }
    await clearPendingApply()
    await clearPendingDisconnect()
    clearPendingDraft()
    if (typeof storageId !== 'string' || storageId !== activeStorage?.id) {
      return { status: 'invalidSelection' }
    }

    try {
      const storage = await inspectStorage(activeStorage.folderPath, {
        homeDirectory: app.getPath('home'),
        systemPlatform: process.platform
      })
      return { status: 'opened', storageId: activeStorage.id, storage }
    } catch (error) {
      return {
        status: error instanceof StorageInspectionError ? error.code : 'unavailable',
        folderPath: activeStorage.folderPath,
        configPath: join(activeStorage.folderPath, CONFIG_FILENAME)
      }
    }
  })

  ipcMain.handle('storage:choose-for-creation', async (event, language) => {
    if (!isTrustedIpcEvent(event)) return { status: 'unavailable' }
    await clearPendingApply()
    await clearPendingDisconnect()
    clearPendingDraft()
    pendingCreation = undefined

    const result = await dialog.showOpenDialog(mainWindow, {
      title:
        language === 'ru'
          ? 'Выберите папку для хранилища Yonder'
          : 'Choose a folder for the Yonder storage',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || result.filePaths.length !== 1) return { status: 'cancelled' }

    try {
      const preview = await inspectStorageDirectory(result.filePaths[0])
      if (preview.configExists) return { status: 'configExists', ...preview }

      pendingCreation = { id: randomUUID(), folderPath: preview.folderPath }
      return { status: 'ready', selectionId: pendingCreation.id, ...preview }
    } catch {
      return { status: 'unavailable' }
    }
  })

  ipcMain.handle('storage:create-config', async (event, request) => {
    if (!isTrustedIpcEvent(event)) return { status: 'unavailable' }
    await clearPendingApply()
    await clearPendingDisconnect()
    clearPendingDraft()
    if (
      !request ||
      typeof request.selectionId !== 'string' ||
      typeof request.name !== 'string' ||
      request.selectionId !== pendingCreation?.id
    ) {
      return { status: 'invalidSelection' }
    }

    try {
      const result = await createStorageConfig(pendingCreation.folderPath, request.name)
      pendingCreation = undefined
      activeStorage = undefined
      const created = {
        status: 'created',
        folderPath: result.folderPath,
        configPath: result.configPath,
        name: result.name
      }

      if (request.openAfterCreation !== true) return created

      try {
        const storage = await inspectStorage(result.folderPath, {
          homeDirectory: app.getPath('home'),
          systemPlatform: process.platform
        })
        activeStorage = { id: randomUUID(), folderPath: storage.folderPath }
        return { ...created, storageId: activeStorage.id, storage }
      } catch {
        return { ...created, openingFailed: true }
      }
    } catch (error) {
      if (error instanceof StorageCreationError && error.code === 'invalidName') {
        return { status: 'invalidName' }
      }
      pendingCreation = undefined
      if (error instanceof StorageCreationError && error.code === 'configExists') {
        return { status: 'configExists' }
      }
      return { status: 'unavailable' }
    }
  })

  ipcMain.handle('connection:choose-draft-source', async (event, request) => {
    if (!isTrustedIpcEvent(event) || !draftController) return { status: 'unavailable' }
    clearPendingAuthoring()
    if (
      !request ||
      Object.keys(request).length !== 2 ||
      typeof request.storageId !== 'string' ||
      typeof request.language !== 'string' ||
      request.storageId !== activeStorage?.id
    ) {
      return { status: 'invalidSelection' }
    }

    const draftStorage = { ...activeStorage }

    const result = await dialog.showOpenDialog(mainWindow, {
      title:
        request.language === 'ru'
          ? 'Выберите источник внутри хранилища'
          : 'Choose a source inside the storage',
      defaultPath: draftStorage.folderPath,
      properties: ['openFile', 'openDirectory']
    })
    if (result.canceled || result.filePaths.length !== 1) return { status: 'cancelled' }
    if (activeStorage?.id !== draftStorage.id) return { status: 'invalidSelection' }

    try {
      return await draftController.selectSource(draftStorage.folderPath, result.filePaths[0])
    } catch (error) {
      return { status: error instanceof ConnectionDraftError ? error.code : 'unavailable' }
    }
  })

  ipcMain.handle('connection:choose-draft-target-parent', async (event, request) => {
    if (!isTrustedIpcEvent(event) || !draftController) return { status: 'unavailable' }
    clearPendingAuthoring()
    if (
      !request ||
      Object.keys(request).length !== 2 ||
      typeof request.storageId !== 'string' ||
      typeof request.language !== 'string' ||
      request.storageId !== activeStorage?.id
    ) {
      return { status: 'invalidSelection' }
    }

    const draftStorage = { ...activeStorage }

    const result = await dialog.showOpenDialog(mainWindow, {
      title:
        request.language === 'ru'
          ? 'Выберите существующую папку назначения'
          : 'Choose an existing destination folder',
      defaultPath: app.getPath('home'),
      properties: ['openDirectory']
    })
    if (result.canceled || result.filePaths.length !== 1) return { status: 'cancelled' }
    if (activeStorage?.id !== draftStorage.id) return { status: 'invalidSelection' }

    try {
      return await draftController.selectTargetParent(draftStorage.folderPath, result.filePaths[0])
    } catch (error) {
      return { status: error instanceof ConnectionDraftError ? error.code : 'unavailable' }
    }
  })

  ipcMain.handle('connection:preview-draft', async (event, request) => {
    if (!isTrustedIpcEvent(event) || !draftController) return { status: 'unavailable' }
    clearPendingAuthoring()
    if (
      !request ||
      Object.keys(request).length !== 6 ||
      typeof request.storageId !== 'string' ||
      request.storageId !== activeStorage?.id
    ) {
      return { status: 'invalidSelection' }
    }

    const draftStorage = { ...activeStorage }
    try {
      const result = await draftController.preview(draftStorage.folderPath, {
        sourceSelectionId: request.sourceSelectionId,
        targetSelectionId: request.targetSelectionId,
        name: request.name,
        id: request.id,
        linkName: request.linkName
      })
      if (activeStorage?.id !== draftStorage.id) return { status: 'invalidSelection' }
      return result
    } catch (error) {
      return { status: error instanceof ConnectionDraftError ? error.code : 'unavailable' }
    }
  })

  ipcMain.handle('connection:prepare-draft-write', async (event, request) => {
    if (!isTrustedIpcEvent(event) || !authoringController) return { status: 'unavailable' }
    if (
      !request ||
      Object.keys(request).length !== 6 ||
      typeof request.storageId !== 'string' ||
      request.storageId !== activeStorage?.id
    ) {
      return { status: 'invalidSelection' }
    }

    await clearPendingApply()
    await clearPendingDisconnect()
    if (request.storageId !== activeStorage?.id) return { status: 'invalidSelection' }

    const draftStorage = { ...activeStorage }
    try {
      const result = await authoringController.prepare(draftStorage.folderPath, {
        sourceSelectionId: request.sourceSelectionId,
        targetSelectionId: request.targetSelectionId,
        name: request.name,
        id: request.id,
        linkName: request.linkName
      })
      if (activeStorage?.id !== draftStorage.id) {
        clearPendingAuthoring()
        return { status: 'invalidSelection' }
      }
      pendingDraftStorageId = draftStorage.id
      return result
    } catch (error) {
      pendingDraftStorageId = ''
      return {
        status: error instanceof ConnectionAuthoringError ? error.code : 'unavailable'
      }
    }
  })

  ipcMain.handle('connection:confirm-draft-write', async (event, token) => {
    if (!isTrustedIpcEvent(event) || !authoringController) return { status: 'unavailable' }
    if (!activeStorage || pendingDraftStorageId !== activeStorage.id) {
      return { status: 'invalidSelection' }
    }

    const draftStorage = { ...activeStorage }
    pendingDraftStorageId = ''
    try {
      const result = await authoringController.confirm(token)
      draftController?.clear()
      if (activeStorage?.id !== draftStorage.id || result.connectionId === undefined) {
        return { status: 'created', refreshFailed: true }
      }
      try {
        const storage = await inspectStorage(draftStorage.folderPath, {
          homeDirectory: app.getPath('home'),
          systemPlatform: process.platform
        })
        return { status: 'created', storageId: draftStorage.id, storage }
      } catch {
        return { status: 'created', refreshFailed: true }
      }
    } catch (error) {
      return {
        status: error instanceof ConnectionAuthoringError ? error.code : 'unavailable'
      }
    }
  })

  ipcMain.handle('connection:cancel-draft-write', async (event, token) => {
    if (!isTrustedIpcEvent(event) || !authoringController) return { status: 'unavailable' }
    pendingDraftStorageId = ''
    try {
      return await authoringController.cancel(token)
    } catch (error) {
      return {
        status: error instanceof ConnectionAuthoringError ? error.code : 'unavailable'
      }
    }
  })

  ipcMain.handle('connection:prepare-apply', async (event, request) => {
    if (!isTrustedIpcEvent(event) || !applyController) return { status: 'unavailable' }
    if (
      !request ||
      Object.keys(request).length !== 2 ||
      typeof request.storageId !== 'string' ||
      typeof request.connectionId !== 'string' ||
      request.storageId !== activeStorage?.id
    ) {
      return { status: 'invalidSelection' }
    }

    clearPendingAuthoring()
    await clearPendingDisconnect()
    if (request.storageId !== activeStorage?.id) return { status: 'invalidSelection' }

    const applyStorage = { ...activeStorage }
    try {
      const result = await applyController.prepare(
        applyStorage.folderPath,
        request.connectionId,
        app.getPath('home')
      )
      if (activeStorage?.id !== applyStorage.id) {
        await clearPendingApply()
        return { status: 'invalidSelection' }
      }
      pendingApplyStorageId = applyStorage.id
      return result
    } catch (error) {
      pendingApplyStorageId = ''
      return {
        status: error instanceof ConnectionApplyError ? error.code : 'unavailable',
        recovery: error instanceof ConnectionApplyError ? error.recovery : null
      }
    }
  })

  ipcMain.handle('connection:confirm-apply', async (event, token) => {
    if (!isTrustedIpcEvent(event) || !applyController) return { status: 'unavailable' }
    if (!activeStorage || pendingApplyStorageId !== activeStorage.id) {
      return { status: 'invalidSelection' }
    }
    const applyStorage = { ...activeStorage }
    pendingApplyStorageId = ''
    try {
      const result = await applyController.confirm(token)
      if (activeStorage?.id !== applyStorage.id || result.connectionId === undefined) {
        return { status: 'connected', refreshFailed: true }
      }
      try {
        const storage = await inspectStorage(applyStorage.folderPath, {
          homeDirectory: app.getPath('home'),
          systemPlatform: process.platform
        })
        return { status: 'connected', storageId: applyStorage.id, storage }
      } catch {
        return { status: 'connected', refreshFailed: true }
      }
    } catch (error) {
      return {
        status: error instanceof ConnectionApplyError ? error.code : 'unavailable',
        recovery: error instanceof ConnectionApplyError ? error.recovery : null
      }
    }
  })

  ipcMain.handle('connection:cancel-apply', async (event, token) => {
    if (!isTrustedIpcEvent(event) || !applyController) return { status: 'unavailable' }
    pendingApplyStorageId = ''
    try {
      return await applyController.cancel(token)
    } catch (error) {
      return { status: error instanceof ConnectionApplyError ? error.code : 'unavailable' }
    }
  })

  ipcMain.handle('connection:prepare-disconnect', async (event, request) => {
    if (!isTrustedIpcEvent(event) || !disconnectController) return { status: 'unavailable' }
    if (
      !request ||
      Object.keys(request).length !== 2 ||
      typeof request.storageId !== 'string' ||
      typeof request.connectionId !== 'string' ||
      request.storageId !== activeStorage?.id
    ) {
      return { status: 'invalidSelection' }
    }

    clearPendingAuthoring()
    await clearPendingApply()
    if (request.storageId !== activeStorage?.id) return { status: 'invalidSelection' }
    const disconnectStorage = { ...activeStorage }
    try {
      const result = await disconnectController.prepare(
        disconnectStorage.folderPath,
        request.connectionId,
        app.getPath('home')
      )
      if (activeStorage?.id !== disconnectStorage.id) {
        await clearPendingDisconnect()
        return { status: 'invalidSelection' }
      }
      pendingDisconnectStorageId = disconnectStorage.id
      return result
    } catch (error) {
      pendingDisconnectStorageId = ''
      return {
        status: error instanceof ConnectionDisconnectError ? error.code : 'unavailable'
      }
    }
  })

  ipcMain.handle('connection:confirm-disconnect', async (event, token) => {
    if (!isTrustedIpcEvent(event) || !disconnectController) return { status: 'unavailable' }
    if (!activeStorage || pendingDisconnectStorageId !== activeStorage.id) {
      return { status: 'invalidSelection' }
    }

    const disconnectStorage = { ...activeStorage }
    pendingDisconnectStorageId = ''
    try {
      const result = await disconnectController.confirm(token)
      if (activeStorage?.id !== disconnectStorage.id || result.connectionId === undefined) {
        return { status: 'disconnected', refreshFailed: true }
      }
      try {
        const storage = await inspectStorage(disconnectStorage.folderPath, {
          homeDirectory: app.getPath('home'),
          systemPlatform: process.platform
        })
        return { status: 'disconnected', storageId: disconnectStorage.id, storage }
      } catch {
        return { status: 'disconnected', refreshFailed: true }
      }
    } catch (error) {
      return {
        status: error instanceof ConnectionDisconnectError ? error.code : 'unavailable'
      }
    }
  })

  ipcMain.handle('connection:cancel-disconnect', async (event, token) => {
    if (!isTrustedIpcEvent(event) || !disconnectController) return { status: 'unavailable' }
    pendingDisconnectStorageId = ''
    try {
      return await disconnectController.cancel(token)
    } catch (error) {
      return {
        status: error instanceof ConnectionDisconnectError ? error.code : 'unavailable'
      }
    }
  })
}

app.whenReady().then(async () => {
  if (!ownsSingleInstance) return
  draftController = createConnectionDraftController({
    homeDirectory: app.getPath('home')
  })
  authoringController = createConnectionAuthoringController({
    previewDraft: (storagePath, request) => draftController.preview(storagePath, request)
  })
  disconnectController = createConnectionDisconnectController({ executable: nativeHelperPath })
  try {
    const journal = await openApplyJournal(join(app.getPath('userData'), 'operation-journal'))
    applyController = createConnectionApplyController({
      executable: nativeHelperPath,
      journal
    })
  } catch {
    applyController = undefined
  }
  installStorageHandlers()
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false)
  })
  session.defaultSession.setPermissionCheckHandler(() => false)

  const origin = devUrl ? new URL(devUrl).origin : ''
  const socket = origin.replace(/^http/, 'ws')
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self' ${origin} ${socket}`.trim(),
    "object-src 'none'",
    "frame-src 'none'",
    "base-uri 'none'",
    "form-action 'none'"
  ].join('; ')

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] }
    })
  })

  createWindow()
  app.on('second-instance', () => {
    if (!mainWindow) createWindow()
    else {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
