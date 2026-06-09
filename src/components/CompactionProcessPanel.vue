<script lang="ts">
import { computed, defineComponent, onBeforeUnmount, onMounted, ref, watch, type PropType } from 'vue'
import { formatBytes, formatDuration } from '../visualization'
import { getMergeTimeSeverityMap, sortCompactionProcessFiles, sortCompactionProcessTasks, type CompactionProcessAnalysis, type CompactionProcessFile, type CompactionProcessFileSortKey, type CompactionProcessSortKey, type CompactionProcessTask, type SortDirection } from '../parser'

type GraphFileKind = 'input' | 'output'
interface LineageNodeRef {
  taskIndex: number
  fileIndex: number
  fileCount: number
  file: CompactionProcessFile
}
interface LineageLink {
  fileId: string
  from: LineageNodeRef
  to: LineageNodeRef
}
interface GraphFileNode {
  id: string
  file: CompactionProcessFile
  x: number
  y: number
  role: GraphFileKind | 'intermediate'
}
interface GraphTaskNode {
  id: string
  task: CompactionProcessTask
  x: number
  y: number
}
interface GraphLink {
  id: string
  fromX: number
  fromY: number
  fromRadius: number
  toX: number
  toY: number
  toRadius: number
  kind: 'input' | 'output'
}
type SelectedGraphNode = { kind: 'file'; node: GraphFileNode } | { kind: 'task'; node: GraphTaskNode }
interface GraphMinimapViewport {
  x: number
  y: number
  width: number
  height: number
}

