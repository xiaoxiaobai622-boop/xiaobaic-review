/**
 * Admin quick-preview regression.
 *
 * Run through Playwright MCP (browser_run_code_unsafe filename) with `npm run dev`
 * on http://localhost:3000. HLS/MP4 fixtures are embedded below, so no network or
 * database writes are needed.
 *
 * Covers: HLS-only preview mints `hls` (never 720p) and plays through hls.js;
 * progressive preview keeps the 720p path; no-source videos show guidance plus
 * the review link; a browser without MSE/native HLS gets the explicit HLS notice
 * instead of 415/Format error.
 */
async (host) => {
  const context = await host.context().browser().newContext({ serviceWorkers: 'block', viewport: { width: 1200, height: 900 } })
  const origin = 'http://localhost:3000'
  const failures = []
  const check = (condition, message) => { if (!condition) failures.push(message) }
  const requests = []

  // Self-contained media fixtures: 2s 160x120 H.264 HLS + a small progressive MP4.
  const seg0 = Buffer.from('R0AREABC8CUAAcEAAP8B/wAB/IAUSBIBBkZGbXBlZwlTZXJ2aWNlMDF3fEPK//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////9HQAAQAACwDQABwQAAAAHwACqxBLL//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////0dQABAAArASAAHBAADhAPAAG+EA8AAVvU1W////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////R0EAMAdQAAB7DH4AAAAB4AAAgIAFIQAH2GEAAAABCfAAAAABZ0LAHtoKEflwEQAAAwABAAADABQPFi6gAAAAAWjOD8gAAAEGBf//TtxF6b3m2Ui3lizYINkj7u94MjY0IC0gY29yZSAxNjUgcjMyMjIgYjM1NjA1YSAtIEguMjY0L01QRUctNCBBVkMgY29kZWMgLSBDb3B5bGVmdCAyMDAzLTIwMjUgLSBodHRwOi8vd3d3LnZpZGVvbGFHAQARbi5vcmcveDI2NC5odG1sIC0gb3B0aW9uczogY2FiYWM9MCByZWY9MSBkZWJsb2NrPTA6MDowIGFuYWx5c2U9MDowIG1lPWRpYSBzdWJtZT0wIHBzeT0xIHBzeV9yZD0xLjAwOjAuMDAgbWl4ZWRfcmVmPTAgbWVfcmFuZ2U9MTYgY2hyb21hX21lPTEgdHJlbGxpcz0wIDh4OGRjdD0wIGNxbT0wIGRlYWR6b25lPTIxLDExIGZhc0cBABJ0X3Bza2lwPTEgY2hyb21hX3FwX29mZnNldD0wIHRocmVhZHM9NCBsb29rYWhlYWRfdGhyZWFkcz0xIHNsaWNlZF90aHJlYWRzPTAgbnI9MCBkZWNpbWF0ZT0xIGludGVybGFjZWQ9MCBibHVyYXlfY29tcGF0PTAgY29uc3RyYWluZWRfaW50cmE9MCBiZnJhbWVzPTAgd2VpZ2h0cD0wIGtleWludD0xMCBrZXlpbnRfbWluPTYgRwEAMwEAc2NlbmVjdXQ9MCBpbnRyYV9yZWZyZXNoPTAgcmM9Y3JmIG1idHJlZT0wIGNyZj0yMy4wIHFjb21wPTAuNjAgcXBtaW49MCBxcG1heD02OSBxcHN0ZXA9NCBpcF9yYXRpbz0xLjQwIGFxPTAAgAAAAAFliIQ6JigMnJycnJycnJyddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddeBHQQA0mRAAAIygfgD//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////wAAAeAAAICABSEACR6xAAAAAQnwAAAAAUGaIDqAo0dBADWZEAAAnjR+AP//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////AAAB4AAAgIAFIQAJZQEAAAABCfAAAAABQZpAPoCjR0EANpkQAACvyH4A//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////8AAAHgAACAgAUhAAmrUQAAAAEJ8AAAAAFBmmA+gKNHQQA3mRAAAMFcfgD//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////wAAAeAAAICABSEACfGhAAAAAQnwAAAAAUGagD6Ao0dBADiZEAAA0vB+AP//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////AAAB4AAAgIAFIQALN/EAAAABCfAAAAABQZqgPoCjR0EAOZkQAADkhH4A//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////8AAAHgAACAgAUhAAt+QQAAAAEJ8AAAAAFBmsA+gKNHQQA6mRAAAPYYfgD//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////wAAAeAAAICABSEAC8SRAAAAAQnwAAAAAUGa4D6Ao0dBADuZEAABB6x+AP//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////AAAB4AAAgIAFIQANCuEAAAABCfAAAAABQZsAPoCjR0EAPJkQAAEZQH4A//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////8AAAHgAACAgAUhAA1RMQAAAAEJ8AAAAAFBmyA+gKM=', 'base64')
  const seg1 = Buffer.from('R0AREQBC8CUAAcEAAP8B/wAB/IAUSBIBBkZGbXBlZwlTZXJ2aWNlMDF3fEPK//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////9HQAARAACwDQABwQAAAAHwACqxBLL//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////0dQABEAArASAAHBAADhAPAAG+EA8AAVvU1W////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////R0EAPTNQAAEq1H4A//////////////////////////////////////////////////////////8AAAHgAACAgAUhAA2XgQAAAAEJ8AAAAAFnQsAe2goR+XARAAADAAEAAAMAFA8WLqAAAAABaM4PyAAAAAFliIIBGiYoAAgIycnJycnJycnJ11111111111111111111111111111111111111111111111111111111111111111111115HQQA+mRAAATxofgD//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////wAAAeAAAICABSEADd3RAAAAAQnwAAAAAUGaIDqAo0dBAD+ZEAABTfx+AP//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////AAAB4AAAgIAFIQAPJCEAAAABCfAAAAABQZpAPoCjR0EAMJkQAAFfkH4A//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////8AAAHgAACAgAUhAA9qcQAAAAEJ8AAAAAFBmmA+gKNHQQAxmRAAAXEkfgD//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////wAAAeAAAICABSEAD7DBAAAAAQnwAAAAAUGagD6Ao0dBADKZEAABgrh+AP//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////AAAB4AAAgIAFIQAP9xEAAAABCfAAAAABQZqgPoCjR0EAM5kQAAGUTH4A//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////8AAAHgAACAgAUhABE9YQAAAAEJ8AAAAAFBmsA+gKNHQQA0mRAAAaXgfgD//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////wAAAeAAAICABSEAEYOxAAAAAQnwAAAAAUGa4D6Ao0dBADWZEAABt3R+AP//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////AAAB4AAAgIAFIQARygEAAAABCfAAAAABQZsAPoCjR0EANpkQAAHJCH4A//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////8AAAHgAACAgAUhABMQUQAAAAEJ8AAAAAFBmyA+gKM=', 'base64')
  const mp4 = Buffer.from('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', 'base64')
  const manifest = [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    '#EXT-X-TARGETDURATION:1',
    '#EXT-X-MEDIA-SEQUENCE:0',
    '#EXTINF:1.000000,',
    '/api/content/lab-seg0.ts',
    '#EXTINF:1.000000,',
    '/api/content/lab-seg1.ts',
    '#EXT-X-ENDLIST',
    '',
  ].join('\n')

  const session = { authenticated: true, user: { id: 'preview-lab', email: 'p@example.invalid', phone: '13800000001', name: '预览样本', avatarUrl: null, onboardingCompleted: true, isPlatformAdmin: false, teams: [{ role: 'OWNER', team: { id: 'lab-team', name: '实验团队', createdBy: { name: '预览样本' } } }] } }

  async function prepare(page) {
    await page.route(`${origin}/api/**`, route => {
      const request = route.request()
      const url = request.url()
      const method = request.method()
      requests.push(`${method} ${url}`)
      if (url.includes('/api/auth/session')) return route.fulfill({ json: session })
      if (url.includes('/api/studio/video-token')) {
        const quality = new URL(url).searchParams.get('quality')
        return route.fulfill({ json: { token: quality === 'hls' ? 'hls-token' : 'p720-token' } })
      }
      if (url.endsWith('/api/content/hls-token')) {
        return route.fulfill({ status: 200, headers: { 'Content-Type': 'application/vnd.apple.mpegurl' }, body: manifest })
      }
      if (url.endsWith('/api/content/lab-seg0.ts')) return route.fulfill({ status: 200, headers: { 'Content-Type': 'video/mp2t' }, body: seg0 })
      if (url.endsWith('/api/content/lab-seg1.ts')) return route.fulfill({ status: 200, headers: { 'Content-Type': 'video/mp2t' }, body: seg1 })
      if (url.endsWith('/api/content/p720-token')) return route.fulfill({ status: 200, headers: { 'Content-Type': 'video/mp4' }, body: mp4 })
      if (method === 'GET' || method === 'HEAD') return route.fulfill({ json: [] })
      return route.fulfill({ status: 500, json: { error: `unexpected write ${method} ${url}` } })
    })
  }

  async function openPreview(page, testCase) {
    await page.goto(`${origin}/lab/projects?v=preview&case=${testCase}`)
    await page.locator('[data-preview-lab]').waitFor()
    await page.getByRole('button', { name: '视频操作' }).click()
    await page.getByRole('menuitem', { name: '播放预览' }).click()
    return page.getByRole('dialog')
  }

  async function newCase(testCase, disableMse = false) {
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await prepare(page)
    if (disableMse) {
      // Simulate a browser with neither MSE nor native HLS. Chromium on macOS
      // reports canPlayType('application/vnd.apple.mpegurl') === 'maybe' even
      // though it cannot decode the stream, so both capabilities must be off.
      await page.addInitScript(() => {
        Object.defineProperty(window, 'MediaSource', { value: undefined, configurable: true })
        const canPlayType = HTMLVideoElement.prototype.canPlayType
        HTMLVideoElement.prototype.canPlayType = function (type) {
          if (type === 'application/vnd.apple.mpegurl') return ''
          return canPlayType.call(this, type)
        }
      })
    }
    requests.length = 0
    const dialog = await openPreview(page, testCase)
    await dialog.waitFor()
    await page.waitForTimeout(600)
    return { page, dialog, errors, requests: [...requests] }
  }

  try {
    const hls = await newCase('hls')
    check(requests.some(line => line.includes('quality=hls')), 'HLS-only 预览必须铸 hls 令牌')
    check(!requests.some(line => line.includes('quality=720p')), 'HLS-only 预览不能再铸 720p 令牌')
    check(requests.some(line => line.includes('/api/content/hls-token')), 'HLS-only 预览必须请求 HLS 清单')
    const hlsVideo = hls.dialog.locator('video')
    await hlsVideo.waitFor()
    await hlsVideo.evaluate(async video => { video.muted = true; try { await video.play() } catch {} })
    await hls.page.waitForFunction(() => {
      const video = document.querySelector('[role="dialog"] video')
      return Boolean(video && video.currentTime > 0.1 && !video.error)
    }, undefined, { timeout: 15000 })
    check(await hls.dialog.getByText(/仅提供 HLS|HLS-only/).count() === 0, 'Chrome/Edge 能通过 hls.js 播放时不应出现不支持提示')
    check(hls.errors.length === 0, `HLS 预览 page errors: ${hls.errors.join(' | ')}`)
    const hlsRequests = hls.requests
    await hls.page.close()

    const progressive = await newCase('progressive')
    check(requests.some(line => line.includes('quality=720p')), '渐进视频预览仍必须铸 720p 令牌')
    check(!requests.some(line => line.includes('quality=hls')), '渐进视频预览不应改走 HLS')
    check(requests.some(line => line.includes('/api/content/p720-token')), '渐进视频预览必须请求 720p 流')
    const progressiveVideo = progressive.dialog.locator('video')
    await progressiveVideo.waitFor()
    await progressiveVideo.evaluate(async video => { video.muted = true; try { await video.play() } catch {} })
    await progressive.page.waitForFunction(() => {
      const video = document.querySelector('[role="dialog"] video')
      return Boolean(video && video.currentTime > 0.1 && !video.error)
    }, undefined, { timeout: 10000 })
    check(progressive.errors.length === 0, `渐进预览 page errors: ${progressive.errors.join(' | ')}`)
    const progressiveRequests = progressive.requests
    await progressive.page.close()

    const unavailable = await newCase('unavailable')
    check(await unavailable.dialog.getByText('该视频暂无可播放的预览，请到审阅页查看。').count() === 1, '无渐进流也无 HLS 时必须给明确提示')
    check(await unavailable.dialog.getByRole('button', { name: '打开审片页面' }).count() === 1, '不可预览时必须给审阅页入口')
    check(await unavailable.dialog.locator('video').count() === 0, '不可预览时不能打开空播放器')
    check(!requests.some(line => line.includes('/api/studio/video-token')), '不可预览时不应铸任何播放令牌')
    const unavailableRequests = unavailable.requests
    await unavailable.page.close()

    const unsupported = await newCase('hls', true)
    check(await unsupported.dialog.getByText(/仅提供 HLS 播放/).count() === 1, '浏览器不支持 HLS 时必须说明仅 HLS')
    check(await unsupported.dialog.getByRole('button', { name: '打开审片页面' }).count() === 1, '浏览器不支持 HLS 时必须给审阅页入口')
    check(await unsupported.dialog.getByText(/415|Format error|Only HLS playback is available/).count() === 0, '不支持 HLS 时不能暴露 415/Format error')
    check(await unsupported.dialog.locator('video').count() === 0, '不支持 HLS 时不能留下死播放器')
    const unsupportedRequests = unsupported.requests
    await unsupported.page.close()

    const evidence = {
      cases: {
        hls: hlsRequests,
        progressive: progressiveRequests,
        unavailable: unavailableRequests,
        unsupported: unsupportedRequests,
      },
      failures,
      result: failures.length === 0 ? 'passed' : 'failed',
    }
    if (failures.length) throw new Error(JSON.stringify(evidence))
    return evidence
  } finally {
    await context.close()
  }
}
