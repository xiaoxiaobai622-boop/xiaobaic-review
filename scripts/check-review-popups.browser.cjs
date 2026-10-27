async (host) => {
  const context = await host.context().browser().newContext({ serviceWorkers: 'block' })
  const page = await context.newPage()
  try {
  const assert = {
    equal(actual, expected, message) { if (actual !== expected) throw new Error(message || `Expected ${expected}, received ${actual}`) },
    deepEqual(actual, expected) { if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`) },
    ok(value, message) { if (!value) throw new Error(message || 'Assertion failed') },
  }
  const origin = 'http://localhost:3000'
  await page.route(`${origin}/api/auth/session`, route => route.fulfill({
    json: { authenticated: true, user: { id: 'popup-lab-test', email: 'popup-lab@example.invalid', name: '浮层测试', avatarUrl: null, onboardingCompleted: true, role: 'MEMBER', teams: [] } },
  }))
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.goto(`${origin}/lab/projects?v=popups&pane=baseline`)
  await page.locator('[data-popup-sample]').waitFor()
  const baseline = await page.locator('[data-testid="time-format-trigger"]').evaluate(async trigger => {
    trigger.click()
    await new Promise(resolve => requestAnimationFrame(resolve))
    const menu = document.querySelector('[role="menu"]')
    trigger.click()
    await new Promise(resolve => requestAnimationFrame(resolve))
    return { retained: menu?.isConnected }
  })
  assert.equal(baseline.retained, false)

  await page.goto(`${origin}/lab/projects?v=popups&pane=candidate`)
  await page.locator('[data-popup-sample="candidate"]').waitFor()
  const motion = await page.locator('[data-testid="time-format-trigger"]').evaluate(async trigger => {
    const frame = () => new Promise(resolve => requestAnimationFrame(resolve))
    trigger.click()
    await frame(); await frame()
    const panel = document.getElementById(trigger.getAttribute('aria-controls'))
    const opening = panel.getAnimations().map(animation => ({ property: animation.transitionProperty, duration: animation.effect.getTiming().duration, easing: animation.effect.getTiming().easing }))
    for (const animation of panel.getAnimations()) { animation.pause(); animation.currentTime = 0 }
    const startMatrix = new DOMMatrix(getComputedStyle(panel).transform)
    const startTransform = { scale: startMatrix.a, y: startMatrix.f }
    for (const animation of panel.getAnimations()) animation.play()
    await Promise.all(panel.getAnimations().map(animation => animation.finished))
    const rect = panel.getBoundingClientRect()
    const anchor = trigger.getBoundingClientRect()
    const initialFocus = panel.contains(document.activeElement)
    trigger.focus()
    trigger.click()
    await frame(); await frame()
    const retained = panel.isConnected
    const closing = panel.getAnimations().map(animation => animation.effect.getTiming().duration)
    trigger.focus()
    trigger.click()
    await frame(); await frame()
    await Promise.all(panel.getAnimations().map(animation => animation.finished.catch(() => {})))
    return { opening, startTransform, closing, retained, initialFocus, reopenFocus: panel.contains(document.activeElement), reopened: panel.isConnected && trigger.getAttribute('aria-expanded') === 'true', gap: anchor.top - rect.bottom }
  })
  assert.equal(motion.retained, true, 'closing popup must remain mounted for exit')
  assert.equal(motion.reopened, true, 'stale exit must not remove a reopened popup')
  assert.equal(motion.initialFocus, true, 'opening must focus the selected menu item')
  assert.equal(motion.reopenFocus, true, 'rapid reopening must focus the retained content again')
  assert.equal(motion.opening[0].duration, 200)
  assert.equal(motion.opening[0].easing, 'cubic-bezier(0.2, 0.4, 0.1, 1)')
  assert.ok(motion.closing.length > 0 && motion.closing.every(duration => duration === 125))
  assert.ok(Math.abs(motion.startTransform.scale - 0.97) < 0.001)
  assert.ok(Math.abs(motion.startTransform.y - 7.76) < 0.01)
  assert.ok(Math.abs(motion.gap - 4) < 1)
  await page.keyboard.press('Escape')
  await page.locator('[data-testid="time-format-trigger"]').waitFor()
  const trigger = page.getByRole('button', { name: '添加表情符号', exact: true })
  await trigger.click()
  await trigger.click()
  assert.equal(await trigger.getAttribute('aria-expanded'), 'false')
  await page.getByRole('dialog', { name: '选择表情符号', exact: true }).waitFor({ state: 'hidden' })
  await trigger.click()
  await page.keyboard.press('Escape')
  assert.equal(await trigger.evaluate(el => el === document.activeElement), true)

  for (const width of [390, 768]) {
    await page.setViewportSize({ width, height: 844 })
    for (const name of ['添加表情符号', '评论可见性：公共', '更多']) {
      const control = page.getByRole('button', { name, exact: true })
      await control.click()
      const rect = await control.evaluate(async el => {
        const panel = document.getElementById(el.getAttribute('aria-controls'))
        await Promise.all(panel.getAnimations().map(animation => animation.finished.catch(() => {})))
        const r = panel.getBoundingClientRect()
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: innerWidth, height: innerHeight }
      })
      assert.ok(rect.left >= 7 && rect.right <= rect.width - 7 && rect.top >= 7 && rect.bottom <= rect.height - 7, JSON.stringify({ name, rect }))
      await page.keyboard.press('Escape')
    }
  }
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await trigger.click()
  const reduced = await trigger.evaluate(el => getComputedStyle(document.getElementById(el.getAttribute('aria-controls'))).transitionDuration)
  assert.equal(reduced, '1e-05s')
  await page.keyboard.press('Escape')
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.setViewportSize({ width: 1440, height: 960 })
  for (const inline of [true, false]) {
    await page.goto(`${origin}/lab/projects?v=popups&pane=candidate&inline=${inline}`)
    const time = page.locator('[data-testid="time-format-trigger"]')
    const input = page.getByRole('textbox')
    await time.click()
    await page.keyboard.press('Tab')
    assert.equal(await time.getAttribute('aria-expanded'), 'false')
    assert.equal(await input.evaluate(el => el === document.activeElement), true, 'Tab must continue after the time trigger')
    await time.click()
    await page.keyboard.press('Shift+Tab')
    assert.equal(await time.getAttribute('aria-expanded'), 'false')
    assert.equal(await time.evaluate(el => el === document.activeElement), true)

    const more = page.getByRole('button', { name: '更多', exact: true })
    await more.click()
    await page.keyboard.press('Tab')
    assert.equal(await page.getByRole('slider', { name: '样本音量' }).evaluate(el => el === document.activeElement), true)
    assert.equal(await more.getAttribute('aria-expanded'), 'true')
    await page.keyboard.press('Tab')
    assert.equal(await page.getByRole('button', { name: '快捷键', exact: true }).evaluate(el => el === document.activeElement), true)
    await page.keyboard.press('Tab')
    assert.equal(await more.getAttribute('aria-expanded'), 'false')
    assert.equal(await time.evaluate(el => el === document.activeElement), true, 'Tab at the dialog boundary must return to the page order')
    await more.click()
    await page.keyboard.press('Shift+Tab')
    assert.equal(await more.getAttribute('aria-expanded'), 'false')
    assert.equal(await more.evaluate(el => el === document.activeElement), true)

    await input.fill('前后')
    await input.evaluate(el => el.setSelectionRange(1, 1))
    const emojiTrigger = page.getByRole('button', { name: '添加表情符号', exact: true })
    await emojiTrigger.click()
    const emoji = String.fromCodePoint(0x1f600)
    await page.getByRole('button', { name: emoji, exact: true }).click()
    await page.getByRole('dialog', { name: '选择表情符号', exact: true }).waitFor({ state: 'hidden' })
    assert.equal(await input.inputValue(), `前${emoji}后`)
    await page.waitForFunction(() => document.activeElement?.tagName === 'TEXTAREA' && document.activeElement.selectionStart === 3)
    assert.equal(await input.evaluate(el => el.selectionStart === 3 && el === document.activeElement), true, 'emoji insertion must restore the caret after its animation frame')
    await emojiTrigger.click()
    const visibility = page.locator('button[aria-label^="评论可见性"]')
    await visibility.click()
    assert.equal(await emojiTrigger.getAttribute('aria-expanded'), 'false')
    await page.getByRole('menuitemradio', { name: /内部评论/ }).click()
    assert.equal(await visibility.getAttribute('aria-expanded'), 'false')
    assert.equal(await visibility.getAttribute('aria-label'), '评论可见性：内部')
  }

  await page.goto(`${origin}/lab/projects?v=popups`)
  const left = page.locator('[data-popup-sample="baseline"]')
  const right = page.locator('[data-popup-sample="candidate"]')
  const leftTime = left.locator('[data-testid="time-format-trigger"]')
  const rightTime = right.locator('[data-testid="time-format-trigger"]')
  const leftValue = await leftTime.textContent()
  await rightTime.click()
  await page.getByRole('menuitemradio', { name: '帧', exact: true }).click()
  assert.equal(await leftTime.textContent(), leftValue, 'candidate preferences must not change baseline')
  assert.ok((await rightTime.textContent()) !== leftValue)
  await leftTime.click()
  await left.getByRole('menuitemradio', { name: '时间码', exact: true }).click()
  assert.ok((await leftTime.textContent()) !== (await rightTime.textContent()))
  await right.getByRole('textbox').fill('仅右侧修改')
  assert.ok((await left.getByRole('textbox').inputValue()) !== '仅右侧修改')
  await page.getByRole('combobox', { name: '预览主题' }).selectOption('light')
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('dark')), false)
  assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), null)
  await page.getByRole('combobox', { name: '预览主题' }).selectOption('dark')
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('dark')), true)
  assert.equal(await page.locator('iframe').count(), 0)
  await page.reload()
  await leftTime.focus()
  await page.keyboard.press('Enter')
  let reachedCandidate = false
  for (let index = 0; index < 35; index++) {
    await page.keyboard.press('Tab')
    if (await right.getByRole('textbox').evaluate(el => el === document.activeElement)) { reachedCandidate = true; break }
  }
  assert.ok(reachedCandidate, 'the candidate composer must be keyboard reachable')
  await page.keyboard.press('ArrowDown')
  assert.equal(await right.getByRole('textbox').evaluate(el => el === document.activeElement), true, 'baseline document listeners must not intercept candidate keys')

  await page.reload()
  await right.waitFor()
  await right.evaluate(async root => {
    const a = root.querySelector('[data-testid="time-format-trigger"]')
    const b = root.querySelector('button[aria-label="更多"]')
    const frame = () => new Promise(resolve => requestAnimationFrame(resolve))
    a.click(); await frame(); await frame()
    b.focus(); b.click(); await frame()
    a.focus(); a.click(); await frame()
  })
  await page.keyboard.press('Escape')
  assert.equal(await rightTime.getAttribute('aria-expanded'), 'false', 'Escape must close the focused reopened popup, not an older exiting layer')
  assert.equal(await rightTime.evaluate(el => el === document.activeElement), true)
  await rightTime.click()
  const logicalClose = await page.getByRole('menuitemradio', { name: '帧', exact: true }).evaluate(async item => {
    item.click()
    await new Promise(resolve => requestAnimationFrame(resolve))
    return document.activeElement?.getAttribute('data-testid')
  })
  assert.equal(logicalClose, 'time-format-trigger', 'selection must restore focus before the exit animation finishes')
  await page.reload()
  const interruptedMotion = await rightTime.evaluate(async trigger => {
    const frame = () => new Promise(resolve => requestAnimationFrame(resolve))
    trigger.click(); await frame(); await frame()
    const panel = document.getElementById(trigger.getAttribute('aria-controls'))
    for (const animation of panel.getAnimations()) { animation.pause(); animation.currentTime = animation.effect.getTiming().duration / 10 }
    const beforeClose = Number(getComputedStyle(panel).opacity)
    trigger.click(); await frame()
    const afterClose = Number(getComputedStyle(panel).opacity)
    trigger.click(); await frame()
    const afterReopen = Number(getComputedStyle(panel).opacity)
    return { beforeClose, afterClose, afterReopen }
  })
  assert.ok(interruptedMotion.afterClose <= interruptedMotion.beforeClose, 'closing during entry must not jump toward full opacity')
  assert.ok(interruptedMotion.afterReopen >= interruptedMotion.afterClose, 'reopening during exit must not jump back to transparent')
  await page.keyboard.press('Escape')

  await page.getByRole('combobox', { name: '样本状态' }).selectOption('empty')
  await right.getByRole('textbox').fill('本页试用')
  await right.getByRole('textbox').press('Enter')
  assert.equal(await right.locator('section h2').locator('..').textContent(), '批注1', 'the empty fixture must count locally added comments')

  const priorTheme = await page.evaluate(() => localStorage.getItem('theme'))
  const priorDefault = await page.evaluate(() => localStorage.getItem('adminDefaultTheme'))
  let releaseTheme
  const themeGate = new Promise(resolve => { releaseTheme = resolve })
  await page.evaluate(() => localStorage.removeItem('theme'))
  await page.route(`${origin}/api/settings/theme`, async route => { await themeGate; await route.fulfill({ json: { defaultTheme: 'light' } }) })
  try {
    await page.goto(`${origin}/lab/projects?v=popups`)
    await right.waitFor()
    const themeResponse = page.waitForResponse(`${origin}/api/settings/theme`)
    releaseTheme()
    await themeResponse
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains('dark')), true, 'late app settings must not override the selected preview theme')
  } finally {
    releaseTheme()
    await page.unroute(`${origin}/api/settings/theme`)
    await page.evaluate(({ priorTheme, priorDefault }) => {
      for (const [key, value] of [['theme', priorTheme], ['adminDefaultTheme', priorDefault]]) {
        if (value === null) localStorage.removeItem(key)
        else localStorage.setItem(key, value)
      }
    }, { priorTheme, priorDefault })
  }
  assert.equal(await page.evaluate(() => localStorage.getItem('time_format')), null, 'the lab must not change production time preferences')
  assert.equal(await page.evaluate(() => localStorage.getItem('comment_emoji_recent')), null, 'the lab must not change production emoji history')
  return { baseline, motion, reduced, narrowWidths: [390, 768], layouts: ['inline', 'external'], tabOrder: 'passed', emojiCaret: 'passed', independentColumns: 'passed', interruptedExit: 'passed', delayedTheme: 'passed', productionPreferences: 'untouched' }
  } finally {
    await context.close()
  }
}