export default defineComponent({
  name: 'CompactionProcessPanel',
  props: {
    analysis: {
      type: Object as PropType<CompactionProcessAnalysis>,
      required: true,
    },
  },
  setup(props) {
    const showGraph = ref(false)
    const visualizedTasks = ref<CompactionProcessTask[]>([])
    const sortKey = ref<CompactionProcessSortKey>('time')
    const sortDirection = ref<SortDirection>('desc')
    const processFileSearch = ref('')
    const inputFileSortKey = ref<CompactionProcessFileSortKey>('time-range')
    const inputFileSortDirection = ref<SortDirection>('asc')
    const outputFileSortKey = ref<CompactionProcessFileSortKey>('time-range')
    const outputFileSortDirection = ref<SortDirection>('asc')
    const expandedTaskKey = ref<string | null>(null)
    const graphScale = ref(1)
    const graphPan = ref({ x: 0, y: 0 })
    const graphDrag = ref<{ pointerId: number; startX: number; startY: number; panX: number; panY: number } | null>(null)
    const graphDidDrag = ref(false)
    const graphDragThreshold = 4
    const selectedGraphNode = ref<SelectedGraphNode | null>(null)
    const pendingGraphSelection = ref<SelectedGraphNode | null>(null)
    const tracedGraphNode = ref<SelectedGraphNode | null>(null)
    const graphSvgRef = ref<SVGSVGElement | null>(null)
    const graphCanvasRef = ref<HTMLElement | null>(null)
    const graphViewportRevision = ref(0)

    const sortedTasks = computed(() => sortCompactionProcessTasks(props.analysis.tasks, sortKey.value, sortDirection.value))
    const mergeTimeSeverities = computed(() => getMergeTimeSeverityMap(props.analysis.tasks))
    const graphTasks = computed(() => sortCompactionProcessTasks(props.analysis.tasks, 'time', 'asc'))
    const traceGraphTasks = computed(() => {
      if (!tracedGraphNode.value) return []
      const taskIds = new Set<string>()
      const seedFileIds = new Set<string>()

      if (tracedGraphNode.value.kind === 'file') {
        seedFileIds.add(tracedGraphNode.value.node.file.fileId)
      } else {
        const task = tracedGraphNode.value.node.task
        taskIds.add(taskKey(task))
        task.inputFiles.forEach(file => seedFileIds.add(file.fileId))
        task.outputFiles.forEach(file => seedFileIds.add(file.fileId))
      }

      const ancestorFileIds = new Set(seedFileIds)
      const descendantFileIds = new Set(seedFileIds)
      const tracedFileIds = new Set(seedFileIds)
      addAncestorTasks(ancestorFileIds, taskIds, tracedFileIds)
      addDescendantTasks(descendantFileIds, taskIds, tracedFileIds)
      return graphTasks.value.filter(task => taskIds.has(taskKey(task)))
    })
    const searchedTaskKeys = computed(() => {
      const query = processFileSearch.value.trim().toLowerCase()
      if (!query) return new Set(sortedTasks.value.map(task => taskKey(task)))

      const seedFileIds = new Set<string>()
      graphTasks.value.forEach((task) => {
        ;[...task.inputFiles, ...task.outputFiles].forEach((file) => {
          if (file.fileId.toLowerCase().includes(query)) seedFileIds.add(file.fileId)
        })
      })

      const taskIds = new Set<string>()
      const ancestorFileIds = new Set(seedFileIds)
      const descendantFileIds = new Set(seedFileIds)
      const tracedFileIds = new Set(seedFileIds)
      addAncestorTasks(ancestorFileIds, taskIds, tracedFileIds)
      addDescendantTasks(descendantFileIds, taskIds, tracedFileIds)
      return taskIds
    })
    const directlyMatchedTaskKeys = computed(() => {
      const taskIds = new Set<string>()
      for (const task of graphTasks.value) {
        if ([...task.inputFiles, ...task.outputFiles].some(fileMatchesSearch)) taskIds.add(taskKey(task))
      }
      return taskIds
    })
    const tableTasks = computed(() => sortedTasks.value.filter(task => searchedTaskKeys.value.has(taskKey(task))))
    const defaultExpandedTaskKey = computed(() => tableTasks.value.find(task => directlyMatchedTaskKeys.value.has(taskKey(task))) ? taskKey(tableTasks.value.find(task => directlyMatchedTaskKeys.value.has(taskKey(task)))!) : null)
    const graphLayoutTasks = computed(() => visualizedTasks.value)
    const graphHeight = computed(() => Math.max(360, graphLayoutTasks.value.length * 150 + 80))
    const graphTransform = computed(() => `translate(${graphPan.value.x} ${graphPan.value.y}) scale(${graphScale.value})`)
    const isGraphDragging = computed(() => graphDrag.value !== null)
    const showGraphMinimap = computed(() => graphScale.value > 1.05)
    const selectedGraphPopoverStyle = computed(() => {
      graphViewportRevision.value
      if (!selectedGraphNode.value) return {}
      const point = graphCssPoint(selectedGraphNode.value.node.x, selectedGraphNode.value.node.y)
      return {
        left: `${point.x + 12}px`,
        top: `${point.y + 12}px`,
      }
    })
    const maxFileSize = computed(() => {
      const sizes = props.analysis.tasks.flatMap(task => [...task.inputFiles, ...task.outputFiles].map(file => file.sizeBytes))
      return Math.max(1, ...sizes)
    })
    const graphLayout = computed(() => {
      const fileNodeById = new Map<string, GraphFileNode>()
      const taskNodes: GraphTaskNode[] = []
      const graphLinks: GraphLink[] = []
      const laneByFileId = new Map<string, number>()
      const rowByTaskId = new Map<string, number>()
      const rowGap = 56
      const fileColumnGap = 230
      const taskColumnGap = 230
      const layoutTasks = [...graphLayoutTasks.value].sort((a, b) => a.timestamp - b.timestamp)
      let nextLane = 0

      function laneForFile(fileId: string): number {
        const existing = laneByFileId.get(fileId)
        if (existing !== undefined) return existing
        laneByFileId.set(fileId, nextLane)
        return nextLane++
      }

      function assignTaskLane(inputLanes: number[]): number {
        if (inputLanes.length === 0) return nextLane++
        const sortedLanes = [...inputLanes].sort((a, b) => a - b)
        return sortedLanes[Math.floor(sortedLanes.length / 2)]
      }

      function sortedByLane(files: CompactionProcessFile[]): CompactionProcessFile[] {
        return [...files].sort((a, b) => laneForFile(a.fileId) - laneForFile(b.fileId))
      }

      function ensureFileNode(file: CompactionProcessFile, column: number, role: GraphFileNode['role']): GraphFileNode {
        const existing = fileNodeById.get(file.fileId)
        const row = laneForFile(file.fileId)
        const x = 120 + column * fileColumnGap
        const y = 90 + row * rowGap
        if (existing) {
          existing.file = file
          existing.x = Math.max(existing.x, x)
          if (existing.role !== role) existing.role = 'intermediate'
          return existing
        }
        const node = { id: file.fileId, file, x, y, role }
        fileNodeById.set(file.fileId, node)
        return node
      }

      layoutTasks.forEach((task, taskIndex) => {
        const inputDepth = task.inputFiles.reduce((max, file) => Math.max(max, Math.floor((fileNodeById.get(file.fileId)?.x ?? 120) / fileColumnGap)), 0)
        const taskColumn = inputDepth + 1
        const outputColumn = taskColumn + 1
        const inputLanes = task.inputFiles.map(file => laneForFile(file.fileId))
        const taskLane = assignTaskLane(inputLanes)
        rowByTaskId.set(taskKey(task), taskLane)
        const taskNode = {
          id: taskKey(task),
          task,
          x: 120 + taskColumn * taskColumnGap,
          y: 90 + taskLane * rowGap,
        }
        taskNodes.push(taskNode)

        task.inputFiles.forEach((file) => {
          ensureFileNode(file, Math.max(0, taskColumn - 1), 'input')
        })

        let outputInheritsTaskLane = true
        task.outputFiles.forEach((file) => {
          if (!task.inputFiles.some(input => input.fileId === file.fileId) && !laneByFileId.has(file.fileId)) {
            laneByFileId.set(file.fileId, outputInheritsTaskLane ? taskLane : nextLane++)
            outputInheritsTaskLane = false
          }
          ensureFileNode(file, outputColumn, 'output')
        })
      })

      layoutTasks.forEach((task) => {
        const taskNode = taskNodes.find(node => node.id === taskKey(task))
        if (!taskNode) return
        sortedByLane(task.inputFiles).forEach((file) => {
          const fileNode = fileNodeById.get(file.fileId)
          if (!fileNode) return
          graphLinks.push({ id: `in-${taskNode.id}-${file.fileId}`, fromX: fileNode.x, fromY: fileNode.y, fromRadius: fileNodeRadius(fileNode.file.sizeBytes), toX: taskNode.x, toY: taskNode.y, toRadius: 24, kind: 'input' })
        })
        sortedByLane(task.outputFiles).forEach((file) => {
          const fileNode = fileNodeById.get(file.fileId)
          if (!fileNode) return
          graphLinks.push({ id: `out-${taskNode.id}-${file.fileId}`, fromX: taskNode.x, fromY: taskNode.y, fromRadius: 24, toX: fileNode.x, toY: fileNode.y, toRadius: fileNodeRadius(fileNode.file.sizeBytes), kind: 'output' })
        })
      })

      const fileNodes = [...fileNodeById.values()]
      const width = Math.max(900, ...fileNodes.map(node => node.x + 220), ...taskNodes.map(node => node.x + 180))
      const height = Math.max(360, ...fileNodes.map(node => node.y + 120), ...taskNodes.map(node => node.y + 120))
      return { fileNodeById, fileNodes, taskNodes, graphLinks, width, height }
    })
    const graphMinimapViewport = computed<GraphMinimapViewport>(() => {
      graphViewportRevision.value
      const layout = graphLayout.value
      const svg = graphSvgRef.value
      const canvas = graphCanvasRef.value
      const fallbackWidth = layout.width / graphScale.value
      const fallbackHeight = layout.height / graphScale.value
      const visibleWidth = svg && canvas ? (canvas.clientWidth / svg.getBoundingClientRect().width) * layout.width / graphScale.value : fallbackWidth
      const visibleHeight = svg && canvas ? (canvas.clientHeight / svg.getBoundingClientRect().height) * layout.height / graphScale.value : fallbackHeight
      const visibleX = svg && canvas ? (canvas.scrollLeft / svg.getBoundingClientRect().width) * layout.width : 0
      const visibleY = svg && canvas ? (canvas.scrollTop / svg.getBoundingClientRect().height) * layout.height : 0
      const width = Math.min(layout.width, visibleWidth)
      const height = Math.min(layout.height, visibleHeight)
      return {
        x: Math.min(Math.max(0, (visibleX - graphPan.value.x) / graphScale.value), Math.max(0, layout.width - width)),
        y: Math.min(Math.max(0, (visibleY - graphPan.value.y) / graphScale.value), Math.max(0, layout.height - height)),
        width,
        height,
      }
    })

    function refreshGraphViewport() {
      graphViewportRevision.value += 1
    }

    onMounted(() => {
      window.addEventListener('resize', refreshGraphViewport)
    })

    onBeforeUnmount(() => {
      window.removeEventListener('resize', refreshGraphViewport)
    })
    watch(processFileSearch, () => {
      expandedTaskKey.value = null
      showGraph.value = false
      visualizedTasks.value = []
    })
    const lineageLinks = computed<LineageLink[]>(() => {
      const latestOutputByFileId = new Map<string, LineageNodeRef>()
      const links: LineageLink[] = []

      graphTasks.value.forEach((task, taskIndex) => {
        task.inputFiles.forEach((file, fileIndex) => {
          const from = latestOutputByFileId.get(file.fileId)
          if (from) {
            links.push({
              fileId: file.fileId,
              from,
              to: { taskIndex, fileIndex, fileCount: task.inputFiles.length, file },
            })
          }
        })

        task.outputFiles.forEach((file, fileIndex) => {
          latestOutputByFileId.set(file.fileId, { taskIndex, fileIndex, fileCount: task.outputFiles.length, file })
        })
      })

      return links
    })

    function setSort(key: CompactionProcessSortKey) {
      if (sortKey.value === key) {
        sortDirection.value = sortDirection.value === 'asc' ? 'desc' : 'asc'
      } else {
        sortKey.value = key
        sortDirection.value = key === 'time' ? 'desc' : 'asc'
      }
    }

    function sortMark(key: CompactionProcessSortKey): string {
      if (sortKey.value !== key) return ''
      return sortDirection.value === 'asc' ? '↑' : '↓'
    }

    function setFileSort(kind: 'input' | 'output', key: CompactionProcessFileSortKey) {
      const currentKey = kind === 'input' ? inputFileSortKey : outputFileSortKey
      const currentDirection = kind === 'input' ? inputFileSortDirection : outputFileSortDirection
      if (currentKey.value === key) {
        currentDirection.value = currentDirection.value === 'asc' ? 'desc' : 'asc'
      } else {
        currentKey.value = key
        currentDirection.value = 'asc'
      }
    }

    function fileSortMark(kind: 'input' | 'output', key: CompactionProcessFileSortKey): string {
      const currentKey = kind === 'input' ? inputFileSortKey : outputFileSortKey
      const currentDirection = kind === 'input' ? inputFileSortDirection : outputFileSortDirection
      if (currentKey.value !== key) return ''
      return currentDirection.value === 'asc' ? '↑' : '↓'
    }

    function sortedFiles(kind: 'input' | 'output', files: CompactionProcessFile[]): CompactionProcessFile[] {
      const key = kind === 'input' ? inputFileSortKey.value : outputFileSortKey.value
      const direction = kind === 'input' ? inputFileSortDirection.value : outputFileSortDirection.value
      return sortCompactionProcessFiles(files, key, direction)
    }

    function taskKey(task: CompactionProcessTask): string {
      return `${task.timestamp}-${task.regionId}-${task.tableId}`
    }

    function toggleTask(task: CompactionProcessTask) {
      const key = taskKey(task)
      const currentKey = expandedTaskKey.value ?? defaultExpandedTaskKey.value
      expandedTaskKey.value = currentKey === key ? null : key
    }

    function isTaskExpanded(task: CompactionProcessTask): boolean {
      return (expandedTaskKey.value ?? defaultExpandedTaskKey.value) === taskKey(task)
    }

    function fileMatchesSearch(file: CompactionProcessFile): boolean {
      const query = processFileSearch.value.trim().toLowerCase()
      return query !== '' && file.fileId.toLowerCase().includes(query)
    }

    function isDirectFileMatch(task: CompactionProcessTask): boolean {
      return directlyMatchedTaskKeys.value.has(taskKey(task))
    }

    function visualizeTableTasks() {
      visualizedTasks.value = tableTasks.value
      showGraph.value = true
      tracedGraphNode.value = null
      graphPan.value = { x: 0, y: 0 }
      graphScale.value = 1
      refreshGraphViewport()
    }

    function formatNum(n: number): string {
      return n.toLocaleString(undefined, { maximumFractionDigits: 2 })
    }

    function formatMaybeDuration(ms: number | null): string {
      return ms === null ? 'N/A' : formatDuration(ms)
    }

    function mergeTimeClass(task: CompactionProcessTask): string {
      return `merge-badge ${mergeTimeSeverities.value.get(task) ?? 'none'}`
    }

    function taskTime(task: CompactionProcessTask): string {
      return new Date(task.timestamp).toISOString().slice(0, 19) + 'Z'
    }

    function fileTimeRange(file: CompactionProcessFile): string {
      return `${new Date(file.timeRange[0]).toISOString().slice(0, 19)}Z - ${new Date(file.timeRange[1]).toISOString().slice(0, 19)}Z`
    }

    function fileTimeStart(file: CompactionProcessFile): string {
      return new Date(file.timeRange[0]).toISOString().slice(0, 19) + 'Z'
    }

    function fileTimeEnd(file: CompactionProcessFile): string {
      return new Date(file.timeRange[1]).toISOString().slice(0, 19) + 'Z'
    }

    function graphRowY(taskIndex: number): number {
      return taskIndex * 150 + 90
    }

    function fileNodeY(taskIndex: number, fileIndex: number, totalFiles: number): number {
      const center = graphRowY(taskIndex)
      const gap = 28
      return center + (fileIndex - (totalFiles - 1) / 2) * gap
    }

    function fileNodeX(kind: GraphFileKind): number {
      return kind === 'input' ? 190 : 910
    }

    function taskNodeX(): number {
      return 550
    }

    function fileNodeRadius(sizeBytes: number): number {
      return 7 + Math.sqrt(sizeBytes / maxFileSize.value) * 15
    }

    function fileNodeClass(kind: GraphFileKind): string {
      return `graph-file-node ${kind}`
    }

    function graphFileLabel(file: CompactionProcessFile): string {
      return `${file.fileId} · L${file.level} · ${formatBytes(file.sizeBytes)}`
    }

    function graphFileShortLabel(file: CompactionProcessFile): string {
      return `${file.fileId.slice(0, 8)}...${file.fileId.slice(-4)}`
    }

    function lineagePath(link: LineageLink): string {
      const startX = fileNodeX('output') + fileNodeRadius(link.from.file.sizeBytes) + 10
      const startY = fileNodeY(link.from.taskIndex, link.from.fileIndex, link.from.fileCount)
      const endX = fileNodeX('input') - fileNodeRadius(link.to.file.sizeBytes) - 10
      const endY = fileNodeY(link.to.taskIndex, link.to.fileIndex, link.to.fileCount)
      const controlOffset = Math.max(90, Math.abs(endY - startY) * 0.35)
      return `M ${startX} ${startY} C ${startX + controlOffset} ${startY}, ${endX - controlOffset} ${endY}, ${endX} ${endY}`
    }

    function clipLinkEndpoint(fromX: number, fromY: number, toX: number, toY: number, radius: number): { x: number; y: number } {
      const dx = toX - fromX
      const dy = toY - fromY
      const length = Math.hypot(dx, dy) || 1
      return {
        x: fromX + (dx / length) * radius,
        y: fromY + (dy / length) * radius,
      }
    }

    function graphLinkPath(link: GraphLink): string {
      const start = clipLinkEndpoint(link.fromX, link.fromY, link.toX, link.toY, link.fromRadius + 6)
      const end = clipLinkEndpoint(link.toX, link.toY, link.fromX, link.fromY, link.toRadius + 10)
      return `M ${start.x} ${start.y} L ${end.x} ${end.y}`
    }

    function graphFileNodeClass(node: GraphFileNode): string {
      return `graph-file-node ${node.role}`
    }

    function addAncestorTasks(fileIds: Set<string>, taskIds: Set<string>, tracedFileIds: Set<string>) {
      let changed = true
      while (changed) {
        changed = false
        for (const task of [...graphTasks.value].reverse()) {
          if (!task.outputFiles.some(file => fileIds.has(file.fileId))) continue
          const key = taskKey(task)
          if (!taskIds.has(key)) {
            taskIds.add(key)
            changed = true
          }
          task.inputFiles.forEach((file) => {
            if (!fileIds.has(file.fileId)) changed = true
            fileIds.add(file.fileId)
            tracedFileIds.add(file.fileId)
          })
          task.outputFiles.forEach((file) => {
            tracedFileIds.add(file.fileId)
          })
        }
      }
    }

    function addDescendantTasks(fileIds: Set<string>, taskIds: Set<string>, tracedFileIds: Set<string>) {
      let changed = true
      while (changed) {
        changed = false
        for (const task of graphTasks.value) {
          if (!task.inputFiles.some(file => fileIds.has(file.fileId))) continue
          const key = taskKey(task)
          if (!taskIds.has(key)) {
            taskIds.add(key)
            changed = true
          }
          task.inputFiles.forEach(file => tracedFileIds.add(file.fileId))
          task.outputFiles.forEach((file) => {
            if (!fileIds.has(file.fileId)) changed = true
            fileIds.add(file.fileId)
            tracedFileIds.add(file.fileId)
          })
        }
      }
    }

    function selectGraphFile(node: GraphFileNode) {
      selectedGraphNode.value = { kind: 'file', node }
    }

    function selectGraphTask(node: GraphTaskNode) {
      selectedGraphNode.value = { kind: 'task', node }
    }

    function prepareGraphFileSelection(node: GraphFileNode) {
      pendingGraphSelection.value = { kind: 'file', node }
    }

    function prepareGraphTaskSelection(node: GraphTaskNode) {
      pendingGraphSelection.value = { kind: 'task', node }
    }

    function clearGraphSelection() {
      selectedGraphNode.value = null
    }

    function traceGraphNode() {
      if (!selectedGraphNode.value) return
      tracedGraphNode.value = selectedGraphNode.value
      graphPan.value = { x: 0, y: 0 }
      graphScale.value = 1
      refreshGraphViewport()
    }

    function clearGraphTrace() {
      tracedGraphNode.value = null
      graphPan.value = { x: 0, y: 0 }
      graphScale.value = 1
      refreshGraphViewport()
    }

    function graphCssPoint(x: number, y: number): { x: number; y: number } {
      const svg = graphSvgRef.value
      const canvas = graphCanvasRef.value
      if (!svg || !canvas) return { x: graphPan.value.x + x * graphScale.value, y: graphPan.value.y + y * graphScale.value }
      const svgRect = svg.getBoundingClientRect()
      const canvasRect = canvas.getBoundingClientRect()
      const graphRenderedScale = {
        x: svgRect.width / graphLayout.value.width,
        y: svgRect.height / graphLayout.value.height,
      }
      return {
        x: canvas.scrollLeft + svgRect.left - canvasRect.left + (graphPan.value.x + x * graphScale.value) * graphRenderedScale.x,
        y: canvas.scrollTop + svgRect.top - canvasRect.top + (graphPan.value.y + y * graphScale.value) * graphRenderedScale.y,
      }
    }

    function graphClientPoint(event: MouseEvent | PointerEvent): { x: number; y: number } {
      const rect = (event.currentTarget as SVGSVGElement).getBoundingClientRect()
      return {
        x: (event.clientX - rect.left) * (graphLayout.value.width / rect.width),
        y: (event.clientY - rect.top) * (graphLayout.value.height / rect.height),
      }
    }

    function handleGraphWheel(event: WheelEvent) {
      const previousScale = graphScale.value
      const nextScale = Math.min(3, Math.max(0.5, previousScale + (event.deltaY < 0 ? 0.1 : -0.1)))
      const cursor = graphClientPoint(event)
      const graphPointBeforeZoom = {
        x: (cursor.x - graphPan.value.x) / previousScale,
        y: (cursor.y - graphPan.value.y) / previousScale,
      }
      graphScale.value = nextScale
      graphPan.value = {
        x: cursor.x - graphPointBeforeZoom.x * nextScale,
        y: cursor.y - graphPointBeforeZoom.y * nextScale,
      }
    }

    function handleGraphPointerDown(event: PointerEvent) {
      const point = graphClientPoint(event)
      graphDrag.value = { pointerId: event.pointerId, startX: point.x, startY: point.y, panX: graphPan.value.x, panY: graphPan.value.y }
      graphDidDrag.value = false
      ;(event.currentTarget as SVGSVGElement).setPointerCapture(event.pointerId)
    }

    function handleGraphPointerMove(event: PointerEvent) {
      if (!graphDrag.value || graphDrag.value.pointerId !== event.pointerId) return
      const point = graphClientPoint(event)
      const dx = point.x - graphDrag.value.startX
      const dy = point.y - graphDrag.value.startY
      if (Math.hypot(dx, dy) > graphDragThreshold) graphDidDrag.value = true
      graphPan.value = {
        x: graphDrag.value.panX + dx,
        y: graphDrag.value.panY + dy,
      }
    }

    function handleGraphPointerUp(event: PointerEvent) {
      if (graphDrag.value?.pointerId !== event.pointerId) return
      if (!graphDidDrag.value && pendingGraphSelection.value) {
        selectedGraphNode.value = pendingGraphSelection.value
      } else if (!graphDidDrag.value) {
        clearGraphSelection()
      }
      pendingGraphSelection.value = null
      graphDrag.value = null
      const svg = event.currentTarget as SVGSVGElement
      if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId)
      requestAnimationFrame(() => {
        graphDidDrag.value = false
      })
    }

    function handleGraphPointerCancel(event: PointerEvent) {
      if (graphDrag.value?.pointerId !== event.pointerId) return
      pendingGraphSelection.value = null
      graphDrag.value = null
      graphDidDrag.value = false
    }

    return { clearGraphSelection, clearGraphTrace, directlyMatchedTaskKeys, expandedTaskKey, fileMatchesSearch, fileNodeClass, fileNodeRadius, fileNodeX, fileNodeY, fileSortMark, fileTimeEnd, fileTimeRange, fileTimeStart, formatBytes, formatDuration, formatNum, formatMaybeDuration, graphCanvasRef, graphFileLabel, graphFileShortLabel, graphFileNodeClass, graphHeight, graphLayout, graphLinkPath, graphMinimapViewport, graphRowY, graphScale, graphPan, graphSvgRef, graphTasks, graphTransform, handleGraphPointerCancel, handleGraphPointerDown, handleGraphPointerMove, handleGraphPointerUp, handleGraphWheel, isDirectFileMatch, isGraphDragging, isTaskExpanded, lineageLinks, lineagePath, mergeTimeClass, prepareGraphFileSelection, prepareGraphTaskSelection, processFileSearch, refreshGraphViewport, selectedGraphNode, selectedGraphPopoverStyle, selectGraphFile, selectGraphTask, setFileSort, setSort, showGraph, showGraphMinimap, sortedFiles, sortedTasks, sortMark, tableTasks, taskKey, taskNodeX, taskTime, toggleTask, traceGraphNode, tracedGraphNode, visualizeTableTasks, visualizedTasks }
  },
})
</script>

