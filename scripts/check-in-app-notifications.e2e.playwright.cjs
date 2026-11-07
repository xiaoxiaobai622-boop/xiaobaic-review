async (browserPage) => {
  const context = await browserPage.context().browser().newContext({ viewport: { width: 1280, height: 900 } })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  try {
    await page.goto('http://127.0.0.1:9998/')
    const data = JSON.parse(await page.textContent('body'))
    await context.addInitScript(({ refreshToken, teamId }) => {
      localStorage.setItem('vitransfer_refresh_token', refreshToken)
      localStorage.setItem('vitransfer_active_team_id', teamId)
    }, { refreshToken: data.refreshToken, teamId: data.teamId })

    await page.goto('http://localhost:3457/studio/projects')
    await page.getByRole('button', { name: /通知/ }).first().waitFor({ timeout: 45000 })
    if (page.url().includes('/login')) throw new Error(`redirected to login: ${page.url()}`)

    await page.getByRole('button', { name: /通知/ }).first().click()
    const panel = page.locator('[data-rail-panel="notifications"]')
    await panel.waitFor()
    const teamRow = panel.getByText('E2E Client 上传了 2 个文件')
    await teamRow.waitFor({ timeout: 45000 })

    const tabsBefore = await panel.getByRole('tab').allInnerTexts()
    if (!tabsBefore.some(text => /团队动态\s*1/.test(text))) throw new Error(`team unread missing: ${JSON.stringify(tabsBefore)}`)
    if (!tabsBefore.some(text => /@我的\s*1/.test(text))) throw new Error(`mention unread missing: ${JSON.stringify(tabsBefore)}`)

    await panel.getByRole('button', { name: '全部标记为已读' }).click()
    await page.waitForFunction(() => {
      const panel = document.querySelector('[data-rail-panel="notifications"]')
      if (!panel) return false
      const tab = [...panel.querySelectorAll('[role="tab"]')].find((node) => node.textContent?.includes('团队动态'))
      return Boolean(tab && !/团队动态\s*1/.test(tab.textContent || ''))
    }, undefined, { timeout: 15000 })
    const tabsAfter = await panel.getByRole('tab').allInnerTexts()
    const teamTab = tabsAfter.find(text => text.startsWith('团队动态')) || ''
    if (/团队动态\s*1/.test(teamTab)) throw new Error(`team unread not cleared: ${JSON.stringify(tabsAfter)}`)

    await panel.getByRole('tab', { name: /@我的/ }).click()
    const mentionRow = panel.getByText('E2E Member 在批注中 @了你')
    await mentionRow.waitFor({ timeout: 30000 })
    await mentionRow.click()
    await page.waitForURL(new RegExp(`/studio/projects/${data.projectId}/share`), { timeout: 45000 })
    const url = page.url()
    if (!url.includes(`comment=${data.mentionCommentId}`)) throw new Error(`comment deep link missing: ${url}`)
    if (errors.length) throw new Error(`page errors: ${errors.join(' | ')}`)
    return { url, tabsBefore, tabsAfter, errors }
  } finally {
    await context.close()
  }
}
