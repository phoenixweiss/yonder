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

test('the approved identity is wired into the current application surfaces', async () => {
  const [mainSource, htmlSource, appSource, iconPng, iconIcns] = await Promise.all([
    readFile(new URL('../src/main/index.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/renderer/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../src/renderer/src/App.vue', import.meta.url), 'utf8'),
    readFile(new URL('../resources/icon.png', import.meta.url)),
    readFile(new URL('../resources/icon.icns', import.meta.url))
  ])

  assert.match(mainSource, /developmentAppIconPath/)
  assert.match(mainSource, /app\.dock\.setIcon\(developmentAppIconPath\)/)
  assert.match(htmlSource, /href="\/favicon\.png"/)
  assert.match(appSource, /yonder-lockup\.svg/)
  assert.equal(iconPng.subarray(1, 4).toString(), 'PNG')
  assert.equal(iconPng.readUInt32BE(16), 1024)
  assert.equal(iconPng.readUInt32BE(20), 1024)
  assert.equal(iconPng[25], 6)
  assert.equal(iconIcns.subarray(0, 4).toString(), 'icns')
})

test('the ad-hoc signed macOS package keeps the native helper outside ASAR', async () => {
  const [builderSource, packageSource, mainSource] = await Promise.all([
    readFile(new URL('../electron-builder.yml', import.meta.url), 'utf8'),
    readFile(new URL('../package.json', import.meta.url), 'utf8'),
    readFile(new URL('../src/main/index.js', import.meta.url), 'utf8')
  ])
  const builder = parse(builderSource)
  const manifest = JSON.parse(packageSource)
  const nativeHelper = builder.extraResources.find(
    ({ from, to }) =>
      from === 'build/native/yonder-link-helper' && to === 'native/yonder-link-helper'
  )

  assert.equal(builder.appId, 'io.github.phoenixweiss.yonder')
  assert.equal(builder.productName, 'Yonder')
  assert.deepEqual(builder.mac.target, ['dmg', 'zip'])
  assert.equal(builder.mac.icon, 'resources/icon.icns')
  assert.equal(builder.mac.identity, '-')
  assert.equal(builder.mac.hardenedRuntime, false)
  assert.deepEqual(builder.electronLanguages, ['en-US', 'ru'])
  assert.equal(builder.dmg.background, 'resources/dmg-background.tiff')
  assert.deepEqual(builder.dmg.window, { width: 540, height: 380 })
  assert.deepEqual(builder.dmg.contents, [
    { x: 130, y: 128, type: 'file' },
    { x: 410, y: 128, type: 'link', path: '/Applications' }
  ])
  assert.ok(nativeHelper)
  assert.equal(builder.publish, undefined)
  assert.equal(manifest.devDependencies['electron-builder'], '26.15.3')
  assert.deepEqual(Object.keys(manifest.dependencies), ['yaml'])
  for (const dependency of ['i18next', 'i18next-vue', 'vue']) {
    assert.equal(typeof manifest.devDependencies[dependency], 'string')
  }
  assert.match(manifest.scripts['package:mac:dir'], /electron-builder --mac dir/)
  assert.match(manifest.scripts['package:mac'], /electron-builder --mac --config/)
  assert.match(manifest.scripts['package:mac'], /--publish never/)
  assert.match(mainSource, /app\.isPackaged[\s\S]*?process\.resourcesPath[\s\S]*?native/)
})

test('tagged macOS releases build and publish only verified Apple silicon artifacts', async () => {
  const workflowSource = await readFile(
    new URL('../.github/workflows/release-macos.yml', import.meta.url),
    'utf8'
  )
  const workflow = parse(workflowSource)
  const releaseJob = workflow.jobs.release
  const actionRefs = releaseJob.steps.filter(({ uses }) => uses).map(({ uses }) => uses)
  const runSource = releaseJob.steps
    .filter(({ run }) => run)
    .map(({ run }) => run)
    .join('\n')

  assert.deepEqual(workflow.on.push.tags, ['v*.*.*'])
  assert.deepEqual(workflow.permissions, {})
  assert.equal(workflow.concurrency['cancel-in-progress'], false)
  assert.equal(releaseJob['runs-on'], 'macos-15')
  assert.deepEqual(releaseJob.permissions, { contents: 'write' })
  assert.deepEqual(actionRefs, [
    'actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803',
    'actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38'
  ])
  assert.match(runSource, /yarn install --frozen-lockfile/)
  assert.match(runSource, /version_file[\s\S]*?package_version/)
  assert.match(runSource, /GITHUB_REF_NAME[\s\S]*?package_version/)
  assert.match(runSource, /uname -m[\s\S]*?arm64/)
  assert.match(runSource, /yarn quality/)
  assert.match(runSource, /yarn package:mac/)
  assert.match(runSource, /codesign --verify --deep --strict/)
  assert.match(runSource, /hdiutil verify/)
  assert.match(runSource, /unzip -t/)
  assert.match(runSource, /shasum -a 256 -c SHA256SUMS\.txt/)
  assert.match(runSource, /gh release create[\s\S]*?--draft[\s\S]*?--prerelease/)
  assert.match(runSource, /remote_digest[\s\S]*?local_digest/)
  assert.match(runSource, /gh release edit[\s\S]*?--draft=false/)
  assert.match(workflowSource, /GH_TOKEN: \$\{\{ github\.token \}\}/)
  assert.doesNotMatch(workflowSource, /pull_request_target|workflow_dispatch|--clobber/)
})