<template>
  <div class="process-panel">
    <section class="hero-card">
      <div>
        <p class="eyebrow">Process analysis</p>
        <h2>Compaction task timeline</h2>
        <p class="hero-copy">Summarizes pasted or uploaded compaction logs by merge cost, pick cost, file counts, and IO size.</p>
      </div>
      <div class="hero-stat">
        <span class="hero-value">{{ formatNum(analysis.totalTasks) }}</span>
        <span class="hero-label">tasks</span>
      </div>
    </section>

    <section class="metric-grid">
      <div class="metric-card">
        <div class="metric-value">{{ formatNum(analysis.totalInputFiles) }}</div>
        <div class="metric-label">Input files</div>
      </div>
      <div class="metric-card">
        <div class="metric-value">{{ formatNum(analysis.totalOutputFiles) }}</div>
        <div class="metric-label">Output files</div>
      </div>
      <div class="metric-card">
        <div class="metric-value">{{ formatNum(analysis.averageFanOut) }}</div>
        <div class="metric-label">Avg fan-out</div>
      </div>
      <div class="metric-card">
        <div class="metric-value">{{ formatNum(analysis.maxFanOut) }}</div>
        <div class="metric-label">Max fan-out</div>
      </div>
      <div class="metric-card">
        <div class="metric-value">{{ formatMaybeDuration(analysis.averagePickMillis) }}</div>
        <div class="metric-label">Avg pick time</div>
      </div>
      <div class="metric-card">
        <div class="metric-value">{{ formatMaybeDuration(analysis.averageMergeMillis) }}</div>
        <div class="metric-label">Avg merge time</div>
      </div>
      <div class="metric-card wide">
        <div class="metric-value">{{ formatBytes(analysis.totalInputBytes) }}</div>
        <div class="metric-label">Input bytes</div>
      </div>
      <div class="metric-card wide">
        <div class="metric-value">{{ formatBytes(analysis.totalOutputBytes) }}</div>
        <div class="metric-label">Output bytes</div>
      </div>
    </section>

     <section class="task-table-wrap">
       <h3>Compaction Tasks</h3>
       <div class="process-search">
         <label>
           <span>Search input file lineage</span>
           <input v-model="processFileSearch" type="search" placeholder="Enter file id or fragment" />
         </label>
         <button class="visualize-button" type="button" @click="visualizeTableTasks">Visualize</button>
       </div>
       <div class="task-table">
        <div class="task-row header">
          <button class="sort-header" @click="setSort('time')">Time {{ sortMark('time') }}</button>
          <span>Region</span>
          <button class="sort-header" @click="setSort('input-files')">Input file num {{ sortMark('input-files') }}</button>
          <button class="sort-header" @click="setSort('input-size')">Input size {{ sortMark('input-size') }}</button>
          <button class="sort-header" @click="setSort('output-files')">Output file num {{ sortMark('output-files') }}</button>
          <button class="sort-header" @click="setSort('output-size')">Output size {{ sortMark('output-size') }}</button>
          <button class="sort-header" @click="setSort('merge')">Merge time {{ sortMark('merge') }}</button>
          <span>Pick</span>
        </div>
         <template v-for="task in tableTasks" :key="taskKey(task)">
           <button
             :class="['task-row', 'task-row-button', { expanded: isTaskExpanded(task), 'search-hit': directlyMatchedTaskKeys.has(taskKey(task)) }]"
             @click="toggleTask(task)"
           >
            <span class="mono">{{ taskTime(task) }}</span>
            <span>{{ task.regionId }} / {{ task.tableId }}</span>
            <span>{{ formatNum(task.inputFileCount) }}</span>
            <span>{{ formatBytes(task.inputBytes) }}</span>
            <span>{{ formatNum(task.outputFileCount) }}</span>
            <span>{{ formatBytes(task.outputBytes) }}</span>
            <span :class="mergeTimeClass(task)">{{ formatMaybeDuration(task.mergeMillis) }}</span>
            <span>{{ formatMaybeDuration(task.pickMillis) }}</span>
          </button>
          <div v-if="isTaskExpanded(task)" class="task-detail">
            <div class="detail-grid">
              <div><span class="detail-label">Region</span><span>{{ task.regionId }}</span></div>
              <div><span class="detail-label">Table</span><span>{{ task.tableId }}</span></div>
              <div><span class="detail-label">Fan-out</span><span>{{ formatNum(task.fanOut) }}</span></div>
              <div><span class="detail-label">Merge time</span><span :class="mergeTimeClass(task)">{{ formatMaybeDuration(task.mergeMillis) }}</span></div>
              <div><span class="detail-label">Pick time</span><span>{{ formatMaybeDuration(task.pickMillis) }}</span></div>
              <div><span class="detail-label">Timestamp</span><span class="mono">{{ taskTime(task) }}</span></div>
            </div>

            <div class="file-lists">
              <div class="file-list">
                <h4>Input Files</h4>
                <div class="file-row file-row-head">
                  <button class="sort-header" @click="setFileSort('input', 'file-id')">File ID {{ fileSortMark('input', 'file-id') }}</button>
                  <button class="sort-header" @click="setFileSort('input', 'level')">Level {{ fileSortMark('input', 'level') }}</button>
                  <button class="sort-header" @click="setFileSort('input', 'size')">Size {{ fileSortMark('input', 'size') }}</button>
                  <button class="sort-header" @click="setFileSort('input', 'time-range')">Time range {{ fileSortMark('input', 'time-range') }}</button>
                </div>
                <div v-for="file in sortedFiles('input', task.inputFiles)" :key="file.fileId" :class="['file-row', { 'file-search-hit': fileMatchesSearch(file) }]">
                  <span class="mono file-id">{{ file.fileId }}</span>
                  <span>{{ file.level }}</span>
                  <span>{{ formatBytes(file.sizeBytes) }}</span>
                  <span class="file-time-range mono">
                    <span class="time-range-line"><span class="time-range-label">Start</span><span>{{ fileTimeStart(file) }}</span></span>
                    <span class="time-range-line"><span class="time-range-label">End</span><span>{{ fileTimeEnd(file) }}</span></span>
                  </span>
                </div>
              </div>
              <div class="file-list">
                <h4>Output Files</h4>
                <div class="file-row file-row-head">
                  <button class="sort-header" @click="setFileSort('output', 'file-id')">File ID {{ fileSortMark('output', 'file-id') }}</button>
                  <button class="sort-header" @click="setFileSort('output', 'level')">Level {{ fileSortMark('output', 'level') }}</button>
                  <button class="sort-header" @click="setFileSort('output', 'size')">Size {{ fileSortMark('output', 'size') }}</button>
                  <button class="sort-header" @click="setFileSort('output', 'time-range')">Time range {{ fileSortMark('output', 'time-range') }}</button>
                </div>
                <div v-for="file in sortedFiles('output', task.outputFiles)" :key="file.fileId" :class="['file-row', { 'file-search-hit': fileMatchesSearch(file) }]">
                  <span class="mono file-id">{{ file.fileId }}</span>
                  <span>{{ file.level }}</span>
                  <span>{{ formatBytes(file.sizeBytes) }}</span>
                  <span class="file-time-range mono">
                    <span class="time-range-line"><span class="time-range-label">Start</span><span>{{ fileTimeStart(file) }}</span></span>
                    <span class="time-range-line"><span class="time-range-label">End</span><span>{{ fileTimeEnd(file) }}</span></span>
                  </span>
                </div>
              </div>
            </div>
          </div>
        </template>
      </div>
    </section>

    <section v-if="showGraph" class="graph-wrap">
      <div class="graph-header">
        <div>
          <h3>Compaction graph</h3>
          <p>Input files flow into each compaction task and produce output files. Circle size is scaled by file size.</p>
        </div>
        <button v-if="tracedGraphNode" class="graph-trace-clear" @click="clearGraphTrace">Clear Trace</button>
        <div class="graph-legend">
          <span><i class="legend-dot input"></i>Input file</span>
          <span><i class="legend-dot output"></i>Output file</span>
          <span><i class="legend-dot task"></i>Task</span>
          <span><i class="legend-line lineage"></i>Continued input</span>
        </div>
      </div>
      <div ref="graphCanvasRef" :class="['graph-canvas', { dragging: isGraphDragging }]" @scroll="refreshGraphViewport">
        <svg ref="graphSvgRef" :viewBox="`0 0 ${graphLayout.width} ${graphLayout.height}`" role="img" aria-label="Compaction input output relationship graph" @wheel.prevent="handleGraphWheel" @pointerdown="handleGraphPointerDown" @pointermove="handleGraphPointerMove" @pointerup="handleGraphPointerUp" @pointercancel="handleGraphPointerCancel" @lostpointercapture="handleGraphPointerCancel">
          <defs>
            <marker id="arrow-head" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth">
              <path d="M0,0 L0,6 L9,3 z" class="arrow-head" />
            </marker>
          </defs>
          <g :transform="graphTransform">
            <path v-for="link in graphLayout.graphLinks" :key="link.id" :d="graphLinkPath(link)" :class="['graph-link', link.kind === 'input' ? 'input-link' : 'output-link']" marker-end="url(#arrow-head)">
              <title>{{ link.kind === 'input' ? 'Input file feeds task' : 'Task produces output file' }}</title>
            </path>
            <g v-for="node in graphLayout.fileNodes" :key="node.id" role="button" tabindex="0" :aria-label="`File ${node.file.fileId}`" @pointerdown="prepareGraphFileSelection(node)" @click.stop @keydown.enter.stop.prevent="selectGraphFile(node)" @keydown.space.stop.prevent="selectGraphFile(node)">
              <circle :class="graphFileNodeClass(node)" :cx="node.x" :cy="node.y" :r="fileNodeRadius(node.file.sizeBytes)">
                <title>{{ graphFileLabel(node.file) }}</title>
              </circle>
              <text :x="node.x" :y="node.y + fileNodeRadius(node.file.sizeBytes) + 16" class="graph-file-label" text-anchor="middle">{{ graphFileShortLabel(node.file) }}</text>
            </g>
            <g v-for="node in graphLayout.taskNodes" :key="node.id" role="button" tabindex="0" :aria-label="`Task ${taskTime(node.task)}`" @pointerdown="prepareGraphTaskSelection(node)" @click.stop @keydown.enter.stop.prevent="selectGraphTask(node)" @keydown.space.stop.prevent="selectGraphTask(node)">
              <circle class="graph-task-node" :cx="node.x" :cy="node.y" r="24">
                <title>{{ node.task.inputFileCount }} input files compacted into {{ node.task.outputFileCount }} output files</title>
              </circle>
              <text :x="node.x" :y="node.y + 5" class="graph-task-label" text-anchor="middle" textLength="38" lengthAdjust="spacingAndGlyphs">{{ formatMaybeDuration(node.task.mergeMillis) }}</text>
              <text :x="node.x" :y="node.y + 42" class="graph-region" text-anchor="middle">R{{ node.task.regionId }}</text>
            </g>
          </g>
        </svg>
        <div v-if="selectedGraphNode" class="graph-popover" :style="selectedGraphPopoverStyle">
          <button class="graph-trace-button" @click.stop="traceGraphNode">Trace</button>
          <template v-if="selectedGraphNode.kind === 'file'">
            <h4>File {{ selectedGraphNode.node.file.fileId }}</h4>
            <div><span>Level</span><strong>{{ selectedGraphNode.node.file.level }}</strong></div>
            <div><span>Size</span><strong>{{ formatBytes(selectedGraphNode.node.file.sizeBytes) }}</strong></div>
            <div><span>Start</span><strong>{{ fileTimeStart(selectedGraphNode.node.file) }}</strong></div>
            <div><span>End</span><strong>{{ fileTimeEnd(selectedGraphNode.node.file) }}</strong></div>
            <div><span>Role</span><strong>{{ selectedGraphNode.node.role }}</strong></div>
          </template>
          <template v-if="selectedGraphNode.kind === 'task'">
            <h4>Task {{ taskTime(selectedGraphNode.node.task) }}</h4>
            <div><span>Region / table</span><strong>{{ selectedGraphNode.node.task.regionId }} / {{ selectedGraphNode.node.task.tableId }}</strong></div>
            <div><span>Input count</span><strong>{{ formatNum(selectedGraphNode.node.task.inputFileCount) }}</strong></div>
            <div><span>Output count</span><strong>{{ formatNum(selectedGraphNode.node.task.outputFileCount) }}</strong></div>
            <div><span>Input size</span><strong>{{ formatBytes(selectedGraphNode.node.task.inputBytes) }}</strong></div>
            <div><span>Output size</span><strong>{{ formatBytes(selectedGraphNode.node.task.outputBytes) }}</strong></div>
            <div><span>Merge time</span><strong>{{ formatMaybeDuration(selectedGraphNode.node.task.mergeMillis) }}</strong></div>
            <div><span>Pick time</span><strong>{{ formatMaybeDuration(selectedGraphNode.node.task.pickMillis) }}</strong></div>
            <div><span>Fan-out</span><strong>{{ formatNum(selectedGraphNode.node.task.fanOut) }}</strong></div>
          </template>
        </div>
      </div>
      <svg v-if="showGraphMinimap" class="graph-minimap" :viewBox="`0 0 ${graphLayout.width} ${graphLayout.height}`" aria-hidden="true">
        <path v-for="link in graphLayout.graphLinks" :key="`minimap-${link.id}`" :d="graphLinkPath(link)" class="graph-minimap-link" />
        <circle v-for="node in graphLayout.fileNodes" :key="`minimap-file-${node.id}`" :class="['graph-minimap-file', node.role]" :cx="node.x" :cy="node.y" r="10" />
        <rect v-for="node in graphLayout.taskNodes" :key="`minimap-task-${node.id}`" class="graph-minimap-task" :x="node.x - 14" :y="node.y - 14" width="28" height="28" rx="6" />
        <rect class="graph-minimap-viewport" :x="graphMinimapViewport.x" :y="graphMinimapViewport.y" :width="graphMinimapViewport.width" :height="graphMinimapViewport.height" />
      </svg>
    </section>
  </div>
