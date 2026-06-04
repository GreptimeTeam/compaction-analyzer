import { describe, expect, it } from 'vitest'
import { formatDuration } from './visualization'

describe('formatDuration', () => {
  it('rounds millisecond durations to two decimal places', () => {
    expect(formatDuration(0.000345)).toBe('0ms')
    expect(formatDuration(12.3456)).toBe('12.35ms')
  })
})
