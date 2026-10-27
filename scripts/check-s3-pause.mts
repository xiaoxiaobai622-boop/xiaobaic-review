import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { after, afterEach, test } from 'node:test'
import React, { act } from 'react'

const require = createRequire(import.meta.url)
const { JSDOM } = require('jsdom')
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost:3000', pretendToBeVisual: true })
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'NodeFilter', 'Event', 'MouseEvent', 'KeyboardEvent', 'CustomEvent', 'MutationObserver', 'localStorage']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: (dom.window as any)[key] })
}
Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true })

class FakeXHR {
  static instances: FakeXHR[] = []
  upload: { onprogress: ((event: { lengthComputable: boolean; loaded: number }) => void) | null } = { onprogress: null }
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  onabort: (() => void) | null = null
  status = 0
  aborted = false
  sent = false
  constructor() { FakeXHR.instances.push(this) }
  open() {}
  setRequestHeader() {}
  getResponseHeader(name: string) { return name.toLowerCase() === 'etag' ? '"etag-1"' : null }
  send() { this.sent = true }
  abort() {
    if (this.aborted) return
    this.aborted = true
    this.onabort?.()
  }
  finish() { this.status = 200; this.onload?.() }
}
Object.defineProperty(globalThis, 'XMLHttpRequest', { configurable: true, value: FakeXHR })

const requests: Array<{ url: string; body: any }> = []
globalThis.fetch = (async (input: any, init?: RequestInit) => {
  const url = String(input)
  requests.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null })
  if (url.includes('/api/uploads/s3/presign')) {
    return new Response(JSON.stringify({ uploadId: 'up-1', partSize: 8 * 1024 * 1024, parts: [{ partNumber: 1, url: 'https://s3.test/part-1' }] }), { status: 200 })
  }
  return new Response(JSON.stringify({ ok: true }), { status: 200 })
}) as typeof fetch

const { createRoot } = await import('react-dom/client')
const { useS3MultipartUpload } = await import('../src/hooks/useS3MultipartUpload')
let root: ReturnType<typeof createRoot> | undefined
let api: ReturnType<typeof useS3MultipartUpload> | undefined

function Harness() {
  api = useS3MultipartUpload()
  return null
}

async function flush() {
  await act(async () => { await Promise.resolve(); await new Promise((resolve) => setTimeout(resolve, 0)) })
}

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  api = undefined
  FakeXHR.instances = []
  requests.length = 0
})
after(() => dom.window.close())

test('pausing aborts the parts already in flight and resumes from that part', async () => {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(React.createElement(Harness)))

  const file = new File([new Uint8Array(10)], 'clip.mp4', { type: 'video/mp4' })
  let completed = 0
  const callbacks = { onSuccess: () => { completed += 1 } }
  await act(async () => { void api!.startUpload(file, { videoId: 'v1' }, callbacks, 'k') })
  await flush()

  assert.equal(FakeXHR.instances.length, 1, 'presign must start one part')
  const first = FakeXHR.instances[0]
  assert.equal(first.sent, true)

  await act(async () => { api!.pauseUpload('k') })
  await flush()
  assert.equal(first.aborted, true, 'pausing must abort the in-flight part')
  assert.equal(completed, 0, 'a paused upload must not complete')
  assert.deepEqual(requests.map((request) => request.url.split('?')[0]), ['/api/uploads/s3/presign'], 'paused upload must not call complete')

  await act(async () => { api!.resumeUpload('k') })
  await flush()
  assert.equal(FakeXHR.instances.length, 2, 'resume must re-send the interrupted part')
  const second = FakeXHR.instances[1]
  await act(async () => { second.finish() })
  await flush()

  assert.equal(completed, 1, 'the upload completes once after resume')
  const complete = requests.find((request) => request.url.includes('/api/uploads/s3/complete'))
  assert.ok(complete, 'completion must be requested')
  assert.deepEqual(complete!.body.parts, [{ partNumber: 1, etag: 'etag-1' }])
})
