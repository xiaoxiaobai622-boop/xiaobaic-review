async (host) => {
  const context = await host.context().browser().newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 } })
  const page = await context.newPage()
  const origin = 'http://localhost:3000'
  const failures = []
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const project = { id: 'p1', projectCode: 'CITY', slug: 'city', shareCode: null, title: '城市之间 · 调色审阅', description: null, status: 'IN_REVIEW', companyName: '光影工作室', clientCompanyId: null, clientCompany: null, groupId: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), dueDate: null, videos: [{ id: 'v1', status: 'READY', reviewStatus: 'IN_REVIEW' }], recipients: [], _count: { videos: 1, comments: 2 } }
  await page.route(`${origin}/api/**`, route => {
    const request = route.request()
    if (!['GET', 'HEAD'].includes(request.method())) return route.abort()
    const url = request.url()
    if (url.includes('/api/auth/session')) return route.fulfill({ json: { authenticated: true, user: { id: 's', email: 's@example.invalid', phone: '13800000000', name: '滑动样本', avatarUrl: null, onboardingCompleted: true, isPlatformAdmin: false, teamRole: 'OWNER', teams: [{ role: 'OWNER', team: { id: 'nav-team', name: '导航团队', createdBy: { name: '滑动样本' } } }] } } })
    if (url.includes('/api/projects')) return route.fulfill({ json: { projects: [project] } })
    if (url.includes('/api/studio/project-groups')) return route.fulfill({ json: { groups: [] } })
    if (url.includes('/api/studio/saved-views')) return route.fulfill({ json: { views: [] } })
    if (url.includes('/api/clients')) return route.fulfill({ json: { clients: [] } })
    if (url.includes('/api/studio/search')) return route.fulfill({ json: { projects: [], assets: [], truncated: false } })
    return route.fulfill({ json: { items: [] } })
  })

  const measure = async (container, activeSelector, nextIndex) => {
    const result = await container.evaluate(async (root, args) => {
      const [activeSelector, nextIndex] = args
      const buttons = [...root.querySelectorAll('[data-segment]')]
      const thumb = root.querySelector(':scope > span[aria-hidden="true"]')
      const first = buttons.find((button) => button.matches(activeSelector)) || buttons[0]
      const style = thumb ? getComputedStyle(thumb) : null
      const before = thumb ? thumb.getBoundingClientRect() : null
      const target = buttons[nextIndex]
      target.click()
      await new Promise((resolve) => setTimeout(resolve, 260))
      const afterThumb = root.querySelector(':scope > span[aria-hidden="true"]')
      const after = afterThumb ? afterThumb.getBoundingClientRect() : null
      const targetRect = target.getBoundingClientRect()
      return {
        thumb: Boolean(thumb),
        duration: style?.transitionDuration ?? null,
        properties: style?.transitionProperty ?? null,
        beforeX: before?.x ?? null,
        afterX: after?.x ?? null,
        targetX: targetRect.x,
        afterWidth: after?.width ?? null,
        targetWidth: targetRect.width,
        containerOverflow: root.scrollWidth > root.clientWidth + 1,
      }
    }, [activeSelector, nextIndex])
    return result
  }

  try {
    await page.addInitScript(() => localStorage.setItem('vitransfer_active_team_id', 'nav-team'))

    // 项目中心：视图切换
    await page.goto(`${origin}/studio/projects`)
    await page.locator('[data-card-root]').waitFor()
    const viewToggle = page.locator('[data-segment]').first().locator('..')
    const view = await measure(viewToggle, '[aria-pressed="true"]', 1)
    if (!view.thumb) failures.push('view toggle must render a sliding thumb')
    if (view.afterX === null || Math.abs(view.afterX - view.targetX) > 1) failures.push(`view thumb must land on the active button (${view.afterX} vs ${view.targetX})`)
    if (Math.abs((view.afterWidth ?? 0) - view.targetWidth) > 1) failures.push('view thumb width must match the active button')
    if (!String(view.properties).includes('transform')) failures.push('view thumb must animate transform')
    if (view.duration !== '0.15s') failures.push(`view thumb duration ${view.duration}`)

    // 搜索页：类型/排序分段
    await page.goto(`${origin}/studio/search`)
    await page.getByRole('button', { name: '项目', exact: true }).waitFor()
    const searchContainer = page.getByRole('button', { name: '项目', exact: true }).locator('xpath=..')
    const search = await measure(searchContainer, '[aria-pressed="true"]', 1)
    if (!search.thumb) failures.push('search segments must render a sliding thumb')
    if (search.afterX === null || Math.abs(search.afterX - search.targetX) > 1) failures.push(`search thumb must land on the active button (${search.afterX} vs ${search.targetX})`)

    // 日历：视图切换
    await page.goto(`${origin}/studio/calendar`)
    const calendarButton = page.getByRole('button', { name: /甘特|时间线|Gantt/ }).first()
    await calendarButton.waitFor({ timeout: 60000 }).catch(() => {})
    if (await calendarButton.count()) {
      const calendar = await measure(calendarButton.locator('xpath=..'), '[aria-pressed="true"]', 1)
      if (!calendar.thumb) failures.push('calendar view switch must render a sliding thumb')
    } else {
      failures.push('calendar view switch not found')
    }

    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`${origin}/studio/search`)
    await page.getByRole('button', { name: '项目', exact: true }).waitFor()
    const narrow = await page.getByRole('button', { name: '项目', exact: true }).locator('xpath=..').evaluate(root => ({ overflow: root.scrollWidth > root.clientWidth + 1, thumb: Boolean(root.querySelector(':scope > span[aria-hidden="true"]')) }))
    if (narrow.overflow || !narrow.thumb) failures.push(`narrow search segments ${JSON.stringify(narrow)}`)

    if (errors.length) failures.push(`page errors: ${errors.join(' | ')}`)
    if (failures.length) throw new Error(JSON.stringify({ failures, view, search, errors }))
    return { view, search, narrow, errors }
  } finally { await context.close() }
}