</template>

<style scoped>
.process-panel {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
}

.hero-card {
  display: flex;
  justify-content: space-between;
  gap: 24px;
  padding: 24px;
  border: 1px solid rgba(74, 144, 226, 0.35);
  border-radius: 18px;
  background: linear-gradient(135deg, rgba(74, 144, 226, 0.16), rgba(155, 89, 182, 0.08)), var(--bg-surface);
  box-shadow: 0 20px 80px rgba(0, 0, 0, 0.2);
}

.eyebrow {
  color: var(--primary);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  margin-bottom: 8px;
}

.hero-card h2 {
  font-size: 28px;
  margin-bottom: 8px;
}

.hero-copy {
  color: var(--text-secondary);
  max-width: 620px;
}

.hero-stat {
  min-width: 130px;
  text-align: right;
}

.hero-value {
  display: block;
  color: var(--primary);
  font-family: var(--font-mono);
  font-size: 44px;
  font-weight: 800;
}

.hero-label {
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-size: 12px;
}

.metric-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
  margin: 20px 0;
}

.metric-card {
  padding: 16px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--bg-surface);
}

.metric-card.wide {
  grid-column: span 2;
}

.metric-value {
  color: var(--primary);
  font-family: var(--font-mono);
  font-size: 20px;
  font-weight: 800;
}

