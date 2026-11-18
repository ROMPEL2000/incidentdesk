import type { Analysis } from './analysis.ts'
import { rules } from './detection.ts'

export const verdicts = {
  suspicious: 'Подозрительная активность',
  explained: 'Объяснимое событие',
  insufficient: 'Недостаточно данных',
} as const
export type Verdict = keyof typeof verdicts
export type Review = { verdict: Verdict; note: string; savedAt: string }
export type Reviews = Record<string, Review>

export const MAX_NOTE = 2000
const prefix = 'incidentdesk:v1:'
const storageKey = (dataset: string, alert: string) => `${prefix}${dataset}:${alert}`

export function readReviews(storage: Storage, analysis: Analysis): Reviews {
  const reviews: Reviews = {}
  for (const { id } of analysis.alerts) {
    const raw = storage.getItem(storageKey(analysis.key, id))
    if (!raw) continue
    try {
      const review: Review = JSON.parse(raw)
      if (review && Object.hasOwn(verdicts, review.verdict) &&
        typeof review.note === 'string' && typeof review.savedAt === 'string') reviews[id] = review
    } catch {
      // A damaged entry does not prevent reading other reviews.
    }
  }
  return reviews
}

export function writeReview(storage: Storage, dataset: string, alert: string, review: Review) {
  storage.setItem(storageKey(dataset, alert), JSON.stringify(review))
}

export function removeReview(storage: Storage, dataset: string, alert: string) {
  storage.removeItem(storageKey(dataset, alert))
}

export function clearReviews(storage: Storage) {
  for (let i = storage.length - 1; i >= 0; i--) {
    const key = storage.key(i)
    if (key?.startsWith(prefix)) storage.removeItem(key)
  }
}

export function report(analysis: Analysis, reviews: Reviews, format: 'md' | 'json', now = new Date()) {
  const reviewed = analysis.alerts.filter((alert) => Object.hasOwn(reviews, alert.id))
  const document = {
    schemaVersion: 1, generatedAt: now.toISOString(), dataset: analysis.key,
    eventCount: analysis.events.length, alertCount: analysis.alerts.length, duplicates: analysis.duplicates,
    reviews: reviewed.map(({ evidence, start, end, ...alert }) => ({
      ...alert, title: rules[alert.rule].title, severity: rules[alert.rule].label,
      threshold: rules[alert.rule].threshold, minutes: rules[alert.rule].minutes,
      start: new Date(start).toISOString(), end: new Date(end).toISOString(),
      review: { ...reviews[alert.id], label: verdicts[reviews[alert.id].verdict] },
      evidence: evidence.map(({ at, ...event }) => ({ ...event, timestamp: new Date(at).toISOString() })),
    })),
  }
  if (format === 'json') return JSON.stringify(document, null, 2) + '\n'

  // Indented code blocks keep untrusted text literal in Markdown renderers.
  const literal = (value: string) => value.replace(/\r\n?/g, '\n').split('\n').map((line) => '    ' + line).join('\n')
  const sections = document.reviews.map((entry) => [
    `## ${entry.title}`,
    `Серьёзность: ${entry.severity}. Порог: ${entry.threshold} за ${entry.minutes} мин. Наблюдаемое значение: ${entry.count}.`,
    `IP: ${entry.ip}. Период (UTC): ${entry.start} — ${entry.end}.`,
    `**Вывод:** ${entry.review.label}. Сохранён ${entry.review.savedAt}.`,
    ...(entry.review.note ? ['Комментарий', literal(entry.review.note)] : []),
    'Подтверждающие записи (UTC)',
    literal(entry.evidence.map((event) => `#${event.id} | ${event.timestamp} | ${event.user} | ${event.ip} | ${event.type} | ${event.result}`).join('\n')),
  ].join('\n\n'))
  return ['# IncidentDesk — отчёт о разборе',
    `Сформирован ${document.generatedAt}. Событий: ${document.eventCount}. Предупреждений: ${document.alertCount}. Разобрано: ${reviewed.length}. Повторов пропущено: ${document.duplicates}.`,
    'Срабатывание правила требует проверки по дополнительным источникам.', ...sections].join('\n\n') + '\n'
}

