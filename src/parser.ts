/**
 * CSV and log file parsers.
 * Ports the Rust parser.rs and list_files.rs logic to TypeScript.
 */
import type { AliveFile } from './types'

export type InputMode = 'alive-file-list' | 'compaction-log' | 'compaction-process'

export interface ParseResult {
  aliveFiles: AliveFile[]
}

export interface AnalysisResult {
  totalFiles: number
  totalSizeBytes: number
  overlappingFiles: number
  maxOverlapDepth: number
  avgOverlapDepth: number
  sizeCv: number
  sourceBreakdown: Record<string, number>
  sizeDistribution: Array<{ label: string; count: number }>
}

export interface CompactionProcessTask {
  timestamp: number
  regionId: number
  tableId: number
  inputFileCount: number
  outputFileCount: number
  fanOut: number
  inputBytes: number
  outputBytes: number
  inputFiles: CompactionProcessFile[]
  outputFiles: CompactionProcessFile[]
  pickMillis: number | null
  mergeMillis: number | null
}

export interface CompactionProcessFile {
  fileId: string
  level: number
  sizeBytes: number
  timeRange: [number, number]
}

export interface CompactionProcessAnalysis {
  totalTasks: number
  totalInputFiles: number
  totalOutputFiles: number
  totalInputBytes: number
  totalOutputBytes: number
  averageFanOut: number
  maxFanOut: number
  averagePickMillis: number | null
  averageMergeMillis: number | null
  tasks: CompactionProcessTask[]
}

export type CompactionProcessSortKey = 'time' | 'merge' | 'input-files' | 'output-files' | 'input-size' | 'output-size'
export type CompactionProcessFileSortKey = 'file-id' | 'level' | 'size' | 'time-range'
export type MergeTimeSeverity = 'red' | 'orange' | 'yellow' | 'green' | 'none'
export type SortDirection = 'asc' | 'desc'

// ── Format detection ──

export function isMysqlFormat(input: string): boolean {
  return input.trimStart().startsWith('+--')
}

export function parseAliveFileList(input: string): ParseResult {
  return isMysqlFormat(input) ? parseAliveFileListMysql(input) : parseAliveFileListCsv(input)
}

// ── Alive file list CSV parser ──

export function parseAliveFileListCsv(csv: string): ParseResult {
  const lines = csv.split('\n').filter(l => l.trim())
  if (lines.length < 2) throw new Error('CSV must have a header and at least one data row')

  const header = splitCsvLine(lines[0])
  const colIndex: Record<string, number> = {}
  header.forEach((name, i) => { colIndex[name.trim()] = i })

  const requiredCols = ['file_id', 'region_id', 'table_id', 'file_size', 'min_ts', 'max_ts', 'visible']
  for (const col of requiredCols) {
    if (!(col in colIndex)) throw new Error(`Missing required CSV column: ${col}`)
  }

  const aliveFiles: AliveFile[] = []
  for (let i = 1; i < lines.length; i++) {
    const fields = splitCsvLine(lines[i])
    if (fields.length < header.length) continue

    const visible = getField(fields, colIndex, 'visible', i + 1).trim()
    if (visible !== 'true') continue

    const fileId = getField(fields, colIndex, 'file_id', i + 1).trim()
    const regionId = parseNumField(fields, colIndex, 'region_id', i + 1)
    const tableId = parseNumField(fields, colIndex, 'table_id', i + 1)
    const sizeBytes = parseNumField(fields, colIndex, 'file_size', i + 1)
    const minTs = parseUnixNanos(getField(fields, colIndex, 'min_ts', i + 1), i + 1)
    const maxTs = parseUnixNanos(getField(fields, colIndex, 'max_ts', i + 1), i + 1)

    aliveFiles.push({
      fileId,
      regionId,
      tableId,
      createdAt: minTs,
      source: 'list-file',
      sizeBytes,
      timeRange: [minTs, maxTs],
    })
  }

  console.log(`[parseAliveFileListCsv] Before sort`)
  aliveFiles.sort((a, b) => a.fileId.localeCompare(b.fileId))
  console.log(`[parseAliveFileListCsv] Parsed ${aliveFiles.length} alive files from CSV`)
  return { aliveFiles }
}

