/**
 * Canvas-based visualization of alive SST files.
 *
 * Layout: X-axis = time (horizontal), Y-axis = stacked tracks.
 * Each file is a horizontal bar spanning its time range.
 * Bar height is proportional to file size.
 * Files overlapping in time are arranged in vertical tracks.
 *
 * Interactions:
 *  - Scroll: pan time axis
 *  - Ctrl+scroll: zoom time axis
 *  - Left-drag: select time range to zoom into
 *  - Double-click: reset zoom
 *  - Hover: tooltip with file details
 */

import type { AliveFile } from './types'

const MARGIN_LEFT = 80
const MARGIN_RIGHT = 30
const MARGIN_TOP = 50
const MARGIN_BOTTOM = 50
const TRACK_GAP = 10
const BAR_X_GAP = 1
const BAR_RADIUS = 3
const BAR_MIN_WIDTH_PX = 2
const ZOOM_FACTOR = 1.15
const MIN_TIME_SPAN = 1000 // 1 second minimum zoom

// Colors
const COLOR_NORMAL = '#4a90e2'
const COLOR_NORMAL_DIM = 'rgba(74, 144, 226, 0.75)'
const COLOR_OVERLAP = '#e2844a'
const COLOR_OVERLAP_DIM = 'rgba(226, 132, 74, 0.75)'
const COLOR_SOURCE_FLUSH = '#4a90e2'
const COLOR_SOURCE_COMPACTION = '#9b59b6'
const COLOR_SOURCE_LISTFILE = '#27ae60'
const COLOR_ACCENT_STRIPE = 'rgba(255,255,255,0.25)'
const COLOR_HOVER_GLOW = 'rgba(245, 158, 11, 0.4)'
const COLOR_SELECTION = 'rgba(74, 144, 226, 0.15)'
const COLOR_SELECTION_BORDER = 'rgba(74, 144, 226, 0.6)'

interface PlacedItem {
  file: AliveFile
  track: number
  x: number
  width: number
  height: number
}

interface TrackLayout {
  height: number
  maxBytes: number
}

interface LayoutResult {
  placed: PlacedItem[]
  tracks: TrackLayout[]
  totalHeight: number
  minTime: number
  maxTime: number
  allFiles: AliveFile[]
}

function buildOverlapSet(files: AliveFile[]): Set<string> {
  const ids = new Set<string>()
  const withRange = files.filter(f => f.timeRange)
  for (let i = 0; i < withRange.length; i++) {
    const a = withRange[i]
    const [aS, aE] = a.timeRange!
    const aP = aS === aE
    for (let j = i + 1; j < withRange.length; j++) {
      const b = withRange[j]
      const [bS, bE] = b.timeRange!
      const bP = bS === bE
      const ov = (aP || bP) ? aS <= bE && bS <= aE : aS < bE && bS < aE
      if (ov) { ids.add(a.fileId); ids.add(b.fileId) }
    }
  }
  return ids
}

