<script lang="ts">
import { defineComponent, type PropType } from 'vue'
import { formatBytes, formatDuration } from '../visualization'
import type { CompactionProcessAnalysis, CompactionProcessTask } from '../parser'

export default defineComponent({
  name: 'CompactionProcessPanel',
  props: {
    analysis: {
      type: Object as PropType<CompactionProcessAnalysis>,
      required: true,
    },
  },
  setup() {
    function formatNum(n: number): string {
      return n.toLocaleString(undefined, { maximumFractionDigits: 2 })
    }

    function formatMaybeDuration(ms: number | null): string {
      return ms === null ? 'N/A' : formatDuration(ms)
    }

    function taskTime(task: CompactionProcessTask): string {
      return new Date(task.timestamp).toISOString().slice(0, 19) + 'Z'
    }

    return { formatBytes, formatDuration, formatNum, formatMaybeDuration, taskTime }
  },
})
</script>

<template>
  <div class="process-panel">
    <section class="hero-card">
      <div>
        <p class="eyebrow">Process analysis</p>
        <h2>Compaction task timeline</h2>
        <p class="hero-copy">Summarizes pasted or uploaded compaction logs by merge cost, pick cost, and file fan-out.</p>
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
          <span>Time</span>
          <span>Region</span>
          <span>In -> Out</span>
          <span>Fan-out</span>
          <span>Merge</span>
          <span>Pick</span>
          <span>Bytes</span>
        </div>
        <div v-for="task in analysis.tasks" :key="task.timestamp + '-' + task.regionId" class="task-row">
          <span class="mono">{{ taskTime(task) }}</span>
          <span>{{ task.regionId }} / {{ task.tableId }}</span>
          <span>{{ task.inputFileCount }} -> {{ task.outputFileCount }}</span>
          <span>{{ formatNum(task.fanOut) }}</span>
          <span>{{ formatMaybeDuration(task.mergeMillis) }}</span>
          <span>{{ formatMaybeDuration(task.pickMillis) }}</span>
          <span>{{ formatBytes(task.inputBytes) }} -> {{ formatBytes(task.outputBytes) }}</span>
        </div>
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
  min-width: 900px;
}

.task-row {
  display: grid;
  grid-template-columns: 180px 180px 90px 80px 100px 100px 1fr;
  gap: 12px;
  align-items: center;
  padding: 12px 18px;
  border-bottom: 1px solid rgba(42, 42, 74, 0.6);
  color: var(--text-secondary);
  font-size: 12px;
}

.task-row.header {
  color: var(--text);
  background: var(--bg);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
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
}
</style>
