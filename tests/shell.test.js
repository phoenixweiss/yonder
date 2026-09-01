import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { parse } from 'yaml'
import { normalizeLanguagePreference, resolveLanguage } from '../src/renderer/src/language.js'

function collectLeafPaths(value, prefix = '') {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return [prefix]
  return Object.keys(value)
    .sort()
    .flatMap((key) => collectLeafPaths(value[key], prefix ? `${prefix}.${key}` : key))
}

function collectLeafValues(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return [value]
  return Object.values(value).flatMap(collectLeafValues)
}

test('English and Russian interface resources have the same complete structure', async () => {
  const translations = await Promise.all(
    ['en', 'ru'].map(async (language) => {
      const source = await readFile(
        new URL(`../src/renderer/src/locales/${language}.yaml`, import.meta.url),
        'utf8'
      )
      return [language, parse(source)]
    })
  )

  const [canonicalLanguage, canonicalTranslation] = translations[0]
  const canonicalPaths = collectLeafPaths(canonicalTranslation)

  for (const [language, translation] of translations) {
    assert.deepEqual(
      collectLeafPaths(translation),
      canonicalPaths,
      `${language}.yaml must match ${canonicalLanguage}.yaml`
    )
    for (const value of collectLeafValues(translation)) {
      assert.equal(typeof value, 'string')
      assert.ok(value.trim())
    }
  }
})

test('language detection respects preferences, system order and regional variants', () => {
  for (const [locales, expected] of [
    [['ru-RU', 'en-US'], 'ru'],
    [['en-GB', 'ru-RU'], 'en'],
    [['fr-CA', 'ru-KZ'], 'ru'],
    [['RU_ru.UTF-8'], 'ru'],
    [['de-DE', 'fr-FR'], 'en'],
    [[], 'en'],
    [undefined, 'en'],
    [[null, 1, 'ru'], 'ru']
  ]) {
    assert.equal(resolveLanguage('system', locales), expected)
  }
})

test('explicit language choices override the system and invalid preferences use system mode', () => {
  assert.equal(resolveLanguage('en', ['ru-RU']), 'en')
  assert.equal(resolveLanguage('ru', ['en-US']), 'ru')

  for (const value of [null, undefined, '', 'system', 'de', '{}']) {
    assert.equal(normalizeLanguagePreference(value), 'system')
  }
  for (const value of ['en', 'ru']) {
    assert.equal(normalizeLanguagePreference(value), value)
  }
})

test('the minimal renderer has no UI framework, router or global store dependency', async () => {
  const packageSource = await readFile(new URL('../package.json', import.meta.url), 'utf8')
  const manifest = JSON.parse(packageSource)
  const dependencies = { ...manifest.dependencies, ...manifest.devDependencies }

  for (const dependency of ['@picocss/pico', 'pinia', 'vue-router']) {
    assert.equal(dependencies[dependency], undefined)
  }
})
