import { useEffect, useState } from 'react'
import type { Alert } from './detection.ts'
import type { LogEvent } from './csv.ts'

export const clock = (at: number) => new Date(at).toISOString().slice(11, 23).replace(/\.000$/, '')
export const rangeText = (start: number, end: number) => {
  const date = (at: number) => new Date(at).toISOString().slice(0, 10)
  return date(start) === date(end) ? `${clock(start)} — ${clock(end)}` :
    `${date(start)} ${clock(start)} — ${date(end)} ${clock(end)}`
}
export const eventType = { login: 'Вход', logout: 'Выход' }
export const resultText = { success: 'Успех', failure: 'Отказ' }

export function Icon({ name, size = 20 }: { name: 'arrow' | 'upload' | 'pulse' | 'log' | 'shield' | 'close' | 'download' | 'check' | 'filter' | 'back' | 'alert' | 'chevron'; size?: number }) {
  const paths = {
    arrow: 'M4 12h15m-6-6 6 6-6 6', upload: 'M12 16V3m-5 5 5-5 5 5M4 16v4h16v-4',
    pulse: 'M2 12h5l3-7 4 14 3-7h5', log: 'M5 3h14v18H5zM8 8h8m-8 4h8m-8 4h5',
    shield: 'M12 22c5-3 8-6 8-11V5l-8-3-8 3v6c0 5 3 8 8 11zM9 12l2 2 4-4',
    close: 'm6 6 12 12M18 6 6 18', download: 'M12 3v13m-5-5 5 5 5-5M4 17v4h16v-4',
    check: 'm5 12 5 5L20 7', filter: 'M3 6h18M6 12h12m-8 6h4', back: 'M20 12H5m6-6-6 6 6 6',
    alert: 'M12 3 2.5 20h19L12 3zM12 9v4m0 3v.1', chevron: 'm9 5 7 7-7 7',
  }
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]} /></svg>
}

export function Brand() {
  return <a className="brand" href="#home" aria-label="IncidentDesk, на главную"><span><Icon name="pulse" size={22} /></span>IncidentDesk</a>
}

export function SignalArt({ alert, stage = 1, hero = false }: { alert: Alert; stage?: number; hero?: boolean }) {
  const positions = [[112, 91], [169, 140], [92, 201], [141, 260], [222, 320]]
  return <div className={`signal-art stage-${stage} ${hero ? 'hero-art' : ''}`}>
    <div className="art-grid" />
    <div className="art-code"><span /> {alert.ip} <small>UTC</small></div>
    <svg className="signal-lines" viewBox="0 0 540 410" aria-hidden="true">
      <ellipse cx="286" cy="205" rx="214" ry="157" transform="rotate(-25 286 205)" />
      <ellipse cx="286" cy="205" rx="177" ry="117" transform="rotate(-25 286 205)" />
      <ellipse cx="286" cy="205" rx="140" ry="79" transform="rotate(-25 286 205)" />
      <path className="crosshair" d="M28 205h486M286 26v358M429 88v16m-8-8h16M410 302v16m-8-8h16M52 322v12m-6-6h12" />
      {positions.map(([x, y], index) => <g className={`trace trace-${index}`} key={x}>
        <path d={`M${x} ${y}H${x + 45}L286 205H350`} />
        <circle cx={x} cy={y} r="5" />
      </g>)}
    </svg>
    <div className="art-rows">
      {alert.evidence.map((event, index) => <div className={`art-row ${event.result}`} style={{ '--row': index } as React.CSSProperties} key={event.id}>
        <span className="art-row-icon"><Icon name={event.result === 'success' ? 'check' : 'close'} size={13} /></span>
        <time>{clock(event.at)}</time><span>{resultText[event.result]}</span>
      </div>)}
    </div>
    <div className="art-alert">
      <span className="art-alert-icon"><Icon name={stage === 3 ? 'log' : 'pulse'} size={26} /></span>
      <div><small>{stage === 3 ? 'Результат разбора' : stage === 2 ? 'Подтверждающие записи' : 'Сработало правило'}</small>
      <strong>{stage === 3 ? 'Недостаточно данных' : stage === 2 ? `${alert.evidence.length} событий из журнала` : 'Вход после отказов'}</strong></div>
    </div>
    <div className="art-axis"><span>{clock(alert.start)}</span><i /><span>{clock(alert.end)}</span></div>
  </div>
}

