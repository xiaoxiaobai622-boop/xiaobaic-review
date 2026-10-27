async (host) => {
  const context = await host.context().browser().newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 960 } })
  const page = await context.newPage()
  const origin = 'http://localhost:3000'
  const failures = []
  const errors = []
  const project = { id: 'p1', projectCode: 'CITY', slug: 'city', shareCode: null, title: '城市之间 · 调色审阅', description: null, status: 'IN_REVIEW', companyName: '光影工作室', clientCompanyId: null, clientCompany: null, groupId: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), dueDate: null, videos: [{ id: 'v1', status: 'READY', reviewStatus: 'IN_REVIEW' }], recipients: [], _count: { videos: 1, comments: 2 } }
  page.on('pageerror', error => errors.push(error.message))
  await page.route(`${origin}/api/**`, route => {
    const request = route.request()
    if (!['GET', 'HEAD'].includes(request.method())) return route.abort()
    const url = request.url()
    if (url.includes('/api/auth/session')) return route.fulfill({ json: { authenticated: true, user: { id: 'p', email: 'p@example.invalid', phone: '13800000000', name: '项目样本', avatarUrl: null, onboardingCompleted: true, isPlatformAdmin: false, teams: [{ role: 'OWNER', team: { id: 'nav-team', name: '导航团队', createdBy: { name: '项目样本' } } }] } } })
    if (url.includes('/api/projects')) return route.fulfill({ json: { projects: [project] } })
    if (url.includes('/api/studio/project-groups')) return route.fulfill({ json: { groups: [] } })
    if (url.includes('/api/studio/saved-views')) return route.fulfill({ json: { views: [] } })
    if (url.includes('/api/clients')) return route.fulfill({ json: { clients: [] } })
    return route.fulfill({ json: { items: [] } })
  })
  try {
    await page.addInitScript(() => localStorage.setItem('vitransfer_active_team_id', 'nav-team'))
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 })
      await page.goto(`${origin}/studio/projects`)
      await page.locator('[data-card-root]').waitFor()
      const trigger = page.getByRole('button', { name: '项目操作' }).first()
      await trigger.click()
      const menu = page.getByRole('menu', { name: '项目操作' })
      await menu.waitFor()
      const info = await menu.evaluate(async e => {
        await Promise.all(e.getAnimations().map(a => a.finished.catch(() => {})))
        const rect = e.getBoundingClientRect()
        return {
          insideCard: Boolean(e.closest('[data-card-root]')),
          focusInside: e.contains(document.activeElement),
          rect: { x: rect.x, right: rect.right, y: rect.y, bottom: rect.bottom },
          items: [...e.querySelectorAll('[role="menuitem"]')].length,
        }
      })
      if (info.insideCard) failures.push(`${width}: card menu must leave the card's overflow`)
      if (!info.focusInside) failures.push(`${width}: card menu must take focus`)
      if (info.rect.x < 7 || info.rect.right > width - 7 || info.rect.y < 7 || info.rect.bottom > 900 - 7) failures.push(`${width}: card menu outside viewport ${JSON.stringify(info.rect)}`)
      if (width === 1440) {
        await page.keyboard.press('ArrowDown')
        const moved = await menu.evaluate(e => e.contains(document.activeElement))
        if (!moved) failures.push('card menu arrow keys must move focus')
        await menu.click({ position: { x: 6, y: 6 } })
        await page.waitForTimeout(200)
        if (await menu.count() !== 1) failures.push('clicking inside the card menu must not dismiss it')
        await page.keyboard.press('Escape')
        await menu.waitFor({ state: 'detached' })
        if (!await trigger.evaluate(e => e === document.activeElement)) failures.push('Escape must return focus to the card menu trigger')
        await page.screenshot({ path: '/Users/xiaoxiaobai/Documents/Qoder/2026-10-26/573ed666/popup-evidence/card-menu-1440.png' })
      } else {
        await page.screenshot({ path: '/Users/xiaoxiaobai/Documents/Qoder/2026-10-26/573ed666/popup-evidence/card-menu-390.png' })
        await page.keyboard.press('Escape')
        await menu.waitFor({ state: 'detached' })
      }
    }
    if (errors.length) failures.push(`page errors: ${errors.join(' | ')}`)
    if (failures.length) throw new Error(JSON.stringify({ failures, errors }))
    return { result: 'passed', errors }
  } finally { await context.close() }
}
