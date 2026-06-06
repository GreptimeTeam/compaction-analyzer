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
})
