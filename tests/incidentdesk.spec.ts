import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const csvHeader = 'timestamp,user,ip,event_type,result'
const screenshot = (name: string) => process.env.UPDATE_SCREENSHOTS ? resolve('docs', name + '.png') : ''

test('walkthrough, evidence, saved conclusion, both exports and deletion', async ({ page }) => {
  await page.goto('./')
  await expect(page.getByRole('heading', { name: 'IncidentDesk' })).toBeVisible()
  if (screenshot('desktop')) {
    await page.locator('.hero-art .art-alert').evaluate(async (element) => {
      await Promise.all(element.getAnimations().map((animation) => animation.finished))
      await document.fonts.ready
    })
    await page.screenshot({ path: screenshot('desktop') })
  }
  await page.getByRole('link', { name: 'Учебный случай' }).click()
  await expect(page.getByRole('heading', { name: 'Доказательства', exact: true })).toBeAttached()
  await page.getByRole('heading', { name: 'Доказательства', exact: true }).evaluate((element) => element.scrollIntoView({ block: 'center', behavior: 'instant' }))
  await expect(page.locator('.story-sticky .signal-art')).toHaveClass(/stage-2/)
  await page.getByRole('link', { name: 'Открыть этот разбор' }).click()
  const dialog = page.getByRole('dialog', { name: 'Успешный вход после отказов' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('row')).toHaveCount(6)
  await expect(dialog.getByRole('cell', { name: '203.0.113.74' })).toHaveCount(5)
  if (screenshot('investigation')) await page.screenshot({ path: screenshot('investigation'), animations: 'disabled' })

  await dialog.getByRole('button', { name: 'Открыть записи в журнале' }).click()
  await expect(page.getByRole('heading', { name: 'Подтверждающие записи' })).toBeFocused()
  await expect(page.getByRole('row')).toHaveCount(6)
  await page.getByRole('combobox', { name: 'Результат', exact: true }).selectOption('success')
  await expect(page.getByRole('row')).toHaveCount(2)
  await page.getByRole('button', { name: /Успех: 1 · Отказ: 0/ }).press('Enter')
  await expect(page.locator('.chart-detail')).toContainText('Успех: 1 · Отказ: 0')
  await page.getByRole('button', { name: 'Весь журнал' }).click()
  await expect(page.getByRole('row')).toHaveCount(21)
  await page.getByRole('button', { name: 'Предупреждения', exact: true }).click()
  const card = page.getByRole('button', { name: /Успешный вход после отказов/ })
  await card.click()
  await dialog.getByRole('combobox', { name: 'Вывод', exact: true }).selectOption('insufficient')
  await dialog.getByLabel('Комментарий').fill('Сверить устройство и MFA.')
  await dialog.getByRole('button', { name: 'Сохранить вывод' }).click()
  await expect(dialog.getByRole('status')).toContainText('Сохранено')
  await page.keyboard.press('Escape')
  await expect(card).toBeFocused()

  for (const format of ['Markdown', 'JSON']) {
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: format }).click()])
    const content = readFileSync((await download.path())!, 'utf8')
    expect(content).toContain('Сверить устройство и MFA.')
    if (format === 'JSON') expect(JSON.parse(content).reviews[0].evidence).toHaveLength(5)
  }
  await page.reload()
  await expect(dialog.getByLabel('Комментарий')).toHaveValue('Сверить устройство и MFA.')
  await dialog.getByRole('button', { name: 'Удалить вывод', exact: true }).click()
  await expect(dialog.getByLabel('Комментарий')).toHaveValue('')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'JSON' })).toBeDisabled()
})