// ── MySQL table output parser ──

function parseAliveFileListMysql(text: string): ParseResult {
  const lines = text.split('\n')
  // Find header row (first | line that is not a +-- border)
  let headerIdx = -1
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    if (trimmed.startsWith('|') && !trimmed.startsWith('+')) {
      headerIdx = i
      break
    }
  }
  if (headerIdx < 0) throw new Error('Could not find MySQL table header row')

  const headers = parseMysqlRow(lines[headerIdx])
  const colIndex: Record<string, number> = {}
  headers.forEach((name, i) => { colIndex[name.trim().toLowerCase()] = i })

  const requiredCols = ['file_id', 'region_id', 'table_id', 'file_size', 'min_ts', 'max_ts', 'visible']
  for (const col of requiredCols) {
    if (!(col in colIndex)) throw new Error(`Missing required MySQL column: ${col}`)
  }

  const aliveFiles: AliveFile[] = []
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    if (!trimmed.startsWith('|') || trimmed.startsWith('+')) continue

    const fields = parseMysqlRow(lines[i])
    if (fields.length < headers.length) continue

    const visible = getMysqlField(fields, colIndex, 'visible').trim()
    if (visible !== '1') continue

    const fileId = getMysqlField(fields, colIndex, 'file_id').trim()
    // Skip metadata rows (no UUID)
    if (!/^[0-9a-f]{8}-/.test(fileId)) continue

    const regionId = parseMysqlNum(getMysqlField(fields, colIndex, 'region_id'))
    const tableId = parseMysqlNum(getMysqlField(fields, colIndex, 'table_id'))
    const sizeBytes = parseMysqlNum(getMysqlField(fields, colIndex, 'file_size'))
    const minTs = parseDatetime(getMysqlField(fields, colIndex, 'min_ts'))
    const maxTs = parseDatetime(getMysqlField(fields, colIndex, 'max_ts'))

    if (minTs === null || maxTs === null) continue

    aliveFiles.push({
      fileId,
      regionId,
      tableId,
      createdAt: minTs,
      source: 'list-file',
      sizeBytes,
      timeRange: [minTs, maxTs],
    })
  }

  aliveFiles.sort((a, b) => a.fileId.localeCompare(b.fileId))
  return { aliveFiles }
}

function parseMysqlRow(line: string): string[] {
  // Split by | and strip, ignoring the leading and trailing empty segments
  const parts = line.split('|')
  // Remove first and last empty segments from leading/trailing |
  return parts.slice(1, -1).map(s => s.trim())
}

function getMysqlField(fields: string[], colIndex: Record<string, number>, name: string): string {
  const idx = colIndex[name]
  if (idx === undefined || idx >= fields.length) return ''
  return fields[idx]
}

function parseMysqlNum(value: string): number {
  const v = parseFloat(value.trim())
  return isNaN(v) ? 0 : v
}

function parseDatetime(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed || trimmed === 'NULL') return null
  // Format: "2026-05-04 00:00:00.006000" or "1970-01-01 00:00:00"
  const normalized = trimmed.replace(' ', 'T') + 'Z'
  const ms = new Date(normalized).getTime()
  return isNaN(ms) ? null : ms
}

// ── Compaction log parser ──

export function parseLogCsv(log: string): ParseResult {
  const lines = normalizeLogLines(log)
  const aliveMap = new Map<string, AliveFile>()

  for (const line of lines) {
    if (line.includes('Compacted SST files')) {
      parseCompactionLine(line, aliveMap)
    } else if (line.includes('Applying RegionEdit')) {
      parseRegionEditLine(line, aliveMap)
    } else if (line.includes('Successfully flush memtables')) {
      parseFlushLine(line, aliveMap)
    }
  }

  const aliveFiles = [...aliveMap.values()]
  aliveFiles.sort((a, b) => a.fileId.localeCompare(b.fileId))
  return { aliveFiles }
}

export function analyzeCompactionProcesses(log: string): CompactionProcessAnalysis {
  const tasks = parseCompactionProcessTasksFromLog(log)

  return analyzeCompactionProcessTasks(tasks)
}

