import { describe, expect, it } from 'vitest'
import packageJson from '../package.json'
import source from '../scripts/bench-process.mjs?raw'

describe('compaction process benchmark script', () => {
  it('measures parsing, analysis, and table-stage costs for process logs', () => {
    expect(packageJson.scripts).toHaveProperty('bench:process')
    expect(source).toContain("import { analyzeCompactionProcessTasks, getMergeTimeSeverityMap, parseCompactionProcessTasksFromLog, sortCompactionProcessTasks } from '../src/parser.ts'")
    expect(source).toContain("const inputPath = process.argv[2] || '/home/lei/compaction.log'")
    expect(source).toContain("const tasks = measure('parseCompactionProcessTasksFromLog'")
    expect(source).toContain("const analysis = measure('analyzeCompactionProcessTasks'")
    expect(source).toContain("const sorted = measure('sortCompactionProcessTasks/time-desc'")
    expect(source).toContain("const severities = measure('mergeTimeSeverity/allRows'")
    expect(source).toContain('const severityByTask = getMergeTimeSeverityMap(analysis.tasks)')
    expect(source).toContain('severityByTask.get(task)')
    expect(source).toContain("printTiming('total'")
  })
})
