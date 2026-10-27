import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { test, afterEach } from 'node:test'
import React, { act, useState } from 'react'

const require = createRequire(import.meta.url)
const { JSDOM } = require('jsdom')
require.extensions['.css'] = (module) => { module.exports = { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) } }
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost:3000', pretendToBeVisual: true })
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'Node', 'NodeFilter', 'Event', 'MouseEvent', 'KeyboardEvent', 'CustomEvent', 'MutationObserver', 'getComputedStyle', 'localStorage']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: (dom.window as any)[key] })
}
Object.assign(globalThis, {
  React, IS_REACT_ACT_ENVIRONMENT: true,
  requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
  cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
})
const { createRoot } = await import('react-dom/client')
const { NextIntlClientProvider } = require('next-intl')
const { default: CommentInput } = await import('../src/components/CommentInput')
const { default: TimeFormatSwitch } = await import('../src/components/TimeFormatSwitch')
const { default: ReviewOverflowMenu } = await import('../src/components/ReviewOverflowMenu')
const { Dialog, DialogTrigger, DialogContent, DialogTitle } = await import('../src/components/ui/dialog')
const messages = JSON.parse(readFileSync(new URL('../src/locales/zh.json', import.meta.url), 'utf8'))
let root: ReturnType<typeof createRoot> | undefined

function Composer() {
  const [text, setText] = useState('前后')
  const [visibility, setVisibility] = useState<'PUBLIC' | 'INTERNAL'>('PUBLIC')
  return React.createElement(CommentInput, {
    newComment: text, onCommentChange: setText, onSubmit() {}, loading: false,
    selectedTimestamp: null, selectedVideoFps: 25, replyingToComment: null,
    onCancelReply() {}, currentVideoRestricted: false, commentsDisabled: false,
    showCategoryPicker: false, visibility, onVisibilityChange: setVisibility,
    sendInsideComposer: true,
  })
}
async function mount(component: React.ReactNode) {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(React.createElement(NextIntlClientProvider, { locale: 'zh', messages, timeZone: 'UTC' }, component)))
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
afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.innerHTML = ''
  localStorage.clear()
})

test('a second pointer click closes the emoji popup instead of reopening it', async () => {
  await mount(React.createElement(Composer))
  const trigger = element('button[aria-label="添加表情符号"]')
  await click(trigger)
  assert.equal(trigger.getAttribute('aria-expanded'), 'true')
  await click(trigger)
  assert.equal(trigger.getAttribute('aria-expanded'), 'false')
})

test('Escape closes visibility and returns focus to its own trigger', async () => {
  await mount(React.createElement(Composer))
  const trigger = element('button[aria-label^="评论可见性"]')
  await click(trigger)
  await key(document.activeElement as HTMLElement, 'Escape')
  assert.equal(trigger.getAttribute('aria-expanded'), 'false')
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
  assert.equal(document.activeElement, trigger)
})

test('visibility selection exposes the selected radio state and changes only the callback value', async () => {
  await mount(React.createElement(Composer))
  const trigger = element('button[aria-label^="评论可见性"]')
  await click(trigger)
  const items = document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')
  assert.equal(items.length, 2)
  assert.equal(items[0].getAttribute('aria-checked'), 'true')
  await click(items[1])
  assert.equal(trigger.getAttribute('aria-label'), '评论可见性：内部')
  assert.equal(trigger.getAttribute('aria-expanded'), 'false')
})

test('emoji selection replaces the selection, closes, and restores the textarea caret', async () => {
  await mount(React.createElement(Composer))
  const input = element<HTMLTextAreaElement>('textarea')
  input.focus()
  input.setSelectionRange(1, 1)
  await click(element('button[aria-label="添加表情符号"]'))
  const emoji = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="dialog"] .grid button')).find(button => button.textContent === String.fromCodePoint(0x1f600))!
  assert.ok(emoji)
  await click(emoji)
  await act(async () => { await new Promise(resolve => requestAnimationFrame(resolve)) })
  assert.equal(input.value, `前${String.fromCodePoint(0x1f600)}后`)
  assert.equal(input.selectionStart, 3)
  assert.equal(document.activeElement, input)
  assert.equal(element('button[aria-label="添加表情符号"]').getAttribute('aria-expanded'), 'false')
})

test('a reply request focuses the composer and places the caret at the end', async () => {
  function ReplyComposer() {
    const [text, setText] = useState('已有内容')
    return React.createElement(CommentInput, {
      newComment: text, onCommentChange: setText, onSubmit() {}, loading: false,
      selectedTimestamp: null, selectedVideoFps: 25, replyingToComment: null,
      onCancelReply() {}, currentVideoRestricted: false, commentsDisabled: false,
      showCategoryPicker: false, visibility: 'PUBLIC', onVisibilityChange() {},
      sendInsideComposer: true, focusRequest: 1,
    })
  }
  await mount(React.createElement(ReplyComposer))
  const textarea = element<HTMLTextAreaElement>('textarea')
  await act(async () => { await new Promise(resolve => requestAnimationFrame(resolve)) })
  assert.equal(document.activeElement, textarea)
  assert.equal(textarea.selectionStart, textarea.value.length)
})

test('time format focuses the selected item and supports End without moving the page', async () => {
  await mount(React.createElement(TimeFormatSwitch, { currentTime: 12, duration: 93, fps: 25 }))
  await click(element('[data-testid="time-format-trigger"]'))
  assert.equal(document.activeElement?.getAttribute('aria-checked'), 'true')
  await key(document.activeElement as HTMLElement, 'End')
  const items = document.querySelectorAll('[role="menuitemradio"]')
  assert.equal(document.activeElement, items[items.length - 1])
})