.metric-label {
  color: var(--text-muted);
  font-size: 12px;
  margin-top: 6px;
}

.graph-wrap {
  position: relative;
  display: flex;
  flex-direction: column;
  max-height: calc(100vh - 120px);
  border: 1px solid rgba(74, 144, 226, 0.28);
  border-radius: 14px;
  background: radial-gradient(circle at 20% 0%, rgba(74, 144, 226, 0.16), transparent 34%), var(--bg-surface);
  overflow: hidden;
}

.graph-header {
  display: flex;
  justify-content: space-between;
  gap: 20px;
  padding: 16px 18px;
  border-bottom: 1px solid var(--border);
}

.graph-header h3 {
  font-size: 14px;
  margin-bottom: 6px;
}

.graph-header p {
  color: var(--text-secondary);
  font-size: 12px;
}

.graph-legend {
  display: flex;
  align-items: center;
  gap: 12px;
  color: var(--text-secondary);
  font-size: 11px;
  white-space: nowrap;
}

.graph-trace-clear,
.graph-trace-button {
  border: 1px solid rgba(96, 165, 250, 0.45);
  border-radius: 999px;
  background: rgba(37, 99, 235, 0.22);
  color: #dbeafe;
  cursor: pointer;
  font-family: inherit;
  font-size: 11px;
  font-weight: 800;
}

