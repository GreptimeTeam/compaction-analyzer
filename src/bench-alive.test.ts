import { describe, expect, it } from 'vitest'
import packageJson from '../package.json'
import source from '../scripts/bench-alive.mjs?raw'

describe('alive file list benchmark script', () => {
  it('measures the same parse and analysis stages as the upload flow', () => {
    expect(packageJson.scripts).toHaveProperty('bench:alive')
    expect(source).toContain("import { analyze, parseAliveFileList } from '../src/parser.ts'")
    expect(source).toContain("import { benchmarkVisualizationData } from '../src/visualization.ts'")
    expect(source).toContain('const parsed = measure(\'parseAliveFileList\'')
    expect(source).toContain('const loaded = measure(\'handleFilesLoaded\'')
    expect(source).toContain('const filtered = measure(\'applyFilters/analyze\'')
    expect(source).toContain('const visualized = measure(\'postAnalyze/visualizationData\'')
    expect(source).toContain('new Map()')
    expect(source).toContain('analysisResult = analyze(files)')
    expect(source).toContain('benchmarkVisualizationData(filtered.files)')
    expect(source).toContain('visualized.overlapCount')
    expect(source).toContain('printTiming(\'total\'')
  })
})