function buildLayout(files: AliveFile[]): LayoutResult {
  const sorted = files
    .filter(f => f.timeRange && f.sizeBytes != null && f.sizeBytes > 0)
    .sort((a, b) => {
      const d = a.timeRange![0] - b.timeRange![0]
      return d !== 0 ? d : a.fileId.localeCompare(b.fileId)
    })

  if (sorted.length === 0) {
    return { placed: [], tracks: [], totalHeight: 0, minTime: 0, maxTime: 0, allFiles: files }
  }

  // Greedy first-fit track assignment: only advance to next track on overlap
  interface TrackEnd { endTime: number; maxBytes: number }
  const trackEnds: TrackEnd[] = []
  const assignments: Array<{ file: AliveFile; track: number }> = []

  for (const file of sorted) {
    const [start, end] = file.timeRange!
    const isPoint = start === end
    const sz = file.sizeBytes!

    let assigned = -1
    for (let t = 0; t < trackEnds.length; t++) {
      const fits = isPoint
        ? start >= trackEnds[t].endTime
        : start >= trackEnds[t].endTime
      if (fits) { assigned = t; break }
    }

    if (assigned === -1) {
      assigned = trackEnds.length
      trackEnds.push({ endTime: 0, maxBytes: 0 })
    }

    trackEnds[assigned].endTime = isPoint ? end + 1 : end
    if (sz > trackEnds[assigned].maxBytes) trackEnds[assigned].maxBytes = sz
    assignments.push({ file, track: assigned })
  }

  // Track height: based on largest file in each track
  const TRACK_BASE = 20
  const BYTES_TO_HEIGHT = 0.003
  const MAX_TRACK_HEIGHT = 120
  const tracks: TrackLayout[] = trackEnds.map(t => ({
    height: Math.min(MAX_TRACK_HEIGHT, Math.max(TRACK_BASE, t.maxBytes * BYTES_TO_HEIGHT)),
    maxBytes: t.maxBytes,
  }))

  let yAccum = 0
  const trackYOffsets: number[] = []
  for (const t of tracks) {
    trackYOffsets.push(yAccum)
    yAccum += t.height + TRACK_GAP
  }

  // Place files — bar height proportional to file size within the track
  const placed: PlacedItem[] = assignments.map(({ file, track }) => {
    const [start, end] = file.timeRange!
    const trackH = tracks[track].height
    const maxB = tracks[track].maxBytes
    const barH = Math.max(4, (file.sizeBytes! / maxB) * (trackH - 4))
    return {
      file,
      track,
      x: start,
      width: Math.max(1, end - start),
      height: barH,
    }
  })

  const minTime = sorted[0].timeRange![0]
  const maxTime = sorted.reduce((m, f) => Math.max(m, f.timeRange![1]), 0)
  const totalHeight = yAccum - TRACK_GAP

  return { placed, tracks, totalHeight, minTime, maxTime, allFiles: files }
}

function adaptiveTickInterval(visibleSpan: number, drawableW: number): number {
  const intervals = [
    1000, 2000, 5000, 10000, 15000, 30000, 60000, 120000, 300000, 600000,
    1800000, 3600000, 7200000, 14400000, 28800000, 43200000, 86400000,
    172800000, 604800000, 2592000000, 7776000000, 15552000000, 31536000000,
  ]
  for (const iv of intervals) {
    if (drawableW / (visibleSpan / iv) >= 60) return iv
  }
  return intervals[intervals.length - 1]
}

function formatTimeLabel(ms: number, interval: number): string {
  const d = new Date(ms)
  const p = (n: number, l = 2) => String(n).padStart(l, '0')
  if (interval < 1000) return `${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}.${p(d.getUTCMilliseconds(), 3)}`
  if (interval < 60000) return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`
  if (interval < 86400000) return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`
  if (interval < 31536000000) return `${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`
}

