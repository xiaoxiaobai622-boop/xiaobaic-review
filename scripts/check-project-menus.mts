import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { after, afterEach, test } from 'node:test'
import React, { act, useState } from 'react'

const require = createRequire(import.meta.url)
const { JSDOM } = require('jsdom')
require.extensions['.css'] = (module) => { module.exports = { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) } }
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost:3000', pretendToBeVisual: true })
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLButtonElement', 'HTMLInputElement', 'Node', 'NodeFilter', 'Event', 'MouseEvent', 'KeyboardEvent', 'FocusEvent', 'CustomEvent', 'MutationObserver', 'getComputedStyle', 'DOMMatrix', 'DOMRect']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: (dom.window as any)[key] })
}
Object.assign(globalThis, {
  React, IS_REACT_ACT_ENVIRONMENT: true,
  requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
  cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
})
const { createRoot } = await import('react-dom/client')
const { NextIntlClientProvider } = require('next-intl')
const { default: ProjectsSortMenu } = await import('../src/components/projects/ProjectsSortMenu')
const { default: VideoSortMenu } = await import('../src/components/projects/VideoSortMenu')
const { default: VideoDisplayMenu } = await import('../src/components/projects/VideoDisplayMenu')
const { default: FilterDropdown } = await import('../src/components/FilterDropdown')
const { default: CommentSortMenu } = await import('../src/components/CommentSortMenu')
const messages = JSON.parse(readFileSync(new URL('../src/locales/zh.json', import.meta.url), 'utf8'))
let root: ReturnType<typeof createRoot> | undefined

async function mount(component: React.ReactNode) {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(React.createElement(NextIntlClientProvider, { locale: 'zh', messages, timeZone: 'UTC' },
    React.createElement(React.Fragment, null, component, React.createElement('button', { id: 'outside' }, '外部')))))
}
function element<T extends HTMLElement = HTMLElement>(selector: string): T {
  const el = document.querySelector<T>(selector)
  assert.ok(el, `Missing element: ${selector}`)
  return el
}
async function click(el: HTMLElement) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
    el.focus()
    el.click()
  })
}
async function key(el: HTMLElement, value: string) {
  await act(async () => el.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true })))
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

function SortHarness() {
  const [value, setValue] = useState<'updatedDesc' | 'titleAsc'>('updatedDesc')
  return React.createElement(ProjectsSortMenu, { value: value as any, onChange: (next) => setValue(next as any) })
}

test('projects sort opens on the checked option, moves by keyboard, and restores focus', async () => {
  await mount(React.createElement(SortHarness))
  const trigger = element<HTMLButtonElement>('button[aria-haspopup="menu"]')
  await click(trigger)
  assert.equal(trigger.getAttribute('aria-expanded'), 'true')
  assert.equal(document.activeElement?.getAttribute('aria-checked'), 'true')
  await key(document.activeElement as HTMLElement, 'ArrowDown')
  assert.notEqual(document.activeElement?.getAttribute('aria-checked'), null)
  const target = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')).find(el => !el.getAttribute('aria-checked') || el.getAttribute('aria-checked') === 'false')!
  await click(target)
  assert.equal(trigger.getAttribute('aria-expanded'), 'false')
  await settle()
  assert.equal(document.activeElement, trigger)
  assert.match(trigger.textContent || '', /创建/)
})

test('an outside click on the sort menu leaves focus on the clicked control', async () => {
  await mount(React.createElement(SortHarness))
  const trigger = element<HTMLButtonElement>('button[aria-haspopup="menu"]')
  await click(trigger)
  await click(element('#outside'))
  await settle()
  assert.equal(trigger.getAttribute('aria-expanded'), 'false')
  assert.equal(document.activeElement, element('#outside'))
})

function VideoSortHarness() {
  const [value, setValue] = useState({ field: 'updated', dir: 'desc' } as any)
  return React.createElement(VideoSortMenu, { value, onChange: setValue })
}

