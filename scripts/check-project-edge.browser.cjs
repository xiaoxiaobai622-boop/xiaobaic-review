async (host) => {
  const context = await host.context().browser().newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 960 } })
  const page = await context.newPage()
  const origin = 'http://localhost:3000'
  const failures = []
  const check = (condition, message) => { if (!condition) failures.push(message) }
  const errors = []
  let projectRequests = 0
  let failProjects = true
  const project = { id: 'p1', projectCode: 'CITY', slug: 'city', shareCode: null, title: '城市之间 · 调色审阅', description: null, status: 'IN_REVIEW', companyName: '光影工作室', clientCompanyId: null, clientCompany: null, groupId: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), dueDate: null, videos: [{ id: 'v1', status: 'READY', reviewStatus: 'IN_REVIEW' }], recipients: [], _count: { videos: 1, comments: 2 } }
  page.on('pageerror', error => errors.push(error.message))
  await page.route(`${origin}/api/**`, route => {
    const request = route.request()
    if (!['GET', 'HEAD'].includes(request.method())) return route.abort()
    const url = request.url()
    if (url.includes('/api/auth/session')) return route.fulfill({ json: { authenticated: true, user: { id: 'p', email: 'p@example.invalid', phone: '13800000000', name: '项目样本', avatarUrl: null, onboardingCompleted: true, isPlatformAdmin: false, teams: [{ role: 'OWNER', team: { id: 'nav-team', name: '导航团队', createdBy: { name: '项目样本' } } }] } } })
    if (url.includes('/api/projects')) {
      projectRequests += 1
      if (failProjects) return route.fulfill({ status: 500, json: { error: 'fixture failure' } })
      return route.fulfill({ json: { projects: [project] } })
    }
    if (url.includes('/api/studio/project-groups')) return route.fulfill({ json: { groups: [] } })
    if (url.includes('/api/studio/saved-views')) return route.fulfill({ json: { views: [] } })
    if (url.includes('/api/clients')) return route.fulfill({ json: { clients: [] } })
    return route.fulfill({ json: { items: [] } })
  })
  try {
    await page.addInitScript(() => localStorage.setItem('vitransfer_active_team_id', 'nav-team'))
    await page.goto(`${origin}/lab/projects?v=menus`)
    await page.locator('[data-project-menus]').waitFor()
    const switcher = page.locator('[aria-haspopup]').nth(4)
    await switcher.click()
    const panel = page.locator('[role="dialog"]').last()
    await panel.waitFor()
    await page.getByText('加载失败').first().waitFor({ timeout: 15000 })
    const afterError = projectRequests
    await page.waitForTimeout(1500)
    check(projectRequests === afterError, `switcher must not retry while open (${afterError} -> ${projectRequests})`)
    check(await panel.getByRole('button', { name: '重试' }).count() === 1, 'switcher must show a retry action')
    failProjects = false
    await panel.getByRole('button', { name: '重试' }).click()
    await page.getByText('城市之间', { exact: false }).first().waitFor({ timeout: 15000 })
    check(projectRequests === afterError + 1, 'retry must fetch exactly once')

    // Batch bar menu must survive clicks on its own heading/padding.
    await page.keyboard.press('Escape')
    failProjects = false
    await page.goto(`${origin}/studio/projects`)
    await page.locator('#main-content').waitFor()
    await page.getByRole('button', { name: /批量管理/ }).click()
    await page.getByRole('button', { name: '选择项目' }).first().click()
    const move = page.getByRole('button', { name: /归入文件夹/ })
    await move.click()
    const batchMenu = page.locator('[role="menu"]').last()
    await batchMenu.waitFor()
    await batchMenu.click({ position: { x: 6, y: 6 } })
    await page.waitForTimeout(300)
    check(await batchMenu.count() === 1, 'clicking the batch menu heading must not close it')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
    check(await page.locator('[role="menu"]').count() === 0, 'Escape must close the batch menu')
    check(await page.evaluate(() => document.activeElement?.closest('[tabindex="-1"]') !== null || document.activeElement?.textContent?.includes('归入文件夹') === true || document.activeElement?.textContent?.includes('批量管理') === true), 'closing the batch menu must keep focus in the batch bar')

    check(errors.length === 0, `page errors: ${errors.join(' | ')}`)
    if (failures.length) throw new Error(JSON.stringify({ failures, projectRequests, errors }))
    return { projectRequests, errors, batchMenu: 'passed', retry: 'passed' }
  } finally { await context.close() }
}
