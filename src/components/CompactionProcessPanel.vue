<script lang="ts">
import { computed, defineComponent, ref, type PropType } from 'vue'
import { formatBytes, formatDuration } from '../visualization'
import { getMergeTimeSeverity, sortCompactionProcessFiles, sortCompactionProcessTasks, type CompactionProcessAnalysis, type CompactionProcessFile, type CompactionProcessFileSortKey, type CompactionProcessSortKey, type CompactionProcessTask, type SortDirection } from '../parser'

export default defineComponent({
  name: 'CompactionProcessPanel',
  props: {
    analysis: {
      type: Object as PropType<CompactionProcessAnalysis>,
      required: true,
    },
  },
  setup(props) {
    const sortKey = ref<CompactionProcessSortKey>('time')
    const sortDirection = ref<SortDirection>('desc')
    const inputFileSortKey = ref<CompactionProcessFileSortKey>('time-range')
    const inputFileSortDirection = ref<SortDirection>('asc')
    const outputFileSortKey = ref<CompactionProcessFileSortKey>('time-range')
    const outputFileSortDirection = ref<SortDirection>('asc')
    const expandedTaskKey = ref<string | null>(null)

    const sortedTasks = computed(() => sortCompactionProcessTasks(props.analysis.tasks, sortKey.value, sortDirection.value))

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
      expandedTaskKey.value = expandedTaskKey.value === key ? null : key
    }

    function formatNum(n: number): string {
      return n.toLocaleString(undefined, { maximumFractionDigits: 2 })
    }

    function formatMaybeDuration(ms: number | null): string {
      return ms === null ? 'N/A' : formatDuration(ms)
    }

    function mergeTimeClass(task: CompactionProcessTask): string {
      return `merge-badge ${getMergeTimeSeverity(task, props.analysis.tasks)}`
    }

    function taskTime(task: CompactionProcessTask): string {
      return new Date(task.timestamp).toISOString().slice(0, 19) + 'Z'
    }

    function fileTimeRange(file: CompactionProcessFile): string {
      return `${new Date(file.timeRange[0]).toISOString().slice(0, 19)}Z - ${new Date(file.timeRange[1]).toISOString().slice(0, 19)}Z`
    }

    return { expandedTaskKey, fileSortMark, fileTimeRange, formatBytes, formatDuration, formatNum, formatMaybeDuration, mergeTimeClass, setFileSort, setSort, sortedFiles, sortedTasks, sortMark, taskKey, taskTime, toggleTask }
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
        <template v-for="task in sortedTasks" :key="taskKey(task)">
          <button
            :class="['task-row', 'task-row-button', { expanded: expandedTaskKey === taskKey(task) }]"
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
          <div v-if="expandedTaskKey === taskKey(task)" class="task-detail">
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
                <div v-for="file in sortedFiles('input', task.inputFiles)" :key="file.fileId" class="file-row">
                  <span class="mono file-id">{{ file.fileId }}</span>
                  <span>{{ file.level }}</span>
                  <span>{{ formatBytes(file.sizeBytes) }}</span>
                  <span class="mono">{{ fileTimeRange(file) }}</span>
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
                <div v-for="file in sortedFiles('output', task.outputFiles)" :key="file.fileId" class="file-row">
                  <span class="mono file-id">{{ file.fileId }}</span>
                  <span>{{ file.level }}</span>
                  <span>{{ formatBytes(file.sizeBytes) }}</span>
                  <span class="mono">{{ fileTimeRange(file) }}</span>
                </div>
              </div>
            </div>
          </div>
        </template>
      </div>
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
