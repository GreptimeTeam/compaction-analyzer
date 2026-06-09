import { readFile } from 'node:fs/promises'
import { statSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { analyze, parseAliveFileList } from '../src/parser.ts'
import { benchmarkVisualizationData } from '../src/visualization.ts'

const inputPath = process.argv[2]

if (!inputPath) {
  console.error('Usage: npm run bench:alive -- <alive-file-list.csv>')
  process.exit(1)
}

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
  console.log(`${label.padEnd(22)} ${ms.toFixed(1).padStart(10)} ms`)
}

function handleFilesLoaded(result) {
  const map = new Map()
  for (const file of result.aliveFiles) {
    map.set(file.fileId, file)
  }
  return map
}

function applyFilters(allFiles) {
  const files = []
  for (const [, file] of allFiles) {
    files.push(file)
  }
  const analysisResult = analyze(files)
  return { files, analysisResult }
}

const totalStart = performance.now()
const inputSize = statSync(inputPath).size
const content = await measureAsync('readFile', () => readFile(inputPath, 'utf8'))
const parsed = measure('parseAliveFileList', () => parseAliveFileList(content))
const loaded = measure('handleFilesLoaded', () => handleFilesLoaded(parsed))
const filtered = measure('applyFilters/analyze', () => applyFilters(loaded))
const visualized = measure('postAnalyze/visualizationData', () => benchmarkVisualizationData(filtered.files))
const totalMs = performance.now() - totalStart

console.log(`Input: ${inputPath}`)
console.log(`Size: ${formatBytes(inputSize)}`)
console.log('')
for (const timing of timings) {
  printTiming(timing.label, timing.ms)
}
printTiming('total', totalMs)
console.log('')
console.log(`aliveFiles: ${parsed.aliveFiles.length}`)
console.log(`filteredFiles: ${filtered.files.length}`)
console.log(`totalSize: ${formatBytes(filtered.analysisResult.totalSizeBytes)}`)
console.log(`overlappingFiles: ${filtered.analysisResult.overlappingFiles}`)
console.log(`maxOverlapDepth: ${filtered.analysisResult.maxOverlapDepth}`)
console.log(`avgOverlapDepth: ${filtered.analysisResult.avgOverlapDepth.toFixed(2)}`)
console.log(`visualizedFiles: ${visualized.placedCount}`)
console.log(`visualizationTracks: ${visualized.numTracks}`)
console.log(`visualizationOverlaps: ${visualized.overlapCount}`)
