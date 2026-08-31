import './assets/main.scss'

import { createApp } from 'vue'
import App from './App.vue'
import { installI18n } from './i18n.js'

const app = createApp(App)
await installI18n(app)
app.mount('#app')
