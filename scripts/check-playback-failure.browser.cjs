/**
 * Playback failure regression (one-off, local fixture).
 *
 * Run it through Playwright MCP after opening a review share page with a video
 * selected. The script reuses that page's URL, so the share token never appears
 * in this file or in its output.
 *
 * Covers:
 *   - normal playback
 *   - 503 -> "视频暂时不可用" (never the network sentence)
 *   - 403 + failed re-mint -> "播放授权已过期" (never the network sentence)
 *   - version switch keeps playing without a failure sentence
 *
 * Set RUN_NETWORK to true to also wait out Chrome's ~31s media timeout and
 * assert the real-network sentence.
 */
async (host) => {
  const RUN_NETWORK = false
  const url = host.url()
  if (!url.includes('/share/') || !url.includes('video=')) {
    throw new Error('Open the review share page with a video selected before running this check')
  }

  const browser = host.context().browser()
  const FAILURE_MESSAGES = [
    '视频加载失败，请刷新页面或检查网络后重试。',
    '播放授权已过期，请刷新页面重新打开。',
    '当前浏览器无法解码该视频，请刷新页面或更换清晰度。',
    '该视频的格式当前浏览器不支持播放，请刷新页面重试。',
    '视频暂时不可用，请稍后重试。',
  ]
  const results = []
  let pass = 0
  let fail = 0
  const check = (name, ok, detail) => {
    results.push({ name, ok, detail })
    if (ok) pass += 1
    else fail += 1
  }

  const read = (page) => page.evaluate((messages) => {
    const video = document.querySelector('video')
    const text = document.body.innerText
    return {
      err: video ? (video.error ? video.error.code : null) : 'no-video',
      rs: video && video.readyState,
      ns: video && video.networkState,
      paused: video && video.paused,
      ct: video && Number(video.currentTime.toFixed(2)),
      failures: messages.filter((message) => text.includes(message)),
    }
  }, FAILURE_MESSAGES)

  const load = async (page) => {
    await page.goto(url)
    await page.waitForSelector('video')
    await page.waitForFunction(() => {
      const video = document.querySelector('video')
      return video && video.readyState >= 3
    })
    await page.locator('video').click()
    await page.waitForTimeout(1200)
  }

  const withPage = async (name, run) => {
    const context = await browser.newContext({ serviceWorkers: 'block' })
    const page = await context.newPage()
    try {
      return await run(page)
    } finally {
      await context.close()
    }
  }

  await withPage('normal', async (page) => {
    await load(page)
    const state = await read(page)
    check('normal: no failure sentence', state.failures.length === 0, state)
    check('normal: video element is playable', state.rs >= 3 && !state.err, state)
  })

  await withPage('unavailable', async (page) => {
    let mock = false
    await page.route('**/api/content/**', async (route) => {
      if (!mock) return route.continue()
      return route.fulfill({
        status: 503,
        headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store', 'Content-Type': 'application/json' },
        body: '{"error":"temporarily unavailable","code":"TEMPORARY_UNAVAILABLE"}',
      })
    })
    await load(page)
    mock = true
    await page.evaluate(() => {
      const video = document.querySelector('video')
      if (video) video.currentTime = 70
    })
    await page.waitForFunction(
      () => document.body.innerText.includes('视频暂时不可用，请稍后重试。'),
      null,
      { timeout: 5000 },
    ).catch(() => {})
    const state = await read(page)
    check('503: unavailable sentence', state.failures.includes('视频暂时不可用，请稍后重试。'), state)
    check('503: no network/auth sentence', !state.failures.some((message) => /加载失败|授权已过期/.test(message)), state)
  })

  await withPage('auth', async (page) => {
    let mock = false
    await page.route('**/api/content/**', async (route) => {
      if (!mock) return route.continue()
      return route.fulfill({
        status: 403,
        headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store', 'Content-Type': 'application/json' },
        body: '{"error":"access denied"}',
      })
    })
    await page.route('**/api/share/**/video-token**', async (route) => {
      if (!mock) return route.continue()
      return route.fulfill({ status: 403, headers: { 'Content-Type': 'application/json' }, body: '{"error":"access denied"}' })
    })
    await load(page)
    mock = true
    await page.evaluate(() => {
      const video = document.querySelector('video')
      if (video) video.currentTime = 70
    })
    await page.waitForFunction(
      () => document.body.innerText.includes('播放授权已过期，请刷新页面重新打开。'),
      null,
      { timeout: 6000 },
    ).catch(() => {})
    const state = await read(page)
    check('403: auth sentence', state.failures.includes('播放授权已过期，请刷新页面重新打开。'), state)
    check('403: no network sentence', !state.failures.some((message) => message.includes('加载失败')), state)
  })

  await withPage('version-switch', async (page) => {
    await load(page)
    const options = await page.evaluate(() => {
      const select = document.querySelector('select[aria-label="切换版本"]')
      if (!select) return []
      return [...select.options].map((option) => ({ value: option.value, label: option.textContent.trim() }))
    })
    const selected = await page.evaluate(() => document.querySelector('select[aria-label="切换版本"]')?.value)
    const target = options.find((option) => option.value !== selected)
    if (!target) {
      check('version switch: fixture has two versions', false, options)
    } else {
      await page.selectOption('select[aria-label="切换版本"]', { value: target.value })
      await page.waitForTimeout(1800)
      await page.locator('video').click()
      await page.waitForTimeout(2500)
      const state = await read(page)
      check('version switch: no failure sentence', state.failures.length === 0, state)
      check('version switch: switched video is playable', state.rs >= 2 && !state.err, state)
    }
  })

  if (RUN_NETWORK) {
    await withPage('network', async (page) => {
      let block = false
      await page.route('**/api/content/**', async (route) => (block ? route.abort('connectionfailed') : route.continue()))
      await load(page)
      block = true
      await page.evaluate(() => {
        const video = document.querySelector('video')
        if (video) video.currentTime = 70
      })
      await page.waitForFunction(
        () => document.body.innerText.includes('视频加载失败，请刷新页面或检查网络后重试。'),
        null,
        { timeout: 45000 },
      ).catch(() => {})
      const state = await read(page)
      check('network: network sentence', state.failures.includes('视频加载失败，请刷新页面或检查网络后重试。'), state)
      check('network: no auth/unavailable sentence', !state.failures.some((message) => /授权已过期|暂时不可用/.test(message)), state)
    })
  }

  return { pass, fail, results }
}
