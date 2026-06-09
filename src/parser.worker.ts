import { analyzeCompactionProcesses, parseAliveFileList, parseCompactionProcessTasksFromLog, parseLogCsv, type CompactionProcessAnalysis, type CompactionProcessTask, type InputMode, type ParseResult } from './parser'

type WorkerInputMode = InputMode | 'compaction-process-chunk'

type ParseWorkerRequest = {
  id: number
  mode: WorkerInputMode
  content: string
}

type ParseWorkerResponse =
  | { id: number; ok: true; kind: 'files'; result: ParseResult }
  | { id: number; ok: true; kind: 'processes'; result: CompactionProcessAnalysis }
  | { id: number; ok: true; kind: 'process-tasks'; tasks: CompactionProcessTask[] }
  | { id: number; ok: true; kind: 'progress'; progress: number }
  | { id: number; ok: false; error: string }

function postProgress(id: number, progress: number): void {
  self.postMessage({ id, ok: true, kind: 'progress', progress } satisfies ParseWorkerResponse)
}

function parseInput(request: ParseWorkerRequest): ParseWorkerResponse {
  switch (request.mode) {
    case 'alive-file-list':
      console.log(`[Worker] Parsing alive-file-list for request ${request.id}`)
      const startTime = performance.now()
      const v = parseAliveFileList(request.content)
      const elapsedTime = performance.now() - startTime
      console.log(`[Worker] Finished parsing alive-file-list for request ${request.id}, parsed ${v.aliveFiles.length} files, elapsed time: ${elapsedTime.toFixed(2)} ms`)
      return { id: request.id, ok: true, kind: 'files', result: v }
    case 'compaction-log':
      return { id: request.id, ok: true, kind: 'files', result: parseLogCsv(request.content) }
    case 'compaction-process':
      return { id: request.id, ok: true, kind: 'processes', result: analyzeCompactionProcesses(request.content) }
    case 'compaction-process-chunk':
      return { id: request.id, ok: true, kind: 'process-tasks', tasks: parseCompactionProcessTasksFromLog(request.content) }
  }
}

self.onmessage = (event: MessageEvent<ParseWorkerRequest>) => {
  const request = event.data
  try {
    postProgress(request.id, 5)
    const response = parseInput(request)
    postProgress(request.id, 100)
    self.postMessage(response)
    console.log(`[Worker] Response for request ${request.id} posted successfully`)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to parse input.'
    self.postMessage({ id: request.id, ok: false, error: message })
  }
}