export function parseCompactionProcessTasksFromLog(log: string): CompactionProcessTask[] {
  return normalizeLogLines(log)
    .map(parseCompactionProcessLine)
    .filter((task): task is CompactionProcessTask => task !== null)
}

export function analyzeCompactionProcessTasks(tasks: CompactionProcessTask[]): CompactionProcessAnalysis {
  const totalInputFiles = tasks.reduce((sum, task) => sum + task.inputFileCount, 0)
  const totalOutputFiles = tasks.reduce((sum, task) => sum + task.outputFileCount, 0)
  const totalInputBytes = tasks.reduce((sum, task) => sum + task.inputBytes, 0)
  const totalOutputBytes = tasks.reduce((sum, task) => sum + task.outputBytes, 0)

  return {
    totalTasks: tasks.length,
    totalInputFiles,
    totalOutputFiles,
    totalInputBytes,
    totalOutputBytes,
    averageFanOut: average(tasks.map(task => task.fanOut)),
    maxFanOut: tasks.reduce((max, task) => Math.max(max, task.fanOut), 0),
    averagePickMillis: averageNullable(tasks.map(task => task.pickMillis)),
    averageMergeMillis: averageNullable(tasks.map(task => task.mergeMillis)),
    tasks,
  }
}

export function sortCompactionProcessTasks(
  tasks: CompactionProcessTask[],
  key: CompactionProcessSortKey,
  direction: SortDirection,
): CompactionProcessTask[] {
  const sign = direction === 'asc' ? 1 : -1
  return [...tasks].sort((a, b) => {
    const delta = sortValue(a, key) - sortValue(b, key)
    if (delta !== 0) return delta * sign
    return (a.timestamp - b.timestamp) * sign
  })
}

export function sortCompactionProcessFiles(
  files: CompactionProcessFile[],
  key: CompactionProcessFileSortKey,
  direction: SortDirection,
): CompactionProcessFile[] {
  const sign = direction === 'asc' ? 1 : -1
  return [...files].sort((a, b) => {
    if (key === 'file-id') return a.fileId.localeCompare(b.fileId) * sign
    const delta = fileSortValue(a, key) - fileSortValue(b, key)
    if (delta !== 0) return delta * sign
    return a.fileId.localeCompare(b.fileId) * sign
  })
}

export function getMergeTimeSeverity(task: CompactionProcessTask, tasks: CompactionProcessTask[]): MergeTimeSeverity {
  if (task.mergeMillis === null) return 'none'
  const withMerge = tasks.filter(t => t.mergeMillis !== null)
  const sorted = sortCompactionProcessTasks(withMerge, 'merge', 'desc')
  const rank = sorted.findIndex(t => t === task)
  if (rank < 0) return 'none'
  return mergeTimeSeverityForRank(rank, sorted.length)
}

export function getMergeTimeSeverityMap(tasks: CompactionProcessTask[]): Map<CompactionProcessTask, MergeTimeSeverity> {
  const severities = new Map<CompactionProcessTask, MergeTimeSeverity>()
  const withMerge = tasks.filter(t => t.mergeMillis !== null)
  const sorted = sortCompactionProcessTasks(withMerge, 'merge', 'desc')

  for (const task of tasks) {
    severities.set(task, 'none')
  }
  sorted.forEach((task, rank) => {
    severities.set(task, mergeTimeSeverityForRank(rank, sorted.length))
  })
  return severities
}

function mergeTimeSeverityForRank(rank: number, total: number): MergeTimeSeverity {
  const percentile = (rank + 1) / total
  if (percentile <= 0.1) return 'red'
  if (percentile <= 0.3) return 'orange'
  if (percentile <= 0.5) return 'yellow'
  return 'green'
}

function sortValue(task: CompactionProcessTask, key: CompactionProcessSortKey): number {
  switch (key) {
    case 'time': return task.timestamp
    case 'merge': return task.mergeMillis ?? -Infinity
    case 'input-files': return task.inputFileCount
    case 'output-files': return task.outputFileCount
    case 'input-size': return task.inputBytes
    case 'output-size': return task.outputBytes
  }
}

