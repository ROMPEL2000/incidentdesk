export const MAX_BYTES = 1024 * 1024
export const MAX_ROWS = 10_000
const headers = ['timestamp', 'user', 'ip', 'event_type', 'result']

export type LogEvent = {
  id: number
  at: number
  user: string
  ip: string
  type: 'login' | 'logout'
  result: 'success' | 'failure'
}

function rows(csv: string) {
  const result: { cells: string[]; line: number }[] = []
  let cells: string[] = []
  let field = ''
  let quoted = false
  let closed = false
  let line = 1
  let start = 1

  function finishRow() {
    cells.push(field)
    if (cells.length > 1 || field.trim()) result.push({ cells, line: start })
    if (result.length > MAX_ROWS + 1) throw new Error('В CSV больше 10 000 записей.')
    cells = []
    field = ''
    closed = false
    start = ++line
  }

  for (let i = 0; i < csv.length; i++) {
    const char = csv[i]
    if (quoted) {
      if (char !== '"') {
        if (char === '\n' || char === '\r') throw new Error(`Строка ${line}. Перенос внутри поля запрещён.`)
        field += char
      } else if (csv[i + 1] === '"') {
        field += '"'
        i++
      } else {
        quoted = false
        closed = true
      }
    } else if (char === ',') {
      cells.push(field)
      field = ''
      closed = false
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && csv[i + 1] === '\n') i++
      finishRow()
    } else if (char === '"' && !field && !closed) {
      quoted = true
    } else {
      if (closed || char === '"') throw new Error(`Строка ${line}. Проверьте расстановку кавычек.`)
      field += char
    }
  }
  if (quoted) throw new Error(`Строка ${line}. Кавычка не закрыта.`)
  finishRow()
  return result
}

function parseTime(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(value)
  if (!match) return NaN
  const [, year, month, day, hour, minute, second, zone] = match
  const localDate = new Date(`${year}-${month}-${day}T00:00:00Z`)
  if (localDate.getUTCDate() !== Number(day) || +hour > 23 || +minute > 59 || +second > 59) return NaN
  if (zone === '-00:00') return NaN
  return Date.parse(value)
}

function normalizeIp(value: string) {
  if (/^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/.test(value)) {
    return value.split('.').every((octet) => Number(octet) <= 255) ? value : null
  }
  if (!value.includes(':') || !/^[0-9a-f:.]+$/i.test(value)) return null
  try {
    return new URL(`http://[${value}]/`).hostname.slice(1, -1)
  } catch {
    return null
  }
}

export function parseCsv(bytes: Uint8Array) {
  if (bytes.byteLength > MAX_BYTES) throw new Error('Размер CSV превышает 1 МиБ.')
  let csv: string
  try {
    csv = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new Error('Сохраните CSV в кодировке UTF-8.')
  }
  const [header, ...records] = rows(csv)
  if (header?.line !== 1 || header.cells.length !== headers.length || headers.some((name, index) => header.cells[index] !== name)) {
    throw new Error('Первая строка должна содержать timestamp,user,ip,event_type,result.')
  }
  if (!records.length) throw new Error('В CSV нет событий.')
  const errors: string[] = []
  const unique = new Map<string, Omit<LogEvent, 'id'>>()
  for (const { cells, line } of records) {
    const [timestamp, user = '', rawIp = '', type, result] = cells.map((cell) => cell.trim())
    const at = parseTime(timestamp)
    const ip = normalizeIp(rawIp)
    const prefix = `Строка ${line}.`
    if (cells.length !== 5) errors.push(`${prefix} Ожидаются 5 полей.`)
    else if (!Number.isFinite(at)) errors.push(`${prefix} Укажите действительное время ISO 8601 с часовым поясом.`)
    else if (!user || user.length > 80 || /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(user)) errors.push(`${prefix} Имя пользователя должно содержать 1–80 знаков без управляющих символов.`)
    else if (!ip) errors.push(`${prefix} Укажите корректный IPv4 или IPv6.`)
    else if (type !== 'login' && type !== 'logout') errors.push(`${prefix} Тип события должен быть login или logout.`)
    else if (result !== 'success' && result !== 'failure') errors.push(`${prefix} Результат должен быть success или failure.`)
    else unique.set(JSON.stringify([at, user, ip, type, result]), { at, user, ip, type, result })
    if (errors.length === 5) break
  }
  if (errors.length) throw new Error(errors.join('\n'))

  const events = [...unique.entries()]
    .sort(([keyA, a], [keyB, b]) => a.at - b.at || (keyA < keyB ? -1 : 1))
    .map(([, event], index) => ({ ...event, id: index + 1 }))
  return { events, duplicates: records.length - events.length }
}

