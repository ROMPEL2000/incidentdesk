import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { analyze } from '../src/analysis.ts'
import { MAX_BYTES, MAX_ROWS, parseCsv } from '../src/csv.ts'
import { detect } from '../src/detection.ts'
import { clearReviews, readReviews, removeReview, report, writeReview, type Review } from '../src/review.ts'

const header = 'timestamp,user,ip,event_type,result'
const encode = (s: string) => new TextEncoder().encode(s)
const csv = (lines: string[]) => encode([header, ...lines].join('\n'))
const row = (seconds: number, user = 'alice', result = 'failure', ip = '192.0.2.1', type = 'login') =>
  `${new Date(Date.UTC(2026, 10, 18) + seconds * 1000).toISOString()},${user},${ip},${type},${result}`
const find = (lines: string[], rule: string) => detect(parseCsv(csv(lines)).events).filter((alert) => alert.rule === rule)
const demo = () => analyze(readFileSync(new URL('../src/demo.csv', import.meta.url)))

test('R1: inclusive 5 minute boundary and exactly 5 failures', () => {
  const first = [0, 10, 20, 30].map((at) => row(at))
  assert.equal(find(first, 'repeated').length, 0)
  assert.equal(find([...first, row(300)], 'repeated')[0].evidence.length, 5)
  assert.equal(find([...first, row(300.001)], 'repeated').length, 0)
})

test('R1: transitively merges windows with shared evidence; separates groups and disjoint windows', () => {
  const records = [0, 1, 2, 3, 4, 300, 301, 302, 303, 304, 900, 901, 902, 903, 904].map((at) => row(at))
  const other = [0, 1, 2, 3].map((at) => row(at, 'alice', 'failure', '192.0.2.2'))
  assert.deepEqual(find([...records, ...other], 'repeated').map((alert) => alert.count), [10, 5])
})

test('R2: uses distinct case-sensitive accounts within inclusive 10 minute boundary and one IP', () => {
  const first = [row(0, 'alice'), row(10, 'Alice'), row(15, 'Alice')]
  assert.equal(find(first, 'multiple').length, 0)
  assert.equal(find([...first, row(600, 'bob', 'failure', '192.0.2.2')], 'multiple').length, 0)
  assert.equal(find([...first, row(600, 'bob')], 'multiple')[0].count, 3)
  assert.equal(find([...first, row(600.001, 'bob')], 'multiple').length, 0)
})

test('R3: strictly earlier failures, inclusive lower edge, exact pair and threshold', () => {
  const first = [0, 10, 20, 30].map((at) => row(at))
  assert.equal(find([...first, row(300, 'alice', 'success')], 'after')[0].count, 4)
  for (const attempt of [
    [...first, row(300.001, 'alice', 'success')],
    [...first, row(300, 'bob', 'success')],
    [...first, row(300, 'alice', 'success', '192.0.2.2')],
    [...first.slice(0, 3), row(300), row(300, 'alice', 'success')],
    [...first, row(300, 'alice', 'success', '192.0.2.1', 'logout')],
  ]) assert.equal(find(attempt, 'after').length, 0)
})

test('R3: login success resets the sequence and prevents evidence reuse', () => {
  const first = [0, 10, 20, 30].map((at) => row(at))
  const success = (at: number) => row(at, 'alice', 'success')
  assert.equal(find([...first, success(15), success(60)], 'after').length, 0)
  assert.equal(find([...first, success(60), success(61)], 'after').length, 1)
  assert.equal(find([...first, success(60), ...[61, 62, 63, 64].map((at) => row(at)), success(65)], 'after').length, 2)
})

test('ordinary events or logout do not trigger rules; a stale service password can trigger R1', () => {
  assert.equal(detect(parseCsv(csv([row(0), row(2, 'alice', 'success'),
    ...Array.from({ length: 6 }, (_, index) => row(index + 3, 'alice', 'failure', '192.0.2.1', 'logout'))])).events).length, 0)
  assert.equal(find([0, 1, 2, 3, 4].map((at) => row(at, 'svc-backup')), 'repeated').length, 1)
})

test('reordered records, equivalent time zones and IPv6 spellings produce the same key', async () => {
  const a = '2026-11-18T03:00:00+03:00,alice,2001:0DB8:0:0:0:0:0:1,login,failure'
  const b = '2026-11-18T00:00:00Z,alice,2001:db8::1,login,failure'
  const other = row(0, 'bob')
  const normal = await analyze(csv([a, other]))
  const reordered = await analyze(csv([other, b, a]))
  assert.equal(reordered.key, normal.key)
  assert.equal(reordered.duplicates, 1)
  assert.deepEqual(reordered.events, normal.events)
})

