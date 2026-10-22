import test from 'node:test';
import assert from 'node:assert/strict';
import { strokeSplats } from '../src/lib/light-mist-input';

test('entering or resting the pointer does not paint a stationary glowing dot', () => {
  const point = { x: 100, y: 200, time: 10 };
  assert.deepEqual(strokeSplats(null, point, 1000, 800), []);
  assert.deepEqual(strokeSplats(point, { ...point, time: 50 }, 1000, 800), []);
});

test('a stroke preserves direction and converts top-left pointer coordinates to bottom-left texture coordinates', () => {
  const result = strokeSplats({ x: 400, y: 400, time: 0 }, { x: 500, y: 200, time: 100 }, 1000, 800);
  assert.ok(result.length > 1);
  const end = result.at(-1);
  assert.ok(end);
  assert.equal(end.x, 0.5);
  assert.equal(end.y, 0.75);
  assert.ok(end.dx > 0 && end.dy > 0);
  assert.ok(result.every(point => Number.isFinite(point.dx) && point.amount > 0));
});

test('long fast strokes are connected rather than rendered as disconnected spots', () => {
  const points = strokeSplats({ x: 50, y: 400, time: 0 }, { x: 950, y: 400, time: 100 }, 1000, 800);
  assert.ok(points.length >= 25);
  for (let i = 1; i < points.length; i++) {
    assert.ok((points[i].x - points[i - 1].x) * 1000 <= 36);
    assert.equal(points[i].y, 0.5);
  }
});

test('fast movement displaces more fluid than slow movement over the same distance', () => {
  const start = { x: 200, y: 300, time: 0 };
  const slow = strokeSplats(start, { x: 300, y: 300, time: 200 }, 1000, 800).at(-1);
  const fast = strokeSplats(start, { x: 300, y: 300, time: 16 }, 1000, 800).at(-1);
  assert.ok(slow && fast);
  assert.ok(fast.dx > slow.dx);
  assert.ok(fast.amount > slow.amount);
});

test('duplicate timestamps stay finite and long gaps do not create a re-entry streak', () => {
  const start = { x: 10, y: 20, time: 0 };
  const instant = strokeSplats(start, { x: 100, y: 80, time: 0 }, 1000, 800);
  assert.ok(instant.every(p => [p.dx, p.dy, p.radius, p.amount].every(Number.isFinite)));
  assert.deepEqual(strokeSplats(start, { x: 900, y: 700, time: 2000 }, 1000, 800), []);
});

test('zero-size surfaces and pointer positions outside the canvas cannot inject fluid', () => {
  const start = { x: 100, y: 100, time: 0 };
  assert.deepEqual(strokeSplats(start, { x: 200, y: 200, time: 20 }, 0, 0), []);
  assert.deepEqual(strokeSplats(start, { x: -10, y: 200, time: 20 }, 1000, 800), []);
});
