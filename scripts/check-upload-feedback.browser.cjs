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
    if (!['GET', 'HEAD'].includes(request.method())) {
      writes.push(request.url())
      return route.abort()
    }
    if (request.url().includes('/api/auth/session')) return route.fulfill({ json: { authenticated: true, user: { id: 'upload-lab', email: 'u@example.invalid', phone: '13800000000', name: '上传样本', avatarUrl: null, onboardingCompleted: true, isPlatformAdmin: false, teams: [{ role: 'OWNER', team: { id: 'nav-team', name: '导航团队', createdBy: { name: '上传样本' } } }] } } })
    return route.fulfill({ json: { items: [] } })
  })
  try {
    await page.addInitScript(() => localStorage.setItem('vitransfer_active_team_id', 'nav-team'))
    await page.goto(`${origin}/lab/projects?v=uploads`)
    await page.locator('[data-upload-lab]').waitFor()

    const assetInput = page.locator('input[type="file"]').first()
    const accept = await assetInput.getAttribute('accept')
    check(Boolean(accept && accept.includes('.mp4')), `asset input must advertise accepted types (got ${accept})`)
    await assetInput.setInputFiles([
      { name: 'sample-clip.mp4', mimeType: 'video/mp4', buffer: Buffer.from('not-a-real-video') },
      { name: 'notes.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('nope') },
    ])
    await page.getByRole('button', { name: '加入上传队列' }).click()
    const alert = page.locator('section[aria-labelledby="asset-queue-title"]').getByRole('alert')
    await alert.waitFor()
    check((await alert.innerText()).includes('notes.exe'), 'invalid file must be named in the error')
    check(await page.getByText('上传队列 (1)').count() === 1, 'only the valid file may enter the queue')
    check(await page.getByRole('button', { name: '加入上传队列' }).count() === 0, 'selection must clear so a second click cannot duplicate the batch')

    await page.getByText('失败').first().waitFor({ timeout: 15000 })
    const row = page.locator('section[aria-labelledby="asset-queue-title"] .rounded-md.border').filter({ hasText: 'sample-clip.mp4' }).first()
    check(await row.count() === 1, 'the queued file must render one row')
    check(await row.getByRole('progressbar').count() === 0, 'failed rows must not show a stale progress bar')
    check(await row.getByRole('button', { name: '重新上传' }).count() === 1, 'failed rows must offer a labelled retry')
    check(await row.getByRole('button', { name: '取消上传' }).count() === 1, 'failed rows must offer a labelled cancel')

    // Comment attachment dialog: keyboard-reachable dropzone and honest failure summary.
    await page.getByRole('button', { name: '添加附件' }).click()
    const dialog = page.getByRole('dialog', { name: '添加评论附件' })
    await dialog.waitFor()
    const dropzone = dialog.getByRole('button', { name: '拖放文件到这里，或点击选择' })
    check(await dropzone.count() === 1, 'dropzone must be a keyboard-reachable button')
    check(await dropzone.getAttribute('tabindex') === '0', 'dropzone must be tabbable')
    const commentInput = dialog.locator('input[type="file"]')
    await commentInput.setInputFiles([{ name: 'bad.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('nope') }])
    await page.getByText('出现错误').waitFor({ timeout: 10000 })
    check(await dialog.getByText('全部文件上传完成').count() === 0, 'an all-failed batch must not claim success')
    check(await dialog.getByRole('button', { name: '移除' }).count() === 1, 'remove action must be labelled')
    await page.screenshot({ path: '/Users/xiaoxiaobai/Documents/Qoder/2026-10-26/573ed666/popup-evidence/uploads-1440-dark.png' })
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'detached' })

    await page.setViewportSize({ width: 390, height: 844 })
    await page.evaluate(() => document.documentElement.classList.add('light'))
    await page.screenshot({ path: '/Users/xiaoxiaobai/Documents/Qoder/2026-10-26/573ed666/popup-evidence/uploads-390-light.png', fullPage: true })
    check(errors.length === 0, `page errors: ${errors.join(' | ')}`)
    if (failures.length) throw new Error(JSON.stringify({ failures, errors, writes }))
    return { accept, writes, errors, result: 'passed' }
  } finally { await context.close() }
}
