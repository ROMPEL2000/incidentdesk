import { parseCsv } from './csv.ts'
import { detect } from './detection.ts'

export async function analyze(bytes: Uint8Array) {
  const { events, duplicates } = parseCsv(bytes)
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(events)))
  const key = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return { key, events, duplicates, alerts: detect(events) }
}

export type Analysis = Awaited<ReturnType<typeof analyze>>
export type WorkerResult = { data: Analysis } | { error: string }

