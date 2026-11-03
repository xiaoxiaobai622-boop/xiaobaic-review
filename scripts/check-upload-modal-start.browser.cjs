/**
 * Upload modal start regression.
 *
 * Run through Playwright MCP (browser_run_code_unsafe filename) with `npm run dev`
 * on http://localhost:3000. All API writes are intercepted; no data is stored.
 *
 * Covers: first click starts within 2s, one row per file, monotonic progress to
 * 100%, no duplicate records, the 3-upload cap with continuation, and close
 * protection while uploads are active.
 */
async (host) => {
  const context = await host.context().browser().newContext({ serviceWorkers: 'block', viewport: { width: 1200, height: 900 } })
  const origin = 'http://localhost:3000'
  const failures = []
  const check = (condition, message) => { if (!condition) failures.push(message) }

  // 32 bytes with a valid BMFF ftyp header: enough for the browser-side
  // container sniff, tiny enough that TUS finishes in one PATCH.
  const videoBytes = Buffer.concat([
    Buffer.from([0x00, 0x00, 0x00, 0x18]),
    Buffer.from('ftypisom'),
    Buffer.from([0x00, 0x00, 0x02, 0x00]),
    Buffer.from('isomiso2avc1mp41'),
  ])

  const session = { authenticated: true, user: { id: 'upload-modal-lab', email: 'u@example.invalid', phone: '13800000000', name: '上传样本', avatarUrl: null, onboardingCompleted: true, isPlatformAdmin: false, teams: [{ role: 'OWNER', team: { id: 'lab-team', name: '实验团队', createdBy: { name: '上传样本' } } }] } }

  async function prepare(page, { patchDelayMs = 0, videos = [], writes = [] } = {}) {
    let uploadSequence = 0
    await page.addInitScript(() => localStorage.setItem('vitransfer_active_team_id', 'lab-team'))
    await page.route(`${origin}/api/**`, async route => {
      const request = route.request()
      const url = request.url()
      const method = request.method()
      if (!['GET', 'HEAD'].includes(method)) writes.push(`${method} ${url}`)

      if (url.includes('/api/auth/session')) return route.fulfill({ json: session })
      if (method === 'GET' || method === 'HEAD') return route.fulfill({ json: { items: [] } })
      if (url.endsWith('/api/videos') && method === 'POST') {
        videos.push(Date.now())
        return route.fulfill({ status: 201, json: { videoId: `lab-video-${videos.length}` } })
      }
      if (url.endsWith('/api/uploads') && method === 'POST') {
        uploadSequence += 1
        return route.fulfill({
          status: 201,
          headers: { Location: `${origin}/api/uploads/lab-upload-${uploadSequence}`, 'Tus-Resumable': '1.0.0', 'Upload-Offset': '0' },
        })
      }
      if (/\/api\/uploads\/lab-upload-\d+$/.test(url) && method === 'PATCH') {
        if (patchDelayMs) await new Promise(resolve => setTimeout(resolve, patchDelayMs))
        return route.fulfill({
          status: 204,
          headers: { 'Tus-Resumable': '1.0.0', 'Upload-Offset': String(videoBytes.length) },
        })
      }
      return route.fulfill({ status: 500, json: { error: `unexpected write ${method} ${url}` } })
    })
    return { writes, videos }
  }

  try {
    // ── First click must start immediately ────────────────────────────────────
    const page = await context.newPage()
    const errors = []
    const writes = []
    const videoStarts = []
    page.on('pageerror', error => errors.push(error.message))
    await prepare(page, { writes, videos: videoStarts })
    await page.goto(`${origin}/lab/projects?v=upload-modal`)
    const dialog = page.getByRole('dialog')
    await dialog.waitFor()

    const input = dialog.locator('input[type="file"]')
    await input.setInputFiles({ name: 'lab-sample.mp4', mimeType: 'video/mp4', buffer: videoBytes })
    check(await dialog.locator('input[value="lab-sample"]').count() === 1, '选片后必须只有一行上传记录')
    check(writes.filter(line => line.includes('/api/videos')).length === 0, '点击“开始上传”之前不应创建视频记录')

    const requestPromise = page.waitForRequest(
      request => request.url().includes('/api/videos') && request.method() === 'POST',
      { timeout: 2500 },
    )
    const clickedAt = Date.now()
    await dialog.getByRole('button', { name: /开始上传|Start Upload/ }).click()
    await requestPromise
    const startedAfterMs = Date.now() - clickedAt
    check(startedAfterMs <= 2000, `第一次点击必须在 2 秒内发出上传请求（实际 ${startedAfterMs}ms）`)

    const progressSamples = []
    let completed = false
    for (let index = 0; index < 120; index += 1) {
      const text = await dialog.locator('span.font-medium').filter({ hasText: /%/ }).first().textContent().catch(() => null)
      if (text) {
        const value = Number.parseInt(text.replace('%', ''), 10)
        if (Number.isFinite(value)) progressSamples.push(value)
      }
      if (await dialog.getByText(/已完成|Completed/).count() > 0) {
        completed = true
        break
      }
      await page.waitForTimeout(50)
    }
    check(completed, '上传应完成并显示“已完成”')
    check(progressSamples.every((value, index) => index === 0 || value >= progressSamples[index - 1]), `进度必须单调递增（${progressSamples.join(',')}）`)
    check(progressSamples.includes(100), `进度必须到 100%（${progressSamples.join(',')}）`)
    check(writes.filter(line => line.includes('/api/videos')).length === 1, `一次点击只能创建一条视频记录（实际 ${writes.filter(line => line.includes('/api/videos')).length}）`)
    check(await dialog.locator('input[value="lab-sample"]').count() === 1, '上传完成后仍只能有一行记录')
    check(errors.length === 0, `page errors: ${errors.join(' | ')}`)
    const singleFileEvidence = { startedAfterMs, progressSamples, writes, errors }
    await page.close()

    // ── Four files: cap at three, then continue after a slot frees ────────────
    const batchPage = await context.newPage()
    const batchErrors = []
    const batchWrites = []
    const batchStarts = []
    batchPage.on('pageerror', error => batchErrors.push(error.message))
    await prepare(batchPage, { patchDelayMs: 300, writes: batchWrites, videos: batchStarts })
    await batchPage.goto(`${origin}/lab/projects?v=upload-modal`)
    const batchDialog = batchPage.getByRole('dialog')
    await batchDialog.waitFor()
    await batchDialog.locator('input[type="file"]').setInputFiles([1, 2, 3, 4].map(index => ({
      name: `batch-${index}.mp4`,
      mimeType: 'video/mp4',
      buffer: videoBytes,
    })))
    check(await batchDialog.locator('input[value^="batch-"]').count() === 4, '四个文件必须各占一行')
    await batchDialog.getByRole('button', { name: /开始上传|Start Upload/ }).click()
    check(await batchDialog.getByRole('button', { name: /开始上传|Start Upload/ }).count() === 0, '上传中不能再点开始上传')
    check(await batchDialog.getByRole('button', { name: /取消|Cancel/ }).isDisabled(), '上传中关闭按钮必须禁用')

    let batchCompleted = 0
    for (let index = 0; index < 200; index += 1) {
      batchCompleted = await batchDialog.getByText(/已完成|Completed/).count()
      if (batchCompleted === 4) break
      await batchPage.waitForTimeout(50)
    }
    check(batchCompleted === 4, `四个文件都应完成（实际 ${batchCompleted}）`)
    check(batchStarts.length === 4, `四个文件各创建一次视频记录（实际 ${batchStarts.length}）`)

    const firstWave = batchStarts.filter(timestamp => timestamp - batchStarts[0] < 250)
    check(firstWave.length === 3, `首批应只启动 3 个（实际 ${firstWave.length}）`)
    check(batchStarts.length === 4 && batchStarts[3] - batchStarts[0] >= 250, '第四个文件必须等首批让位后再开始')
    check(batchWrites.filter(line => line.includes('POST') && line.endsWith('/api/videos')).length === 4, '四个文件不能重复创建视频记录')
    check(await batchDialog.locator('input[value^="batch-"]').count() === 4, '批次完成后仍只能有四行记录')
    check(batchErrors.length === 0, `batch page errors: ${batchErrors.join(' | ')}`)
    await batchPage.close()

    const evidence = {
      singleFile: singleFileEvidence,
      batch: { starts: batchStarts, firstWave: firstWave.length, writes: batchWrites, errors: batchErrors },
      result: failures.length === 0 ? 'passed' : 'failed',
    }
    if (failures.length) throw new Error(JSON.stringify({ failures, ...evidence }))
    return evidence
  } finally {
    await context.close()
  }
}
