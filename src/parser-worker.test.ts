import { describe, expect, it } from 'vitest'
import clientSource from './parser-worker-client.ts?raw'
import workerSource from './parser.worker.ts?raw'

describe('parser worker integration', () => {
  it('creates a module worker and terminates it after each parse request', () => {
    expect(clientSource).toContain('export function parseInputInWorker')
    expect(clientSource).toContain("new Worker(new URL('./parser.worker.ts', import.meta.url), { type: 'module' })")
    expect(clientSource).toContain('function parseCompactionProcessInChunks')
    expect(clientSource).toContain('const chunks = splitLogChunks(request.content)')
    expect(clientSource).toContain('const workerCount = Math.min(chunks.length, Math.max(1, navigator.hardwareConcurrency || 1))')
    expect(clientSource).toContain("mode: 'compaction-process-chunk'")
    expect(clientSource).toContain('request.onProgress?.(Math.round((completedChunks / chunks.length) * 100))')
    expect(clientSource).toContain('analyzeCompactionProcessTasks(tasksByChunk.flat())')
    expect(clientSource).toContain('onProgress?: (progress: number) => void')
    expect(clientSource).toContain('request.onProgress?.(response.progress)')
    expect(clientSource).toContain('worker.postMessage({ id, mode: request.mode, content: request.content })')
    expect(clientSource).toContain('worker.terminate()')
  })

  it('serializes parser results and errors from the worker thread', () => {
    expect(workerSource).toContain('analyzeCompactionProcesses')
    expect(workerSource).toContain('parseAliveFileList')
    expect(workerSource).toContain('parseCompactionProcessTasksFromLog')
    expect(workerSource).toContain('parseLogCsv')
    expect(workerSource).toContain("case 'alive-file-list'")
    expect(workerSource).toContain('const startTime = performance.now()')
    expect(workerSource).toContain('const elapsedTime = performance.now() - startTime')
    expect(workerSource).toContain('elapsed time: ${elapsedTime.toFixed(2)} ms')
    expect(workerSource).toContain("case 'compaction-log'")
    expect(workerSource).toContain("case 'compaction-process'")
    expect(workerSource).toContain("case 'compaction-process-chunk'")
    expect(workerSource).toContain("kind: 'files'")
    expect(workerSource).toContain("kind: 'processes'")
    expect(workerSource).toContain("kind: 'process-tasks'")
    expect(workerSource).toContain("kind: 'progress'")
    expect(workerSource).toContain('postProgress(request.id, 5)')
    expect(workerSource).toContain('postProgress(request.id, 100)')
    expect(workerSource).toContain('self.postMessage({ id: request.id, ok: false, error')
  })
})
