import { describe, expect, it } from 'vitest'
import { analyzeCompactionProcesses } from './parser'

describe('analyzeCompactionProcesses', () => {
  it('summarizes compaction tasks from raw log text', () => {
    const log = `
2026-01-09T13:38:59.242654Z INFO mito2::compaction::task: Compacted SST files, region_id: 4398046511104(1024, 0), input: [FileMeta { file_id: 86aa8733-624c-4d24-9a0e-a7b82c360f56 , time_range: (2026-01-09 13:29:42.016+0000, 2026-01-09 13:33:42.361+0000) , level: 0, file_size: 177.5MiB }, FileMeta { file_id: d3518a5a-ff01-46f6-b02a-a811649f4610 , time_range: (2026-01-09 12:57:43.308+0000, 2026-01-09 13:29:42.505+0000) , level: 1, file_size: 521.5MiB }], output: [FileMeta { file_id: 24c730aa-b14b-43e8-8a34-1a0f6c8ed53e , time_range: (2026-01-09 12:57:43.308+0000, 2026-01-09 13:33:42.361+0000) , level: 2, file_size: 666.0MiB }], window: None, pick_time: 12ms, merge_time: 345ms
2026-01-09T14:00:00.000000Z INFO mito2::compaction::task: Compacted SST files, region_id: 8796093022208(2048, 0), input: [FileMeta { file_id: 11111111-1111-4111-8111-111111111111 , time_range: (2026-01-09 13:00:00+0000, 2026-01-09 13:10:00+0000) , level: 0, file_size: 10.0MiB }, FileMeta { file_id: 22222222-2222-4222-8222-222222222222 , time_range: (2026-01-09 13:10:00+0000, 2026-01-09 13:20:00+0000) , level: 0, file_size: 20.0MiB }, FileMeta { file_id: 33333333-3333-4333-8333-333333333333 , time_range: (2026-01-09 13:20:00+0000, 2026-01-09 13:30:00+0000) , level: 0, file_size: 30.0MiB }], output: [FileMeta { file_id: 44444444-4444-4444-8444-444444444444 , time_range: (2026-01-09 13:00:00+0000, 2026-01-09 13:30:00+0000) , level: 1, file_size: 55.0MiB }], window: None, pick_elapsed: 8ms, merge_elapsed: 1.5s
`

    const result = analyzeCompactionProcesses(log)

    expect(result.totalTasks).toBe(2)
    expect(result.totalInputFiles).toBe(5)
    expect(result.totalOutputFiles).toBe(2)
    expect(result.maxFanOut).toBe(3)
    expect(result.averageFanOut).toBe(2.5)
    expect(result.averagePickMillis).toBe(10)
    expect(result.averageMergeMillis).toBe(922.5)
    expect(result.tasks[0]).toMatchObject({
      regionId: 4398046511104,
      tableId: 1024,
      inputFileCount: 2,
      outputFileCount: 1,
      fanOut: 2,
      pickMillis: 12,
      mergeMillis: 345,
    })
  })
})
