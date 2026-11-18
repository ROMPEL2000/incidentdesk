import { useEffect, useMemo, useRef, useState } from 'react'
import type { Analysis } from './analysis.ts'
import type { LogEvent } from './csv.ts'
import { rules, type Alert } from './detection.ts'
import { Brand, rangeText, EventsTable, Icon, Timeline } from './presentation.tsx'
import { clearReviews, MAX_NOTE, readReviews, removeReview, report, verdicts, writeReview, type Review, type Reviews, type Verdict } from './review.ts'
import demoUrl from './demo.csv?url&no-inline'
import sampleUrl from './one-login.csv?url&no-inline'

const PAGE_SIZE = 25
const noFilter = { search: '', result: '', type: '' }

function PagedEvents({ events }: { events: LogEvent[] }) {
  const [page, setPage] = useState(0)
  const pages = Math.ceil(events.length / PAGE_SIZE)
  const current = Math.min(page, Math.max(0, pages - 1))
  if (!events.length) return <p className="empty">По этим фильтрам событий нет.</p>
  return <>
    <EventsTable events={events.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE)} />
    {pages > 1 && <div className="pagination">
      <button className="button button-quiet" type="button" disabled={current === 0} onClick={() => setPage(current - 1)}>Назад</button>
      <span aria-live="polite">Страница {current + 1} из {pages}</span>
      <button className="button button-quiet" type="button" disabled={current + 1 === pages} onClick={() => setPage(current + 1)}>Далее</button>
    </div>}
  </>
}

function Severity({ alert }: { alert: Alert }) {
  const rule = rules[alert.rule]
  return <span className={`severity ${rule.severity}`}><Icon name={rule.severity === 'high' ? 'alert' : 'pulse'} size={15} /> {rule.label}</span>
}

function Why({ alert }: { alert: Alert }) {
  const rule = rules[alert.rule]
  if (alert.rule === 'after') return <p>У пользователя <strong>{alert.user}</strong> с IP <strong>{alert.ip}</strong> было {alert.count} отказа в пределах {rule.minutes} минут перед успешным входом.</p>
  return <p>С IP <strong>{alert.ip}</strong> зафиксировано {alert.count} {alert.rule === 'multiple' ? 'различных учётных записей' : 'отказов'} в объединённой серии. В ней есть окно, достигшее порога правила.</p>
}

