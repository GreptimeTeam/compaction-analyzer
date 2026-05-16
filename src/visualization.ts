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
}

interface LayoutResult {
  placed: PlacedItem[]
  numTracks: number
  globalMaxBytes: number
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

function findOverlapping(target: AliveFile, files: AliveFile[]): Set<string> {
  const ids = new Set<string>()
  if (!target.timeRange) return ids
  const [tS, tE] = target.timeRange
  const tP = tS === tE
  for (const f of files) {
    if (f === target || !f.timeRange) continue
    const [fS, fE] = f.timeRange
    const fP = fS === fE
    const ov = (tP || fP) ? tS <= fE && fS <= tE : tS < fE && fS < tE
    if (ov) ids.add(f.fileId)
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
    return { placed: [], numTracks: 0, globalMaxBytes: 0, minTime: 0, maxTime: 0, allFiles: files }
  }

  // Greedy first-fit track assignment: only advance to next track on overlap
  interface TrackEnd { endTime: number }
  const trackEnds: TrackEnd[] = []
  const assignments: Array<{ file: AliveFile; track: number }> = []

  for (const file of sorted) {
    const [start, end] = file.timeRange!
    const isPoint = start === end

    let assigned = -1
    for (let t = 0; t < trackEnds.length; t++) {
      const fits = isPoint
        ? start >= trackEnds[t].endTime
        : start >= trackEnds[t].endTime
      if (fits) { assigned = t; break }
    }

    if (assigned === -1) {
      assigned = trackEnds.length
      trackEnds.push({ endTime: 0 })
    }

    trackEnds[assigned].endTime = isPoint ? end + 1 : end
    assignments.push({ file, track: assigned })
  }

  // Sweep-line to find max simultaneously overlapping files
  // Sort: time ascending, start (+1) before end (-1) at same time
  // so point intervals at the same timestamp count as overlapping
  const events: Array<{ t: number; d: number }> = []
  for (const f of sorted) {
    const [s, e] = f.timeRange!
    events.push({ t: s, d: 1 })
    events.push({ t: e, d: -1 })
  }
  events.sort((a, b) => a.t - b.t || b.d - a.d)
  let cur = 0, maxOverlap = 0
  for (const ev of events) { cur += ev.d; if (cur > maxOverlap) maxOverlap = cur }
  const numTracks = maxOverlap

  // Place files — bar height computed dynamically at render time
  const placed: PlacedItem[] = assignments.map(({ file, track }) => {
    const [start, end] = file.timeRange!
    return {
      file,
      track,
      x: start,
      width: Math.max(1, end - start),
    }
  })

  const minTime = sorted[0].timeRange![0]
  const maxTime = sorted.reduce((m, f) => Math.max(m, f.timeRange![1]), 0)
  const globalMaxBytes = sorted.reduce((m, f) => Math.max(m, f.sizeBytes ?? 0), 0)

  return { placed, numTracks, globalMaxBytes, minTime, maxTime, allFiles: files }
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
  let mouseDownX = 0
  let mouseDownY = 0
  let zoomOverviewBounds: { x: number; y: number; w: number; h: number } | null = null
  let timeMarkerA: number | null = null
  let timeMarkerB: number | null = null
  let manualTickInterval: number | null = null  // null = auto
  let onHoverCallback: ((file: AliveFile | null, pos: { x: number; y: number }) => void) | null = null
  let onZoomChange: ((start: number, end: number, reset: () => void, isZoomed: boolean) => void) | null = null
  let onMarkersChange: ((a: number | null, b: number | null) => void) | null = null
  let onTickIntervalChange: ((ms: number) => void) | null = null
  let onClickFile: ((file: AliveFile | null) => void) | null = null

  function getDrawableW() { return canvas.width / dpr - MARGIN_LEFT - MARGIN_RIGHT }
  function getDrawableH() { return canvas.height / dpr - MARGIN_TOP - MARGIN_BOTTOM }
  function timeSpan() { return viewEnd - viewStart }

  // Track sizing: equal height, computed dynamically from drawable area
  function getTrackHeight() { return getDrawableH() / Math.max(1, layout.numTracks) }
  function getTotalLayoutHeight() { return getDrawableH() }
  function layoutBottom() { return MARGIN_TOP + getDrawableH() }

  function timeToX(t: number) {
    return MARGIN_LEFT + ((t - viewStart) / timeSpan()) * getDrawableW()
  }
  function xToTime(x: number) {
    return viewStart + ((x - MARGIN_LEFT) / getDrawableW()) * timeSpan()
  }
  // Track 0 at bottom, higher tracks stack upward
  function trackBaseY(track: number) {
    return layoutBottom() - (track + 1) * getTrackHeight()
  }
  function barHeight(file: AliveFile) {
    const th = getTrackHeight()
    const maxB = layout.globalMaxBytes || 1
    const ratio = Math.max(0.2, file.sizeBytes! / maxB)
    return Math.max(4, ratio * (th - 4))
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
    const trackH = getTrackHeight()
    for (let i = 0; i < layout.numTracks; i++) {
      const ty = trackBaseY(i) - scrollTop
      const th = trackH
      if (ty + th < MARGIN_TOP || ty > MARGIN_TOP + dh) continue
      ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.015)' : 'rgba(0,0,0,0.05)'
      ctx.fillRect(MARGIN_LEFT, Math.max(MARGIN_TOP, ty), dw, Math.min(th, MARGIN_TOP + dh - Math.max(MARGIN_TOP, ty)))
    }

    // ── X-axis ticks (drawn before bars so bars cover them) ──
    const span = timeSpan()
    const interval = manualTickInterval ?? adaptiveTickInterval(span, dw)
    if (onTickIntervalChange) onTickIntervalChange(interval)
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

    // ── Bars ──
    ctx.save()
    ctx.beginPath()
    ctx.rect(MARGIN_LEFT, MARGIN_TOP, dw, dh)
    ctx.clip()

    const hoverOvIds = hoveredFile ? findOverlapping(hoveredFile, layout.allFiles) : null

    for (const p of layout.placed) {
      const bx = timeToX(p.x)
      const bw = Math.max(BAR_MIN_WIDTH_PX, (p.width / timeSpan()) * dw)
      const bh = barHeight(p.file)
      const by = trackBaseY(p.track) + trackH - bh - scrollTop

      if (bx + bw < MARGIN_LEFT || bx > MARGIN_LEFT + dw) continue
      if (by + bh < MARGIN_TOP || by > MARGIN_TOP + dh) continue

      const isOv = overlapSet.has(p.file.fileId)
      const isHov = p.file === hoveredFile
      const isHoverOv = hoverOvIds?.has(p.file.fileId) ?? false
      let color: string
      if (isHov) {
        color = isOv ? COLOR_OVERLAP : getBaseColor(p.file)
      } else if (isHoverOv) {
        color = '#c084fc' // purple highlight for overlapping files
      } else if (hoverOvIds) {
        color = getDimColor(p.file) // dim non-overlapping when hovering
      } else if (isOv) {
        color = COLOR_OVERLAP_DIM
      } else {
        color = getDimColor(p.file)
      }

      // Bar body
      ctx.fillStyle = color
      drawRoundedRect(ctx, bx, by, bw, bh, BAR_RADIUS)
      ctx.fill()

      // Hover glow on hovered file
      if (isHov) {
        ctx.save()
        ctx.shadowColor = COLOR_HOVER_GLOW
        ctx.shadowBlur = 12
        ctx.strokeStyle = 'rgba(245, 158, 11, 0.8)'
        ctx.lineWidth = 2
        drawRoundedRect(ctx, bx, by, bw, bh, BAR_RADIUS)
        ctx.stroke()
        ctx.restore()
      }

      // Highlight border on overlapping files
      if (isHoverOv && !isHov) {
        ctx.save()
        ctx.strokeStyle = '#c084fc'
        ctx.lineWidth = 1.5
        drawRoundedRect(ctx, bx, by, bw, bh, BAR_RADIUS)
        ctx.stroke()
        ctx.restore()
      }

      // Left accent stripe
      ctx.fillStyle = COLOR_ACCENT_STRIPE
      drawRoundedRect(ctx, bx, by, 3, bh, BAR_RADIUS)
      ctx.fill()

      // Label
      if (bh > 14 && bw > 80) {
        ctx.fillStyle = '#fff'
        ctx.font = `bold 10px Inter, system-ui, sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        const lbl = p.file.fileId.length > 12 ? p.file.fileId.slice(0, 8) + '...' : p.file.fileId
        ctx.fillText(lbl, bx + bw / 2, by + bh / 2, bw - 12)
        ctx.fillStyle = 'rgba(255,255,255,0.6)'
        ctx.font = `9px "JetBrains Mono", monospace`
        ctx.fillText(formatBytes(p.file.sizeBytes!), bx + bw / 2, by + bh / 2 + 12, bw - 12)
      }
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

    // ── Time window markers ──
    if (timeMarkerA !== null && timeMarkerB !== null) {
      const ma = timeToX(timeMarkerA)
      const mb = timeToX(timeMarkerB)
      const left = Math.min(ma, mb)
      const right = Math.max(ma, mb)

      // Highlighted region
      ctx.fillStyle = 'rgba(16, 185, 129, 0.08)'
      ctx.fillRect(left, MARGIN_TOP, right - left, dh)

      // Vertical lines
      ctx.strokeStyle = '#10b981'
      ctx.lineWidth = 1.5
      ctx.setLineDash([6, 3])
      ctx.beginPath()
      ctx.moveTo(ma, MARGIN_TOP)
      ctx.lineTo(ma, MARGIN_TOP + dh)
      ctx.moveTo(mb, MARGIN_TOP)
      ctx.lineTo(mb, MARGIN_TOP + dh)
      ctx.stroke()
      ctx.setLineDash([])

      // Timestamp labels
      ctx.fillStyle = '#10b981'
      ctx.font = '10px "JetBrains Mono", monospace'
      ctx.textBaseline = 'bottom'
      ctx.textAlign = 'center'
      ctx.fillText(formatTimestamp(timeMarkerA), ma, MARGIN_TOP - 4)
      ctx.fillText(formatTimestamp(timeMarkerB), mb, MARGIN_TOP - 4)

      // Duration label centered between markers
      const dur = Math.abs(timeMarkerB - timeMarkerA)
      ctx.fillStyle = 'rgba(16, 185, 129, 0.8)'
      ctx.font = '10px Inter, system-ui, sans-serif'
      ctx.textBaseline = 'top'
      ctx.fillText(formatDuration(dur), (left + right) / 2, MARGIN_TOP + 4)
    } else if (timeMarkerA !== null) {
      const ma = timeToX(timeMarkerA)
      ctx.strokeStyle = '#10b981'
      ctx.lineWidth = 1.5
      ctx.setLineDash([6, 3])
      ctx.beginPath()
      ctx.moveTo(ma, MARGIN_TOP)
      ctx.lineTo(ma, MARGIN_TOP + dh)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.fillStyle = '#10b981'
      ctx.font = '10px "JetBrains Mono", monospace'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'bottom'
      ctx.fillText(formatTimestamp(timeMarkerA), ma, MARGIN_TOP - 4)
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

    // ── Zoom overview bar (centered on top) ──
    const isZoomed = Math.abs(viewStart - layout.minTime) > 100 || Math.abs(viewEnd - layout.maxTime) > 100
    zoomOverviewBounds = null
    if (isZoomed) {
      const barW = Math.min(260, dw * 0.5)
      const barH = 10
      const barX = MARGIN_LEFT + (dw - barW) / 2
      const barY = MARGIN_TOP - barH - 10
      const r = 4

      // Track background
      ctx.fillStyle = '#2a2a4a'
      ctx.beginPath()
      ctx.roundRect(barX, barY, barW, barH, r)
      ctx.fill()

      // Visible range
      const rangeStart = (viewStart - layout.minTime) / fullTimeSpan
      const rangeEnd = (viewEnd - layout.minTime) / fullTimeSpan
      const vx = barX + rangeStart * barW
      const vw = Math.max(4, (rangeEnd - rangeStart) * barW)
      ctx.fillStyle = '#4a90e2'
      ctx.beginPath()
      ctx.roundRect(vx, barY, vw, barH, r)
      ctx.fill()

      // Label
      ctx.fillStyle = '#8888cc'
      ctx.font = '9px Inter, system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'bottom'
      ctx.fillText('zoomed — click to reset', barX + barW / 2, barY - 3)

      zoomOverviewBounds = { x: barX, y: barY, w: barW, h: barH }
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

    const trackH = getTrackHeight()
    for (const p of layout.placed) {
      const bx = timeToX(p.x)
      const bw = Math.max(BAR_MIN_WIDTH_PX, (p.width / timeSpan()) * dw)
      const bh = barHeight(p.file)
      const by = trackBaseY(p.track) + trackH - bh - scrollTop
      if (mx >= bx && mx <= bx + bw && my >= by && my <= by + bh) return p.file
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

    mouseDownX = e.clientX
    mouseDownY = e.clientY

    // Shift+click sets time window markers
    if (e.shiftKey) {
      const t = xToTime(mx)
      if (timeMarkerA === null || timeMarkerB !== null) {
        timeMarkerA = t
        timeMarkerB = null
      } else {
        timeMarkerB = t
      }
      render()
      if (onMarkersChange) onMarkersChange(timeMarkerA, timeMarkerB)
      return
    }

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
    // Check if hovering over zoom overview bar
    let overOverview = false
    if (zoomOverviewBounds) {
      const rect = canvas.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      const b = zoomOverviewBounds
      overOverview = mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h
    }
    canvas.style.cursor = overOverview ? 'pointer' : found ? 'pointer' : 'default'
    render()

    if (onHoverCallback) onHoverCallback(found, { x: e.clientX, y: e.clientY })
  }

  function onMouseUp(e: MouseEvent) {
    // Click on zoom overview bar → reset zoom
    if (!isDragging && zoomOverviewBounds) {
      const rect = canvas.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      const b = zoomOverviewBounds
      if (mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h) {
        resetZoom()
        return
      }
    }

    if (!isDragging) return
    isDragging = false
    canvas.style.cursor = 'default'

    // Detect click (minimal movement) on a file
    const dx = e.clientX - mouseDownX
    const dy = e.clientY - mouseDownY
    if (Math.abs(dx) < 4 && Math.abs(dy) < 4) {
      const clicked = hitTest(e.clientX, e.clientY)
      if (onClickFile) onClickFile(clicked)
    }

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

  function clearMarkers() {
    timeMarkerA = null
    timeMarkerB = null
    render()
    if (onMarkersChange) onMarkersChange(null, null)
  }

  function setTickInterval(ms: number | null) {
    manualTickInterval = ms
    render()
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
    clearMarkers,
    setTickInterval,
    onMarkersChange(cb: (a: number | null, b: number | null) => void) {
      onMarkersChange = cb
    },
    onTickIntervalChange(cb: (ms: number) => void) {
      onTickIntervalChange = cb
    },
    onClickFile(cb: (file: AliveFile | null) => void) {
      onClickFile = cb
    },
  }
}
