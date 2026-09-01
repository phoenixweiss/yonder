import { isSafeRelativePath } from './config.js'

const idPattern = /^[a-z0-9][a-z0-9-]{0,63}$/

export function isValidConnectionId(value) {
  return typeof value === 'string' && idPattern.test(value)
}

export function isValidLinkName(value) {
  return (
    typeof value === 'string' &&
    value.length <= 255 &&
    new TextEncoder().encode(value).length <= 255 &&
    !value.includes('/') &&
    isSafeRelativePath(value)
  )
}

export function suggestConnectionId(name, existingIds = []) {
  const used = new Set(existingIds)
  const normalized = typeof name === 'string' ? name.normalize('NFKD') : ''
  const base = normalized
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '')

  if (base && !used.has(base)) return base
  for (let index = 1; index <= 9999; index++) {
    const suffix = `-${index}`
    const candidate = base
      ? `${base.slice(0, 64 - suffix.length).replace(/-+$/g, '')}${suffix}`
      : `connection-${index}`
    if (!used.has(candidate)) return candidate
  }
  return ''
}