test('preview in repository subfolder analyzes uploads without sending file contents', async ({ page }) => {
  await page.goto('./#desk')
  await expect(page.getByRole('heading', { name: 'Рабочий стол' })).toBeVisible()
  if (screenshot('workspace')) await page.screenshot({ path: screenshot('workspace') })
  const [sample] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Учебный CSV (20 событий)' }).click()])
  expect(readFileSync((await sample.path())!, 'utf8')).toContain(csvHeader)
  const uploadThroughPicker = async (path: string) => {
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Загрузить CSV', exact: true }).click()])
    await chooser.setFiles(path)
  }
  await uploadThroughPicker((await sample.path())!)
  await expect(page.locator('.feedback')).toContainText('Записи совпадают с предыдущим журналом. Событий: 20 · Предупреждений: 3.')
  const [oneLogin] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Проверочный CSV (1 событие)' }).click()])
  await uploadThroughPicker((await oneLogin.path())!)
  await expect(page.locator('.feedback')).toContainText('Сводка обновлена. Событий: 1 · Предупреждений: 0.')
  await expect(page.getByText('Правила не сработали', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: 'Вернуть демо' }).click()
  const requests: string[] = []
  page.on('request', (request) => {
    if (request.method() !== 'GET' || !request.url().startsWith('http://127.0.0.1:4173/incidentdesk/')) requests.push(request.url())
  })
  const upload = (name: string, content: string | Buffer) => page.locator('input[type=file]').setInputFiles({
    name, mimeType: 'text/csv', buffer: typeof content === 'string' ? Buffer.from(content) : content,
  })
  await upload('broken.csv', csvHeader + '\n2026-11-18,alice,300.1.1.1,login,success')
  await expect(page.getByRole('alert')).toContainText('Строка 2')
  await expect(page.getByRole('alert')).toContainText('Сейчас открыт «Учебный журнал».')
  await expect(page.getByText('Учебный журнал', { exact: true })).toBeVisible()
  await upload('oversize.csv', Buffer.alloc(1024 * 1024 + 1))
  await expect(page.getByRole('alert')).toContainText('1 МиБ')
  const first = '2026-11-18T07:00:00Z,alice,192.0.2.10,login,success'
  await upload('normal.csv', [csvHeader, first, first].join('\n'))
  await expect(page.getByText('normal.csv · Убрано повторов: 1')).toBeVisible()
  await expect(page.getByText('Правила не сработали', { exact: false })).toBeVisible()
  await upload('series.csv', [csvHeader, ...Array.from({ length: 6 }, (_, i) =>
    `2026-11-18T07:00:0${i}Z,alice,192.0.2.10,login,${i === 5 ? 'success' : 'failure'}`)].join('\n'))
  await page.getByRole('button', { name: /Серия отказов с одного IP/ }).click()
  await page.getByRole('combobox', { name: 'Вывод', exact: true }).selectOption('explained')
  await page.getByRole('button', { name: 'Сохранить вывод' }).click()
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('Сохранено')
  await page.keyboard.press('Escape')
  const same = [csvHeader, ...[5, 4, 3, 2, 1, 0].map((i) =>
    `2026-11-18T10:00:0${i}+03:00,alice,192.0.2.10,login,${i === 5 ? 'success' : 'failure'}`)].join('\r\n')
  await upload('same-data.csv', same)
  await expect(page.getByText('same-data.csv', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'JSON' })).toBeEnabled()
  await page.getByRole('button', { name: 'Вернуть демо' }).click()
  await expect(page.getByRole('button', { name: 'JSON' })).toBeDisabled()
  await page.getByText('Формат CSV и локальное хранение').click()
  await page.getByRole('button', { name: 'Удалить все локальные выводы' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Удалить', exact: true }).click()
  await upload('same-data.csv', same)
  await expect(page.getByText('same-data.csv', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'JSON' })).toBeDisabled()
  const atRowLimit = [csvHeader, ...Array.from({ length: 10_000 }, (_, i) =>
    `2026-11-18T07:00:00Z,account-${i},192.0.2.10,login,success`)].join('\n')
  await upload('at-limit.csv', atRowLimit)
  await expect(page.getByText('at-limit.csv', { exact: true })).toBeVisible()
  await expect(page.locator('.metrics')).toContainText('10000')
  await upload('too-many.csv', atRowLimit + '\n' + first)
  await expect(page.getByRole('alert')).toContainText('10 000')
  await expect(page.getByText('at-limit.csv', { exact: true })).toBeVisible()
  expect(requests).toEqual([])
})

test('mobile layout, keyboard focus and reduced motion', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('./')
  await expect(page.getByRole('heading', { name: 'IncidentDesk' })).toBeVisible()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: 'IncidentDesk, на главную' }).first()).toBeFocused()
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  const start = page.getByRole('link', { name: 'Начать расследование' })
  await expect(start).toBeFocused()
  expect(await start.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe('solid')
  expect(await page.locator('.art-alert').first().evaluate((element) => getComputedStyle(element).animationName)).toBe('none')
  await expect(page.locator('.hero-art .art-alert')).toHaveCSS('opacity', '1')
  await expect(page.locator('.story-sticky')).toBeHidden()
  await expect(page.locator('.story-mobile').first()).toBeVisible()
  if (screenshot('mobile')) await page.screenshot({ path: screenshot('mobile') })
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: 'Рабочий стол' })).toBeFocused()
  await page.getByRole('button', { name: /Успешный вход после отказов/ }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: 'Закрыть разбор' })).toBeFocused()
  await page.keyboard.press('Tab')
  expect(await page.evaluate(() => document.activeElement?.closest('dialog')?.open)).toBe(true)
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Журнал событий', exact: true }).click()
  await page.getByRole('searchbox').fill('нет-такого-пользователя')
  await expect(page.getByText('Записей: 0 из 20')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)
})

