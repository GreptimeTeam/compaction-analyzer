import { describe, expect, it } from 'vitest'
import { analyzeCompactionProcessTasks, analyzeCompactionProcesses, getMergeTimeSeverity, parseCompactionProcessTasksFromLog, parseLogCsv, sortCompactionProcessFiles, sortCompactionProcessTasks } from './parser'
import source from './parser.ts?raw'

describe('analyzeCompactionProcesses', () => {
  it('exposes task parsing separately so chunks can be analyzed after parallel parsing', () => {
    const log = `
2026-01-09T13:38:59.242654Z INFO mito2::compaction::task: Compacted SST files, region_id: 4398046511104(1024, 0), input: [FileMeta { file_id: 86aa8733-624c-4d24-9a0e-a7b82c360f56 , time_range: (2026-01-09 13:29:42.016+0000, 2026-01-09 13:33:42.361+0000) , level: 0, file_size: 177.5MiB }], output: [FileMeta { file_id: 24c730aa-b14b-43e8-8a34-1a0f6c8ed53e , time_range: (2026-01-09 13:29:42.016+0000, 2026-01-09 13:33:42.361+0000) , level: 1, file_size: 177.5MiB }], window: None, merge_time: 345ms
`

    expect(analyzeCompactionProcessTasks(parseCompactionProcessTasksFromLog(log))).toEqual(analyzeCompactionProcesses(log))
  })

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
    expect(result.tasks[0].inputFiles).toEqual([
      expect.objectContaining({
        fileId: '86aa8733-624c-4d24-9a0e-a7b82c360f56',
        level: 0,
        sizeBytes: 186122240,
      }),
      expect.objectContaining({
        fileId: 'd3518a5a-ff01-46f6-b02a-a811649f4610',
        level: 1,
        sizeBytes: 546832384,
      }),
    ])
    expect(result.tasks[0].outputFiles).toEqual([
      expect.objectContaining({
        fileId: '24c730aa-b14b-43e8-8a34-1a0f6c8ed53e',
        level: 2,
        sizeBytes: 698351616,
      }),
    ])
    expect(result.tasks[0].inputFiles[0].timeRange).toEqual([
      new Date('2026-01-09T13:29:42.016Z').getTime(),
      new Date('2026-01-09T13:33:42.361Z').getTime(),
    ])
  })

  it('summarizes compaction tasks from GreptimeDB JSON log lines', () => {
    const message = 'Compacted SST files, region_id: 4866197946368(1133, 0), input: [FileMeta { region_id: 4866197946368(1133, 0), file_id: 30780311-45ed-4d9a-b394-edb71dbd7ad4 , time_range: (2026-06-04 16:12:12.670078755+0000, 2026-06-04 16:45:09.162246818+0000) , level: 0, file_size: 119.0KiB }, FileMeta { region_id: 4866197946368(1133, 0), file_id: e3855a46-448a-4cee-b547-16d553aac2b3 , time_range: (2026-06-04 16:45:14.162322209+0000, 2026-06-04 17:16:09.162523305+0000) , level: 0, file_size: 119.2KiB }], output: [FileMeta { region_id: 4866197946368(1133, 0), file_id: e06c9283-d968-4c8c-a9e7-6f2a1cc895f0 , time_range: (2026-06-04 16:12:12.670078755+0000, 2026-06-04 17:16:09.162523305+0000) , level: 1, file_size: 235.0KiB }], window: Some(43200), waiter_num: 0, merge_time: 4.028134509s'
    const log = JSON.stringify({
      timestamp: '2026-06-04T18:16:13.833807Z',
      level: 'INFO',
      fields: { message },
      target: 'mito2::compaction::task',
    })

    const result = analyzeCompactionProcesses(log)

    expect(result.totalTasks).toBe(1)
    expect(result.totalInputFiles).toBe(2)
    expect(result.totalOutputFiles).toBe(1)
    expect(result.totalInputBytes).toBe(243917)
    expect(result.totalOutputBytes).toBe(240640)
    expect(result.averageMergeMillis).toBeCloseTo(4028.134509)
    expect(result.tasks[0]).toMatchObject({
      timestamp: new Date('2026-06-04T18:16:13.833807Z').getTime(),
      regionId: 4866197946368,
      tableId: 1133,
      inputFileCount: 2,
      outputFileCount: 1,
      fanOut: 2,
      pickMillis: null,
    })
  })

  it('summarizes a region-filtered task list', () => {
    const result = analyzeCompactionProcessTasks([
      {
        timestamp: 1,
        regionId: 100,
        tableId: 10,
        inputFileCount: 2,
        outputFileCount: 1,
        fanOut: 2,
        inputBytes: 200,
        outputBytes: 180,
        inputFiles: [],
        outputFiles: [],
        pickMillis: 10,
        mergeMillis: 100,
      },
      {
        timestamp: 2,
        regionId: 100,
        tableId: 10,
        inputFileCount: 4,
        outputFileCount: 2,
        fanOut: 2,
        inputBytes: 400,
        outputBytes: 360,
        inputFiles: [],
        outputFiles: [],
        pickMillis: null,
        mergeMillis: 300,
      },
    ])

    expect(result.totalTasks).toBe(2)
    expect(result.totalInputFiles).toBe(6)
    expect(result.totalOutputFiles).toBe(3)
    expect(result.totalInputBytes).toBe(600)
    expect(result.totalOutputBytes).toBe(540)
    expect(result.averageFanOut).toBe(2)
    expect(result.maxFanOut).toBe(2)
    expect(result.averagePickMillis).toBe(10)
    expect(result.averageMergeMillis).toBe(200)
  })

  it('sorts process tasks by requested table columns', () => {
    const tasks = [
      makeTask({ timestamp: 30, inputFileCount: 2, outputFileCount: 2, inputBytes: 300, outputBytes: 100, mergeMillis: null }),
      makeTask({ timestamp: 10, inputFileCount: 4, outputFileCount: 1, inputBytes: 100, outputBytes: 300, mergeMillis: 300 }),
      makeTask({ timestamp: 20, inputFileCount: 1, outputFileCount: 3, inputBytes: 200, outputBytes: 200, mergeMillis: 100 }),
    ]

    expect(sortCompactionProcessTasks(tasks, 'time', 'asc').map(task => task.timestamp)).toEqual([10, 20, 30])
    expect(sortCompactionProcessTasks(tasks, 'merge', 'desc').map(task => task.mergeMillis)).toEqual([300, 100, null])
    expect(sortCompactionProcessTasks(tasks, 'input-files', 'desc').map(task => task.inputFileCount)).toEqual([4, 2, 1])
    expect(sortCompactionProcessTasks(tasks, 'output-files', 'asc').map(task => task.outputFileCount)).toEqual([1, 2, 3])
    expect(sortCompactionProcessTasks(tasks, 'input-size', 'asc').map(task => task.inputBytes)).toEqual([100, 200, 300])
    expect(sortCompactionProcessTasks(tasks, 'output-size', 'desc').map(task => task.outputBytes)).toEqual([300, 200, 100])
    expect(sortCompactionProcessTasks(tasks, 'time', 'asc')).not.toBe(tasks)
  })

  it('assigns merge time colors by percentile band', () => {
    const tasks = [1000, 900, 800, 700, 600, 500, 400, 300, 200, 100].map((mergeMillis, i) => makeTask({
      timestamp: i,
      mergeMillis,
    }))

    expect(getMergeTimeSeverity(tasks[0], tasks)).toBe('red')
    expect(getMergeTimeSeverity(tasks[1], tasks)).toBe('orange')
    expect(getMergeTimeSeverity(tasks[2], tasks)).toBe('orange')
    expect(getMergeTimeSeverity(tasks[3], tasks)).toBe('yellow')
    expect(getMergeTimeSeverity(tasks[4], tasks)).toBe('yellow')
    expect(getMergeTimeSeverity(tasks[5], tasks)).toBe('green')
    expect(getMergeTimeSeverity(makeTask({ mergeMillis: null }), tasks)).toBe('none')
  })

  it('sorts compaction detail files by requested columns', () => {
    const files = [
      { fileId: 'c-file', level: 2, sizeBytes: 300, timeRange: [30, 40] as [number, number] },
      { fileId: 'a-file', level: 3, sizeBytes: 100, timeRange: [10, 20] as [number, number] },
      { fileId: 'b-file', level: 1, sizeBytes: 200, timeRange: [20, 30] as [number, number] },
    ]

    expect(sortCompactionProcessFiles(files, 'file-id', 'asc').map(file => file.fileId)).toEqual(['a-file', 'b-file', 'c-file'])
    expect(sortCompactionProcessFiles(files, 'level', 'asc').map(file => file.level)).toEqual([1, 2, 3])
    expect(sortCompactionProcessFiles(files, 'size', 'desc').map(file => file.sizeBytes)).toEqual([300, 200, 100])
    expect(sortCompactionProcessFiles(files, 'time-range', 'desc').map(file => file.timeRange[0])).toEqual([30, 20, 10])
    expect(sortCompactionProcessFiles(files, 'file-id', 'asc')).not.toBe(files)
  })
})

