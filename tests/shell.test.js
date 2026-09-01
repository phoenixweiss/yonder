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

test('opening a newly created storage is an explicit opt-in', async () => {
  const appSource = await readFile(new URL('../src/renderer/src/App.vue', import.meta.url), 'utf8')

  assert.match(appSource, /const openAfterCreation = ref\(false\)/)
  assert.match(appSource, /v-model="openAfterCreation"[\s\S]*?type="checkbox"/)
  assert.match(appSource, /createStorageConfig\([\s\S]*?openAfterCreation\.value/)
})

test('connection apply exposes only selection ids and one-time confirmation tokens', async () => {
  const [appSource, preloadSource, mainSource] = await Promise.all([
    readFile(new URL('../src/renderer/src/App.vue', import.meta.url), 'utf8'),
    readFile(new URL('../src/preload/index.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/main/index.js', import.meta.url), 'utf8')
  ])

  assert.match(appSource, /showConnectionPreview/)
  assert.match(appSource, /preview\.note/)
  assert.match(appSource, /prepareConnectionApply\([\s\S]*?storageId\.value[\s\S]*?connection\.id/)
  assert.match(appSource, /confirmConnectionApply\(token\)/)
  assert.match(preloadSource, /connection:prepare-apply/)
  assert.match(preloadSource, /connection:confirm-apply/)
  assert.match(preloadSource, /connection:cancel-apply/)
  assert.doesNotMatch(preloadSource, /sourcePath|targetPath|createLink/)
  assert.match(mainSource, /request\.storageId !== activeStorage\?\.id/)
  assert.match(mainSource, /const applyStorage = \{ \.\.\.activeStorage \}/)
  assert.match(mainSource, /applyController\.prepare\([\s\S]*?applyStorage\.folderPath/)
  assert.match(mainSource, /requestSingleInstanceLock/)
})

test('connection authoring separates preview from a one-time configuration confirmation', async () => {
  const [appSource, preloadSource, mainSource] = await Promise.all([
    readFile(new URL('../src/renderer/src/App.vue', import.meta.url), 'utf8'),
    readFile(new URL('../src/preload/index.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/main/index.js', import.meta.url), 'utf8')
  ])

  assert.match(appSource, /showConnectionDraft/)
  assert.match(appSource, /connectionDraft\.readOnlyNote/)
  assert.match(appSource, /connectionDraft\.previewNote/)
  assert.match(appSource, /prepareConnectionDraftWrite\(/)
  assert.match(appSource, /confirmConnectionDraftWrite\(token\)/)
  assert.match(preloadSource, /connection:choose-draft-source/)
  assert.match(preloadSource, /connection:choose-draft-target-parent/)
  assert.match(preloadSource, /connection:preview-draft/)
  assert.match(preloadSource, /connection:prepare-draft-write/)
  assert.match(preloadSource, /connection:confirm-draft-write/)
  assert.match(preloadSource, /connection:cancel-draft-write/)
  assert.doesNotMatch(preloadSource, /writeFile|rename|sourcePath|targetPath/)
  assert.match(mainSource, /draftController\.selectSource\(draftStorage\.folderPath/)
  assert.match(mainSource, /draftController\.selectTargetParent/)
  assert.match(mainSource, /draftController\.preview\(draftStorage\.folderPath/)
  assert.match(mainSource, /authoringController\.prepare\(draftStorage\.folderPath/)
  assert.match(mainSource, /authoringController\.confirm\(token\)/)
})

test('connection disconnect exposes only identifiers and one-time confirmation tokens', async () => {
  const [appSource, preloadSource, mainSource] = await Promise.all([
    readFile(new URL('../src/renderer/src/App.vue', import.meta.url), 'utf8'),
    readFile(new URL('../src/preload/index.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/main/index.js', import.meta.url), 'utf8')
  ])

  assert.match(appSource, /showConnectionDisconnect\(connection\)/)
  assert.match(appSource, /prepareConnectionDisconnect\([\s\S]*?storageId\.value/)
  assert.match(appSource, /confirmConnectionDisconnect\(token\)/)
  assert.match(preloadSource, /connection:prepare-disconnect/)
  assert.match(preloadSource, /connection:confirm-disconnect/)
  assert.match(preloadSource, /connection:cancel-disconnect/)
  assert.doesNotMatch(preloadSource, /unlink|removeLink|sourcePath|targetPath/)
  assert.match(mainSource, /disconnectController\.prepare\([\s\S]*?disconnectStorage\.folderPath/)
  assert.match(mainSource, /disconnectController\.confirm\(token\)/)
})
