import i18next from 'i18next'
import I18NextVue from 'i18next-vue'
import { parse } from 'yaml'
import { ref } from 'vue'
import { normalizeLanguagePreference, resolveLanguage, supportedLanguages } from './language.js'
import en from './locales/en.yaml?raw'
import ru from './locales/ru.yaml?raw'

const preferenceKey = 'yonder.language'
export const languagePreference = ref('system')
export const languageSaveFailed = ref(false)

function getSystemLanguages() {
  return window.yonder?.systemLanguages ?? navigator.languages
}

export async function changeLanguagePreference(value) {
  languagePreference.value = normalizeLanguagePreference(value)
  languageSaveFailed.value = false

  try {
    window.localStorage.setItem(preferenceKey, languagePreference.value)
  } catch {
    languageSaveFailed.value = true
  }

  await i18next.changeLanguage(resolveLanguage(languagePreference.value, getSystemLanguages()))
}

export async function installI18n(app) {
  try {
    languagePreference.value = normalizeLanguagePreference(
      window.localStorage.getItem(preferenceKey)
    )
  } catch {
    languagePreference.value = 'system'
  }

  await i18next.init({
    lng: resolveLanguage(languagePreference.value, getSystemLanguages()),
    fallbackLng: 'en',
    supportedLngs: supportedLanguages,
    resources: { en: { translation: parse(en) }, ru: { translation: parse(ru) } },
    interpolation: { escapeValue: false }
  })

  const syncLanguage = () => {
    document.documentElement.lang = i18next.resolvedLanguage
  }

  syncLanguage()
  i18next.on('languageChanged', syncLanguage)
  app.use(I18NextVue, { i18next })
}

export default i18next
