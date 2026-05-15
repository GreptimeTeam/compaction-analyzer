/**
 * Canvas-based visualization of alive SST files.
 * Y-axis = time (scrollable), X-axis = stacked file size.
 */

import type { AliveFile, LayoutResult, PlacedFile } from './types'

const MARGIN_LEFT = 160
const MARGIN_RIGHT = 40
const MARGIN_TOP = 50
const MARGIN_BOTTOM = 40
const X_GAP_PX = 6
const MIN_WIDTH_PX = 6
const MIN_HEIGHT_PX = 2
const ROW_HEIGHT = 24
const LABEL_FONT_SIZE = 10
const FILE_ID_COLOR = '#e8f0fe'
const HOVER_BORDER_COLOR = '#f59e0b'
const ZOOM_FACTOR = 1.15
const MIN_SCALE = 0.05
const MAX_SCALE = 200

// Colors matching the Rust SVG scheme
const COLOR_NORMAL = '#4a90e2'
const COLOR_NORMAL_STROKE = '#357abd'
const COLOR_OVERLAP = '#e2844a'
const COLOR_OVERLAP_STROKE = '#bd6e35'
const COLOR_SOURCE_FLUSH = '#4a90e2'
const COLOR_SOURCE_COMPACTION = '#9b59b6'
const COLOR_SOURCE_LISTFILE = '#27ae60'

function getColor(file: AliveFile, isOverlap: boolean): string {
  if (isOverlap) return COLOR_OVERLAP
  switch (file.source) {
    case 'flush': return COLOR_SOURCE_FLUSH
    case 'compaction': return COLOR_SOURCE_COMPACTION
    case 'list-file': return COLOR_SOURCE_LISTFILE
    default: return COLOR_NORMAL
  }
}

function getStrokeColor(file: AliveFile, isOverlap: boolean): string {
  if (isOverlap) return COLOR_OVERLAP_STROKE
  return COLOR_NORMAL_STROKE
}

interface OverlapSet {
  has(id: string): boolean
}

function buildOverlapSet(files: AliveFile[]): OverlapSet {
  const ids = new Set<string>()
  const withRange = files.filter(f => f.timeRange)
  for (let i = 0; i < withRange.length; i++) {
    const a = withRange[i]
    const [aStart, aEnd] = a.timeRange!
    const aIsPoint = aStart === aEnd
    for (let j = i + 1; j < withRange.length; j++) {
      const b = withRange[j]
      const [bStart, bEnd] = b.timeRange!
      const bIsPoint = bStart === bEnd
      const overlaps = (aIsPoint || bIsPoint)
        ? aStart <= bEnd && bStart <= aEnd
        : aStart < bEnd && bStart < aEnd
      if (overlaps) {
        ids.add(a.fileId)
        ids.add(b.fileId)
      }
    }
  }
  return ids
}