describe('analyze overlap performance', () => {
  it('uses a sweep-line overlap detector instead of pairwise file comparisons', () => {
    expect(source).toContain('function countOverlappingFiles')
    expect(source).toContain('overlapEvents.sort')
    expect(source).not.toContain('for (let j = i + 1; j < withRange.length; j++)')
  })

  it('logs elapsed time for each analyze stage', () => {
    expect(source).toContain('function logAnalyzeStage')
    expect(source).toContain("logAnalyzeStage('filter ranged files'")
    expect(source).toContain("logAnalyzeStage('overlap detection'")
    expect(source).toContain("logAnalyzeStage('overlap depth'")
    expect(source).toContain("logAnalyzeStage('size coefficient variation'")
    expect(source).toContain("logAnalyzeStage('source breakdown'")
    expect(source).toContain("logAnalyzeStage('size distribution'")
    expect(source).toContain("logAnalyzeStage('total'")
  })
})

describe('parseLogCsv', () => {
  it('tracks alive files from GreptimeDB JSON log lines', () => {
    const flushedFile = '30780311-45ed-4d9a-b394-edb71dbd7ad4'
    const compactedFile = 'e06c9283-d968-4c8c-a9e7-6f2a1cc895f0'
    const flushMessage = `Successfully flush memtables, region: 4866197946368(1133, 0), reason: Periodically, files: [FileId(${flushedFile})], series count: 381, total_rows: 5493`
    const regionEditMessage = `Applying RegionEdit { files_to_add: [FileMeta { region_id: 4866197946368(1133, 0), file_id: ${flushedFile} , time_range: (2026-06-04 16:12:12.670078755+0000, 2026-06-04 16:45:09.162246818+0000) , level: 0, file_size: 119.0KiB }], files_to_remove: [], timestamp_ms: Some(1780591509920) } to region 4866197946368(1133, 0), is_staging: false`
    const compactionMessage = `Compacted SST files, region_id: 4866197946368(1133, 0), input: [FileMeta { region_id: 4866197946368(1133, 0), file_id: ${flushedFile} , time_range: (2026-06-04 16:12:12.670078755+0000, 2026-06-04 16:45:09.162246818+0000) , level: 0, file_size: 119.0KiB }], output: [FileMeta { region_id: 4866197946368(1133, 0), file_id: ${compactedFile} , time_range: (2026-06-04 16:12:12.670078755+0000, 2026-06-04 16:45:09.162246818+0000) , level: 1, file_size: 116.0KiB }], window: None, merge_time: 4s`
    const log = [
      JSON.stringify({ timestamp: '2026-06-04T16:45:09.920444Z', fields: { message: flushMessage }, target: 'mito2::flush' }),
      JSON.stringify({ timestamp: '2026-06-04T16:45:09.920487Z', fields: { message: regionEditMessage }, target: 'mito2::flush' }),
      JSON.stringify({ timestamp: '2026-06-04T18:16:13.833807Z', fields: { message: compactionMessage }, target: 'mito2::compaction::task' }),
    ].join('\n')

    const result = parseLogCsv(log)

    expect(result.aliveFiles).toHaveLength(1)
    expect(result.aliveFiles[0]).toMatchObject({
      fileId: compactedFile,
      regionId: 4866197946368,
      tableId: 1133,
      source: 'compaction',
      sizeBytes: 118784,
      timeRange: [
        new Date('2026-06-04T16:12:12.670Z').getTime(),
        new Date('2026-06-04T16:45:09.162Z').getTime(),
      ],
    })
  })
})

function makeTask(overrides: Partial<ReturnType<typeof analyzeCompactionProcessTasks>['tasks'][number]>) {
  return {
    timestamp: 0,
    regionId: 1,
    tableId: 1,
    inputFileCount: 1,
    outputFileCount: 1,
    fanOut: 1,
    inputBytes: 1,
    outputBytes: 1,
    inputFiles: [],
    outputFiles: [],
    pickMillis: null,
    mergeMillis: null,
    ...overrides,
  }
}