test('Bumpster coordinates version, changelog, and quality checks', async () => {
  const [version, manifestSource, config, hook] = await Promise.all([
    readFile(new URL('../VERSION', import.meta.url), 'utf8'),
    readFile(new URL('../package.json', import.meta.url), 'utf8'),
    readFile(new URL('../.bumpsterrc', import.meta.url), 'utf8'),
    readFile(new URL('../.bumpster/hooks/pre-bump', import.meta.url), 'utf8')
  ])
  const manifest = JSON.parse(manifestSource)

  assert.equal(version.trim(), manifest.version)
  assert.match(config, /GIT_MASTER_BRANCH="main"/)
  assert.match(config, /GIT_DEVELOP_BRANCH="dev"/)
  assert.match(config, /SYNC_WITH_PACKAGE_JSON="true"/)
  assert.match(config, /BEFORE_BUMP_BRANCH="dev"/)
  assert.match(config, /AFTER_BUMP_BRANCH="dev"/)
  assert.match(hook, /corepack yarn quality/)
  assert.match(hook, /prepare-release-changelog\.mjs/)
  assert.match(hook, /git add CHANGELOG\.md README\.md README_RU\.md/)
})

test('public project materials foreground the external synchronization boundary', async () => {
  const [readme, readmeRu, workflow] = await Promise.all([
    readFile(new URL('../README.md', import.meta.url), 'utf8'),
    readFile(new URL('../README_RU.md', import.meta.url), 'utf8'),
    readFile(new URL('../.github/workflows/release-macos.yml', import.meta.url), 'utf8')
  ])
  const canonicalStatement =
    'Yonder does not provide its own synchronization service. Files remain in an ordinary folder, and synchronization is left to an external cloud client.'

  assert.match(readme, /> \*\*Yonder does not provide its own synchronization service\./)
  assert.match(readmeRu, /> \*\*Yonder не предоставляет собственный сервис синхронизации\./)
  assert.ok(workflow.includes(`**${canonicalStatement}**`))
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

test('the connection dashboard presents one primary state and keeps removal optional', async () => {
  const [appSource, enSource, ruSource] = await Promise.all([
    readFile(new URL('../src/renderer/src/App.vue', import.meta.url), 'utf8'),
    readFile(new URL('../src/renderer/src/locales/en.yaml', import.meta.url), 'utf8'),
    readFile(new URL('../src/renderer/src/locales/ru.yaml', import.meta.url), 'utf8')
  ])

  assert.match(
    appSource,
    /v-if="connection\.state === 'connected'"[\s\S]*?inspection\.connectedReady/
  )
  assert.match(appSource, /v-else-if="connectionPreview\(connection\)"/)
  assert.doesNotMatch(appSource, /preview\.nextStep|disconnect\.available/)
  assert.match(enSource, /source: Source\n {2}target: Destination/)
  assert.match(ruSource, /source: Источник\n {2}target: Назначение/)
  assert.match(enSource, /open: Connect…/)
  assert.match(ruSource, /open: Подключить…/)
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

test('connection removal exposes only identifiers and one-time confirmation tokens', async () => {
  const [appSource, preloadSource, mainSource] = await Promise.all([
    readFile(new URL('../src/renderer/src/App.vue', import.meta.url), 'utf8'),
    readFile(new URL('../src/preload/index.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/main/index.js', import.meta.url), 'utf8')
  ])

  assert.match(appSource, /showConnectionRemoval\(connection\)/)
  assert.match(appSource, /prepareConnectionRemoval\([\s\S]*?storageId\.value/)
  assert.match(appSource, /confirmConnectionRemoval\(token\)/)
  assert.match(preloadSource, /connection:prepare-removal/)
  assert.match(preloadSource, /connection:confirm-removal/)
  assert.match(preloadSource, /connection:cancel-removal/)
  assert.doesNotMatch(preloadSource, /configPath|sourcePath|targetPath|resultingSource/)
  assert.match(mainSource, /removalController\.prepare\([\s\S]*?removalStorage\.folderPath/)
  assert.match(mainSource, /removalController\.confirm\(token\)/)
})
