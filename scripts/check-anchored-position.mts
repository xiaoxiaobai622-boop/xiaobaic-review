import assert from 'node:assert/strict'
import { computeAnchoredPosition } from '../src/lib/anchored-position'

const viewport = { left: 0, top: 0, right: 1440, bottom: 900 }
const menu = { width: 195, height: 330 }
const firstRow = { left: 848.7, top: 415, right: 875, bottom: 441.3, width: 26.3, height: 26.3 }
const lastRow = { left: 1386.4, top: 818, right: 1412.6, bottom: 844.3, width: 26.3, height: 26.3 }
const leftEdge = { left: 20, top: 300, right: 46.3, bottom: 326.3, width: 26.3, height: 26.3 }

const cases: Array<{ name: string; args: Parameters<typeof computeAnchoredPosition>[0]; expect: { side: string; gap: number; inside: boolean } }> = [
  {
    name: 'first row opens below with 6px gap',
    args: { anchor: firstRow, size: menu, viewport, placement: { align: 'end', side: 'bottom', gap: 6 } },
    expect: { side: 'bottom', gap: 6, inside: true },
  },
  {
    name: 'last row flips above with 6px gap',
    args: { anchor: lastRow, size: menu, viewport, placement: { align: 'end', side: 'bottom', gap: 6 } },
    expect: { side: 'top', gap: 6, inside: true },
  },
  {
    name: 'left edge menu clamps to viewport padding',
    args: { anchor: leftEdge, size: menu, viewport, placement: { align: 'end', side: 'bottom', gap: 6 } },
    expect: { side: 'bottom', gap: 6, inside: true },
  },
  {
    name: 'taller than viewport clamps both edges',
    args: { anchor: firstRow, size: { width: 195, height: 1100 }, viewport, placement: { align: 'end', side: 'bottom', gap: 6 } },
    expect: { side: 'bottom', gap: 6, inside: true },
  },
  {
    name: 'context menu point flips above pointer',
    args: {
      anchor: { left: 100, top: 850, right: 100, bottom: 850, width: 0, height: 0 },
      size: { width: 208, height: 260 },
      viewport,
      placement: { align: 'start', side: 'bottom', gap: 0 },
    },
    expect: { side: 'top', gap: 0, inside: true },
  },
]

for (const testCase of cases) {
  const result = computeAnchoredPosition(testCase.args)
  const anchor = testCase.args.anchor
  const gap = result.side === 'bottom' ? result.top - anchor.bottom : anchor.top - (result.top + result.height)
  assert.equal(result.side, testCase.expect.side, `${testCase.name}: side`)
  if (result.height < result.maxHeight) {
    assert.ok(Math.abs(gap - testCase.expect.gap) <= 1, `${testCase.name}: gap ${gap}`)
  }
  assert.ok(result.left >= 8 - 0.01, `${testCase.name}: left ${result.left}`)
  assert.ok(result.top >= 8 - 0.01, `${testCase.name}: top ${result.top}`)
  assert.ok(result.left + result.width <= 1432 + 0.01, `${testCase.name}: right ${result.left + result.width}`)
  assert.ok(result.top + result.height <= 892 + 0.01, `${testCase.name}: bottom ${result.top + result.height}`)
  console.log(`ok - ${testCase.name}:`, JSON.stringify(result))
}

const submenuRight = computeAnchoredPosition({
  anchor: { left: 600, top: 200, right: 626, bottom: 226, width: 26, height: 26 },
  size: menu,
  viewport,
  placement: { align: 'start', side: 'bottom', gap: 6 },
})
assert.equal(submenuRight.submenuSide, 'right')
const submenuLeft = computeAnchoredPosition({
  anchor: { left: 1370, top: 200, right: 1396, bottom: 226, width: 26, height: 26 },
  size: menu,
  viewport,
  placement: { align: 'end', side: 'bottom', gap: 6 },
})
assert.equal(submenuLeft.submenuSide, 'left')
console.log('ok - submenu side flips near the right edge:', submenuRight.submenuSide, submenuLeft.submenuSide)

const point = (x: number, y: number) => ({ left: x, top: y, right: x, bottom: y, width: 0, height: 0 })
const pointerMenu = { width: 208, height: 260 }
const pointerPlacement = { align: 'start' as const, side: 'bottom' as const, gap: 6, padding: 8, pointer: true }

const pointerDownRight = computeAnchoredPosition({ anchor: point(100, 400), size: pointerMenu, viewport, placement: pointerPlacement })
assert.equal(pointerDownRight.left, 106)
assert.equal(pointerDownRight.top, 406)

const pointerFlipLeft = computeAnchoredPosition({ anchor: point(1400, 400), size: pointerMenu, viewport, placement: pointerPlacement })
assert.equal(pointerFlipLeft.left + pointerMenu.width, 1394)

const pointerFlipUp = computeAnchoredPosition({ anchor: point(100, 850), size: pointerMenu, viewport, placement: pointerPlacement })
assert.equal(pointerFlipUp.top + pointerMenu.height, 844)

const pointerFlipCorner = computeAnchoredPosition({ anchor: point(1430, 890), size: pointerMenu, viewport, placement: pointerPlacement })
assert.ok(pointerFlipCorner.left >= 8 && pointerFlipCorner.left + pointerMenu.width <= 1432)
assert.ok(pointerFlipCorner.top >= 8 && pointerFlipCorner.top + pointerMenu.height <= 892)
console.log('ok - pointer menus keep a 6px gap and flip left/up near edges:', JSON.stringify(pointerFlipCorner))