test('quoting, BOM, CRLF and UTF-8 fields', () => {
  const parsed = parseCsv(encode('\uFEFF' + header + '\r\n' + row(0, '"Иван, ""оператор"""') + '\r\n'))
  assert.equal(parsed.events[0].user, 'Иван, "оператор"')
})

test('invalid input rejects full file with line numbers', () => {
  assert.throws(() => parseCsv(csv([row(0), row(1, '', 'unknown')])), /Строка 3/)
  assert.throws(() => parseCsv(csv([row(0).replace('.000Z', '')])), /ISO 8601/)
  assert.throws(() => parseCsv(csv([row(0).replace('11-18', '02-30')])), /ISO 8601/)
  assert.throws(() => parseCsv(csv([row(0, 'alice', 'failure', '256.0.2.1')])), /IPv4/)
  assert.throws(() => parseCsv(csv([row(0, '"zz"junk')])), /кавычек/)
  assert.throws(() => parseCsv(csv([row(0, '"line\nbreak"')])), /Перенос/)
  assert.throws(() => parseCsv(encode('user,ip')), /Первая строка/)
  assert.throws(() => parseCsv(csv([])), /нет событий/)
  assert.throws(() => parseCsv(new Uint8Array([255])), /UTF-8/)
})

test('limits are inclusive: 1 MiB and 10000 records before deduplication', () => {
  const bytes = csv([row(0)])
  const atLimit = new Uint8Array(MAX_BYTES).fill(32)
  atLimit.set(bytes)
  assert.equal(parseCsv(atLimit).events.length, 1)
  assert.throws(() => parseCsv(new Uint8Array(MAX_BYTES + 1)), /1 МиБ/)
  const data = Array.from({ length: MAX_ROWS }, (_, index) => row(index))
  assert.equal(parseCsv(csv(data)).events.length, MAX_ROWS)
  assert.throws(() => parseCsv(csv([...data, data[0]])), /10 000/)
})

test('synthetic dataset includes the five evidence rows and three alerts used in the walkthrough', async () => {
  const data = await demo()
  assert.equal(data.events.length, 20)
  assert.equal(data.alerts.length, 3)
  const primary = data.alerts[0]
  assert.equal(primary.rule, 'after')
  assert.equal(primary.count, 4)
  assert.equal(primary.user, 'ops')
  assert.equal(primary.evidence.at(-1)?.result, 'success')
  assert.equal(primary.evidence.length, 5)
})

test('storage separates datasets, handles invalid records and supports individual or global deletion', async () => {
  const data = await demo()
  const storage = new MemoryStorage()
  const id = data.alerts[0].id
  const entry = { verdict: 'insufficient', note: 'Проверить MFA', savedAt: '2026-11-18T07:25:00.000Z' } satisfies Review
  writeReview(storage, data.key, id, entry)
  writeReview(storage, 'other', id, entry)
  storage.setItem('other-app', 'keep')
  storage.setItem(`incidentdesk:v1:${data.key}:${data.alerts[1].id}`, '{')
  assert.deepEqual(readReviews(storage, data), { [id]: entry })
  assert.deepEqual(readReviews(storage, { ...data, key: 'absent' }), {})
  removeReview(storage, data.key, id)
  assert.deepEqual(readReviews(storage, data), {})
  clearReviews(storage)
  assert.equal(storage.length, 1)
  assert.equal(storage.getItem('other-app'), 'keep')
})

test('reports include only reviewed alerts and preserve comments as literal text in Markdown', async () => {
  const data = await demo()
  const id = data.alerts[0].id
  const note = 'Сверить MFA\n\n<script>\n# Данные'
  const now = new Date('2026-11-18T07:25:00Z')
  const reviews = { [id]: { verdict: 'insufficient', note, savedAt: now.toISOString() } } as const
  const json = JSON.parse(report(data, reviews, 'json', now))
  assert.equal(json.reviews.length, 1)
  assert.equal(json.reviews[0].evidence.length, 5)
  assert.equal(json.reviews[0].review.note, note)
  assert.match(report(data, reviews, 'md', now), /\n    <script>\n    # Данные/)
})

class MemoryStorage implements Storage {
  entries = new Map<string, string>()
  get length() { return this.entries.size }
  key(index: number) { return [...this.entries.keys()][index] ?? null }
  getItem(key: string) { return this.entries.get(key) ?? null }
  setItem(key: string, value: string) { this.entries.set(key, value) }
  removeItem(key: string) { this.entries.delete(key) }
  clear() { this.entries.clear() }
}

