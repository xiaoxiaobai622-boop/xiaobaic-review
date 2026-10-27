async (host) => {
  const context = await host.context().browser().newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 960 } })
  const page = await context.newPage()
  const origin = 'http://localhost:3000'
  const failures = []
  const check = (condition, message) => { if (!condition) failures.push(message) }
  const errors = []
  const writes = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route(`${origin}/api/**`, route => {
    const request = route.request()
    if (!['GET', 'HEAD'].includes(request.method())) { writes.push(request.url()); return route.abort() }
    if (request.url().includes('/api/auth/session')) return route.fulfill({ json: { authenticated: true, user: { id: 'menu-lab', email: 'menu@example.invalid', phone: '13800000000', name: '菜单样本', avatarUrl: null, onboardingCompleted: true, isPlatformAdmin: false, teams: [{ role: 'OWNER', team: { id: 'nav-team', name: '导航团队', createdBy: { name: '菜单样本' } } }] } } })
    if (request.url().includes('/api/projects')) return route.fulfill({ json: { projects: [
      { id: 'sample-1', title: '城市之间 · 调色审阅', projectCode: 'CITY' },
      { id: 'sample-2', title: '品牌短片第二季 · 交付', projectCode: 'BRAND' },
      { id: 'sample-3', title: '很长的项目名称，用来检查切换器在窄屏下是否会撑破面板边界并保持单行截断', projectCode: 'LONG' },
    ] } })
    return route.fulfill({ json: { items: [] } })
  })
  try {
    await page.addInitScript(() => localStorage.setItem('vitransfer_active_team_id', 'nav-team'))
    await page.goto(`${origin}/lab/projects?v=menus`)
    await page.locator('[data-project-menus]').waitFor()

    const panels = []
    const openAndMeasure = async (trigger, panelSelector) => {
      await trigger.click()
      const panel = page.locator(panelSelector)
      await panel.waitFor()
      const measured = await panel.evaluate(async e => {
        const animations = e.getAnimations().map(a => ({ property: a.transitionProperty, duration: a.effect.getTiming().duration }))
        const focusInside = e.contains(document.activeElement)
        await Promise.all(e.getAnimations().map(a => a.finished.catch(() => {})))
        return { animations, focusInside, rect: e.getBoundingClientRect().toJSON(), role: e.getAttribute('role') }
      })
      return { panel, ...measured }
    }

    const toolbarButtons = page.locator('[aria-haspopup]')
    const filter = toolbarButtons.nth(0)
    const filterPanel = await openAndMeasure(filter, '[role="dialog"]')
    check(filterPanel.animations.some(a => a.property === 'opacity' && a.duration === 200), 'filter must use shared 200ms entry')
    check(filterPanel.focusInside, 'filter must move focus inside')
    check(filterPanel.rect.width === 260, `filter width ${filterPanel.rect.width}`)
    check(filterPanel.rect.x >= 0 && filterPanel.rect.x + filterPanel.rect.width <= 1440, 'filter must stay inside the viewport')
    await page.keyboard.press('Escape')
    await filterPanel.panel.waitFor({ state: 'detached' })
    check(await filter.evaluate(e => e === document.activeElement), 'filter Escape must restore trigger')
    panels.push({ name: 'filter', ...filterPanel })

    const sort = toolbarButtons.nth(1)
    const sortPanel = await openAndMeasure(sort, '[role="menu"]')
    check(sortPanel.focusInside && sortPanel.role === 'menu', 'sort must focus inside its menu')
    check(sortPanel.rect.width === 200, `sort width ${sortPanel.rect.width}`)
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    check(await page.locator('[data-menu-state]').innerText().then(text => text.includes('statusPriority')), 'sort selection must update state')
    await sortPanel.panel.waitFor({ state: 'detached' })
    panels.push({ name: 'sort', ...sortPanel })

    const videoSort = toolbarButtons.nth(2)
    const videoSortPanel = await openAndMeasure(videoSort, '[role="dialog"]')
    check(videoSortPanel.focusInside, 'video sort must focus inside')
    check(videoSortPanel.rect.width === 210, `video sort width ${videoSortPanel.rect.width}`)
    await page.getByRole('button', { name: /升序/ }).click()
    check(await page.locator('[data-menu-state]').innerText().then(text => text.includes('"dir":"asc"')), 'direction must update')
    check(await videoSort.getAttribute('aria-expanded') === 'true', 'direction change must keep the panel open')
    await page.keyboard.press('Escape')
    await videoSortPanel.panel.waitFor({ state: 'detached' })
    panels.push({ name: 'videoSort', ...videoSortPanel })

    const display = toolbarButtons.nth(3)
    const displayPanel = await openAndMeasure(display, '[role="dialog"]')
    check(displayPanel.rect.width === 258, `display width ${displayPanel.rect.width}`)
    const showInfo = page.getByRole('switch')
    const before = await showInfo.getAttribute('aria-checked')
    await showInfo.click()
    check(await showInfo.getAttribute('aria-checked') !== before, 'display switch must toggle')
    await page.keyboard.press('Escape')
    await displayPanel.panel.waitFor({ state: 'detached' })
    check(await display.evaluate(e => e === document.activeElement), 'display Escape must restore trigger')
    panels.push({ name: 'display', ...displayPanel })

    const switcher = toolbarButtons.nth(4)
    const switcherPanel = await openAndMeasure(switcher, '[role="dialog"]')
    check(switcherPanel.rect.width === 320, `switcher width ${switcherPanel.rect.width}`)
    await page.getByRole('textbox', { name: '搜索项目' }).fill('品牌')
    check(await switcherPanel.panel.getByRole('button', { name: /品牌短片/ }).count() === 1, 'switcher search must filter')
    check(await switcherPanel.panel.getByRole('button', { name: /城市之间/ }).count() === 0, 'switcher search must hide non-matches')
    check(await switcherPanel.panel.getByRole('button', { name: /很长的项目名称/ }).count() === 0, 'switcher search must hide the long non-match too')
    await page.keyboard.press('Escape')
    await switcherPanel.panel.waitFor({ state: 'detached' })
    panels.push({ name: 'switcher', ...switcherPanel })

    await page.keyboard.press('Meta+k')
    await page.locator('[role="dialog"]').waitFor()
    check(await page.getByRole('textbox', { name: '搜索项目' }).evaluate(e => e === document.activeElement), 'Meta+K must focus the switcher search')
    await page.keyboard.press('Escape')

    const geometry = []
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 844 })
      for (const theme of ['dark', 'light']) {
        await page.evaluate(theme => document.documentElement.classList.toggle('dark', theme === 'dark'), theme)
        for (const [index, triggerName, selector] of [[0, '筛选', '[role="dialog"]'], [1, '排序', '[role="menu"]'], [3, '显示', '[role="dialog"]']]) {
          await toolbarButtons.nth(index).click()
          const panel = page.locator(selector).last()
          await panel.waitFor()
          await panel.evaluate(async e => { await Promise.all(e.getAnimations().map(a => a.finished.catch(() => {}))) })
          const rect = await panel.evaluate(e => e.getBoundingClientRect().toJSON())
          check(rect.x >= 7 && rect.x + rect.width <= width - 7, `${triggerName} ${width}/${theme} overflow ${JSON.stringify(rect)}`)
          geometry.push({ triggerName, width, theme, rect })
          await page.keyboard.press('Escape')
          await panel.waitFor({ state: 'detached' })
        }
        await page.screenshot({ path: `/Users/xiaoxiaobai/Documents/Qoder/2026-10-26/573ed666/popup-evidence/menus-${width}-${theme}.png` })
      }
    }
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await toolbarButtons.nth(1).click()
    const reduced = await page.locator('[role="menu"]').evaluate(e => ({ duration: getComputedStyle(e).transitionDuration, translate: getComputedStyle(e).translate }))
    check(reduced.duration.split(',').every(d => parseFloat(d) < 0.001) && reduced.translate === 'none', `reduced motion ${JSON.stringify(reduced)}`)
    await page.keyboard.press('Escape')
    check(errors.length === 0, `page errors: ${errors.join(' | ')}`)
    check(writes.length === 0, `writes: ${writes.join(', ')}`)
    if (failures.length) throw new Error(JSON.stringify({ failures, panels, geometry, reduced, errors, writes }))
    return { panels: panels.map(({ panel, ...rest }) => rest), geometry, reduced, errors, writes }
  } finally { await context.close() }
}
