import { app, BrowserWindow, session } from 'electron'
import { fileURLToPath } from 'node:url'

let mainWindow
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
  })

  if (devUrl) mainWindow.loadURL(devUrl)
  else mainWindow.loadFile(fileURLToPath(new URL('../renderer/index.html', import.meta.url)))
}

app.whenReady().then(() => {
  app.setName('Yonder')
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
