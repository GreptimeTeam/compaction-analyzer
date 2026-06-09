import { analyzeCompactionProcessTasks, type CompactionProcessAnalysis, type CompactionProcessTask, type InputMode, type ParseResult } from './parser'

type WorkerInputMode = InputMode | 'compaction-process-chunk'

export type ParseWorkerRequest = {
  id: number
  mode: WorkerInputMode
  content: string
}

type ParseInputRequest = Omit<ParseWorkerRequest, 'id'> & {
  mode: InputMode
  onProgress?: (progress: number) => void
}

export type ParseWorkerResult =
  | { kind: 'files'; result: ParseResult }
  | { kind: 'processes'; result: CompactionProcessAnalysis }

type ParseWorkerResponse =
  | ({ id: number; ok: true } & ParseWorkerResult)
  | { id: number; ok: true; kind: 'process-tasks'; tasks: CompactionProcessTask[] }
  | { id: number; ok: true; kind: 'progress'; progress: number }
  | { id: number; ok: false; error: string }

let nextRequestId = 1

export function parseInputInWorker(request: ParseInputRequest): Promise<ParseWorkerResult> {
  if (request.mode === 'compaction-process') return parseCompactionProcessInChunks(request)

  const id = nextRequestId++
  const worker = new Worker(new URL('./parser.worker.ts', import.meta.url), { type: 'module' })

  return new Promise((resolve, reject) => {
    function finish(callback: () => void) {
      worker.terminate()
      callback()
    }

    worker.onmessage = (event: MessageEvent<ParseWorkerResponse>) => {
      const response = event.data
      if (response.id !== id) return

      if (response.ok && response.kind === 'progress') {
        request.onProgress?.(response.progress)
        return
      }

      if (response.ok && response.kind === 'files') {
        finish(() => resolve({ kind: 'files', result: response.result }))
      } else if (response.ok && response.kind === 'processes') {
        finish(() => resolve({ kind: 'processes', result: response.result }))
      } else {
        finish(() => reject(new Error(response.ok ? 'Unexpected worker response.' : response.error)))
      }
    }

    worker.onerror = (event) => {
      finish(() => reject(new Error(event.message || 'Failed to parse input.')))
    }

    worker.postMessage({ id, mode: request.mode, content: request.content })
  })
}

function parseCompactionProcessInChunks(request: ParseInputRequest): Promise<ParseWorkerResult> {
  const chunks = splitLogChunks(request.content)
  if (chunks.length === 0) return Promise.resolve({ kind: 'processes', result: analyzeCompactionProcessTasks([]) })

  const workerCount = Math.min(chunks.length, Math.max(1, navigator.hardwareConcurrency || 1))
  const workers = Array.from({ length: workerCount }, () => new Worker(new URL('./parser.worker.ts', import.meta.url), { type: 'module' }))
  const tasksByChunk: CompactionProcessTask[][] = Array.from({ length: chunks.length }, () => [])
  let completedChunks = 0
  let nextChunk = 0
  let settled = false

  return new Promise((resolve, reject) => {
    function finish(callback: () => void) {
      if (settled) return
      settled = true
      for (const worker of workers) worker.terminate()
      callback()
    }

    function sendNext(worker: Worker) {
      const chunkIndex = nextChunk++
      if (chunkIndex >= chunks.length) return
      const id = nextRequestId++
      worker.postMessage({ id, mode: 'compaction-process-chunk', content: chunks[chunkIndex] })
      return { id, chunkIndex }
    }

    const active = new Map<Worker, { id: number; chunkIndex: number }>()

    for (const worker of workers) {
      worker.onmessage = (event: MessageEvent<ParseWorkerResponse>) => {
        const current = active.get(worker)
        const response = event.data
        if (!current || response.id !== current.id) return

        if (response.ok && response.kind === 'progress') return
        if (response.ok && response.kind === 'process-tasks') {
          tasksByChunk[current.chunkIndex] = response.tasks
          completedChunks++
          request.onProgress?.(Math.round((completedChunks / chunks.length) * 100))
          const next = sendNext(worker)
          if (next) {
            active.set(worker, next)
            return
          }
          active.delete(worker)
          if (completedChunks === chunks.length) {
            finish(() => resolve({ kind: 'processes', result: analyzeCompactionProcessTasks(tasksByChunk.flat()) }))
          }
          return
        }
        if (!response.ok) finish(() => reject(new Error(response.error)))
      }

      worker.onerror = (event) => {
        finish(() => reject(new Error(event.message || 'Failed to parse input.')))
      }

      const next = sendNext(worker)
      if (next) active.set(worker, next)
    }
  })
}

function splitLogChunks(content: string): string[] {
  const lines = content.split('\n').filter(line => line.trim())
  const chunkSize = Math.max(1, Math.ceil(lines.length / Math.max(1, navigator.hardwareConcurrency || 1)))
  const chunks: string[] = []
  for (let i = 0; i < lines.length; i += chunkSize) {
    chunks.push(lines.slice(i, i + chunkSize).join('\n'))
  }
  return chunks
}
