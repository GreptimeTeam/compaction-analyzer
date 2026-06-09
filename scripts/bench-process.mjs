import { readFile } from 'node:fs/promises'
import { statSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { analyzeCompactionProcessTasks, getMergeTimeSeverityMap, parseCompactionProcessTasksFromLog, sortCompactionProcessTasks } from '../src/parser.ts'

const inputPath = process.argv[2] || '/home/lei/compaction.log'
const timings = []

function measure(label, fn) {
  const start = performance.now()
  const result = fn()
  const ms = performance.now() - start
  timings.push({ label, ms })
  return result
}

async function measureAsync(label, fn) {
  const start = performance.now()
  const result = await fn()
  const ms = performance.now() - start
  timings.push({ label, ms })
  return result
}

function formatBytes(bytes) {
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`
}

function printTiming(label, ms) {
  console.log(`${label.padEnd(38)} ${ms.toFixed(1).padStart(10)} ms`)
}

function classifyMergeTimeRows(analysis) {
  const counts = { red: 0, orange: 0, yellow: 0, green: 0, none: 0 }
  const severityByTask = getMergeTimeSeverityMap(analysis.tasks)
  for (const task of analysis.tasks) {
    counts[severityByTask.get(task) ?? 'none']++
  }
  return counts
}

const totalStart = performance.now()
const inputSize = statSync(inputPath).size
const content = await measureAsync('readFile', () => readFile(inputPath, 'utf8'))
const tasks = measure('parseCompactionProcessTasksFromLog', () => parseCompactionProcessTasksFromLog(content))
const analysis = measure('analyzeCompactionProcessTasks', () => analyzeCompactionProcessTasks(tasks))
const sorted = measure('sortCompactionProcessTasks/time-desc', () => sortCompactionProcessTasks(analysis.tasks, 'time', 'desc'))
const severities = measure('mergeTimeSeverity/allRows', () => classifyMergeTimeRows(analysis))
const totalMs = performance.now() - totalStart

console.log(`Input: ${inputPath}`)
console.log(`Size: ${formatBytes(inputSize)}`)
console.log('')
for (const timing of timings) {
  printTiming(timing.label, timing.ms)
}
printTiming('total', totalMs)
console.log('')
console.log(`tasks: ${analysis.totalTasks}`)
console.log(`sortedTasks: ${sorted.length}`)
console.log(`totalInputFiles: ${analysis.totalInputFiles}`)
console.log(`totalOutputFiles: ${analysis.totalOutputFiles}`)
console.log(`totalInputBytes: ${formatBytes(analysis.totalInputBytes)}`)
console.log(`totalOutputBytes: ${formatBytes(analysis.totalOutputBytes)}`)
console.log(`averageFanOut: ${analysis.averageFanOut.toFixed(2)}`)
console.log(`maxFanOut: ${analysis.maxFanOut.toFixed(2)}`)
console.log(`averagePickMillis: ${analysis.averagePickMillis === null ? 'N/A' : analysis.averagePickMillis.toFixed(1)}`)
console.log(`averageMergeMillis: ${analysis.averageMergeMillis === null ? 'N/A' : analysis.averageMergeMillis.toFixed(1)}`)
console.log(`mergeSeverity: ${JSON.stringify(severities)}`)
