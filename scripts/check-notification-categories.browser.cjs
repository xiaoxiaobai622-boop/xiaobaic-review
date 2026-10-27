async (host) => {
  const context = await host.context().browser().newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 } })
  const page = await context.newPage()
  const origin = 'http://localhost:3000'
  const failures = []
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const now = new Date().toISOString()
  await page.route(`${origin}/api/**`, route => {
    const request = route.request()
    if (request.method() !== 'GET') return route.abort()
    const url = request.url()
    if (url.includes('/api/auth/session')) return route.fulfill({ json: { authenticated: true, user: { id: 'u', email: 'u@example.invalid', phone: '13800000000', name: '通知样本', avatarUrl: null, onboardingCompleted: true, isPlatformAdmin: false, teamRole: 'OWNER', teams: [{ role: 'OWNER', team: { id: 'nav-team', name: '导航团队', createdBy: { name: '通知样本' } } }] } } })
    if (url.includes('/api/comments/for-me')) return route.fulfill({ json: { items: [{ id: 'r1', content: '这一镜头的衔接很顺', timecode: '00:12', createdAt: now, authorName: '林', parentContent: '', videoName: '城市之间.mp4', projectTitle: '调色审阅', projectId: 'p1', videoId: 'v1' }] } })
    if (url.includes('/api/announcements')) return route.fulfill({ json: { items: [{ id: 'a1', title: '平台维护通知', content: '今晚 23:00 维护', createdAt: now, readAt: null }] } })
    if (url.includes('/api/team-center')) return route.fulfill({ json: { teams: [], invitations: [{ id: 'i1', token: 'inv-token', role: 'ADMIN', createdAt: now, expiresAt: now, team: { id: 't2', name: '光影团队' } }], joinRequests: [], activeTeamId: 'nav-team' } })
    return route.fulfill({ json: { items: [] } })
  })
  try {
    await page.addInitScript(() => localStorage.setItem('vitransfer_active_team_id', 'nav-team'))
    await page.goto(`${origin}/studio/desktop`)
    await page.getByRole('heading', { level: 1 }).waitFor()
    await page.getByRole('button', { name: /通知/ }).first().click()
    const panel = page.locator('[data-rail-panel="notifications"]')
    await panel.waitFor()

    const tabs = panel.getByRole('tab')
    const labels = await tabs.allInnerTexts()
    if (JSON.stringify(labels.slice(0, 3)) !== JSON.stringify(['团队', '平台', '个人 1'])) failures.push(`tab order/labels ${JSON.stringify(labels)}`)
    if (await tabs.nth(0).getAttribute('aria-selected') !== 'true') failures.push('team must be the default tab')
    if (await panel.getByText('林 回复了你').count() !== 1) failures.push('team tab must show replies')
    if (await panel.getByText('平台维护通知').count() !== 0) failures.push('team tab must not show platform announcements')

    await tabs.nth(1).click()
    if (await panel.getByText('平台维护通知').count() !== 1) failures.push('platform tab must show announcements')
    if (await panel.getByText('林 回复了你').count() !== 0) failures.push('platform tab must hide replies')

    await tabs.nth(2).click()
    if (!await panel.getByText('邀请你加入 光影团队').isVisible()) failures.push('personal tab must show the invitation')
    if (await panel.getByText('角色：管理员').count() !== 1) failures.push('invitation must name the role')
    if (await panel.getByRole('button', { name: '全部标记为已读' }).count() !== 0) failures.push('personal tab must not offer mark-all-read')
    if (await panel.getByRole('button', { name: '全部', exact: true }).count() !== 0) failures.push('personal tab must not show the read filter')
    const href = await panel.getByText('邀请你加入 光影团队').locator('xpath=ancestor::button[1]').evaluate(el => el.outerHTML.includes('邀请'))
    if (!href) failures.push('invitation row missing')

    await page.setViewportSize({ width: 390, height: 844 })
    const rect = await panel.evaluate(el => el.getBoundingClientRect().toJSON())
    if (rect.right > 390 || rect.x < 0) failures.push(`panel overflow ${JSON.stringify(rect)}`)

    if (errors.length) failures.push(`page errors: ${errors.join(' | ')}`)
    if (failures.length) throw new Error(JSON.stringify({ failures, labels, errors }))
    return { labels, tabOrder: 'passed', personal: 'passed', errors }
  } finally { await context.close() }
}