.graph-trace-clear {
  align-self: center;
  padding: 7px 12px;
}

.graph-trace-button {
  float: right;
  margin: 0 0 8px 10px;
  padding: 5px 10px;
  pointer-events: auto;
}

.graph-trace-clear:hover,
.graph-trace-button:hover {
  border-color: rgba(147, 197, 253, 0.8);
  background: rgba(37, 99, 235, 0.38);
}

.legend-dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  margin-right: 5px;
  border-radius: 999px;
  vertical-align: -1px;
}

.legend-dot.input { background: #60a5fa; }
.legend-dot.output { background: #34d399; }
.legend-dot.task { background: #c084fc; }

.legend-line {
  display: inline-block;
  width: 18px;
  height: 0;
  margin-right: 5px;
  border-top: 2px dashed #facc15;
  vertical-align: 3px;
}

.graph-canvas {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 12px;
}

.graph-canvas svg {
  min-width: 1080px;
  width: 100%;
  cursor: grab;
}

.graph-canvas.dragging svg {
  cursor: grabbing;
}

.graph-minimap {
  position: absolute;
  right: 18px;
  bottom: 18px;
  z-index: 1;
  width: 180px;
  height: 118px;
  min-width: 0;
  border: 1px solid rgba(148, 163, 184, 0.42);
  border-radius: 10px;
  background: rgba(15, 23, 42, 0.82);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.34);
  pointer-events: none;
}

.graph-minimap-link {
  fill: none;
  stroke: rgba(148, 163, 184, 0.42);
  stroke-width: 8;
}

.graph-minimap-file {
  stroke-width: 4;
}

.graph-minimap-file.input {
  fill: rgba(96, 165, 250, 0.72);
}

.graph-minimap-file.output {
  fill: rgba(52, 211, 153, 0.72);
}

.graph-minimap-file.intermediate {
  fill: rgba(250, 204, 21, 0.72);
}

.graph-minimap-task {
  fill: rgba(192, 132, 252, 0.72);
}

.graph-minimap-viewport {
  fill: rgba(255, 255, 255, 0.08);
  stroke: rgba(255, 255, 255, 0.86);
  stroke-width: 8;
}

.graph-row-line {
  stroke: rgba(148, 163, 184, 0.12);
  stroke-dasharray: 4 10;
}

.graph-link {
  stroke-width: 1.8;
  fill: none;
  opacity: 0.72;
}

.input-link { stroke: #60a5fa; }
.output-link { stroke: #34d399; }

.graph-lineage-link {
  fill: none;
  stroke: #facc15;
  stroke-width: 2.4;
  stroke-dasharray: 7 6;
  opacity: 0.86;
  filter: drop-shadow(0 0 6px rgba(250, 204, 21, 0.25));
}

.arrow-head {
  fill: #94a3b8;
}

.graph-file-node {
  cursor: pointer;
  stroke-width: 2;
  filter: drop-shadow(0 6px 14px rgba(0, 0, 0, 0.35));
}

.graph-file-node.input {
  fill: rgba(96, 165, 250, 0.28);
  stroke: #60a5fa;
}

.graph-file-node.output {
  fill: rgba(52, 211, 153, 0.26);
  stroke: #34d399;
}

.graph-file-node.intermediate {
  fill: rgba(250, 204, 21, 0.24);
  stroke: #facc15;
}

.graph-task-node {
  cursor: pointer;
  fill: rgba(192, 132, 252, 0.22);
  stroke: #c084fc;
  stroke-width: 2;
}

.graph-popover {
  position: absolute;
  z-index: 2;
  min-width: 230px;
  max-width: 320px;
  padding: 12px;
  border: 1px solid rgba(148, 163, 184, 0.38);
  border-radius: 12px;
  background: rgba(15, 23, 42, 0.96);
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.45);
  color: var(--text-secondary);
  font-size: 11px;
  pointer-events: none;
}

.graph-popover h4 {
  overflow: hidden;
  margin-bottom: 8px;
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.graph-popover div {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 4px 0;
  border-top: 1px solid rgba(148, 163, 184, 0.12);
}

.graph-popover strong {
  color: var(--text);
  font-family: var(--font-mono);
  font-weight: 700;
  text-align: right;
}

.graph-task-label,
.graph-time,
.graph-region,
.graph-file-label {
  font-family: var(--font-mono);
  pointer-events: none;
}

.graph-task-label {
  fill: #f5d0fe;
  font-size: 9px;
  font-weight: 800;
}

.graph-time {
  fill: var(--text-muted);
  font-size: 10px;
}

.graph-region {
  fill: var(--text-secondary);
  font-size: 10px;
}

.graph-file-label {
  fill: #cbd5e1;
  font-size: 10px;
}

.task-table-wrap {
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--bg-surface);
  overflow: hidden;
}

.task-table-wrap h3 {
  padding: 16px 18px;
  font-size: 14px;
  border-bottom: 1px solid var(--border);
}

.task-table {
  min-width: 1040px;
}

.process-search {
  display: flex;
  align-items: end;
  gap: 12px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--border);
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 700;
}

.process-search label {
  display: grid;
  gap: 6px;
  flex: 1;
}

.process-search input {
  width: min(520px, 100%);
  border: 1px solid rgba(96, 165, 250, 0.35);
  border-radius: 10px;
  padding: 10px 12px;
  background: var(--bg);
  color: var(--text);
  font-family: var(--font-mono);
}

.visualize-button {
  border: 1px solid rgba(96, 165, 250, 0.45);
  border-radius: 10px;
  padding: 10px 14px;
  background: rgba(37, 99, 235, 0.22);
  color: #dbeafe;
  cursor: pointer;
  font-family: inherit;
  font-size: 12px;
  font-weight: 800;
}

.visualize-button:hover {
  border-color: rgba(147, 197, 253, 0.8);
  background: rgba(37, 99, 235, 0.38);
}

.task-row {
  display: grid;
  grid-template-columns: 180px 180px 120px 130px 120px 120px 110px 90px;
  gap: 12px;
  align-items: center;
  padding: 12px 18px;
  border-bottom: 1px solid rgba(42, 42, 74, 0.6);
  color: var(--text-secondary);
  font-size: 12px;
}

.task-row-button {
  width: 100%;
  border: none;
  background: transparent;
  cursor: pointer;
  font-family: inherit;
  text-align: left;
}

.task-row-button:hover,
.task-row-button.expanded {
  background: rgba(74, 144, 226, 0.08);
  color: var(--text);
}

.task-row-button.search-hit {
  background: rgba(250, 204, 21, 0.12);
  color: var(--text);
  box-shadow: inset 3px 0 0 #facc15;
}

.task-row.header {
  color: var(--text);
  background: var(--bg);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.sort-header {
  border: none;
  padding: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font: inherit;
  letter-spacing: inherit;
  text-align: left;
  text-transform: inherit;
}

.sort-header:hover {
  color: var(--primary);
}

.merge-badge {
  display: inline-flex;
  width: max-content;
  min-width: 54px;
  justify-content: center;
  padding: 3px 8px;
  border-radius: 999px;
  font-family: var(--font-mono);
  font-weight: 800;
}

.merge-badge.red {
  background: rgba(239, 68, 68, 0.24);
  color: #fecaca;
  box-shadow: inset 0 0 0 1px rgba(248, 113, 113, 0.55);
}

.merge-badge.orange {
  background: rgba(249, 115, 22, 0.24);
  color: #fed7aa;
  box-shadow: inset 0 0 0 1px rgba(251, 146, 60, 0.55);
}

.merge-badge.yellow {
  background: rgba(234, 179, 8, 0.22);
  color: #fef08a;
  box-shadow: inset 0 0 0 1px rgba(250, 204, 21, 0.5);
}

.merge-badge.green {
  background: rgba(34, 197, 94, 0.2);
  color: #bbf7d0;
  box-shadow: inset 0 0 0 1px rgba(74, 222, 128, 0.45);
}

.merge-badge.none {
  background: rgba(148, 163, 184, 0.12);
  color: var(--text-muted);
  box-shadow: inset 0 0 0 1px rgba(148, 163, 184, 0.22);
}

.task-detail {
  padding: 18px;
  border-bottom: 1px solid rgba(42, 42, 74, 0.8);
  background: rgba(15, 15, 26, 0.65);
}

.detail-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 18px;
}

.detail-grid > div {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg);
  color: var(--text-secondary);
}

.detail-label {
  color: var(--text-muted);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.file-lists {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.file-list {
  overflow-x: auto;
  border: 1px solid rgba(96, 165, 250, 0.45);
  border-radius: 10px;
  background: linear-gradient(180deg, rgba(37, 99, 235, 0.2), rgba(30, 64, 175, 0.14)), var(--bg-surface);
  box-shadow: inset 0 1px 0 rgba(191, 219, 254, 0.12);
}

.file-list h4 {
  padding: 12px;
  border-bottom: 1px solid rgba(96, 165, 250, 0.35);
  color: #dbeafe;
  font-size: 12px;
}

.file-row {
  display: grid;
  grid-template-columns: 260px 56px 90px 260px;
  gap: 10px;
  min-width: 700px;
  padding: 8px 12px;
  border-bottom: 1px solid rgba(96, 165, 250, 0.18);
  color: #c7d2fe;
  font-size: 11px;
}

.file-row.file-search-hit {
  background: rgba(250, 204, 21, 0.16);
  color: #fef3c7;
  box-shadow: inset 3px 0 0 #facc15;
}

.file-row-head {
  color: #eff6ff;
  background: rgba(59, 130, 246, 0.22);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.file-id {
  overflow: hidden;
  text-overflow: ellipsis;
}

.file-time-range {
  display: inline-grid;
  gap: 3px;
}

.time-range-line {
  display: grid;
  grid-template-columns: 38px 1fr;
  gap: 8px;
  align-items: baseline;
}

.time-range-label {
  color: #93c5fd;
  font-family: var(--font-sans);
  font-size: 10px;
  font-weight: 800;
  text-transform: uppercase;
}

.mono {
  font-family: var(--font-mono);
}

@media (max-width: 900px) {
  .hero-card {
    flex-direction: column;
  }
  .hero-stat {
    text-align: left;
  }
  .metric-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .task-table-wrap {
    overflow-x: auto;
  }
  .detail-grid, .file-lists {
    grid-template-columns: 1fr;
  }
}
</style>
