async (host) => {
  const context = await host.context().browser().newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 960 } })
  const page = await context.newPage()
  const origin = 'http://localhost:3000'
  const failures = []
  const check = (condition, message) => { if (!condition) failures.push(message) }
  const errors = []
  const writes = []
  page.on('pageerror', error => errors.push(error.message))
  const user = { id: 'nav-lab', email: 'nav@example.invalid', phone: '13800000000', name: '导航样本', avatarUrl: null, onboardingCompleted: true, isPlatformAdmin: false, teams: [{ role: 'OWNER', team: { id: 'nav-team', name: '导航团队', createdBy: { name: '导航样本' } } }, { role: 'MEMBER', team: { id: 'nav-team-2', name: '第二团队', createdBy: { name: '别人' } } }] }
  await page.route(`${origin}/api/**`, route => {
    const request = route.request()
    if (!['GET', 'HEAD'].includes(request.method())) { writes.push(request.url()); return route.abort() }
    if (request.url().includes('/api/auth/session')) return route.fulfill({ json: { authenticated: true, user } })
    if (request.url().includes('/api/comments/for-me')) return route.fulfill({ json: { items: [{ id: 'r1', content: '这一镜头的衔接很顺', timecode: '00:12', createdAt: new Date().toISOString(), authorName: '林', parentContent: '', videoName: '城市之间.mp4', projectTitle: '调色审阅', projectId: 'p1', videoId: 'v1' }] } })
    return route.fulfill({ json: { items: [] } })
  })
  try {
    await page.addInitScript(() => localStorage.setItem('vitransfer_active_team_id', 'nav-team'))
    await page.goto(`${origin}/studio/desktop`)
    await page.getByRole('heading', { level: 1 }).waitFor()
    check(await page.locator('#main-content').evaluate(e => e.textContent.includes('逐帧审阅桌面客户端')), 'desktop page must render for the fixture user')

    const bell = page.getByRole('button', { name: /通知/ })
    await bell.click()
    const panel = page.locator('[data-rail-panel="notifications"]')
    await panel.waitFor()
    const motion = await panel.evaluate(async e => {
      const animations = e.getAnimations().map(a => ({ property: a.transitionProperty, duration: a.effect.getTiming().duration }))
      const focusInside = e.contains(document.activeElement)
      await Promise.all(e.getAnimations().map(a => a.finished.catch(() => {})))
      return { animations, rect: e.getBoundingClientRect().toJSON(), focusInside }
    })
    check(motion.animations.some(a => a.property === 'opacity' && a.duration === 200), 'notification panel must use the shared 200ms entry')
    check(motion.animations.some(a => a.property === 'translate'), 'notification panel must slide from the rail')
    check(motion.focusInside, 'opening notifications must move focus inside')
    check(Math.abs(motion.rect.left - 56) < 1 && motion.rect.width === 288, `panel geometry ${JSON.stringify(motion.rect)}`)
    check(await panel.getByText('林 回复了你').count() === 1, 'fixture reply must render')
    await page.keyboard.press('Escape')
    await panel.waitFor({ state: 'detached' })
    check(await bell.evaluate(e => e === document.activeElement), 'Escape must return focus to the bell')

    await page.getByRole('button', { name: '帮助', exact: true }).click()
    await page.locator('[data-rail-panel="help"]').waitFor()
    await bell.click()
    await page.locator('[data-rail-panel="help"]').waitFor({ state: 'detached' })
    check(await panel.count() === 1, 'opening notifications must replace the help panel')
    await page.getByRole('button', { name: '关闭通知' }).click()
    await panel.waitFor({ state: 'detached' })
    check(await bell.evaluate(e => e === document.activeElement), 'close button must return focus to the bell')

    const avatar = page.getByRole('button', { name: '导航样本', exact: true })
    await avatar.click()
    const menu = page.getByRole('menu', { name: '导航样本' })
    await menu.waitFor()
    check(await menu.evaluate(e => e.contains(document.activeElement)), 'user menu must take focus')
    check(await menu.evaluate(e => e.getAnimations().some(a => a.transitionProperty === 'opacity')), 'user menu must fade in')
    const first = await page.evaluate(() => document.activeElement.textContent)
    await page.keyboard.press('ArrowDown')
    const second = await page.evaluate(() => document.activeElement.textContent)
    check(first !== second && await menu.evaluate(e => e.contains(document.activeElement)), 'ArrowDown must move within the user menu')
    await page.keyboard.press('End')
    check(await page.evaluate(() => document.activeElement.textContent.includes('退出')), 'End must reach sign-out')
    await page.keyboard.press('Escape')
    await menu.waitFor({ state: 'detached' })
    check(await avatar.evaluate(e => e === document.activeElement), 'Escape must return focus to the avatar')
    await avatar.click()
    await avatar.click()
    check(await menu.count() === 0, 'second avatar click must close the menu')

    const shots = []
    for (const [width, theme] of [[1440, 'dark'], [390, 'light']]) {
      await page.setViewportSize({ width, height: 844 })
      await page.evaluate(theme => document.documentElement.classList.toggle('dark', theme === 'dark'), theme)
      await bell.click()
      await panel.waitFor()
      await panel.evaluate(async e => { await Promise.all(e.getAnimations().map(a => a.finished.catch(() => {}))) })
      const rect = await panel.evaluate(e => e.getBoundingClientRect().toJSON())
      check(rect.left >= 0 && rect.right <= width, `${width}: panel overflow ${JSON.stringify(rect)}`)
      const tokens = await panel.evaluate(e => ({ bg: getComputedStyle(e).backgroundColor, text: getComputedStyle(e.querySelector('h2')).color }))
      shots.push({ width, theme, rect, tokens })
      await page.screenshot({ path: `/Users/xiaoxiaobai/Documents/Qoder/2026-10-26/573ed666/popup-evidence/rail-${width}-${theme}.png` })
      await page.keyboard.press('Escape')
      await panel.waitFor({ state: 'detached' })
    }
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await bell.click()
    await panel.waitFor()
    const reduced = await panel.evaluate(e => ({ duration: getComputedStyle(e).transitionDuration, translate: getComputedStyle(e).translate }))
    check(reduced.duration.split(',').every(d => parseFloat(d) < 0.001) && reduced.translate === 'none', `reduced motion ${JSON.stringify(reduced)}`)
    await page.keyboard.press('Escape')
    await page.emulateMedia({ reducedMotion: 'no-preference' })

    // 项目中心真页面吃的是别的接口形状，样本到这里只看过渡骨架，不再记它的数据错误。
    const errorsBeforeIndex = errors.length
    await page.goto(`${origin}/studio`, { waitUntil: 'commit', timeout: 90000 })
    await page.locator('[aria-busy="true"], [data-projects-dashboard], h1').first().waitFor({ timeout: 90000 })
    const skeleton = await page.locator('[aria-busy="true"]').count()
    await page.waitForURL(`${origin}/studio/projects`, { timeout: 90000 })
    check(errorsBeforeIndex === 0, `page errors: ${errors.join(' | ')}`)
    check(writes.length === 0, `writes: ${writes.join(', ')}`)
    if (failures.length) throw new Error(JSON.stringify({ failures, motion, shots, reduced, skeleton }))
    return { motion, shots, reduced, skeletonSeenOnStudioIndex: skeleton, errors, writes }
  } finally { await context.close() }
}
