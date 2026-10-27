async (host) => {
  const context = await host.context().browser().newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 } })
  const page = await context.newPage()
  const origin = 'http://localhost:3000'
  const failures = []
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const settings = { maxUploadSizeGB: 5, defaultApplyPreviewLut: false, defaultUsePreviewForApprovedPlayback: false, defaultAllowClientAssetUpload: false, defaultAllowReverseShare: false, defaultShowClientTutorial: true, defaultAllowAssetDownload: true, defaultClientCanApprove: false }
  await page.route(`${origin}/api/**`, route => {
    const request = route.request()
    if (!['GET', 'HEAD', 'PATCH'].includes(request.method())) return route.abort()
    const url = request.url()
    if (url.includes('/api/auth/session')) return route.fulfill({ json: { authenticated: true, user: { id: 's', email: 's@example.invalid', phone: '13800000000', name: '设置样本', avatarUrl: null, onboardingCompleted: true, isPlatformAdmin: false, teamRole: 'OWNER', teams: [{ role: 'OWNER', team: { id: 'nav-team', name: '导航团队', createdBy: { name: '设置样本' } } }] } } })
    if (url.includes('/api/team-settings')) return route.fulfill({ json: { settings } })
    return route.fulfill({ json: { items: [] } })
  })
  try {
    await page.addInitScript(() => localStorage.setItem('vitransfer_active_team_id', 'nav-team'))
    await page.goto(`${origin}/studio/team/settings`)
    await page.getByRole('heading', { name: '视频设置' }).waitFor()
    const toggle = page.getByRole('checkbox').first()
    await toggle.click()
    const dirtyHint = page.getByText('有未保存的修改')
    await dirtyHint.waitFor()
    const beforeUnload = await page.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(event)
      return event.defaultPrevented
    })
    if (!beforeUnload) failures.push('beforeunload must be prevented while dirty')

    await page.locator('a[href="/studio/calendar"]').click()
    const dialog = page.getByRole('dialog')
    await dialog.waitFor()
    await dialog.getByRole('button', { name: '取消', exact: true }).click()
    await dialog.waitFor({ state: 'detached' })
    if (!page.url().endsWith('/studio/team/settings')) failures.push('cancelling must keep the user on settings')

    await page.locator('a[href="/studio/calendar"]').click()
    await page.getByRole('dialog').waitFor()
    await page.getByRole('dialog').getByRole('button', { name: '确认', exact: true }).click()
    await page.waitForURL(`${origin}/studio/calendar`, { timeout: 60000 })

    if (errors.length) failures.push(`page errors: ${errors.join(' | ')}`)
    if (failures.length) throw new Error(JSON.stringify({ failures, beforeUnload, errors }))
    return { beforeUnload, guard: 'passed', errors }
  } finally { await context.close() }
}