function buildLayout(files: AliveFile[]): LayoutResult {
  const sorted = files
    .filter(f => f.timeRange && f.sizeBytes)
    .sort((a, b) => {
      const cmp = a.timeRange![0] - b.timeRange![0]
      return cmp !== 0 ? cmp : a.fileId.localeCompare(b.fileId)
    })

  if (sorted.length === 0) {
    return { placed: [], minTime: 0, maxTime: 0, totalWidth: 0, maxSimultaneousBytes: 0 }
  }

  let minTime = Infinity
  let maxTime = -Infinity
  for (const f of sorted) {
    const [s, e] = f.timeRange!
    if (s < minTime) minTime = s
    if (e > maxTime) maxTime = e
  }

  // Sweep-line for max simultaneous bytes
  const events: Array<[number, number]> = []
  for (const f of sorted) {
    const [s, e] = f.timeRange!
    events.push([s, f.sizeBytes!])
    events.push([e, -f.sizeBytes!])
  }
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1])

  let currentBytes = 0
  let maxSimultaneousBytes = 0
  for (const [, delta] of events) {
    currentBytes += delta
    if (currentBytes > maxSimultaneousBytes) maxSimultaneousBytes = currentBytes
  }

  // Initial x-scale
  const drawableWidth = 980
  let xScale = maxSimultaneousBytes > 0
    ? (drawableWidth * 0.8) / maxSimultaneousBytes
    : (drawableWidth * 0.8) / Math.max(1, sorted.reduce((s, f) => s + f.sizeBytes!, 0))
  xScale = Math.max(xScale, 0.000001)

  // Greedy bin-packing layout
  interface Placed {
    start: number
    end: number
    xPx: number
    widthPx: number
  }
  const placedRaw: Placed[] = []
  const layoutEntries: Array<[number, number, AliveFile]> = []

  for (const file of sorted) {
    const [fStart, fEnd] = file.timeRange!
    const fIsPoint = fStart === fEnd
    const fWidthPx = Math.max(file.sizeBytes! * xScale, MIN_WIDTH_PX)

    const overlapping = placedRaw.filter(p => {
      const pIsPoint = p.start === p.end
      return (fIsPoint || pIsPoint)
        ? fStart <= p.end && p.start <= fEnd
        : fStart < p.end && p.start < fEnd
    })
    overlapping.sort((a, b) => a.xPx - b.xPx)

    let currentXPx = 0
    for (const p of overlapping) {
      if (currentXPx + fWidthPx + X_GAP_PX <= p.xPx) break
      currentXPx = Math.max(currentXPx, p.xPx + p.widthPx + X_GAP_PX)
    }

    layoutEntries.push([currentXPx, fWidthPx, file])
    placedRaw.push({ start: fStart, end: fEnd, xPx: currentXPx, widthPx: fWidthPx })
  }

  const maxXPx = placedRaw.reduce((m, p) => Math.max(m, p.xPx + p.widthPx), 0)
  const finalXScale = maxXPx > 0 ? drawableWidth / maxXPx : 1

  const placed: PlacedFile[] = layoutEntries.map(([xOffsetPx, widthPx, file]) => ({
    file,
    xPx: xOffsetPx * finalXScale,
    widthPx: widthPx * finalXScale,
  }))

  return {
    placed,
    minTime,
    maxTime,
    totalWidth: maxXPx * finalXScale,
    maxSimultaneousBytes,
  }
}

