import type { LogEvent } from './csv.ts'

export const rules = {
  repeated: {
    title: 'Серия отказов с одного IP', minutes: 5, threshold: 5, unit: 'отказов',
    severity: 'medium', label: 'Средняя',
    ordinary: 'Приложение продолжает отправлять старый пароль после его смены.',
    checks: 'Сверьте время со сменой пароля и проверьте журналы службы, откуда пришли запросы.',
  },
  multiple: {
    title: 'Отказы по нескольким учётным записям', minutes: 10, threshold: 3, unit: 'разных учётных записи',
    severity: 'medium', label: 'Средняя',
    ordinary: 'Несколько сотрудников выходят через общий VPN и независимо ошибаются при входе.',
    checks: 'Уточните, является ли IP выходом VPN или NAT. Сравните источники и время в журналах IdP.',
  },
  after: {
    title: 'Успешный вход после отказов', minutes: 5, threshold: 4, unit: 'отказа перед входом',
    severity: 'high', label: 'Высокая',
    ordinary: 'Пользователь мог несколько раз ошибиться, а затем ввести правильный пароль.',
    checks: 'Уточните у пользователя, инициировал ли он вход. Сверьте время, устройство, MFA и действия после входа.',
  },
} as const

export type RuleId = keyof typeof rules
export type Alert = {
  id: string
  rule: RuleId
  ip: string
  user?: string
  evidence: LogEvent[]
  count: number
  start: number
  end: number
}

type Range = { first: number; last: number }

function group(events: LogEvent[], getKey: (event: LogEvent) => string) {
  const groups = new Map<string, LogEvent[]>()
  for (const event of events) {
    const key = getKey(event)
    const existing = groups.get(key)
    if (existing) existing.push(event)
    else groups.set(key, [event])
  }
  return groups.values()
}

function addAlert(alerts: Alert[], rule: RuleId, events: LogEvent[], range: Range) {
  const evidence = events.slice(range.first, range.last + 1)
  const first = evidence[0]
  const last = evidence.at(-1)!
  const count = rule === 'multiple' ? new Set(evidence.map((event) => event.user)).size :
    rule === 'after' ? evidence.length - 1 : evidence.length
  alerts.push({
    id: `${rule}-${first.id}-${last.id}`, rule, ip: first.ip,
    ...(rule === 'after' ? { user: first.user } : {}),
    evidence, start: first.at, end: last.at, count,
  })
}

export function detect(events: LogEvent[]) {
  const alerts: Alert[] = []
  const logins = events.filter((event) => event.type === 'login')
  for (const list of group(logins.filter((event) => event.result === 'failure'), (event) => event.ip)) {
    for (const rule of ['repeated', 'multiple'] as const) {
      const { threshold, minutes } = rules[rule]
      const users = new Map<string, number>()
      let first = 0
      let merged: Range | undefined
      for (const [last, event] of list.entries()) {
        users.set(event.user, (users.get(event.user) ?? 0) + 1)
        while (event.at - list[first].at > minutes * 60_000) {
          const user = list[first++].user
          const remaining = users.get(user)! - 1
          if (remaining) users.set(user, remaining)
          else users.delete(user)
        }
        const count = rule === 'repeated' ? last - first + 1 : users.size
        if (count < threshold) continue
        if (merged && first <= merged.last) merged.last = last
        else {
          if (merged) addAlert(alerts, rule, list, merged)
          merged = { first, last }
        }
      }
      if (merged) addAlert(alerts, rule, list, merged)
    }
  }

  for (const list of group(logins, (event) => JSON.stringify([event.ip, event.user]))) {
    const failures: LogEvent[] = []
    let previousSuccess = -Infinity
    for (let index = 0; index < list.length;) {
      const at = list[index].at
      let end = index
      let success: LogEvent | undefined
      while (end < list.length && list[end].at === at) {
        if (list[end].result === 'success') success = list[end]
        end++
      }
      if (success) {
        const window = failures.filter((event) => at - event.at <= rules.after.minutes * 60_000 && event.at > previousSuccess)
        if (window.length >= rules.after.threshold) {
          window.push(success)
          addAlert(alerts, 'after', window, { first: 0, last: window.length - 1 })
        }
        previousSuccess = at
        failures.length = 0
      } else {
        for (; index < end; index++) failures.push(list[index])
      }
      index = end
    }
  }
  return alerts.sort((a, b) => Number(b.rule === 'after') - Number(a.rule === 'after') ||
    a.start - b.start || a.id.localeCompare(b.id, 'en'))
}

