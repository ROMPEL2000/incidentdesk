import { useEffect, useRef, useState } from 'react'
import { analyze, type Analysis, type WorkerResult } from './analysis.ts'
import { MAX_BYTES } from './csv.ts'
import { Landing } from './presentation.tsx'
import { Desk } from './Desk.tsx'
import demoCsv from './demo.csv?raw'

const demoPromise = analyze(new TextEncoder().encode(demoCsv))

export function App() {
  const [demo, setDemo] = useState<Analysis>()
  const [source, setSource] = useState<{ data: Analysis; label: string }>()
  const [hash, setHash] = useState(location.hash)
  const [pendingFile, setPendingFile] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [revision, setRevision] = useState(0)
  const worker = useRef<Worker | null>(null)

  function stopImport() {
    worker.current?.terminate()
    worker.current = null
    setPendingFile('')
  }

  useEffect(() => {
    demoPromise.then(setDemo).catch(() => {
      setError('Не удалось открыть демонстрацию. Запустите приложение через HTTPS или localhost.')
    })
    function onHashChange() {
      const next = location.hash
      if (next === '#case') {
        stopImport()
        setSource(undefined)
        setError('')
        setNotice('')
        setRevision((value) => value + 1)
      }
      setHash(next)
      if (next !== '#story') window.scrollTo({ top: 0, behavior: 'instant' })
    }
    window.addEventListener('hashchange', onHashChange)
    return () => {
      window.removeEventListener('hashchange', onHashChange)
      worker.current?.terminate()
    }
  }, [])

  const desk = hash === '#desk' || hash === '#case'
  useEffect(() => {
    if (desk) document.getElementById('desk-title')?.focus({ preventScroll: true })
    else if (hash === '#story') document.getElementById('story')?.scrollIntoView()
    else if (hash === '#home') document.getElementById('hero-title')?.focus({ preventScroll: true })
  }, [desk, hash, demo])

  function importCsv(file: File) {
    stopImport()
    setError('')
    setNotice('')
    const previous = source ?? (demo && { data: demo, label: 'Учебный журнал' })
    const showError = (message: string) => {
      setError(`Файл «${file.name}» не загружен.${previous ? ` Сейчас открыт «${previous.label}».` : ''}\n${message}`)
    }
    if (file.size > MAX_BYTES) {
      showError('Размер CSV превышает 1 МиБ. Разделите журнал на файлы меньшего размера.')
      return
    }
    setPendingFile(file.name)
    function fail(message: string) {
      stopImport()
      showError(message)
    }
    try {
      const instance = new Worker(new URL('./import.worker.ts', import.meta.url), { type: 'module' })
      worker.current = instance
      instance.onmessage = ({ data }: MessageEvent<WorkerResult>) => {
        if (worker.current !== instance) return
        if ('error' in data) fail(data.error)
        else {
          stopImport()
          setSource({ data: data.data, label: file.name })
          setRevision((value) => value + 1)
          const { events, alerts, key } = data.data
          const sameData = key === previous?.data.key
          const summary = `Событий: ${events.length} · Предупреждений: ${alerts.length}.`
          setNotice(sameData
            ? `Файл «${file.name}» открыт. Записи совпадают с предыдущим журналом. ${summary}`
            : `Файл «${file.name}» открыт. Сводка обновлена. ${summary}`)
        }
      }
      instance.onerror = () => {
        if (worker.current === instance) fail('Обработчик CSV не запустился. Обновите страницу и попробуйте снова.')
      }
      instance.postMessage(file)
    } catch {
      fail('Не удалось запустить обработчик CSV.')
    }
  }

  if (!demo) return <main className="shell boot" role="status">{error || 'Подготовка учебного журнала…'}</main>
  const primary = demo.alerts.find((alert) => alert.rule === 'after')!
  if (!desk) return <Landing alert={primary} />
  return <Desk key={revision} analysis={source?.data ?? demo} label={source?.label ?? 'Учебный журнал'}
    imported={Boolean(source)} initialAlert={hash === '#case' && !source ? primary.id : undefined}
    pendingFile={pendingFile} error={error} notice={notice} onImport={importCsv} onDemo={() => {
      stopImport()
      setSource(undefined)
      setError('')
      setNotice('Учебный журнал открыт.')
      setRevision((value) => value + 1)
      if (location.hash === '#case') {
        history.replaceState(null, '', '#desk')
        setHash('#desk')
      }
    }} />
}

