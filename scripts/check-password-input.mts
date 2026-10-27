import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { after, afterEach, test } from 'node:test'
import React, { act } from 'react'

const require = createRequire(import.meta.url)
const { JSDOM } = require('jsdom')
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost:3000',
  pretendToBeVisual: true,
})
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'Node', 'Event', 'MouseEvent']) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value: Reflect.get(dom.window, key),
  })
}
Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true })

const { createRoot } = await import('react-dom/client')
const { NextIntlClientProvider } = require('next-intl')
const { PasswordInput } = await import('../src/components/ui/password-input')
const messages = JSON.parse(readFileSync(new URL('../src/locales/zh.json', import.meta.url), 'utf8'))
let root: ReturnType<typeof createRoot> | undefined

async function mount(component: React.ReactNode) {
  const host = document.createElement('div')
  document.body.append(host)
  const mountedRoot = createRoot(host)
  root = mountedRoot
  await act(async () => mountedRoot.render(
    React.createElement(NextIntlClientProvider, { locale: 'zh', messages, timeZone: 'UTC' }, component)
  ))
}

function element<T extends HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector)
  assert.ok(found, `Missing element: ${selector}`)
  return found
}

async function click(button: HTMLButtonElement) {
  await act(async () => button.click())
}

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})
after(() => dom.window.close())

test('the enabled visibility toggle stays in the native keyboard tab order', async () => {
  await mount(React.createElement(PasswordInput))
  const button = element<HTMLButtonElement>('button')
  assert.equal(button.tabIndex, 0)
  button.focus()
  assert.equal(document.activeElement, button)
})

test('a disabled input disables its toggle and prevents visibility callbacks', async () => {
  const changes: boolean[] = []
  await mount(React.createElement(PasswordInput, {
    disabled: true,
    onVisibilityChange: (visible) => changes.push(visible),
  }))
  const input = element<HTMLInputElement>('input')
  const button = element<HTMLButtonElement>('button')
  assert.equal(input.disabled, true)
  assert.equal(button.disabled, true)
  await click(button)
  assert.equal(input.type, 'password')
  assert.deepEqual(changes, [])
})

test('an enabled toggle reveals and hides the input with one callback per activation', async () => {
  const changes: boolean[] = []
  await mount(React.createElement(PasswordInput, {
    onVisibilityChange: (visible) => changes.push(visible),
  }))
  const input = element<HTMLInputElement>('input')
  const button = element<HTMLButtonElement>('button')
  assert.equal(input.type, 'password')
  assert.deepEqual(changes, [])
  await click(button)
  assert.equal(input.type, 'text')
  assert.deepEqual(changes, [true])
  await click(button)
  assert.equal(input.type, 'password')
  assert.deepEqual(changes, [true, false])
})

test('the toggle exposes its pressed state and translated action labels', async () => {
  await mount(React.createElement(PasswordInput))
  const button = element<HTMLButtonElement>('button')
  assert.equal(button.getAttribute('aria-pressed'), 'false')
  assert.equal(button.getAttribute('aria-label'), '显示密码')
  assert.equal(button.title, '显示密码')
  await click(button)
  assert.equal(button.getAttribute('aria-pressed'), 'true')
  assert.equal(button.getAttribute('aria-label'), '隐藏密码')
  assert.equal(button.title, '隐藏密码')
  await click(button)
  assert.equal(button.getAttribute('aria-pressed'), 'false')
  assert.equal(button.getAttribute('aria-label'), '显示密码')
  assert.equal(button.title, '显示密码')
})

test('toggling visibility does not submit the enclosing form', async () => {
  let submissions = 0
  await mount(React.createElement('form', {
    onSubmit: (event) => {
      event.preventDefault()
      submissions += 1
    },
  }, React.createElement(PasswordInput)))
  const button = element<HTMLButtonElement>('button')
  await click(button)
  await click(button)
  assert.equal(submissions, 0)
  assert.equal(button.type, 'button')
})

test('showToggle=false leaves a password input without a visibility button', async () => {
  await mount(React.createElement(PasswordInput, { showToggle: false }))
  assert.equal(element<HTMLInputElement>('input').type, 'password')
  assert.equal(document.querySelector('button'), null)
})

test('visibility changes preserve the forwarded input ref and controlled value', async () => {
  const ref = React.createRef<HTMLInputElement>()
  await mount(React.createElement(PasswordInput, {
    ref,
    value: '保留输入内容',
    readOnly: true,
  }))
  const input = element<HTMLInputElement>('input')
  const button = element<HTMLButtonElement>('button')
  assert.equal(ref.current, input)
  assert.equal(input.value, '保留输入内容')
  await click(button)
  assert.equal(ref.current, input)
  assert.equal(element<HTMLInputElement>('input'), input)
  assert.equal(input.value, '保留输入内容')
  await click(button)
  assert.equal(ref.current, input)
  assert.equal(input.value, '保留输入内容')
})

test('mouse-down on the toggle remains canceled so input focus is retained', async () => {
  await mount(React.createElement(PasswordInput))
  const input = element<HTMLInputElement>('input')
  const button = element<HTMLButtonElement>('button')
  input.focus()
  const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 })
  await act(async () => { button.dispatchEvent(event) })
  assert.equal(event.defaultPrevented, true)
  await click(button)
  assert.equal(document.activeElement, input)
})

test('an explicit native input type keeps precedence over visibility state', async () => {
  await mount(React.createElement(PasswordInput, { type: 'text' }))
  const input = element<HTMLInputElement>('input')
  const button = element<HTMLButtonElement>('button')
  assert.equal(input.type, 'text')
  await click(button)
  await click(button)
  assert.equal(input.type, 'text')
})