function Drawer({ alert, review, onClose, onSave, onDelete, onEvidence }: {
  alert: Alert; review?: Review; onClose: () => void; onSave: (verdict: Verdict, note: string) => void;
  onDelete: () => void; onEvidence: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [verdict, setVerdict] = useState<Verdict | ''>(review?.verdict ?? '')
  const [note, setNote] = useState(review?.note ?? '')
  const rule = rules[alert.rule]
  const evidencePreview = alert.evidence.length <= 5 ? alert.evidence : [...alert.evidence.slice(0, 4), alert.evidence.at(-1)!]

  useEffect(() => {
    const panel = dialog.current!
    panel.showModal()
    return () => panel.close()
  }, [])
  useEffect(() => {
    setVerdict(review?.verdict ?? '')
    setNote(review?.note ?? '')
  }, [review])

  return <dialog className="drawer" ref={dialog} aria-labelledby="drawer-title" onCancel={(event) => { event.preventDefault(); onClose() }}>
    <div className="drawer-inner">
      <div className="drawer-top"><Severity alert={alert} /><button type="button" className="icon-button" aria-label="Закрыть разбор" onClick={onClose} autoFocus><Icon name="close" /></button></div>
      <h2 id="drawer-title">{rule.title}</h2>
      <div className="rule-meta"><div><small>Порог правила</small><strong>{rule.threshold} {rule.unit} / {rule.minutes} мин</strong></div>
        <div><small>Наблюдаемый интервал (UTC)</small><strong className="mono">{rangeText(alert.start, alert.end)}</strong></div></div>
      <section className="why"><h3>Почему сработало</h3><Why alert={alert} /></section>
      <section className="drawer-evidence"><h3>Подтверждающие события <span>{alert.evidence.length}</span></h3>
        {evidencePreview.length < alert.evidence.length && <p className="muted">Первые четыре и последняя запись серии.</p>}<EventsTable events={evidencePreview} />
        <button className="button button-quiet" type="button" onClick={onEvidence}>Открыть записи в журнале <Icon name="arrow" size={16} /></button>
      </section>
      <section className="hypothesis"><h3>Обычное объяснение</h3><p>{rule.ordinary}</p><h3>Что проверить дальше</h3><p>{rule.checks}</p></section>
      <form className="review-form" onSubmit={(event) => { event.preventDefault(); if (verdict) onSave(verdict, note) }}>
        <h3>Результат разбора</h3>
        <label>Вывод<select value={verdict} required onChange={(event) => setVerdict(event.target.value as Verdict | '')}>
          <option value="">Выберите вывод</option>
          {Object.entries(verdicts).map(([id, title]) => <option key={id} value={id}>{title}</option>)}
        </select></label>
        <label>Комментарий<textarea value={note} maxLength={MAX_NOTE} rows={4} onChange={(event) => setNote(event.target.value)} placeholder="Что подтверждают записи? Какие данные ещё нужны?" /></label>
        <div className="review-actions"><button className="button button-primary" type="submit"><Icon name="check" size={18} /> Сохранить вывод</button>
          {review && <button className="button button-quiet" type="button" onClick={onDelete}>Удалить вывод</button>}</div>
        <p className="saved-label" role="status">{review ? `Сохранено · ${verdicts[review.verdict]}` : 'Вывод хранится в этом браузере.'}</p>
        <p className="storage-error" id="drawer-status" role="alert" />
      </form>
    </div>
  </dialog>
}

type DeskProps = {
  analysis: Analysis; label: string; imported: boolean; pendingFile: string; error: string; notice: string
  initialAlert?: string; onImport: (file: File) => void; onDemo: () => void
}

export function Desk({ analysis, label, imported, pendingFile, error, notice, initialAlert, onImport, onDemo }: DeskProps) {
  const [view, setView] = useState<'alerts' | 'events'>('alerts')
  const [selected, setSelected] = useState(initialAlert ?? '')
  const [evidence, setEvidence] = useState<Alert>()
  const [filters, setFilters] = useState(noFilter)
  const [status, setStatus] = useState('')
  const [storageError, setStorageError] = useState('')
  const [reviews, setReviews] = useState<Reviews>({})
  const [alertPage, setAlertPage] = useState(0)
  const clearDialog = useRef<HTMLDialogElement>(null)
  const previousButton = useRef<HTMLButtonElement | null>(null)
  const eventsHeading = useRef<HTMLHeadingElement>(null)
  const upload = useRef<HTMLInputElement>(null)
  const uploadButton = useRef<HTMLButtonElement>(null)
  const alert = analysis.alerts.find((item) => item.id === selected)
  const reviewCount = Object.keys(reviews).length
  const failures = analysis.events.filter((event) => event.result === 'failure').length
  const filtered = useMemo(() => (evidence?.evidence ?? analysis.events).filter((event) => {
    const search = filters.search.trim().toLowerCase()
    return (!search || event.user.toLowerCase().includes(search) || event.ip.includes(search)) &&
      (!filters.result || event.result === filters.result) && (!filters.type || event.type === filters.type)
  }), [analysis, evidence, filters])

  useEffect(() => {
    function sync() {
      try {
        setReviews(readReviews(localStorage, analysis))
      } catch {
        setStorageError('Хранилище браузера недоступно. Проверьте настройки приватности.')
      }
    }
    sync()
    window.addEventListener('storage', sync)
    return () => window.removeEventListener('storage', sync)
  }, [analysis])

  useEffect(() => {
    if (imported) uploadButton.current?.focus({ preventScroll: true })
  }, [imported])

  function closeDrawer(showEvidence = false) {
    if (showEvidence && alert) {
      setEvidence(alert)
      setFilters(noFilter)
      setView('events')
    }
    setSelected('')
    requestAnimationFrame(() => {
      if (showEvidence) eventsHeading.current?.focus()
      else if (previousButton.current?.isConnected) previousButton.current.focus()
      else document.getElementById('desk-title')?.focus()
    })
  }

  function storageAction(action: () => void, message: string) {
    setStorageError('')
    const drawerStatus = document.getElementById('drawer-status')
    if (drawerStatus) drawerStatus.textContent = ''
    try {
      action()
      setReviews(readReviews(localStorage, analysis))
      setStatus(message)
    } catch {
      const warning = 'Браузер не смог изменить локальные данные. Проверьте доступ и свободное место.'
      setStorageError(warning)
      if (drawerStatus) drawerStatus.textContent = warning
    }
  }

  function download(format: 'md' | 'json') {
    const content = report(analysis, reviews, format)
    const url = URL.createObjectURL(new Blob([content], { type: format === 'md' ? 'text/markdown;charset=utf-8' : 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `incidentdesk-отчёт.${format}`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 30_000)
    setStatus(`Отчёт ${format === 'md' ? 'Markdown' : 'JSON'} подготовлен к скачиванию.`)
  }

  return <>
    <header className="desk-header"><div className="shell header"><Brand /><nav aria-label="Навигация"><a className="button button-quiet" href="#home"><Icon name="back" size={16} /> На главную</a></nav></div></header>
    <main className="shell workspace">
      <div className="desk-intro">
        <div><p className="section-label"><Icon name="pulse" size={16} /> {imported ? 'Локальный файл' : 'Синтетические данные'}</p><h1 id="desk-title" tabIndex={-1}>Рабочий стол</h1><p className="source-name">{label}{analysis.duplicates ? ` · Убрано повторов: ${analysis.duplicates}` : ''}</p></div>
        <div className="upload-controls">
          {imported && <button className="button button-quiet" type="button" onClick={onDemo}>Вернуть демо</button>}
          <input type="file" hidden ref={upload} accept=".csv,text/csv" onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) { setStatus(''); onImport(file) }
            event.target.value = ''
          }} />
          <button className="button button-primary" type="button" onClick={() => upload.current?.click()} ref={uploadButton}><Icon name="upload" size={18} /> {pendingFile ? 'Выбрать другой CSV' : 'Загрузить CSV'}</button>
          <div className="sample-links">
            <a href={demoUrl} download="incidentdesk-demo.csv">Учебный CSV (20 событий)</a>
            <a href={sampleUrl} download="one-login.csv">Проверочный CSV (1 событие)</a>
          </div>
        </div>
      </div>
      <div className="feedback" aria-live="polite">{pendingFile ? `Проверяем файл «${pendingFile}»…` : status || notice}</div>
      {(error || storageError) && <div className="error" role="alert">{[error, storageError].filter(Boolean).join('\n')}</div>}
      <section className="overview" aria-label="Сводка по журналу">
        <div className="metrics">
          <div><Icon name="log" /><strong>{analysis.events.length}</strong><span>События</span></div>
          <div><Icon name="close" /><strong>{failures}</strong><span>Отказы</span></div>
          <div><Icon name="alert" /><strong>{analysis.alerts.length}</strong><span>Предупреждения</span></div>
          <div><Icon name="check" /><strong>{reviewCount}</strong><span>Разобрано</span></div>
        </div>
        <div className="timeline"><Timeline key={view === 'events' ? JSON.stringify([evidence?.id, filters]) : 'all'} events={view === 'events' ? filtered : analysis.events} /></div>
      </section>
      <div className="work-tabs" role="group" aria-label="Разделы журнала">
        <button type="button" aria-pressed={view === 'alerts'} onClick={() => setView('alerts')}><Icon name="alert" size={17} /> Предупреждения</button>
        <button type="button" aria-pressed={view === 'events'} onClick={() => setView('events')}><Icon name="log" size={17} /> Журнал событий</button>
      </div>
      {view === 'alerts' ? <section className="alert-section" aria-label="Предупреждения">
        <p className="muted">Срабатывания показывают, какие записи стоит проверить. Причину активности определяют при разборе.</p>
        {!analysis.alerts.length && <p className="empty">Правила не сработали для этого журнала. Можно изучить исходные записи во вкладке «Журнал событий».</p>}
        {analysis.alerts.slice(alertPage * PAGE_SIZE, (alertPage + 1) * PAGE_SIZE).map((item) => <button className={`alert-card ${rules[item.rule].severity}`}
          type="button" key={item.id} onClick={(event) => { previousButton.current = event.currentTarget; setSelected(item.id) }}>
          <span className="alert-icon"><Icon name={item.rule === 'after' ? 'alert' : 'pulse'} size={23} /></span>
          <span className="alert-title"><strong>{rules[item.rule].title}</strong><small className="mono">{item.ip}{item.user ? ` / ${item.user}` : ''} · {rangeText(item.start, item.end)} UTC</small></span>
          <Severity alert={item} />
          <span className="alert-count">{item.evidence.length} зап.</span>
          {reviews[item.id] && <span className="review-done"><Icon name="check" size={18} /><span className="sr-only">{verdicts[reviews[item.id].verdict]}</span></span>}
          <Icon name="chevron" size={17} />
        </button>)}
        {analysis.alerts.length > PAGE_SIZE && <div className="pagination">
          <button type="button" className="button button-quiet" disabled={!alertPage} onClick={() => setAlertPage(alertPage - 1)}>Назад</button>
          <span aria-live="polite">Страница {alertPage + 1} из {Math.ceil(analysis.alerts.length / PAGE_SIZE)}</span>
          <button type="button" className="button button-quiet" disabled={(alertPage + 1) * PAGE_SIZE >= analysis.alerts.length} onClick={() => setAlertPage(alertPage + 1)}>Далее</button>
        </div>}
      </section> : <section className="journal">
        <h2 tabIndex={-1} ref={eventsHeading}>{evidence ? 'Подтверждающие записи' : 'Журнал событий'}</h2>
        {evidence && <div className="evidence-filter"><Icon name="filter" size={16} /> {rules[evidence.rule].title}
          <button type="button" className="button button-quiet" onClick={() => { setEvidence(undefined); setFilters(noFilter) }}>Весь журнал</button></div>}
        <div className="filters">
          <label>Пользователь или IP<input type="search" placeholder="Например, ops" value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} /></label>
          <label>Результат<select value={filters.result} onChange={(event) => setFilters({ ...filters, result: event.target.value })}><option value="">Все результаты</option><option value="success">Успех</option><option value="failure">Отказ</option></select></label>
          <label>Событие<select value={filters.type} onChange={(event) => setFilters({ ...filters, type: event.target.value })}><option value="">Все события</option><option value="login">Вход</option><option value="logout">Выход</option></select></label>
          <button type="button" className="button button-quiet" onClick={() => setFilters(noFilter)}>Сбросить</button>
        </div>
        <div className="muted results-total" aria-live="polite">Записей: {filtered.length} из {evidence?.evidence.length ?? analysis.events.length}</div>
        <div className={evidence ? 'evidence-table' : ''}><PagedEvents key={JSON.stringify([evidence?.id, filters])} events={filtered} /></div>
      </section>}
      <section className="desk-footer">
        <div><h2>Отчёт о разборе</h2><p className="muted">Сохранённых выводов по журналу: {reviewCount}. В отчёт входят выводы и подтверждающие записи.</p></div>
        <div className="export-actions"><button className="button button-quiet" type="button" disabled={!reviewCount} onClick={() => download('md')}><Icon name="download" size={17} /> Markdown</button>
          <button className="button button-quiet" type="button" disabled={!reviewCount} onClick={() => download('json')}><Icon name="download" size={17} /> JSON</button></div>
      </section>
      <details className="privacy"><summary>Формат CSV и локальное хранение</summary>
        <p>CSV в UTF-8, до 1 МиБ и 10 000 записей. Заголовок <code>timestamp,user,ip,event_type,result</code>. Время — ISO 8601 с поясом, IP — IPv4 или IPv6, событие — <code>login</code> или <code>logout</code>, результат — <code>success</code> или <code>failure</code>.</p>
        <p>Журнал остаётся в памяти вкладки до перезагрузки или смены источника. Выводы остаются в браузере до удаления или очистки хранилища, между устройствами не синхронизируются.</p>
        <button type="button" className="button button-quiet" onClick={() => clearDialog.current?.showModal()}>Удалить все локальные выводы</button>
      </details>
    </main>
    {alert && <Drawer key={alert.id} alert={alert} review={reviews[alert.id]} onClose={() => closeDrawer()} onEvidence={() => closeDrawer(true)}
      onSave={(verdict, note) => storageAction(() => {
        const entry: Review = { verdict, note: note.trim(), savedAt: new Date().toISOString() }
        writeReview(localStorage, analysis.key, alert.id, entry)
      }, 'Вывод сохранён в браузере.')}
      onDelete={() => storageAction(() => removeReview(localStorage, analysis.key, alert.id), 'Вывод удалён.')} />}
    <dialog className="confirm" ref={clearDialog} aria-labelledby="confirm-title">
      <h2 id="confirm-title">Удалить все выводы?</h2><p>Будут удалены сохранённые выводы IncidentDesk по всем журналам в этом браузере.</p>
      <form method="dialog"><button className="button button-quiet" autoFocus>Отмена</button>
        <button className="button button-danger" onClick={() => storageAction(() => clearReviews(localStorage), 'Все локальные выводы удалены.')}>Удалить</button></form>
    </dialog>
  </>
}

