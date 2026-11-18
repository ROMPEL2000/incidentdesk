import { analyze, type WorkerResult } from './analysis.ts'
import { MAX_BYTES } from './csv.ts'

self.onmessage = async (message: MessageEvent<File>) => {
  try {
    if (message.data.size > MAX_BYTES) throw new Error('Размер CSV превышает 1 МиБ.')
    const data = await analyze(new Uint8Array(await message.data.arrayBuffer()))
    self.postMessage({ data } satisfies WorkerResult)
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'Не удалось прочитать CSV.' } satisfies WorkerResult)
  }
}

