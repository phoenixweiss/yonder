import assert from 'node:assert/strict'
import test from 'node:test'
import { prepareChangelog } from '../scripts/prepare-release-changelog.mjs'

const repositoryUrl = 'https://github.com/example/yonder'

function fixture(notes = '### Changed\n\n- Clearer connection flow.') {
  return `# Changelog

## [Unreleased]

${notes}

## [0.1.2] - 2026-09-02

### Added

- First preview.

[Unreleased]: ${repositoryUrl}/compare/v0.1.2...HEAD
[0.1.2]: ${repositoryUrl}/releases/tag/v0.1.2
`
}

test('prepares one dated release while preserving an empty Unreleased section', () => {
  const result = prepareChangelog(fixture(), {
    previousVersion: '0.1.2',
    nextVersion: '0.1.3',
    releaseDate: '2026-09-03',
    repositoryUrl
  })

  assert.match(result, /## \[Unreleased\]\n\n## \[0\.1\.3\] - 2026-09-03\n\n### Changed/)
  assert.match(result, /\[Unreleased\]: .*\/compare\/v0\.1\.3\.\.\.HEAD/)
  assert.match(result, /\[0\.1\.3\]: .*\/compare\/v0\.1\.2\.\.\.v0\.1\.3/)
  assert.equal(result.match(/Clearer connection flow\./g)?.length, 1)
})

test('rejects empty notes and stale comparison metadata', () => {
  const options = {
    previousVersion: '0.1.2',
    nextVersion: '0.1.3',
    releaseDate: '2026-09-03',
    repositoryUrl
  }

  assert.throws(() => prepareChangelog(fixture(''), options), /categorized release notes/)
  assert.throws(
    () => prepareChangelog(fixture().replace('v0.1.2...HEAD', 'v0.1.1...HEAD'), options),
    /comparison link/
  )
})