function fileSortValue(file: CompactionProcessFile, key: CompactionProcessFileSortKey): number {
  switch (key) {
    case 'level': return file.level
    case 'size': return file.sizeBytes
    case 'time-range': return file.timeRange[0]
    case 'file-id': return 0
  }
}

function parseCompactionProcessLine(line: string): CompactionProcessTask | null {
  if (!line.includes('Compacted SST files')) return null

  const timestamp = extractTimestamp(line)
  if (!timestamp) return null

  const regionMatch = line.match(/region_id:\s*(\d+)\((\d+),\s*\d+\)/)
  if (!regionMatch) return null

  const inputStart = line.indexOf('input: [')
  const outputMarker = '], output: ['
  const outputIdx = line.indexOf(outputMarker)
  const windowMarker = '], window:'
  const windowIdx = line.indexOf(windowMarker)
  if (inputStart < 0 || outputIdx < 0 || windowIdx < 0) return null

  const inputFiles = parseFileStatsSection(line.slice(inputStart + 8, outputIdx))
  const outputFiles = parseFileStatsSection(line.slice(outputIdx + outputMarker.length, windowIdx))
  if (!inputFiles || !outputFiles) return null

  const outputFileCount = outputFiles.length
  const fanOut = outputFileCount > 0 ? inputFiles.length / outputFileCount : 0

  return {
    timestamp,
    regionId: parseInt(regionMatch[1]),
    tableId: parseInt(regionMatch[2]),
    inputFileCount: inputFiles.length,
    outputFileCount,
    fanOut,
    inputBytes: inputFiles.reduce((sum, file) => sum + file.sizeBytes, 0),
    outputBytes: outputFiles.reduce((sum, file) => sum + file.sizeBytes, 0),
    inputFiles,
    outputFiles,
    pickMillis: extractDurationMillis(line, ['pick_time', 'pick_elapsed', 'pick duration']),
    mergeMillis: extractDurationMillis(line, ['merge_time', 'merge_elapsed', 'merge duration', 'compaction_time']),
  }
}

type FileStats = CompactionProcessFile

function normalizeLogLines(log: string): string[] {
  return log
    .split('\n')
    .map(normalizeLogLine)
    .filter(l => l.trim())
}

function normalizeLogLine(line: string): string {
  const trimmed = line.trim()
  if (!trimmed.startsWith('{')) return line

  try {
    const entry = JSON.parse(trimmed)
    const timestamp = typeof entry.timestamp === 'string' ? entry.timestamp : null
    const message = typeof entry.fields?.message === 'string'
      ? entry.fields.message
      : typeof entry.message === 'string'
        ? entry.message
        : null
    if (!timestamp || !message) return line

    const level = typeof entry.level === 'string' ? `${entry.level} ` : ''
    const target = typeof entry.target === 'string' ? `${entry.target}: ` : ''
    return `${timestamp} ${level}${target}${message}`
  } catch {
    return line
  }
}

function parseCompactionLine(line: string, alive: Map<string, AliveFile>): void {
  const timestamp = extractTimestamp(line)
  if (!timestamp) return

  const regionMatch = line.match(/region_id:\s*(\d+)\((\d+),\s*\d+\)/)
  if (!regionMatch) return
  const regionId = parseInt(regionMatch[1])
  const tableId = parseInt(regionMatch[2])

  const inputStart = line.indexOf('input: [')
  const outputMarker = '], output: ['
  const outputIdx = line.indexOf(outputMarker)
  const windowMarker = '], window:'
  const windowIdx = line.lastIndexOf(windowMarker)

  if (inputStart < 0 || outputIdx < 0 || windowIdx < 0) return

  const inputFiles = parseFileStatsSection(line.slice(inputStart + 8, outputIdx))
  const outputFiles = parseFileStatsSection(line.slice(outputIdx + outputMarker.length, windowIdx))

  if (!inputFiles || !outputFiles) return

  // Remove input files from alive set
  for (const f of inputFiles) {
    alive.delete(f.fileId)
  }

  // Add output files
  for (const f of outputFiles) {
    alive.set(f.fileId, {
      fileId: f.fileId,
      regionId,
      tableId,
      createdAt: timestamp,
      source: 'compaction',
      sizeBytes: f.sizeBytes,
      timeRange: f.timeRange,
    })
  }
}

