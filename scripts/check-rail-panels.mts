import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { after, afterEach, test } from 'node:test'
import React, { act } from 'react'

const require = createRequire(import.meta.url)
const { JSDOM } = require('jsdom')
require.extensions['.css'] = (module) => { module.exports = { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) } }
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost:3000', pretendToBeVisual: true })
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLButtonElement', 'HTMLInputElement', 'Node', 'NodeFilter', 'Event', 'MouseEvent', 'KeyboardEvent', 'FocusEvent', 'CustomEvent', 'MutationObserver', 'getComputedStyle']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: (dom.window as any)[key] })
}
Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true })
const { createRoot } = await import('react-dom/client')
const { default: RailHelp } = await import('../src/components/RailHelp')
let root: ReturnType<typeof createRoot> | undefined

async function mount() {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(React.createElement(React.Fragment, null,
    React.createElement(RailHelp, { className: 'rail' }),
    React.createElement('button', { id: 'outside' }, '外部'))))
}
function element<T extends HTMLElement = HTMLElement>(selector: string): T {
  const el = document.querySelector<T>(selector)
  assert.ok(el, `Missing element: ${selector}`)
  return el
}
async function click(el: HTMLElement) {
  await act(async () => {
    el.dispatchEvent(new (dom.window as any).PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }))
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
    el.focus()
    el.click()
  })
}
async function settle() {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
}
afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.innerHTML = ''
})
after(() => dom.window.close())

test('opening the help panel moves focus inside it and exposes the dialog relationship', async () => {
  await mount()
  const trigger = element<HTMLButtonElement>('button[aria-label="帮助"]')
  await click(trigger)
  const panel = element('[data-rail-panel="help"]')
  assert.equal(trigger.getAttribute('aria-expanded'), 'true')
  assert.equal(trigger.getAttribute('aria-controls'), panel.id)
  assert.ok(panel.contains(document.activeElement), 'focus must enter the panel for keyboard users')
})

test('the close button returns focus to the rail trigger', async () => {
  await mount()
  const trigger = element<HTMLButtonElement>('button[aria-label="帮助"]')
  await click(trigger)
  await click(element('button[aria-label="关闭帮助"]'))
  await settle()
  assert.equal(document.querySelector('[data-rail-panel="help"]'), null)
  assert.equal(document.activeElement, trigger)
})

test('an outside pointer closes the panel without stealing focus from the clicked control', async () => {
  await mount()
  const trigger = element<HTMLButtonElement>('button[aria-label="帮助"]')
  await click(trigger)
  await click(element('#outside'))
  await settle()
  assert.equal(trigger.getAttribute('aria-expanded'), 'false')
  assert.equal(document.activeElement, element('#outside'))
})

test('clicking the trigger again closes the panel instead of reopening it', async () => {
  await mount()
  const trigger = element<HTMLButtonElement>('button[aria-label="帮助"]')
  await click(trigger)
  await click(trigger)
  await settle()
  assert.equal(trigger.getAttribute('aria-expanded'), 'false')
  assert.equal(document.querySelector('[data-rail-panel="help"]'), null)
})

test('Escape closes the panel and restores the trigger', async () => {
  await mount()
  const trigger = element<HTMLButtonElement>('button[aria-label="帮助"]')
  await click(trigger)
  await act(async () => { document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })) })
  await settle()
  assert.equal(trigger.getAttribute('aria-expanded'), 'false')
  assert.equal(document.activeElement, trigger)
})
