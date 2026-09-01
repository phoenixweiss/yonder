import { randomUUID } from 'node:crypto'
import { app, BrowserWindow, dialog, ipcMain, session } from 'electron'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inspectStorage, StorageInspectionError } from './inspection.js'
import { createStorageConfig, inspectStorageDirectory, StorageCreationError } from './storage.js'
import { CONFIG_FILENAME } from '../shared/config.js'

let mainWindow
let pendingCreation
let activeStorage
const devUrl = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined

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

function installStorageHandlers() {
  ipcMain.handle('storage:choose-for-opening', async (event, language) => {
    if (!isTrustedIpcEvent(event)) return { status: 'unavailable' }

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
}

app.whenReady().then(() => {
  app.setName('Yonder')
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
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
