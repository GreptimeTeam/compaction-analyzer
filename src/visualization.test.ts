import { describe, expect, it } from 'vitest'
import { formatDuration } from './visualization'
import source from './visualization.ts?raw'

describe('formatDuration', () => {
  it('rounds millisecond durations to two decimal places', () => {
    expect(formatDuration(0.000345)).toBe('0ms')
    expect(formatDuration(12.3456)).toBe('12.35ms')
  })
})

describe('visualization benchmark hooks', () => {
  it('exports pure visualization data preparation for post-analyze benchmarking', () => {
    expect(source).toContain('export function benchmarkVisualizationData')
    expect(source).toContain('const layout = buildLayout(files)')
    expect(source).toContain('const overlapSet = buildOverlapSet(files)')
    expect(source).toContain('overlapCount: overlapSet.size')
  })

  it('logs elapsed time for visualization data preparation stages', () => {
    expect(source).toContain('function logVisualizationStage')
    expect(source).toContain("logVisualizationStage('buildLayout'")
    expect(source).toContain("logVisualizationStage('buildOverlapSet'")
    expect(source).toContain("logVisualizationStage('total'")
  })

  it('uses a sweep-line overlap set instead of pairwise visualization comparisons', () => {
    expect(source).toContain('const overlapEvents = [...events.values()]')
    expect(source).toContain('overlapEvents.sort')
    expect(source).not.toContain('for (let j = i + 1; j < withRange.length; j++)')
  })
})
