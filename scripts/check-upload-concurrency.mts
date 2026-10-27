import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pickUploadBatch } from '../src/lib/upload-concurrency'

const ids = ['a', 'b', 'c', 'd', 'e']

test('an idle queue starts at most three uploads', () => {
  const { start, rest } = pickUploadBatch(ids, {})
  assert.deepEqual(start, ['a', 'b', 'c'])
  assert.deepEqual(rest, ['d', 'e'])
})

test('in-flight uploads reduce the next batch to the free slots', () => {
  const { start, rest } = pickUploadBatch(['d', 'e'], { a: 'uploading', b: 'uploading', c: 'completed' })
  assert.deepEqual(start, ['d'])
  assert.deepEqual(rest, ['e'])
})

test('a full queue waits until a slot frees, and paused failures do not block', () => {
  assert.deepEqual(pickUploadBatch(['d'], { a: 'uploading', b: 'uploading', c: 'uploading' }), { start: [], rest: ['d'] })
  assert.deepEqual(pickUploadBatch(['d'], { a: 'uploading', b: 'uploading', c: 'error' }), { start: ['d'], rest: [] })
  assert.deepEqual(pickUploadBatch(['d'], { a: 'uploading', b: 'paused' }), { start: ['d'], rest: [] })
})

test('an empty queue never starts anything', () => {
  assert.deepEqual(pickUploadBatch([], { a: 'uploading' }), { start: [], rest: [] })
})
