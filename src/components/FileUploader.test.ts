import { describe, expect, it } from 'vitest'
import source from './FileUploader.vue?raw'

describe('FileUploader format examples', () => {
  it('documents accepted plain and JSON log formats', () => {
    expect(source).toContain('Accepted file formats')
    expect(source).toContain('Plain log line')
    expect(source).toContain('JSON log line')
    expect(source).toContain('fields.message')
    expect(source).toContain('Compacted SST files')
  })

  it('parses inputs through the worker client instead of blocking the UI thread', () => {
    expect(source).toContain("import { parseInputInWorker } from '../parser-worker-client'")
    expect(source).not.toContain('parseAliveFileList')
    expect(source).not.toContain('parseLogCsv')
    expect(source).not.toContain('analyzeCompactionProcesses')
    expect(source).toContain('async function processFile()')
    expect(source).toContain('const result = await parseInputInWorker({')
    expect(source).toContain('mode: inputMode.value,')
    expect(source).toContain("if (result.kind === 'files')")
    expect(source).toContain("if (result.kind === 'processes')")
  })

  it('turns the analyze button into a progress bar while parsing', () => {
    expect(source).toContain('const parseProgress = ref(0)')
    expect(source).toContain('parseProgress.value = 0')
    expect(source).toContain('parseProgress.value = progress')
    expect(source).toContain('parseProgress.value = 100')
    expect(source).toContain('onProgress: (progress) => { parseProgress.value = progress }')
    expect(source).toContain(':role="loading ? \'progressbar\' : undefined"')
    expect(source).toContain(':aria-valuenow="loading ? parseProgress : undefined"')
    expect(source).toContain('<span v-if="loading" class="analyze-progress-fill" :style="{ width: `${parseProgress}%` }"></span>')
    expect(source).toContain('<span class="analyze-btn-label">{{ loading ? `Parsing ${parseProgress}%` : \'Analyze\' }}</span>')
    expect(source).toContain('.analyze-progress-fill {')
  })
})
