import Vue from '@vitejs/plugin-vue'
import { defineConfig } from 'electron-vite'

export default defineConfig({
  main: {},
  preload: {
    build: {
      rollupOptions: { output: { format: 'cjs', entryFileNames: 'index.cjs' } }
    }
  },
  renderer: {
    plugins: [Vue()],
    server: { host: '127.0.0.1' }
  }
})