function formatTimestamp(ms: number): string {
  const d = new Date(ms)
  const p = (n: number, l = 2) => String(n).padStart(l, '0')
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}Z`
}

export function formatBytes(bytes: number): string {
  const units = ['B', 'KiB', 'MiB', 'GiB']
  let v = bytes, u = 0
  while (v >= 1024 && u < units.length - 1) { v /= 1024; u++ }
  return u === 0 ? `${bytes}B` : `${v.toFixed(2)}${units[u]}`
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  if (ms < 3600000) return `${(ms / 60000).toFixed(1)}m`
  return `${(ms / 3600000).toFixed(1)}h`
}

export function createVisualization(canvas: HTMLCanvasElement, files: AliveFile[]) {
  const ctx = canvas.getContext('2d')!
  const dpr = window.devicePixelRatio || 1
  const layout = buildLayout(files)
  const overlapSet = buildOverlapSet(files)
  const fullTimeSpan = layout.maxTime - layout.minTime || 1

  // View state
  let viewStart = layout.minTime
  let viewEnd = layout.maxTime
  let scrollTop = 0

  // Interaction state
  let hoveredFile: AliveFile | null = null
  let hoverScreenX = 0
  let hoverScreenY = 0
  let selStart: number | null = null
  let selEnd: number | null = null
  let isDragging = false
  let onHoverCallback: ((file: AliveFile | null, pos: { x: number; y: number }) => void) | null = null
  let onZoomChange: ((start: number, end: number, reset: () => void, isZoomed: boolean) => void) | null = null

  function getDrawableW() { return canvas.width / dpr - MARGIN_LEFT - MARGIN_RIGHT }
  function getDrawableH() { return canvas.height / dpr - MARGIN_TOP - MARGIN_BOTTOM }
  function timeSpan() { return viewEnd - viewStart }

  // Total height of all tracks (for bottom-up layout)
  const allTracksHeight = layout.tracks.reduce((s, t) => s + t.height + TRACK_GAP, 0) - TRACK_GAP
  function layoutBottom() { return MARGIN_TOP + getDrawableH() }

  function timeToX(t: number) {
    return MARGIN_LEFT + ((t - viewStart) / timeSpan()) * getDrawableW()
  }
  function xToTime(x: number) {
    return viewStart + ((x - MARGIN_LEFT) / getDrawableW()) * timeSpan()
  }
  // Track 0 at bottom, higher tracks stack upward
  function trackY(track: number) {
    let y = allTracksHeight
    for (let i = 0; i <= track; i++) y -= layout.tracks[i].height + (i > 0 ? TRACK_GAP : 0)
    return y
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
    const dw = getDrawableW()
    const dh = getDrawableH()

    ctx.clearRect(0, 0, w, h)
    ctx.fillStyle = '#1a1a2e'
    ctx.fillRect(0, 0, w, h)

    // ── Track backgrounds ──
    for (let i = 0; i < layout.tracks.length; i++) {
      const ty = layoutBottom() - allTracksHeight + trackY(i) - scrollTop
      const th = layout.tracks[i].height
      if (ty + th < MARGIN_TOP || ty > MARGIN_TOP + dh) continue
      ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.015)' : 'rgba(0,0,0,0.05)'
      ctx.fillRect(MARGIN_LEFT, Math.max(MARGIN_TOP, ty), dw, Math.min(th, MARGIN_TOP + dh - Math.max(MARGIN_TOP, ty)))
    }

    // ── Bars ──
    ctx.save()
    ctx.beginPath()
    ctx.rect(MARGIN_LEFT, MARGIN_TOP, dw, dh)
    ctx.clip()

    for (const p of layout.placed) {
      const bx = timeToX(p.x)
      const bw = Math.max(BAR_MIN_WIDTH_PX, (p.width / timeSpan()) * dw)
      const by = layoutBottom() - allTracksHeight + trackY(p.track) + layout.tracks[p.track].height - p.height - scrollTop

      if (bx + bw < MARGIN_LEFT || bx > MARGIN_LEFT + dw) continue
      if (by + p.height < MARGIN_TOP || by > MARGIN_TOP + dh) continue

      const isOv = overlapSet.has(p.file.fileId)
      const isHov = p.file === hoveredFile
      const color = isOv ? (isHov ? COLOR_OVERLAP : COLOR_OVERLAP_DIM)
        : (isHov ? getBaseColor(p.file) : getDimColor(p.file))

      // Bar body
      ctx.fillStyle = color
      drawRoundedRect(ctx, bx, by, bw, p.height, BAR_RADIUS)
      ctx.fill()

      // Hover glow
      if (isHov) {
        ctx.save()
        ctx.shadowColor = COLOR_HOVER_GLOW
        ctx.shadowBlur = 12
        ctx.strokeStyle = 'rgba(245, 158, 11, 0.8)'
        ctx.lineWidth = 2
        drawRoundedRect(ctx, bx, by, bw, p.height, BAR_RADIUS)
        ctx.stroke()
        ctx.restore()
      }

      // Left accent stripe
      ctx.fillStyle = COLOR_ACCENT_STRIPE
      drawRoundedRect(ctx, bx, by, 3, p.height, BAR_RADIUS)
      ctx.fill()

      // Label
      if (p.height > 14 && bw > 80) {
        ctx.fillStyle = '#fff'
        ctx.font = `bold 10px Inter, system-ui, sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        const lbl = p.file.fileId.length > 12 ? p.file.fileId.slice(0, 8) + '...' : p.file.fileId
        ctx.fillText(lbl, bx + bw / 2, by + p.height / 2, bw - 12)
        ctx.fillStyle = 'rgba(255,255,255,0.6)'
        ctx.font = `9px "JetBrains Mono", monospace`
        ctx.fillText(formatBytes(p.file.sizeBytes!), bx + bw / 2, by + p.height / 2 + 12, bw - 12)
      }
    }

    ctx.restore()

    // ── X-axis ticks ──
    const span = timeSpan()
    const interval = adaptiveTickInterval(span, dw)
    const firstTick = Math.ceil(viewStart / interval) * interval

    ctx.save()
    ctx.beginPath()
    ctx.rect(MARGIN_LEFT, MARGIN_TOP, dw, h - MARGIN_TOP)
    ctx.clip()

    for (let t = firstTick; t <= viewEnd; t += interval) {
      const x = timeToX(t)
      if (x < MARGIN_LEFT || x > MARGIN_LEFT + dw) continue

      ctx.strokeStyle = '#2a2a4a'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(x, MARGIN_TOP)
      ctx.lineTo(x, MARGIN_TOP + dh)
      ctx.stroke()

      ctx.fillStyle = '#6666aa'
      ctx.font = '10px "JetBrains Mono", monospace'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.fillText(formatTimeLabel(t, interval), x, MARGIN_TOP + dh + 8)
    }
    ctx.restore()

    // ── Selection overlay ──
    if (selStart !== null && selEnd !== null) {
      const sx = timeToX(Math.min(selStart, selEnd))
      const ex = timeToX(Math.max(selStart, selEnd))
      ctx.fillStyle = COLOR_SELECTION
      ctx.fillRect(sx, MARGIN_TOP, ex - sx, dh)
      ctx.strokeStyle = COLOR_SELECTION_BORDER
      ctx.lineWidth = 1.5
      ctx.setLineDash([6, 3])
      ctx.strokeRect(sx, MARGIN_TOP, ex - sx, dh)
      ctx.setLineDash([])

      // Selection time labels
      ctx.fillStyle = '#8888cc'
      ctx.font = '10px "JetBrains Mono", monospace'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'bottom'
      ctx.fillText(formatTimestamp(Math.min(selStart, selEnd)), sx, MARGIN_TOP - 4)
      ctx.fillText(formatTimestamp(Math.max(selStart, selEnd)), ex, MARGIN_TOP - 4)
    }

    // ── Axis labels ──
    ctx.fillStyle = '#8888aa'
    ctx.font = 'bold 12px Inter, system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillText('Time (UTC)', MARGIN_LEFT + dw / 2, h - 20)

    ctx.save()
    ctx.translate(16, MARGIN_TOP + dh / 2)
    ctx.rotate(-Math.PI / 2)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillText('Track', 0, 0)
    ctx.restore()

    // ── Axes ──
    ctx.strokeStyle = '#3a3a5a'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(MARGIN_LEFT, MARGIN_TOP)
    ctx.lineTo(MARGIN_LEFT, MARGIN_TOP + dh)
    ctx.lineTo(MARGIN_LEFT + dw, MARGIN_TOP + dh)
    ctx.stroke()

    // ── Zoom indicator ──
    const isZoomed = Math.abs(viewStart - layout.minTime) > 100 || Math.abs(viewEnd - layout.maxTime) > 100
    if (isZoomed) {
      const barW = 80
      const barH = 6
      const barX = MARGIN_LEFT + dw - barW - 8
      const barY = MARGIN_TOP + 8
      ctx.fillStyle = '#2a2a4a'
      ctx.fillRect(barX, barY, barW, barH)
      const rangeStart = (viewStart - layout.minTime) / fullTimeSpan
      const rangeEnd = (viewEnd - layout.minTime) / fullTimeSpan
      ctx.fillStyle = '#4a90e2'
      ctx.fillRect(barX + rangeStart * barW, barY, (rangeEnd - rangeStart) * barW, barH)
      ctx.fillStyle = '#6666aa'
      ctx.font = '9px Inter, system-ui, sans-serif'
      ctx.textAlign = 'right'
      ctx.textBaseline = 'top'
      ctx.fillText('zoomed', barX - 4, barY)
    }
  }

  function getBaseColor(file: AliveFile): string {
    if (overlapSet.has(file.fileId)) return COLOR_OVERLAP
    switch (file.source) {
      case 'flush': return COLOR_SOURCE_FLUSH
      case 'compaction': return COLOR_SOURCE_COMPACTION
      case 'list-file': return COLOR_SOURCE_LISTFILE
      default: return COLOR_NORMAL
    }
  }

  function getDimColor(file: AliveFile): string {
    if (overlapSet.has(file.fileId)) return COLOR_OVERLAP_DIM
    switch (file.source) {
      case 'flush': return 'rgba(74, 144, 226, 0.75)'
      case 'compaction': return 'rgba(155, 89, 182, 0.75)'
      case 'list-file': return 'rgba(39, 174, 96, 0.75)'
      default: return COLOR_NORMAL_DIM
    }
  }

  function drawRoundedRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    r = Math.min(r, w / 2, h / 2)
    c.beginPath()
    c.moveTo(x + r, y)
    c.lineTo(x + w - r, y)
    c.quadraticCurveTo(x + w, y, x + w, y + r)
    c.lineTo(x + w, y + h - r)
    c.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
    c.lineTo(x + r, y + h)
    c.quadraticCurveTo(x, y + h, x, y + h - r)
    c.lineTo(x, y + r)
    c.quadraticCurveTo(x, y, x + r, y)
    c.closePath()
  }

  function hitTest(clientX: number, clientY: number): AliveFile | null {
    const rect = canvas.getBoundingClientRect()
    const mx = clientX - rect.left
    const my = clientY - rect.top
    const dw = getDrawableW()
    const dh = getDrawableH()
    if (mx < MARGIN_LEFT || mx > MARGIN_LEFT + dw || my < MARGIN_TOP || my > MARGIN_TOP + dh) return null

    for (const p of layout.placed) {
      const bx = timeToX(p.x)
      const bw = Math.max(BAR_MIN_WIDTH_PX, (p.width / timeSpan()) * dw)
      const by = layoutBottom() - allTracksHeight + trackY(p.track) + layout.tracks[p.track].height - p.height - scrollTop
      if (mx >= bx && mx <= bx + bw && my >= by && my <= by + p.height) return p.file
    }
    return null
  }

  function notifyZoom() {
    if (onZoomChange) {
      const zoomed = Math.abs(viewStart - layout.minTime) > 100 || Math.abs(viewEnd - layout.maxTime) > 100
      onZoomChange(viewStart, viewEnd, resetZoom, zoomed)
    }
  }

  // ── Event handlers ──

  function onWheel(e: WheelEvent) {
    e.preventDefault()
    const rect = canvas.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const timeAtCursor = xToTime(mx)

    if (e.ctrlKey || e.metaKey) {
      // Zoom time axis
      const factor = e.deltaY < 0 ? 1 / ZOOM_FACTOR : ZOOM_FACTOR
      const newSpan = timeSpan() * factor
      if (newSpan < MIN_TIME_SPAN || newSpan > fullTimeSpan * 3) return
      const ratio = (mx - MARGIN_LEFT) / getDrawableW()
      viewStart = timeAtCursor - ratio * newSpan
      viewEnd = viewStart + newSpan
      clampView()
    } else {
      // Pan time axis
      const dt = (e.deltaY / getDrawableW()) * timeSpan()
      viewStart += dt
      viewEnd += dt
      clampView()
    }

    render()
    notifyZoom()
  }

  function clampView() {
    const span = timeSpan()
    if (viewStart < layout.minTime - span * 0.05) {
      viewStart = layout.minTime - span * 0.05
      viewEnd = viewStart + span
    }
    if (viewEnd > layout.maxTime + span * 0.05) {
      viewEnd = layout.maxTime + span * 0.05
      viewStart = viewEnd - span
    }
  }

  function onMouseDown(e: MouseEvent) {
    if (e.button !== 0) return
    const rect = canvas.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    if (mx < MARGIN_LEFT || mx > MARGIN_LEFT + getDrawableW()) return
    if (my < MARGIN_TOP || my > MARGIN_TOP + getDrawableH()) return

    selStart = xToTime(mx)
    selEnd = selStart
    isDragging = true
    canvas.style.cursor = 'crosshair'
  }

  function onMouseMove(e: MouseEvent) {
    hoverScreenX = e.clientX
    hoverScreenY = e.clientY

    if (isDragging && selStart !== null) {
      const rect = canvas.getBoundingClientRect()
      const mx = e.clientX - rect.left
      selEnd = xToTime(Math.max(MARGIN_LEFT, Math.min(mx, MARGIN_LEFT + getDrawableW())))
      render()
      return
    }

    const found = hitTest(e.clientX, e.clientY)
    hoveredFile = found
    canvas.style.cursor = found ? 'pointer' : 'default'
    render()

    if (onHoverCallback) onHoverCallback(found, { x: e.clientX, y: e.clientY })
  }

  function onMouseUp(e: MouseEvent) {
    if (!isDragging) return
    isDragging = false
    canvas.style.cursor = 'default'

    if (selStart !== null && selEnd !== null) {
      const s = Math.min(selStart, selEnd)
      const en = Math.max(selStart, selEnd)
      const selSpan = en - s

      if (selSpan > 500) {
        // Meaningful selection → zoom
        viewStart = s
        viewEnd = en
        clampView()
        notifyZoom()
      }
    }

    selStart = null
    selEnd = null
    render()
  }

  function onDblClick() { resetZoom() }

  function resetZoom() {
    viewStart = layout.minTime
    viewEnd = layout.maxTime
    render()
    notifyZoom()
  }

  function onMouseLeave() {
    hoveredFile = null
    if (isDragging) { isDragging = false; selStart = null; selEnd = null }
    canvas.style.cursor = 'default'
    render()
    if (onHoverCallback) onHoverCallback(null, { x: 0, y: 0 })
  }

  // ── Setup ──
  resize()
  render()

  canvas.addEventListener('wheel', onWheel, { passive: false })
  canvas.addEventListener('mousedown', onMouseDown)
  canvas.addEventListener('mousemove', onMouseMove)
  canvas.addEventListener('mouseup', onMouseUp)
  canvas.addEventListener('dblclick', onDblClick)
  canvas.addEventListener('mouseleave', onMouseLeave)
  window.addEventListener('resize', () => { resize(); render() })

  return {
    layout,
    resetZoom,
    destroy() {
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('mousedown', onMouseDown)
      canvas.removeEventListener('mousemove', onMouseMove)
      canvas.removeEventListener('mouseup', onMouseUp)
      canvas.removeEventListener('dblclick', onDblClick)
      canvas.removeEventListener('mouseleave', onMouseLeave)
    },
    onHover(cb: (file: AliveFile | null, pos: { x: number; y: number }) => void) {
      onHoverCallback = cb
    },
    onZoom(cb: (start: number, end: number, reset: () => void, isZoomed: boolean) => void) {
      onZoomChange = cb
    },
  }
}