test('video sort keeps the panel open while choosing a direction and closes on Escape', async () => {
  await mount(React.createElement(VideoSortHarness))
  const trigger = element<HTMLButtonElement>('button[aria-haspopup="dialog"]')
  await click(trigger)
  const dialog = element('[role="dialog"]')
  assert.ok(dialog.contains(document.activeElement), 'opening must move focus into the panel')
  const asc = Array.from(dialog.querySelectorAll<HTMLButtonElement>('button')).find(button => button.getAttribute('aria-pressed') !== null && button.textContent?.includes('升序'))
  assert.ok(asc, 'ascending control must exist')
  await click(asc)
  assert.equal(trigger.getAttribute('aria-expanded'), 'true')
  assert.equal(asc.getAttribute('aria-pressed'), 'true')
  await key(document.activeElement as HTMLElement, 'Escape')
  await settle()
  assert.equal(trigger.getAttribute('aria-expanded'), 'false')
  assert.equal(document.activeElement, trigger)
})

function DisplayHarness() {
  const [prefs, setPrefs] = useState({ size: 'md', aspect: '16:9', showInfo: true, titleLines: 2 } as any)
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('grid')
  return React.createElement(VideoDisplayMenu, { value: prefs, onChange: setPrefs, viewMode, onViewModeChange: setViewMode })
}

test('display menu switches layout and restores focus to its own trigger', async () => {
  await mount(React.createElement(DisplayHarness))
  const trigger = element<HTMLButtonElement>('button[aria-haspopup="dialog"]')
  await click(trigger)
  const listButton = Array.from(element('[role="dialog"]').querySelectorAll<HTMLButtonElement>('button')).find(button => button.getAttribute('aria-pressed') === 'false' && button.textContent?.includes('列表'))
  assert.ok(listButton, 'list layout control must exist')
  await click(listButton)
  assert.equal(listButton.getAttribute('aria-pressed'), 'true')
  assert.equal(trigger.getAttribute('aria-expanded'), 'true')
  await key(document.activeElement as HTMLElement, 'Escape')
  await settle()
  assert.equal(document.activeElement, trigger)
})

function FilterHarness() {
  const [selected, setSelected] = useState(new Set(['REVIEW']))
  return React.createElement(FilterDropdown, {
    width: 240,
    groups: [{
      key: 'status',
      label: '状态',
      options: [{ value: 'REVIEW', label: '审阅中' }, { value: 'DONE', label: '已完成' }],
      selected,
      onChange: setSelected,
    }],
  })
}

test('filter dropdown toggles option sets and restores its trigger', async () => {
  await mount(React.createElement(FilterHarness))
  const trigger = element<HTMLButtonElement>('button[aria-haspopup="dialog"]')
  await click(trigger)
  const panel = element('[role="dialog"]')
  assert.ok(panel.contains(document.activeElement), 'opening must move focus inside')
  const done = Array.from(panel.querySelectorAll<HTMLLabelElement>('label')).find(label => label.textContent?.includes('已完成'))
  assert.ok(done)
  const checkbox = done.querySelector('input')!
  await act(async () => { checkbox.click() })
  assert.equal(checkbox.checked, true)
  const all = Array.from(panel.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
  assert.ok(all.every(input => input.checked), 'selecting every option means no filter is applied')
  const review = Array.from(panel.querySelectorAll<HTMLLabelElement>('label')).find(label => label.textContent?.includes('审阅中'))!.querySelector('input')!
  await act(async () => { review.click() })
  assert.equal(review.checked, false)
  await act(async () => { trigger.focus(); trigger.click() })
  await settle()
  assert.equal(document.activeElement, trigger)
  assert.match(trigger.textContent || '', /1/, 'partial selection must show the active filter count')
})

function CommentSortHarness() {
  const [value, setValue] = useState<'timecode' | 'newest'>('timecode')
  return React.createElement('div', { 'data-review-surface': true }, React.createElement(CommentSortMenu, { value, onChange: (next) => setValue(next as any) }))
}

test('comment sort exposes radio state, stays inside the review surface, and restores focus', async () => {
  await mount(React.createElement(CommentSortHarness))
  const trigger = element<HTMLButtonElement>('button[aria-haspopup="menu"]')
  await click(trigger)
  const menu = element('[role="menu"]')
  assert.ok(menu.parentElement === element('[data-review-surface]'), 'comment sort must inherit the review theme scope')
  assert.equal(document.activeElement?.getAttribute('aria-checked'), 'true')
  await key(document.activeElement as HTMLElement, 'ArrowDown')
  assert.equal(document.activeElement?.getAttribute('aria-checked'), 'false')
  await click(document.activeElement as HTMLElement)
  await settle()
  assert.equal(trigger.getAttribute('aria-expanded'), 'false')
  assert.equal(document.activeElement, trigger)
  assert.equal(document.querySelector('[role="menu"]'), null)
})