function parseRegionEditLine(line: string, alive: Map<string, AliveFile>): void {
  const timestamp = extractTimestamp(line)
  if (!timestamp) return

  const regionMatch = line.match(/to region\s*(\d+)\((\d+),\s*\d+\)/)
  if (!regionMatch) return
  const regionId = parseInt(regionMatch[1])
  const tableId = parseInt(regionMatch[2])

  const addStart = line.indexOf('files_to_add: [')
  const removeMarker = '], files_to_remove:'
  const addEnd = line.indexOf(removeMarker)
  if (addStart < 0 || addEnd < 0) return

  const files = parseFileStatsSection(line.slice(addStart + 15, addEnd))
  if (!files) return

  for (const f of files) {
    const existing = alive.get(f.fileId)
    if (existing) {
      existing.sizeBytes = f.sizeBytes
      existing.timeRange = f.timeRange
    } else {
      alive.set(f.fileId, {
        fileId: f.fileId,
        regionId,
        tableId,
        createdAt: timestamp,
        source: 'flush',
        sizeBytes: f.sizeBytes,
        timeRange: f.timeRange,
      })
    }
  }
}

function parseFlushLine(line: string, alive: Map<string, AliveFile>): void {
  const timestamp = extractTimestamp(line)
  if (!timestamp) return

  const regionMatch = line.match(/region:\s*(\d+)\((\d+),\s*\d+\)/)
  if (!regionMatch) return
  const regionId = parseInt(regionMatch[1])
  const tableId = parseInt(regionMatch[2])

  const filesStart = line.indexOf('files: [')
  if (filesStart < 0) return
  const bracketEnd = line.indexOf(']', filesStart)
  if (bracketEnd < 0) return

  const fileSection = line.slice(filesStart + 8, bracketEnd)
  const fileRegex = /FileId\(([0-9a-f-]+)\)/g
  let match
  while ((match = fileRegex.exec(fileSection)) !== null) {
    const fileId = match[1]
    alive.set(fileId, {
      fileId,
      regionId,
      tableId,
      createdAt: timestamp,
      source: 'flush',
      sizeBytes: null,
      timeRange: null,
    })
  }
}

function parseFileStatsSection(section: string): FileStats[] | null {
  const fileRegex = /file_id:\s*([0-9a-f-]+)\s*,\s*time_range:\s*\(([^,]+),\s*([^\)]+)\)\s*,\s*level:\s*(\d+),\s*file_size:\s*([0-9.]+)([KMG]iB)/g
  const files: FileStats[] = []
  let match

  while ((match = fileRegex.exec(section)) !== null) {
    const fileId = match[1]
    const start = parseLogTime(match[2].trim())
    const end = parseLogTime(match[3].trim())
    const level = parseInt(match[4], 10)
    const sizeBytes = parseSize(match[5], match[6])

    if (start === null || end === null || sizeBytes === null) continue

    files.push({ fileId, level, sizeBytes, timeRange: [start, end] })
  }

  return files.length > 0 ? files : null
}

function extractTimestamp(line: string): number | null {
  const ts = line.split(/\s+/)[0]
  return parseLogTime(ts)
}

function parseLogTime(value: string): number | null {
  // Handle formats like "2026-01-09 13:29:42.016+0000" or "2026-01-09T13:29:42.016+00:00"
  let normalized = value.replace(' ', 'T')
  // Ensure timezone has colon: +0000 -> +00:00
  normalized = normalized.replace(/([+-]\d{2})(\d{2})$/, '$1:$2')
  // If no timezone, add Z
  if (!/[+-]\d{2}:\d{2}$/.test(normalized) && !normalized.endsWith('Z')) {
    normalized += 'Z'
  }
  const ms = new Date(normalized).getTime()
  return isNaN(ms) ? null : ms
}

function extractDurationMillis(line: string, names: string[]): number | null {
  for (const name of names) {
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const match = line.match(new RegExp(`${escapedName}\\s*[:=]\\s*([0-9.]+)\\s*(ns|us|µs|ms|s|sec|secs|seconds)?`, 'i'))
    if (!match) continue
    const value = parseFloat(match[1])
    if (isNaN(value)) continue
    const unit = (match[2] || 'ms').toLowerCase()
    if (unit === 'ns') return value / 1_000_000
    if (unit === 'us' || unit === 'µs') return value / 1_000
    if (unit === 's' || unit === 'sec' || unit === 'secs' || unit === 'seconds') return value * 1000
    return value
  }
  return null
}