export function createVisualization(canvas: HTMLCanvasElement, files: AliveFile[]) {
  const ctx = canvas.getContext('2d')!
  const overlapSet = buildOverlapSet(files)
  const layout = buildLayout(files)

  const dpr = window.devicePixelRatio || 1
  const timeSpan = Math.max(1, layout.maxTime - layout.minTime)

  // State
  let yScale = 200 / timeSpan // pixels per ms
  let scrollTop = 0 // in time-space (ms offset from minTime)
  let hoveredFile: AliveFile | null = null
  let hoveredRect: { x: number; y: number; w: number; h: number } | null = null
  let tooltipPos = { x: 0, y: 0 }
  let onHoverCallback: ((file: AliveFile | null, pos: { x: number; y: number }) => void) | null = null

  function getDrawableHeight() {
    return canvas.height / dpr - MARGIN_TOP - MARGIN_BOTTOM
  }

  function timeToY(timeMs: number): number {
    return MARGIN_TOP + (timeMs - layout.minTime - scrollTop) * yScale
  }

  function yToTime(y: number): number {
    return (y - MARGIN_TOP) / yScale + layout.minTime + scrollTop
  }

  function resize() {
    const rect = canvas.parentElement!.getBoundingClientRect()
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    canvas.style.width = `${rect.width}px`
    canvas.style.height = `${rect.height}px`
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  function render() {
    const w = canvas.width / dpr
    const h = canvas.height / dpr
    const drawableH = getDrawableHeight()

    ctx.clearRect(0, 0, w, h)

    // Background
    ctx.fillStyle = '#1a1a2e'
    ctx.fillRect(0, 0, w, h)

    // Clip drawable area
    ctx.save()
    ctx.beginPath()
    ctx.rect(MARGIN_LEFT, MARGIN_TOP, w - MARGIN_LEFT - MARGIN_RIGHT, drawableH)
    ctx.clip()

    // Draw files
    for (const p of layout.placed) {
      const [start, end] = p.file.timeRange!
      const y = timeToY(start)
      const endY = timeToY(end)
      let height = endY - y
      if (height < MIN_HEIGHT_PX) height = MIN_HEIGHT_PX

      // Skip if outside viewport
      if (y + height < MARGIN_TOP || y > MARGIN_TOP + drawableH) continue

      const isOverlap = overlapSet.has(p.file.fileId)
      const x = MARGIN_LEFT + p.xPx
      const width = p.widthPx

      ctx.fillStyle = getColor(p.file, isOverlap)
      ctx.fillRect(x, y, width, height)

      if (p.file === hoveredFile) {
        ctx.strokeStyle = HOVER_BORDER_COLOR
        ctx.lineWidth = 2
        ctx.strokeRect(x, y, width, height)
      } else {
        ctx.strokeStyle = getStrokeColor(p.file, isOverlap)
        ctx.lineWidth = 0.5
        ctx.strokeRect(x, y, width, height)
      }

      // Label
      if (height > 18 && width > 50) {
        const label = p.file.fileId.length > 12
          ? p.file.fileId.slice(0, 8) + '...'
          : p.file.fileId
        ctx.fillStyle = FILE_ID_COLOR
        ctx.font = `${LABEL_FONT_SIZE}px Inter, system-ui, sans-serif`
        ctx.textAlign = 'center'
        ctx.fillText(label, x + width / 2, y + height / 2 + 4, width - 8)
      }
    }

    ctx.restore()

    // Y-axis labels
    ctx.fillStyle = '#8888aa'
    ctx.font = '11px Inter, system-ui, sans-serif'
    ctx.textAlign = 'right'

    const visibleStart = layout.minTime + scrollTop
    const visibleEnd = visibleStart + drawableH / yScale
    const visibleSpan = visibleEnd - visibleStart

    // Generate nice time ticks
    const tickIntervals = [
      1000, 5000, 10000, 30000, 60000, 300000, 600000, 1800000,
      3600000, 7200000, 14400000, 28800000, 86400000
    ]
    let tickInterval = tickIntervals[tickIntervals.length - 1]
    for (const ti of tickIntervals) {
      if (drawableH / (visibleSpan / ti) > 40) {
        tickInterval = ti
        break
      }
    }

    const firstTick = Math.ceil(visibleStart / tickInterval) * tickInterval
    for (let t = firstTick; t <= visibleEnd; t += tickInterval) {
      const y = timeToY(t)
      if (y < MARGIN_TOP || y > MARGIN_TOP + drawableH) continue

      // Grid line
      ctx.strokeStyle = '#2a2a4a'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(MARGIN_LEFT, y)
      ctx.lineTo(w - MARGIN_RIGHT, y)
      ctx.stroke()

      // Label
      ctx.fillStyle = '#6666aa'
      ctx.font = '10px "JetBrains Mono", monospace'
      ctx.textAlign = 'right'
      ctx.fillText(formatTimestamp(t), MARGIN_LEFT - 8, y + 4)
    }

    // X-axis label
    ctx.fillStyle = '#8888aa'
    ctx.font = 'bold 12px Inter, system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('Size (Stacked)', MARGIN_LEFT + (w - MARGIN_LEFT - MARGIN_RIGHT) / 2, 30)

    // Y-axis label
    ctx.save()
    ctx.translate(16, MARGIN_TOP + drawableH / 2)
    ctx.rotate(-Math.PI / 2)
    ctx.fillStyle = '#8888aa'
    ctx.font = 'bold 12px Inter, system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('Time (UTC)', 0, 0)
    ctx.restore()

    // Axis line
    ctx.strokeStyle = '#3a3a5a'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(MARGIN_LEFT, MARGIN_TOP)
    ctx.lineTo(MARGIN_LEFT, MARGIN_TOP + drawableH)
    ctx.stroke()
  }

  function handleWheel(e: WheelEvent) {
    e.preventDefault()
    const rect = canvas.getBoundingClientRect()
    const mouseY = e.clientY - rect.top
    const timeAtMouse = yToTime(mouseY)

    if (e.ctrlKey || e.metaKey) {
      // Zoom
      const factor = e.deltaY < 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR
      const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, yScale * factor))
      yScale = newScale
    } else {
      // Scroll
      const drawableH = getDrawableHeight()
      const scrollDelta = e.deltaY / yScale
      const maxScroll = Math.max(0, timeSpan - drawableH / yScale)
      scrollTop = Math.max(0, Math.min(maxScroll, scrollTop + scrollDelta))
    }

    render()
    updateHover(tooltipPos.x, tooltipPos.y)
  }

  function findFileAtPoint(clientX: number, clientY: number): { file: AliveFile; rect: { x: number; y: number; w: number; h: number } } | null {
    const rect = canvas.getBoundingClientRect()
    const x = clientX - rect.left
    const y = clientY - rect.top
    const drawableH = getDrawableHeight()

    if (x < MARGIN_LEFT || x > rect.width - MARGIN_RIGHT) return null
    if (y < MARGIN_TOP || y > MARGIN_TOP + drawableH) return null

    for (const p of layout.placed) {
      const [start, end] = p.file.timeRange!
      const py = timeToY(start)
      const pe = timeToY(end)
      const ph = Math.max(pe - py, MIN_HEIGHT_PX)
      const px = MARGIN_LEFT + p.xPx
      const pw = p.widthPx

      if (x >= px && x <= px + pw && y >= py && y <= py + ph) {
        return { file: p.file, rect: { x: px, y: py, w: pw, h: ph } }
      }
    }
    return null
  }

  function updateHover(clientX: number, clientY: number) {
    const found = findFileAtPoint(clientX, clientY)
    hoveredFile = found?.file ?? null
    hoveredRect = found?.rect ?? null
    tooltipPos = { x: clientX, y: clientY }
    render()

    if (onHoverCallback) {
      onHoverCallback(hoveredFile, tooltipPos)
    }
  }

  function handleMouseMove(e: MouseEvent) {
    updateHover(e.clientX, e.clientY)
  }

  function handleMouseLeave() {
    hoveredFile = null
    hoveredRect = null
    render()
    if (onHoverCallback) onHoverCallback(null, { x: 0, y: 0 })
  }

  // Setup
  resize()
  render()

  canvas.addEventListener('wheel', handleWheel, { passive: false })
  canvas.addEventListener('mousemove', handleMouseMove)
  canvas.addEventListener('mouseleave', handleMouseLeave)
  window.addEventListener('resize', () => { resize(); render() })

  return {
    layout,
    destroy() {
      canvas.removeEventListener('wheel', handleWheel)
      canvas.removeEventListener('mousemove', handleMouseMove)
      canvas.removeEventListener('mouseleave', handleMouseLeave)
    },
    onHover(cb: (file: AliveFile | null, pos: { x: number; y: number }) => void) {
      onHoverCallback = cb
    }
  }
}

function formatTimestamp(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number, len = 2) => String(n).padStart(len, '0')
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
}

export function formatBytes(bytes: number): string {
  const units = ['B', 'KiB', 'MiB', 'GiB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return unit === 0 ? `${bytes}B` : `${value.toFixed(2)}${units[unit]}`
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  if (ms < 3600000) return `${(ms / 60000).toFixed(1)}m`
  return `${(ms / 3600000).toFixed(1)}h`
}
