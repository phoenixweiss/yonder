export const supportedLanguages = ['en', 'ru']

export function normalizeLanguagePreference(value) {
  return supportedLanguages.includes(value) ? value : 'system'
}

export function resolveLanguage(preference, systemLanguages) {
  if (supportedLanguages.includes(preference)) return preference

  for (const locale of Array.isArray(systemLanguages) ? systemLanguages : []) {
    if (typeof locale !== 'string') continue
    const language = locale.toLowerCase().split(/[-_.@]/)[0]
    if (supportedLanguages.includes(language)) return language
  }

  return 'en'
}
