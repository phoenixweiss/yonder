import { contextBridge } from 'electron'

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

// Expose language data only. Filesystem capabilities arrive in later, reviewed steps.
contextBridge.exposeInMainWorld('yonder', { systemLanguages })
