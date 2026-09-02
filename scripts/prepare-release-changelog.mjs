import { readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const REPOSITORY_URL = 'https://github.com/phoenixweiss/yonder'

function requireValue(value, pattern, name) {
  if (!pattern.test(value)) throw new Error(`${name} is invalid.`)
}

function occurrences(text, value) {
  return text.split(value).length - 1
}

export function localReleaseDate(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function prepareReadme(
  readme,
  { previousVersion, nextVersion, repositoryUrl = REPOSITORY_URL }
) {
  requireValue(previousVersion, VERSION_PATTERN, 'Previous version')
  requireValue(nextVersion, VERSION_PATTERN, 'Next version')
  const previousLink = `[Yonder ${previousVersion}](${repositoryUrl}/releases/tag/v${previousVersion})`
  if (occurrences(readme, previousLink) !== 1) {
    throw new Error('README current-release link does not match the current version.')
  }
  return readme.replace(
    previousLink,
    `[Yonder ${nextVersion}](${repositoryUrl}/releases/tag/v${nextVersion})`
  )
}

export function prepareChangelog(
  changelog,
  { previousVersion, nextVersion, releaseDate, repositoryUrl = REPOSITORY_URL }
) {
  requireValue(previousVersion, VERSION_PATTERN, 'Previous version')
  requireValue(nextVersion, VERSION_PATTERN, 'Next version')
  requireValue(releaseDate, DATE_PATTERN, 'Release date')
  if (previousVersion === nextVersion) throw new Error('Release version did not change.')

  const unreleasedHeader = '## [Unreleased]'
  if (occurrences(changelog, unreleasedHeader) !== 1) {
    throw new Error('Changelog must contain exactly one Unreleased section.')
  }
  if (changelog.includes(`## [${nextVersion}]`)) {
    throw new Error(`Changelog already contains release ${nextVersion}.`)
  }

  const headerStart = changelog.indexOf(unreleasedHeader)
  const notesStart = headerStart + unreleasedHeader.length
  const nextSection = changelog.indexOf('\n## [', notesStart)
  if (nextSection < 0) throw new Error('Changelog has no release after Unreleased.')
  const pendingNotes = changelog.slice(notesStart, nextSection).trim()
  if (!/^### (Added|Changed|Deprecated|Removed|Fixed|Security)$/m.test(pendingNotes)) {
    throw new Error('Unreleased must contain categorized release notes.')
  }

  const comparison = `[Unreleased]: ${repositoryUrl}/compare/v${previousVersion}...HEAD`
  if (occurrences(changelog, comparison) !== 1) {
    throw new Error('Unreleased comparison link does not match the current version.')
  }

  return changelog
    .replace(unreleasedHeader, `${unreleasedHeader}\n\n## [${nextVersion}] - ${releaseDate}`)
    .replace(
      comparison,
      `[Unreleased]: ${repositoryUrl}/compare/v${nextVersion}...HEAD\n` +
        `[${nextVersion}]: ${repositoryUrl}/compare/v${previousVersion}...v${nextVersion}`
    )
}

async function main() {
  const previousVersion = process.env.BUMPSTER_PREV_VERSION ?? ''
  const nextVersion = process.env.BUMPSTER_NEW_VERSION ?? ''
  const releaseDate = process.env.BUMPSTER_RELEASE_DATE ?? localReleaseDate()
  const projectRoot = process.cwd()
  const versionFile = path.join(projectRoot, 'VERSION')
  const packageFile = path.join(projectRoot, 'package.json')
  const changelogFile = path.join(projectRoot, 'CHANGELOG.md')
  const readmeFile = path.join(projectRoot, 'README.md')
  const readmeRuFile = path.join(projectRoot, 'README_RU.md')

  const [version, packageText, changelog, readme, readmeRu, ...details] = await Promise.all([
    readFile(versionFile, 'utf8'),
    readFile(packageFile, 'utf8'),
    readFile(changelogFile, 'utf8'),
    readFile(readmeFile, 'utf8'),
    readFile(readmeRuFile, 'utf8'),
    stat(changelogFile),
    stat(readmeFile),
    stat(readmeRuFile)
  ])
  const packageJson = JSON.parse(packageText)
  if (version.trim() !== previousVersion || packageJson.version !== previousVersion) {
    throw new Error('VERSION, package.json, and Bumpster must agree before release.')
  }

  const updated = prepareChangelog(changelog, {
    previousVersion,
    nextVersion,
    releaseDate
  })
  const updatedReadme = prepareReadme(readme, { previousVersion, nextVersion })
  const updatedReadmeRu = prepareReadme(readmeRu, { previousVersion, nextVersion })
  const files = [changelogFile, readmeFile, readmeRuFile]
  const contents = [updated, updatedReadme, updatedReadmeRu]
  const temporaryFiles = files.map((file) =>
    path.join(projectRoot, `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`)
  )
  try {
    await Promise.all(
      temporaryFiles.map((file, index) =>
        writeFile(file, contents[index], { mode: details[index].mode })
      )
    )
    for (const [index, file] of files.entries()) await rename(temporaryFiles[index], file)
  } finally {
    await Promise.all(temporaryFiles.map((file) => rm(file, { force: true })))
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await main()
}
