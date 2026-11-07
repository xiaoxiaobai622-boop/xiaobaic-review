async (browserPage) => {
  const context = await browserPage.context().browser().newContext({ viewport: { width: 900, height: 900 } })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  try {
    await page.route('http://localhost:3000/api/auth/session', route => route.fulfill({
      json: { authenticated: true, user: { id: 'mention-test', email: 'mention@example.invalid', name: '提及样本', avatarUrl: null, onboardingCompleted: true, role: 'MEMBER', teams: [] } },
    }))
    await page.goto('http://localhost:3000/lab/projects?v=controls')
    await page.locator('[data-shared-controls]').waitFor()
    const input = page.locator('textarea').last()
    await input.waitFor()

    await input.fill('')
    await input.type('@林')
    const listbox = page.getByRole('listbox', { name: '提及成员' })
    await listbox.waitFor()
    const option = listbox.getByRole('option', { name: '林一' })
    await option.waitFor()
    await option.click()
    const clickedValue = await input.inputValue()
    if (!clickedValue.includes('@林一')) throw new Error(`click insert failed: ${clickedValue}`)
    if (await listbox.isVisible()) throw new Error('listbox must close after selection')

    await input.fill('')
    await input.type('@')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    const keyboardValue = await input.inputValue()
    if (!keyboardValue.startsWith('@')) throw new Error(`keyboard insert failed: ${keyboardValue}`)
    if (errors.length) throw new Error(`page errors: ${errors.join(' | ')}`)
    return { clickedValue, keyboardValue, errors }
  } finally {
    await context.close()
  }
}