export function Landing({ alert }: { alert: Alert }) {
  const [stage, setStage] = useState(0)
  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) if (entry.isIntersecting) setStage(Number((entry.target as HTMLElement).dataset.stage))
    }, { rootMargin: '-36% 0px -44% 0px' })
    document.querySelectorAll('[data-stage]').forEach((item) => observer.observe(item))
    return () => observer.disconnect()
  }, [])

  const stages = [
    { title: 'События', body: `Журнал фиксирует отказы и успешные входы. Здесь мы смотрим на учётную запись ${alert.user} и IP ${alert.ip}.` },
    { title: 'Подозрительная последовательность', body: `За пять минут перед входом правило нашло ${alert.count} отказа с того же IP для той же учётной записи.` },
    { title: 'Доказательства', body: `Откройте ${alert.evidence.length} записей, которые вошли в расчёт. Сверьте время, пользователя и IP, затем проверьте устройство и MFA.` },
    { title: 'Вывод', body: 'По этому журналу нельзя установить, кто выполнил вход. Пример вывода — «Недостаточно данных». Добавьте комментарий о том, какие сведения нужны для проверки.' },
  ]
  return <>
    <header className="header shell"><Brand /><nav aria-label="Главная навигация"><a className="nav-story" href="#story">Учебный случай</a><a className="button button-quiet" href="#desk">Рабочий стол <Icon name="arrow" size={16} /></a></nav></header>
    <main>
      <section className="hero shell" aria-labelledby="hero-title">
        <div className="hero-copy">
          <div className="hero-kicker"><span><Icon name="pulse" size={16} /></span> Лаборатория разбора событий</div>
          <h1 id="hero-title" tabIndex={-1}>Incident<span>Desk</span></h1>
          <p className="hero-lead">Разберите сигнал.<br />Обоснуйте вывод.</p>
          <p className="hero-description">Изучайте учебные журналы безопасности, проверяйте срабатывания по исходным записям и сохраняйте результаты разбора.</p>
          <a className="button button-primary" href="#desk">Начать расследование <Icon name="arrow" size={19} /></a>
        </div>
        <SignalArt alert={alert} hero />
      </section>
      <div className="shell"><div className="hero-strip"><span><Icon name="log" /> Учебный журнал или свой CSV</span><span><Icon name="pulse" /> Три прозрачных правила</span><span><Icon name="shield" /> Анализ в браузере</span></div></div>
      <section className="story shell" id="story">
        <div className="story-heading"><p className="section-label">Учебный случай</p><h2>Путь от записи<br />до вывода</h2></div>
        <div className="story-layout">
          <div className="story-sticky" aria-hidden="true"><SignalArt alert={alert} stage={stage} /></div>
          <div className="story-steps">
            {stages.map((item, index) => <article className={stage === index ? 'active' : ''} data-stage={index} key={item.title}>
              <div className="step-index">{String(index + 1).padStart(2, '0')}</div>
              <h3>{item.title}</h3><p>{item.body}</p><div className="story-mobile" aria-hidden="true"><SignalArt alert={alert} stage={index} /></div>
              {index === 3 && <a className="button button-primary" href="#case">Открыть этот разбор <Icon name="arrow" size={18} /></a>}
            </article>)}
          </div>
        </div>
      </section>
    </main>
    <footer className="footer shell"><Brand /><span>Учебные сценарии и синтетические записи</span></footer>
  </>
}

export function EventsTable({ events }: { events: LogEvent[] }) {
  return <div className="table-scroll" tabIndex={0} role="region" aria-label="Таблица событий">
    <table><thead><tr><th scope="col">№</th><th scope="col">Время UTC</th><th scope="col">Пользователь</th><th scope="col">IP-адрес</th><th scope="col">Событие</th><th scope="col">Результат</th></tr></thead>
      <tbody>{events.map((event) => <tr key={event.id}>
        <td className="mono">{event.id}</td><td className="mono"><time dateTime={new Date(event.at).toISOString()}>{new Date(event.at).toISOString().slice(0, 10)} {clock(event.at)}</time></td>
        <td>{event.user}</td><td className="mono">{event.ip}</td><td>{eventType[event.type]}</td>
        <td><span className={`result ${event.result}`}>{resultText[event.result]}</span></td>
      </tr>)}</tbody></table>
  </div>
}

export function Timeline({ events }: { events: LogEvent[] }) {
  const [selected, setSelected] = useState<number | null>(null)
  if (!events.length) return <p className="empty">По этим фильтрам событий нет.</p>
  const start = events[0].at
  const end = events.at(-1)!.at
  const minimum = Math.max(1, Math.ceil((end - start + 1) / 24))
  const span = [1, 5, 10, 50, 100, 500, 1000, 5000, 10_000, 30_000, 60_000, 300_000,
    900_000, 1_800_000, 3_600_000, 21_600_000, 86_400_000].find((step) => step >= minimum) ??
    Math.ceil(minimum / 86_400_000) * 86_400_000
  const bucketCount = Math.floor((end - start) / span) + 1
  const buckets = Array.from({ length: bucketCount }, () => ({ success: 0, failure: 0 }))
  for (const event of events) buckets[Math.floor((event.at - start) / span)][event.result]++
  const max = Math.max(...buckets.map((bucket) => bucket.success + bucket.failure))
  const detail = (bucket: typeof buckets[number], index: number) => `${new Date(start + index * span).toISOString().replace('T', ' ')} · Успех: ${bucket.success} · Отказ: ${bucket.failure}`
  return <>
    <div className="timeline-top"><div><h2>Временная шкала</h2><span>Шаг {span >= 1000 ? `${(span / 1000).toLocaleString('ru-RU')} с` : `${span} мс`} · UTC</span></div>
      <div className="legend"><span className="legend-ok">Успех</span><span className="legend-fail">Отказ</span></div></div>
    <div className="chart" style={{ '--buckets': bucketCount } as React.CSSProperties}>
      {buckets.map((bucket, index) => <button className={selected === index ? 'selected' : ''} type="button" key={index}
        aria-label={detail(bucket, index)} aria-pressed={selected === index} onClick={() => setSelected(index)}>
        <span className="bar-fail" style={{ height: `${100 * bucket.failure / max}%` }} /><span className="bar-ok" style={{ height: `${100 * bucket.success / max}%` }} />
      </button>)}
    </div>
    <div className="chart-axis mono"><time>{clock(start)}</time><time>{clock(end)}</time></div>
    <p className="chart-detail" aria-live="polite">{selected !== null && buckets[selected] ? detail(buckets[selected], selected) : 'Выберите столбец, чтобы увидеть время и число событий.'}</p>
  </>
}

