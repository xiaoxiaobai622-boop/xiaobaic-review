async (host) => {
  const context = await host.context().browser().newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 960 } })
  const page = await context.newPage()
  const origin = 'http://localhost:3000'
  const failures = []
  const errors = []
  const writes = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route(`${origin}/api/**`, route => {
    const request = route.request()
    if (!['GET', 'HEAD'].includes(request.method())) { writes.push(request.url()); return route.abort() }
    const url = request.url()
    if (url.includes('/api/auth/session')) return route.fulfill({ json: { authenticated: true, user: { id: 'proj-lab', email: 'proj@example.invalid', phone: '13800000000', name: '项目样本', avatarUrl: null, onboardingCompleted: true, isPlatformAdmin: false, teams: [{ role: 'OWNER', team: { id: 'nav-team', name: '导航团队', createdBy: { name: '项目样本' } } }] } } })
    if (url.includes('/api/projects')) return route.fulfill({ json: { projects: [] } })
    if (url.includes('/api/studio/project-groups')) return route.fulfill({ json: { groups: [] } })
    if (url.includes('/api/studio/saved-views')) return route.fulfill({ json: { views: [] } })
    if (url.includes('/api/clients')) return route.fulfill({ json: { clients: [] } })
    return route.fulfill({ json: { items: [] } })
  })
  try {
    await page.addInitScript(() => localStorage.setItem('vitransfer_active_team_id', 'nav-team'))
    await page.goto(`${origin}/studio/projects`)
    await page.locator('#main-content').waitFor()
    const empty = await page.locator('#main-content').innerText()
    const triggers = page.locator('[aria-haspopup]')
    const count = await triggers.count()
    const results = []
    for (let index = 0; index < Math.min(count, 4); index++) {
      await triggers.nth(index).click()
      const panel = page.locator('[role="dialog"], [role="menu"]').last()
      await panel.waitFor()
      const measured = await panel.evaluate(async e => {
        await Promise.all(e.getAnimations().map(a => a.finished.catch(() => {})))
        return { rect: e.getBoundingClientRect().toJSON(), width: e.getBoundingClientRect().width }
      })
      results.push(measured)
      await page.keyboard.press('Escape')
      await panel.waitFor({ state: 'detached' })
    }
    if (errors.length) failures.push(`page errors: ${errors.join(' | ')}`)
    if (writes.length) failures.push(`writes: ${writes.join(', ')}`)
    if (failures.length) throw new Error(JSON.stringify({ failures, empty: empty.slice(0, 400), count }))
    return { triggerCount: count, results, emptyExcerpt: empty.slice(0, 200), errors, writes }
  } finally { await context.close() }
}