function average(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function averageNullable(values: Array<number | null>): number | null {
  const present = values.filter((value): value is number => value !== null)
  return present.length > 0 ? average(present) : null
}

function parseSize(value: string, unit: string): number | null {
  const multipliers: Record<string, number> = {
    'KiB': 1024,
    'MiB': 1024 * 1024,
    'GiB': 1024 * 1024 * 1024,
  }
  const multiplier = multipliers[unit]
  if (!multiplier) return null
  const parsed = parseFloat(value)
  return isNaN(parsed) ? null : Math.round(parsed * multiplier)
}

// ── CSV helpers ──

function splitCsvLine(line: string): string[] {
  return line.split(',').map(f => f.trim())
}

function getField(fields: string[], colIndex: Record<string, number>, name: string, lineNum: number): string {
  const idx = colIndex[name]
  if (idx === undefined) throw new Error(`Missing CSV column '${name}'`)
  if (idx >= fields.length) throw new Error(`Missing '${name}' value on CSV line ${lineNum}`)
  return fields[idx]
}

function parseNumField(fields: string[], colIndex: Record<string, number>, name: string, lineNum: number): number {
  const raw = getField(fields, colIndex, name, lineNum).trim()
  const value = parseFloat(raw)
  if (isNaN(value)) throw new Error(`Invalid '${name}' value on CSV line ${lineNum}: ${raw}`)
  return value
}

function parseUnixNanos(value: string, lineNum: number): number {
  const trimmed = value.trim()
  // Handle nanosecond timestamps - may be too large for JS number
  // Parse as string to avoid precision loss
  const nanos = parseInt(trimmed, 10)
  if (isNaN(nanos)) throw new Error(`Invalid timestamp on CSV line ${lineNum}: ${value}`)
  // Convert nanoseconds to milliseconds
  return Math.floor(nanos / 1_000_000)
}

// ── Analysis ──

export function analyze(files: AliveFile[]): AnalysisResult {
  const analyzeStart = performance.now()
  let stageStart = analyzeStart
  console.log(`[analyze] Starting analysis of ${files.length} files`)
  const withRange = files.filter(f => f.timeRange && f.sizeBytes !== null)
  stageStart = logAnalyzeStage('filter ranged files', stageStart)

  const overlappingFiles = countOverlappingFiles(withRange)
  stageStart = logAnalyzeStage('overlap detection', stageStart)

  // Overlap depth via sweep-line
  const events: Array<[number, number]> = []
  for (const f of withRange) {
    const [s, e] = f.timeRange!
    if (s < e) {
      events.push([s, 1])
      events.push([e, -1])
    }
  }
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1])

  let depth = 0
  let maxDepth = 0
  let prevTime: number | null = null
  let coveredMs = 0
  let depthMs = 0

  for (const [time, delta] of events) {
    if (prevTime !== null && depth > 0) {
      const span = time - prevTime
      if (span > 0) {
        coveredMs += span
        depthMs += span * depth
      }
    }
    depth += delta
    maxDepth = Math.max(maxDepth, depth)
    prevTime = time
  }

  const avgDepth = coveredMs > 0 ? depthMs / coveredMs : 0
  stageStart = logAnalyzeStage('overlap depth', stageStart)

  // Size CV
  const sizes = withRange.map(f => f.sizeBytes!).filter(s => s != null)
  let sizeCv = 0
  if (sizes.length >= 2) {
    const mean = sizes.reduce((a, b) => a + b, 0) / sizes.length
    if (mean > 0) {
      const variance = sizes.reduce((acc, s) => acc + (s - mean) ** 2, 0) / sizes.length
      sizeCv = Math.sqrt(variance) / mean
    }
  }
  stageStart = logAnalyzeStage('size coefficient variation', stageStart)

  // Source breakdown
  const sourceBreakdown: Record<string, number> = {}
  for (const f of files) {
    sourceBreakdown[f.source] = (sourceBreakdown[f.source] || 0) + 1
  }
  stageStart = logAnalyzeStage('source breakdown', stageStart)

  // Size distribution (log-scale buckets)
  const sizeDistribution = buildSizeDistribution(withRange.map(f => f.sizeBytes!))
  stageStart = logAnalyzeStage('size distribution', stageStart)

  const totalFiles = files.length
  const totalSizeBytes = files.reduce((sum, f) => sum + (f.sizeBytes ?? 0), 0)
  logAnalyzeStage('total size', stageStart)
  logAnalyzeStage('total', analyzeStart)

  return {
    totalFiles,
    totalSizeBytes,
    overlappingFiles,
    maxOverlapDepth: maxDepth,
    avgOverlapDepth: avgDepth,
    sizeCv,
    sourceBreakdown,
    sizeDistribution,
  }
}

