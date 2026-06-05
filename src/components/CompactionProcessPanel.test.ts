import { describe, expect, it } from 'vitest'
import source from './CompactionProcessPanel.vue?raw'

describe('CompactionProcessPanel table', () => {
  it('orders file count and size columns by input then output', () => {
    const inputCount = source.indexOf("setSort('input-files')")
    const inputSize = source.indexOf("setSort('input-size')")
    const outputCount = source.indexOf("setSort('output-files')")
    const outputSize = source.indexOf("setSort('output-size')")

    expect(inputCount).toBeGreaterThan(-1)
    expect(inputSize).toBeGreaterThan(inputCount)
    expect(outputCount).toBeGreaterThan(inputSize)
    expect(outputSize).toBeGreaterThan(outputCount)
  })
})
