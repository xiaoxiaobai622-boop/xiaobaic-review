async (host) => {
  const context = await host.context().browser().newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 960 } })
  const page = await context.newPage()
  const failures = []
  const check = (condition, message) => { if (!condition) failures.push(message) }
  const errors = []
  const writes = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('http://localhost:3000/api/**', route => {
    if (!['GET', 'HEAD'].includes(route.request().method())) { writes.push(route.request().url()); return route.abort() }
    if (route.request().url().includes('/auth/session')) return route.fulfill({ json: { authenticated: true, user: { id: 'controls-lab', email: 'controls@example.invalid', name: '本地样本', avatarUrl: null, onboardingCompleted: true, role: 'MEMBER', teams: [] } } })
    return route.continue()
  })
  try {
    await page.goto('http://localhost:3000/lab/projects?v=controls')
    await page.locator('[data-shared-controls]').waitFor()
    const motion = []
    for (const kind of ['dialog', 'select', 'tooltip']) {
      const result = await page.evaluate(async kind => {
        const frame = () => new Promise(resolve => requestAnimationFrame(resolve))
        const trigger = kind === 'dialog' ? document.querySelector('[data-control-dialog-trigger]') : kind === 'select' ? document.querySelector('[role="combobox"]') : [...document.querySelectorAll('button')].find(e => e.textContent === '查看提示')
        if (kind === 'select') trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
        else if (kind === 'tooltip') trigger.focus()
        else trigger.click()
        await frame(); await frame(); await frame()
        const panel = document.querySelector(kind === 'dialog' ? '[data-control-dialog]' : kind === 'select' ? '[role="listbox"]' : '[data-radix-popper-content-wrapper] > [data-state]')
        if (!panel) return { kind, missing: true }
        const animations = panel.getAnimations()
        const transitions = animations.map(a => ({ property: a.transitionProperty || null, duration: a.effect.getTiming().duration }))
        for (const animation of animations) { animation.pause(); animation.currentTime = 70 }
        const before = Number(getComputedStyle(panel).opacity)
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        await frame(); await frame()
        const after = Number(getComputedStyle(panel).opacity)
        const retained = panel.isConnected
        for (const animation of panel.getAnimations()) animation.play()
        await Promise.all(panel.getAnimations().map(a => a.finished.catch(() => {})))
        await frame(); await frame()
        return { kind, transitions, before, after, retained, removed: !panel.isConnected }
      }, kind)
      motion.push(result)
      check(!result.missing, `${kind}: surface did not open`)
      check(result.transitions?.some(a => a.property === 'opacity'), `${kind}: opening must use interruption-safe opacity transition`)
      check(result.transitions?.every(a => a.duration === 200), `${kind}: entry must use accepted 200ms timing`)
      check(result.retained && result.after <= result.before + 0.025, `${kind}: closing during entry must not flash brighter`)
      check(result.removed, `${kind}: exit must release retained DOM`)
    }
    if (failures.length) throw new Error(JSON.stringify({ failures, motion }))
    const trigger = page.locator('[data-control-dialog-trigger]')
    await trigger.click()
    await page.getByRole('combobox', { name: '弹窗选项' }).click()
    await page.waitForFunction(() => document.activeElement?.getAttribute('role') === 'option')
    await page.keyboard.press('End')
    await page.waitForFunction(() => document.activeElement?.textContent === '第二项')
    await page.keyboard.press('Enter')
    check(await page.getByRole('combobox', { name: '弹窗选项' }).innerText() === '第二项', 'nested select must change the value')
    await page.keyboard.press('Escape')
    await page.locator('[data-control-dialog]').waitFor({ state: 'detached' })
    check(await trigger.evaluate(e => e === document.activeElement), 'modal must restore trigger focus')
    await page.getByRole('combobox', { name: '样本状态' }).focus()
    await page.keyboard.press('ArrowDown')
    await page.waitForFunction(() => document.activeElement?.textContent === '审阅中')
    await page.keyboard.press('ArrowDown')
    await page.waitForFunction(() => document.activeElement?.textContent === '已完成')
    await page.keyboard.press('Enter')
    check(await page.getByRole('combobox', { name: '样本状态' }).innerText() === '已完成', 'select keyboard must skip disabled option')
    const geometry = []
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 960 })
      for (const theme of ['dark', 'light']) {
        await page.evaluate(theme => document.documentElement.classList.toggle('dark', theme === 'dark'), theme)
        for (const kind of ['dialog', 'select']) {
          await (kind === 'dialog' ? trigger : page.getByRole('combobox', { name: '样本状态' })).click()
          const panel = page.locator(kind === 'dialog' ? '[data-control-dialog]' : '[role="listbox"]')
          await panel.evaluate(async e => { await Promise.all(e.getAnimations().map(a => a.finished.catch(() => {}))) })
          const box = await panel.boundingBox()
          check(box.x >= 7 && box.x + box.width <= width - 7, `${kind}: ${width}/${theme} overflow`)
          if (kind === 'dialog') check(Math.abs(box.x + box.width / 2 - width / 2) < 1, 'modal centering must survive motion transforms')
          geometry.push({ width, theme, kind, box })
          await page.screenshot({ path: `/Users/xiaoxiaobai/Documents/Qoder/2026-10-26/573ed666/popup-evidence/controls-${width}-${theme}-${kind}.png` })
          await page.keyboard.press('Escape')
          await panel.waitFor({ state: 'detached' })
        }
      }
    }
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await trigger.click()
    const reduced = await page.locator('[data-control-dialog]').evaluate(e => ({ duration: getComputedStyle(e).transitionDuration, scale: getComputedStyle(e).scale, translate: getComputedStyle(e).translate }))
    check(reduced.duration.split(',').every(d => parseFloat(d) < 0.001), 'reduced motion must remove long transitions')
    check(['none', '1'].includes(reduced.scale), 'reduced motion must remove scaling')
    await page.keyboard.press('Escape')
    await page.locator('[data-control-dialog]').waitFor({ state: 'detached' })
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await page.getByRole('button', { name: '必填输入', exact: true }).click()
    await page.getByRole('button', { name: '确认', exact: true }).click()
    check(await page.locator('#app-dialog-input-error').innerText() === '此项不能为空', 'required prompt must retain validation feedback')
    await page.getByLabel('名称', { exact: true }).fill('本地验证')
    await page.getByRole('button', { name: '确认', exact: true }).click()
    check(await page.getByLabel('样本结果').innerText() === '本地验证', 'prompt must return unchanged input')
    await page.getByRole('dialog').waitFor({ state: 'detached' })
    const password = page.getByLabel('样本密码', { exact: true })
    await password.focus()
    await page.keyboard.press('Tab')
    check(await page.getByRole('button', { name: '显示密码' }).evaluate(e => e === document.activeElement), 'password toggle must be reachable after the input')
    await page.keyboard.press('Space')
    check(await password.getAttribute('type') === 'text', 'keyboard must reveal sample password')
    await page.getByRole('switch').click()
    check(await page.getByRole('button', { name: '隐藏密码' }).isDisabled(), 'disabled password must disable its toggle')
    check(await page.getByRole('combobox', { name: '样本状态' }).isDisabled(), 'disabled select must remain disabled')
    await page.getByRole('switch').click()
    await page.clock.install()
    await page.getByRole('button', { name: '显示消息', exact: true }).click()
    await page.clock.runFor(1000)
    await page.getByRole('button', { name: '显示消息', exact: true }).click()
    await page.clock.runFor(2000)
    check(await page.getByRole('status').filter({ hasText: '样本消息' }).allTextContents().then(values => JSON.stringify(values) === '["样本消息 2"]'), 'new messages must not renew older messages')
    await page.getByRole('status').filter({ hasText: '样本消息' }).hover()
    await page.clock.runFor(4000)
    check(await page.getByRole('status').filter({ hasText: '样本消息' }).count() === 1, 'hover must pause notice expiry')
    await page.getByRole('status').filter({ hasText: '样本消息' }).getByRole('button').focus()
    await page.getByRole('heading', { level: 1 }).hover()
    await page.clock.runFor(4000)
    check(await page.getByRole('status').filter({ hasText: '样本消息' }).count() === 1, 'keyboard focus must continue pausing after pointer leaves')
    await page.getByRole('button', { name: '显示消息', exact: true }).focus()
    await page.clock.runFor(1000)
    check(await page.getByRole('status').filter({ hasText: '样本消息' }).count() === 0, 'notice must resume only its remaining lifetime')
    check(errors.length === 0, `page errors: ${errors.join(', ')}`)
    check(writes.length === 0, 'sample must not write API data')
    if (failures.length) throw new Error(JSON.stringify({ failures, motion, geometry, reduced, errors, writes }))
    return { motion, geometry, reduced, keyboard: 'passed', prompt: 'passed', errors, writes }
  } finally { await context.close() }
}
