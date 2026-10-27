import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { after, afterEach, beforeEach, mock, test } from 'node:test'
import React, { act } from 'react'

const require = createRequire(import.meta.url)
const { JSDOM } = require('jsdom')
// Node cannot load CSS modules; visual verification belongs to the browser pass.
require.extensions['.css'] = (module) => { module.exports = { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) } }
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost:3000', pretendToBeVisual: true })
const windowGlobals = dom.window as unknown as Record<string, unknown>
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'Node', 'NodeFilter', 'Event', 'MouseEvent', 'KeyboardEvent', 'CustomEvent', 'MutationObserver', 'getComputedStyle']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: windowGlobals[key] })
}
Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true })
const { createRoot } = await import('react-dom/client')
const { NextIntlClientProvider } = require('next-intl')
const { AppDialogProvider, appNotice } = await import('../src/components/AppDialogProvider')
const messages = JSON.parse(readFileSync(new URL('../src/locales/zh.json', import.meta.url), 'utf8'))
let root: ReturnType<typeof createRoot> | undefined

async function mount() {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(React.createElement(React.StrictMode, null,
    React.createElement(NextIntlClientProvider, { locale: 'zh', messages, timeZone: 'UTC' },
      React.createElement(AppDialogProvider, null, React.createElement('button', { id: 'outside' }, 'Outside'))))))
}
function notices() {
  return Array.from(document.querySelectorAll<HTMLElement>('[role="status"]'))
}
function notice(message: string) {
  const item = notices().find(item => item.querySelector('p:last-child')?.textContent === message)
  assert.ok(item, `Missing notice: ${message}`)
  return item
}
function closeButton(item: HTMLElement) {
  const button = item.querySelector<HTMLButtonElement>('button')
  assert.ok(button, 'Missing notice close button')
  return button
}
function outside() {
  const button = document.querySelector<HTMLButtonElement>('#outside')
  assert.ok(button)
  return button
}
async function show(options: Parameters<typeof appNotice>[0]) {
  await act(async () => appNotice(options))
}
async function advance(ms: number) {
  await act(async () => mock.timers.tick(ms))
}
async function dismiss(item: HTMLElement) {
  await act(async () => closeButton(item).click())
}
async function interact(item: HTMLElement, kind: 'hover' | 'focus', active: boolean) {
  await act(async () => {
    if (kind === 'focus') (active ? closeButton(item) : outside()).focus()
    else item.dispatchEvent(new MouseEvent(active ? 'pointerover' : 'pointerout', {
      bubbles: true, relatedTarget: active ? null : outside(),
    }))
  })
}
async function visibility(hidden: boolean) {
  await act(async () => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: hidden })
    document.dispatchEvent(new Event('visibilitychange'))
  })
}

beforeEach(() => {
  // Only time is mocked: React, DOM events, translations and the provider stay real.
  mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 })
})
afterEach(async () => {
  // Clear the module queue through the real close controls, including after a failure.
  await act(async () => notices().forEach(item => closeButton(item).click()))
  await act(async () => root?.unmount())
  root = undefined
  Reflect.deleteProperty(document, 'hidden')
  document.body.innerHTML = ''
  mock.timers.reset()
})
after(() => dom.window.close())

test('adding a sibling does not postpone an older notice deadline', async () => {
  await mount()
  await show('Older')
  await advance(1000)
  await show('Newer')
  await advance(1999)
  assert.equal(notices().length, 2)
  await advance(1)
  assert.deepEqual(notices().map(item => item.textContent), ['Newer'], 'Older must expire at 3000ms, not 4000ms')
  await advance(999)
  assert.equal(notices().length, 1)
  await advance(1)
  assert.equal(notices().length, 0, 'Expiring a sibling must not reset the newer notice either')
})

test('manually dismissing a sibling does not reset the surviving lifetime', async () => {
  await mount()
  await show('Survivor')
  await show('Dismiss me')
  await advance(1000)
  await dismiss(notice('Dismiss me'))
  await advance(1999)
  assert.equal(notices().length, 1)
  await advance(1)
  assert.equal(notices().length, 0)
})

