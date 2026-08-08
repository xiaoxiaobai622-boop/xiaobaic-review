import { readFile, writeFile } from 'node:fs/promises'

const sourcePath = new URL('../src/locales/en.json', import.meta.url)
const curatedPath = new URL('../src/locales/zh.json', import.meta.url)
const source = JSON.parse(await readFile(sourcePath, 'utf8'))
const curated = JSON.parse(await readFile(curatedPath, 'utf8'))

const entries = []

function getAtPath(object, path) {
  return path.reduce((value, key) => value?.[key], object)
}

function collect(value, path = []) {
  if (typeof value === 'string') {
    if (getAtPath(curated, path) === undefined) entries.push({ path, value })
    return
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) collect(child, [...path, key])
  }
}

function maskMessage(message) {
  const placeholders = []
  let output = ''
  let depth = 0
  let start = -1

  for (let index = 0; index < message.length; index += 1) {
    const char = message[index]
    if (char === '{') {
      if (depth === 0) start = index
      depth += 1
    } else if (char === '}' && depth > 0) {
      depth -= 1
      if (depth === 0) {
        output += message.slice(output.length === 0 ? 0 : 0, 0)
        placeholders.push(message.slice(start, index + 1))
      }
    }
  }

  if (placeholders.length === 0) return { text: message, placeholders }

  output = ''
  depth = 0
  start = 0
  let placeholderIndex = 0
  for (let index = 0; index < message.length; index += 1) {
    if (message[index] === '{') {
      if (depth === 0) {
        output += message.slice(start, index)
        output += `__VTPH_${placeholderIndex}__`
        placeholderIndex += 1
      }
      depth += 1
    } else if (message[index] === '}' && depth > 0) {
      depth -= 1
      if (depth === 0) start = index + 1
    }
  }
  output += message.slice(start)
  return { text: output, placeholders }
}

function restoreMessage(message, placeholders) {
  return placeholders.reduce(
    (result, placeholder, index) => result.replace(`__VTPH_${index}__`, placeholder),
    message
  )
}

function setAtPath(object, path, value) {
  let cursor = object
  for (let index = 0; index < path.length - 1; index += 1) cursor = cursor[path[index]]
  cursor[path.at(-1)] = value
}

async function translateBatch(batch) {
  const prepared = batch.map((entry, index) => {
    const masked = maskMessage(entry.value)
    return { ...entry, ...masked, marker: `[[[VTITEM_${String(index).padStart(4, '0')}]]]` }
  })
  const payload = prepared.map(item => `${item.marker}\n${item.text}`).join('\n')
  const body = new URLSearchParams({ client: 'gtx', sl: 'en', tl: 'zh-CN', dt: 't', q: payload })
  const response = await fetch('https://translate.googleapis.com/translate_a/single', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body,
  })
  if (!response.ok) throw new Error(`Translation request failed: ${response.status}`)
  const data = await response.json()
  const translated = (data[0] || []).map(part => part[0]).join('')
  const markerPattern = /\[\[\[VTITEM_(\d{4})\]\]\]\s*/g
  const matches = [...translated.matchAll(markerPattern)]
  if (matches.length !== prepared.length) throw new Error(`Translation batch marker mismatch: ${matches.length}/${prepared.length}`)

  return matches.map((match, index) => {
    const start = match.index + match[0].length
    const end = matches[index + 1]?.index ?? translated.length
    return restoreMessage(translated.slice(start, end).trim(), prepared[index].placeholders)
  })
}

collect(source)
const result = structuredClone(source)
const batches = []
let current = []
let currentLength = 0

for (const entry of entries) {
  if (current.length > 0 && (current.length >= 24 || currentLength + entry.value.length > 2600)) {
    batches.push(current)
    current = []
    currentLength = 0
  }
  current.push(entry)
  currentLength += entry.value.length
}
if (current.length > 0) batches.push(current)

for (let index = 0; index < batches.length; index += 1) {
  const batch = batches[index]
  const translations = await translateBatch(batch)
  translations.forEach((translation, translationIndex) => {
    setAtPath(result, batch[translationIndex].path, translation)
  })
  console.log(`Translated ${Math.min((index + 1) * 24, entries.length)}/${entries.length}`)
}

function applyCurated(target, overrides) {
  for (const [key, value] of Object.entries(overrides)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) applyCurated(target[key], value)
    else target[key] = value
  }
}

applyCurated(result, curated)
await writeFile(curatedPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
console.log(`Completed Chinese locale with ${entries.length} generated translations.`)