function logAnalyzeStage(label: string, start: number): number {
  const now = performance.now()
  console.log(`[analyze] ${label}: ${(now - start).toFixed(1)} ms`)
  return now
}

function countOverlappingFiles(files: AliveFile[]): number {
  type Interval = { fileId: string; start: number; end: number }
  type OverlapEvent = { time: number; starts: Interval[]; ends: string[]; points: string[] }

  const events = new Map<number, OverlapEvent>()
  const active = new Set<string>()
  const unmarkedActive = new Set<string>()
  const overlappingIds = new Set<string>()

  function eventAt(time: number): OverlapEvent {
    let event = events.get(time)
    if (!event) {
      event = { time, starts: [], ends: [], points: [] }
      events.set(time, event)
    }
    return event
  }

  function markOverlapping(fileId: string): void {
    overlappingIds.add(fileId)
    unmarkedActive.delete(fileId)
  }

  function markUnmarkedActive(): void {
    for (const fileId of unmarkedActive) overlappingIds.add(fileId)
    unmarkedActive.clear()
  }

  for (const file of files) {
    const [start, end] = file.timeRange!
    if (start === end) {
      eventAt(start).points.push(file.fileId)
    } else {
      const interval = { fileId: file.fileId, start, end }
      eventAt(start).starts.push(interval)
      eventAt(end).ends.push(file.fileId)
    }
  }

  const overlapEvents = [...events.values()]
  overlapEvents.sort((a, b) => a.time - b.time)

  for (const event of overlapEvents) {
    if (event.points.length > 0) {
      if (active.size + event.starts.length > 0 || event.points.length > 1) {
        for (const fileId of event.points) markOverlapping(fileId)
      }
      if (active.size + event.starts.length > 0) {
        markUnmarkedActive()
        for (const interval of event.starts) markOverlapping(interval.fileId)
      }
    }

    for (const fileId of event.ends) {
      active.delete(fileId)
      unmarkedActive.delete(fileId)
    }

    if (event.starts.length > 0) {
      if (active.size > 0 || event.starts.length > 1) {
        markUnmarkedActive()
        for (const interval of event.starts) markOverlapping(interval.fileId)
      }
      for (const interval of event.starts) {
        active.add(interval.fileId)
        if (!overlappingIds.has(interval.fileId)) unmarkedActive.add(interval.fileId)
      }
    }
  }

  return overlappingIds.size
}

function buildSizeDistribution(sizes: number[]): Array<{ label: string; count: number }> {
  if (sizes.length === 0) return []

  const buckets = [
    { min: 0, max: 1024, label: '<1 KiB' },
    { min: 1024, max: 10240, label: '1-10 KiB' },
    { min: 10240, max: 102400, label: '10-100 KiB' },
    { min: 102400, max: 1048576, label: '100 KiB-1 MiB' },
    { min: 1048576, max: 10485760, label: '1-10 MiB' },
    { min: 10485760, max: 104857600, label: '10-100 MiB' },
    { min: 104857600, max: 1073741824, label: '100 MiB-1 GiB' },
    { min: 1073741824, max: Infinity, label: '>1 GiB' },
  ]

  return buckets.map(b => ({
    label: b.label,
    count: sizes.filter(s => s >= b.min && s < b.max).length,
  })).filter(b => b.count > 0)
}