for (const [tone, duration] of [['info', 3000], ['success', 3000], ['error', 5000], ['destructive', 5000]] as const) {
  test(`${tone} notices retain their ${duration}ms lifetime`, async () => {
    await mount()
    await show({ message: 'Notice', tone })
    await advance(duration - 1)
    assert.equal(notices().length, 1)
    await advance(1)
    assert.equal(notices().length, 0)
  })
}

for (const [first, second] of [['hover', 'focus'], ['focus', 'hover']] as const) {
  test(`${first} then ${second} pauses until both end and resumes only the remaining time`, async () => {
    await mount()
    await show('Reading')
    const item = notice('Reading')
    await advance(1000)
    await interact(item, first, true)
    await advance(4000)
    assert.equal(notices().length, 1, `${first} alone must pause expiration`)
    await interact(item, second, true)
    await interact(item, first, false)
    await show('Unpaused sibling')
    await advance(3000)
    assert.deepEqual(notices().map(item => item.textContent), ['Reading'], `${second} must keep this notice paused, not its sibling`)
    await interact(item, second, false)
    await advance(1999)
    assert.equal(notices().length, 1)
    await advance(1)
    assert.equal(notices().length, 0, 'Resume must not grant a fresh 3000ms lifetime')
  })
}

test('a hidden document pauses elapsed lifetime and resumes the remainder', async () => {
  await mount()
  await show('Reading')
  await advance(1000)
  await visibility(true)
  await advance(10000)
  assert.equal(notices().length, 1)
  await visibility(false)
  await advance(1999)
  assert.equal(notices().length, 1)
  await advance(1)
  assert.equal(notices().length, 0)
})

test('notices created while hidden wait for visibility and any focus or hover to end', async () => {
  await visibility(true)
  await mount()
  await show('Background')
  await advance(10000)
  assert.equal(notices().length, 1)
  const item = notice('Background')
  await interact(item, 'hover', true)
  await interact(item, 'focus', true)
  await visibility(false)
  await advance(4000)
  assert.equal(notices().length, 1)
  await visibility(true)
  await interact(item, 'hover', false)
  await interact(item, 'focus', false)
  await advance(4000)
  assert.equal(notices().length, 1, 'Ending interaction must not resume while still hidden')
  await visibility(false)
  await advance(2999)
  assert.equal(notices().length, 1)
  await advance(1)
  assert.equal(notices().length, 0)
})

test('deduplication ignores a consecutive matching message and tone without renewing it', async () => {
  await mount()
  await show({ title: 'Original', message: 'Saved', tone: 'success' })
  await advance(1000)
  await show({ title: 'Duplicate', message: 'Saved', tone: 'success' })
  assert.deepEqual(notices().map(item => item.textContent), ['OriginalSaved'])
  await advance(2000)
  assert.equal(notices().length, 0)
})

test('deduplication is last-only and manual dismissal targets the matching id, not message', async () => {
  await mount()
  await show({ message: 'Same', tone: 'info' })
  const first = notice('Same')
  await show({ message: 'Same', tone: 'error' })
  await show({ message: 'Same', tone: 'info' })
  assert.equal(notices().length, 3)
  const survivors = notices().slice(1)
  await dismiss(first)
  assert.deepEqual(notices(), survivors)
  await dismiss(survivors[1])
  await advance(3000)
  assert.deepEqual(notices(), [survivors[0]])
  await advance(2000)
  assert.equal(notices().length, 0)
})

test('the fifth notice evicts only the oldest without renewing the retained four', async () => {
  await mount()
  for (const message of ['One', 'Two', 'Three', 'Four']) await show(message)
  await advance(1000)
  await show('Five')
  assert.deepEqual(notices().map(item => item.textContent), ['Two', 'Three', 'Four', 'Five'])
  await advance(2000)
  assert.deepEqual(notices().map(item => item.textContent), ['Five'])
  await advance(1000)
  assert.equal(notices().length, 0)
})

test('notices queued before mounting render without stealing focus on arrival or expiration', async () => {
  appNotice('Queued')
  await mount()
  const button = outside()
  await act(async () => button.focus())
  await show('Later')
  assert.equal(document.activeElement, button)
  assert.deepEqual(notices().map(item => item.textContent), ['Queued', 'Later'])
  await dismiss(notice('Later'))
  assert.equal(document.activeElement, button)
  await advance(3000)
  assert.equal(notices().length, 0)
  assert.equal(document.activeElement, button)
})