test('Tab closes a menu instead of looping through its choices', async () => {
  await mount(React.createElement(TimeFormatSwitch, { currentTime: 12, duration: 93, fps: 25 }))
  const trigger = element('[data-testid="time-format-trigger"]')
  await click(trigger)
  await key(document.activeElement as HTMLElement, 'Tab')
  assert.equal(trigger.getAttribute('aria-expanded'), 'false')
})

test('an outside pointer click dismisses overflow without stealing focus', async () => {
  await mount(React.createElement(React.Fragment, null,
    React.createElement(ReviewOverflowMenu, null, React.createElement('button', null, '设置')),
    React.createElement('button', { id: 'outside' }, '外部操作')))
  const trigger = element('button[aria-haspopup="dialog"]')
  await click(trigger)
  await click(element('#outside'))
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
  assert.equal(trigger.getAttribute('aria-expanded'), 'false')
  assert.equal(document.activeElement, element('#outside'))
})

test('time format preserves the device preference and synchronizes other player instances', async () => {
  localStorage.setItem('time_format', 'TIMECODE')
  await mount(React.createElement(React.Fragment, null,
    React.createElement(TimeFormatSwitch, { currentTime: 12, duration: 93, fps: 25 }),
    React.createElement(TimeFormatSwitch, { currentTime: 1, duration: 93, fps: 25 })))
  const triggers = document.querySelectorAll<HTMLButtonElement>('[data-testid="time-format-trigger"]')
  assert.match(triggers[0].textContent!, /00:00:12:00/)
  await click(triggers[0])
  assert.equal(element('[aria-checked="true"]').getAttribute('data-time-format'), 'TIMECODE')
  await click(element('[data-time-format="FRAMES"]'))
  assert.equal(localStorage.getItem('time_format'), 'FRAMES')
  assert.equal(triggers[0].textContent!.replace(/\s/g, ''), '300/2325')
  assert.equal(triggers[1].textContent!.replace(/\s/g, ''), '25/2325')
})

test('emoji categories remain keyboard accessible and preserve existing recent selections', async () => {
  const previous = String.fromCodePoint(0x1f680)
  const chosen = String.fromCodePoint(0x1f600)
  localStorage.setItem('comment_emoji_recent', JSON.stringify([previous]))
  await mount(React.createElement(Composer))
  await click(element('button[aria-label="添加表情符号"]'))
  assert.equal(element('[role="dialog"] .grid button').textContent, previous)
  const selected = element('[role="tab"][aria-selected="true"]')
  await key(selected, 'ArrowRight')
  assert.equal(document.activeElement?.getAttribute('aria-label'), '表情与人物')
  assert.equal(element('button[aria-label="添加表情符号"]').getAttribute('aria-expanded'), 'true')
  assert.equal(element('[role="tab"][aria-selected="true"]').getAttribute('aria-label'), '表情与人物')
  const chosenButton = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="dialog"] .grid button')).find(button => button.textContent === chosen)
  assert.ok(chosenButton)
  await click(chosenButton)
  assert.deepEqual(JSON.parse(localStorage.getItem('comment_emoji_recent')!), [chosen, previous])
  assert.equal(localStorage.getItem('review_popup_lab_candidate_recent'), null)
})

test('a nested modal closes without dismissing its overflow owner', async () => {
  await mount(React.createElement(ReviewOverflowMenu, null,
    React.createElement(Dialog, null,
      React.createElement(DialogTrigger, null, '通知预览'),
      React.createElement(DialogContent, { 'aria-describedby': undefined },
        React.createElement(DialogTitle, null, '通知预览'),
        React.createElement('button', { id: 'nested-action' }, '预览操作')))))
  const trigger = element('button[aria-label="更多"]')
  await click(trigger)
  const nestedTrigger = element('[role="dialog"] button[aria-haspopup="dialog"]')
  await click(nestedTrigger)
  const nested = element('#nested-action')
  await key(nested, 'Escape')
  assert.equal(document.querySelector('#nested-action'), null)
  assert.equal(trigger.getAttribute('aria-expanded'), 'true')
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
  assert.equal(document.activeElement, nestedTrigger)
})

test('a popup keeps its anchor review theme scope', async () => {
  await mount(React.createElement('div', { 'data-review-surface': true },
    React.createElement(TimeFormatSwitch, { currentTime: 12, duration: 93, fps: 25 })))
  await click(element('[data-testid="time-format-trigger"]'))
  assert.ok(element('[role="menu"]').parentElement === element('[data-review-surface]'), 'Popup must inherit its anchor review theme')
})

test('the popup follows its anchor into and out of fullscreen', async () => {
  let fullscreen: Element | null = null
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fullscreen })
  try {
    await mount(React.createElement('div', { id: 'player-fullscreen' },
      React.createElement(TimeFormatSwitch, { currentTime: 12, duration: 93, fps: 25 })))
    fullscreen = element('#player-fullscreen')
    await act(async () => document.dispatchEvent(new Event('fullscreenchange')))
    await click(element('[data-testid="time-format-trigger"]'))
    assert.ok(fullscreen.contains(element('[role="menu"]')))
    fullscreen = null
    await act(async () => document.dispatchEvent(new Event('fullscreenchange')))
    assert.equal(element('[role="menu"]').parentElement, document.body)
  } finally {
    delete (document as any).fullscreenElement
  }
})
