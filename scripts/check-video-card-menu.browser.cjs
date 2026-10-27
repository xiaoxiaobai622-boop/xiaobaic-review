async (host) => {
  const context = await host.context().browser().newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 } })
  const page = await context.newPage()
  const origin = 'http://localhost:3000'
  const failures = []
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const now = new Date().toISOString()
  const video = { id: 'v1', name: '城市之间', version: 3, versionLabel: 'v3', status: 'READY', reviewStatus: 'IN_REVIEW', createdAt: now, updatedAt: now, folderId: null, duration: 39.4, fps: 25, width: 960, height: 506, originalFileName: 'city-v3.mp4', sourceType: 'UPLOAD' }
  const project = { id: 'p1', title: '样本项目', status: 'IN_REVIEW', restrictCommentsToLatestVersion: false, folders: [], videos: [video], recipients: [], companyName: null, projectCode: 'SAMPLE', slug: 'sample', createdAt: now, updatedAt: now, dueDate: null, allowReverseShare: false, videosCount: 1 }
  await page.route(`${origin}/api/**`, route => {
    const request = route.request()
    if (!['GET', 'HEAD', 'PATCH', 'POST', 'DELETE'].includes(request.method())) return route.abort()
    const url = request.url()
    if (url.includes('/api/auth/session')) return route.fulfill({ json: { authenticated: true, user: { id: 'u', email: 'u@example.invalid', phone: '13800000000', name: '样本', avatarUrl: null, onboardingCompleted: true, isPlatformAdmin: false, teamRole: 'OWNER', teams: [{ role: 'OWNER', team: { id: 'nav-team', name: '导航团队', createdBy: { name: '样本' } } }] } } })
    if (/\/api\/projects\/p1$/.test(url)) return route.fulfill({ json: project })
    if (url.includes('/api/team-center')) return route.fulfill({ json: { team: { id: 'nav-team', name: '导航团队' }, quota: null } })
    if (url.includes('/api/studio/video-token')) return route.fulfill({ json: { token: null } })
    if (url.includes('/api/share/url')) return route.fulfill({ json: { url: '' } })
    return route.fulfill({ json: { items: [], projects: [], groups: [], videos: [] } })
  })
  try {
    await page.addInitScript(() => localStorage.setItem('vitransfer_active_team_id', 'nav-team'))
    await page.goto(`${origin}/studio/projects/p1?workspace=videos`)
    const trigger = page.getByRole('button', { name: '视频操作' }).first()
    await trigger.waitFor({ timeout: 30000 })
    await trigger.click()
    const menu = page.getByRole('menu', { name: '视频操作' })
    await menu.waitFor()
    const opened = await menu.evaluate(async e => {
      const animations = e.getAnimations().map(a => ({ property: a.transitionProperty, duration: a.effect.getTiming().duration }))
      const focusInside = e.contains(document.activeElement)
      await Promise.all(e.getAnimations().map(a => a.finished.catch(() => {})))
      const rect = e.getBoundingClientRect()
      return { animations, focusInside, rect: { x: rect.x, right: rect.right, y: rect.y, bottom: rect.bottom } }
    })
    if (!opened.animations.some(a => a.property === 'opacity' && a.duration === 200)) failures.push('card menu must use the shared 200ms entry')
    if (!opened.focusInside) failures.push('card menu must take focus')
    if (opened.rect.x < 7 || opened.rect.right > 1280 - 7 || opened.rect.y < 7 || opened.rect.bottom > 900 - 7) failures.push(`card menu outside viewport ${JSON.stringify(opened.rect)}`)

    // hover highlight must be transitioned
    const itemTransition = await menu.getByRole('menuitem').nth(1).evaluate(e => getComputedStyle(e).transitionProperty)
    if (!itemTransition.includes('background-color')) failures.push(`menu item transition ${itemTransition}`)

    // submenu: ArrowRight opens it, Escape closes only the submenu
    await menu.getByRole('menuitem', { name: '分享' }).focus()
    await page.keyboard.press('ArrowRight')
    const submenu = page.locator('[data-submenu-panel="share"]')
    await submenu.waitFor()
    if (!await submenu.evaluate(e => Boolean(e.closest('[data-state="open"]')))) failures.push('submenu must live inside the open menu')
    await page.keyboard.press('Escape')
    await submenu.waitFor({ state: 'detached' })
    if (!await menu.count()) failures.push('Escape inside a submenu must keep the parent menu open')
    await page.keyboard.press('Escape')
    await menu.waitFor({ state: 'detached' })
    if (!await trigger.evaluate(e => e === document.activeElement)) failures.push('closing the menu must restore focus to its trigger')

    await trigger.click()
    await menu.waitFor()
    await page.getByRole('heading', { name: '样本项目' }).first().click({ position: { x: 2, y: 2 } }).catch(() => {})
    await menu.waitFor({ state: 'detached' })
    await page.screenshot({ path: '/Users/xiaoxiaobai/Documents/Qoder/2026-10-26/573ed666/popup-evidence/video-card-menu.png' })

    if (errors.length) failures.push(`page errors: ${errors.join(' | ')}`)
    if (failures.length) throw new Error(JSON.stringify({ failures, opened, errors }))
    return { opened, itemTransition, submenu: 'passed', errors }
  } finally { await context.close() }
}
