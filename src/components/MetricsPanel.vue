<script lang="ts">
import { defineComponent, ref, type PropType } from 'vue'
import { formatBytes, formatDuration } from '../visualization'
import type { AnalysisResult } from '../parser'
import type { AliveFile } from '../types'

export default defineComponent({
  name: 'MetricsPanel',
  props: {
    files: {
      type: Array as PropType<AliveFile[]>,
      required: true,
    },
    analysis: {
      type: Object as PropType<AnalysisResult | null>,
      default: null,
    },
    selectedFile: {
      type: Object as PropType<AliveFile | null>,
      default: null,
    },
  },
  emits: ['update:selectedFile'],
  setup(props, { emit }) {
    const copied = ref(false)

    function formatNum(n: number): string {
      return n.toLocaleString()
    }

    function formatRatio(n: number): string {
      return n.toFixed(4)
    }

    function sourceLabel(source: string): string {
      switch (source) {
        case 'flush': return 'Flush'
        case 'compaction': return 'Compaction'
        case 'list-file': return 'List File'
        default: return source
      }
    }

    function maxBarCount(distribution: Array<{ count: number }>): number {
      return Math.max(1, ...distribution.map(d => d.count))
    }

    function handleCopyFileId() {
      if (!props.selectedFile) return
      const text = props.selectedFile.fileId
      if (navigator.clipboard) {
        navigator.clipboard.writeText(text).then(() => {
          copied.value = true
          setTimeout(() => { copied.value = false }, 2000)
        })
      } else {
        const ta = document.createElement('textarea')
        ta.value = text
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
        copied.value = true
        setTimeout(() => { copied.value = false }, 2000)
      }
    }

    function clearSelected() {
      emit('update:selectedFile', null)
    }

    return { formatBytes, formatDuration, formatNum, formatRatio, sourceLabel, maxBarCount, copied, handleCopyFileId, clearSelected }
  }
})
</script>

<template>
  <div class="metrics-panel" v-if="analysis">
    <h3 class="panel-title">Alive File Metrics</h3>

    <div class="metric-grid">
      <div class="metric-card">
        <div class="metric-value">{{ formatNum(analysis.totalFiles) }}</div>
        <div class="metric-label">Total files</div>
      </div>
      <div class="metric-card">
        <div class="metric-value">{{ formatBytes(analysis.totalSizeBytes) }}</div>
        <div class="metric-label">Total size</div>
      </div>
      <div class="metric-card">
        <div class="metric-value">{{ formatNum(analysis.overlappingFiles) }}</div>
        <div class="metric-label">Overlapping</div>
      </div>
      <div class="metric-card">
        <div class="metric-value">{{ formatNum(analysis.maxOverlapDepth) }}</div>
        <div class="metric-label">Max depth</div>
      </div>
      <div class="metric-card">
        <div class="metric-value">{{ formatRatio(analysis.avgOverlapDepth) }}</div>
        <div class="metric-label">Avg depth</div>
      </div>
      <div class="metric-card">
        <div class="metric-value">{{ formatRatio(analysis.sizeCv) }}</div>
        <div class="metric-label">Size CV</div>
      </div>
    </div>

    <div class="section" v-if="Object.keys(analysis.sourceBreakdown).length > 0">
      <h4 class="section-title">Source Breakdown</h4>
      <div class="source-list">
        <div
          v-for="(count, source) in analysis.sourceBreakdown"
          :key="source"
          class="source-item"
        >
          <span class="source-name">{{ sourceLabel(String(source)) }}</span>
          <span class="source-bar-wrap">
            <span
              class="source-bar"
              :style="{ width: (count / analysis.totalFiles * 100) + '%' }"
            ></span>
          </span>
          <span class="source-count">{{ count }}</span>
        </div>
      </div>
    </div>

    <div class="section" v-if="analysis.sizeDistribution.length > 0">
      <h4 class="section-title">Size Distribution</h4>
      <div class="size-dist">
        <div
          v-for="bucket in analysis.sizeDistribution"
          :key="bucket.label"
          class="size-row"
        >
          <span class="size-label">{{ bucket.label }}</span>
          <span class="size-bar-wrap">
            <span
              class="size-bar"
              :style="{ width: (bucket.count / maxBarCount(analysis.sizeDistribution) * 100) + '%' }"
            ></span>
          </span>
          <span class="size-count">{{ bucket.count }}</span>
        </div>
      </div>
    </div>

    <div v-if="selectedFile" class="section file-detail">
      <div class="file-detail-header">
        <h4 class="section-title">Selected File</h4>
        <button class="detail-close" @click="clearSelected">&times;</button>
      </div>
      <div class="file-id-row">
        <span class="file-id-text">{{ selectedFile.fileId }}</span>
        <button class="copy-btn" @click="handleCopyFileId">{{ copied ? 'Copied!' : 'Copy' }}</button>
      </div>
      <div class="detail-row">
        <span class="detail-label">Size</span>
        <span class="detail-value">{{ selectedFile.sizeBytes != null ? formatBytes(selectedFile.sizeBytes) : 'N/A' }}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Source</span>
        <span class="detail-value">{{ sourceLabel(selectedFile.source) }}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Region</span>
        <span class="detail-value">{{ selectedFile.regionId }}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Table</span>
        <span class="detail-value">{{ selectedFile.tableId }}</span>
      </div>
      <div v-if="selectedFile.timeRange" class="detail-row">
        <span class="detail-label">Start</span>
        <span class="detail-value detail-mono">{{ new Date(selectedFile.timeRange[0]).toISOString().slice(0, 19) }}Z</span>
      </div>
      <div v-if="selectedFile.timeRange" class="detail-row">
        <span class="detail-label">End</span>
        <span class="detail-value detail-mono">{{ new Date(selectedFile.timeRange[1]).toISOString().slice(0, 19) }}Z</span>
      </div>
      <div v-if="selectedFile.timeRange" class="detail-row">
        <span class="detail-label">Duration</span>
        <span class="detail-value">{{ formatDuration(selectedFile.timeRange[1] - selectedFile.timeRange[0]) }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.metrics-panel {
  padding: 20px;
  font-size: 13px;
}

.panel-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--text);
  margin-bottom: 16px;
}

.metric-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-bottom: 24px;
}

.metric-card {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px;
  text-align: center;
}

.metric-value {
  font-size: 18px;
  font-weight: 700;
  color: var(--primary);
  font-family: var(--font-mono);
}

.metric-label {
  font-size: 11px;
  color: var(--text-muted);
  margin-top: 4px;
}

.section {
  margin-bottom: 20px;
}

.section-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 10px;
}

.source-list, .size-dist {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.source-item, .size-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.source-name, .size-label {
  width: 80px;
  flex-shrink: 0;
  color: var(--text-secondary);
  font-size: 12px;
  text-align: right;
}

.source-bar-wrap, .size-bar-wrap {
  flex: 1;
  height: 16px;
  background: var(--bg);
  border-radius: 3px;
  overflow: hidden;
}

.source-bar {
  display: block;
  height: 100%;
  background: var(--primary);
  border-radius: 3px;
  transition: width 0.3s;
}

.size-bar {
  display: block;
  height: 100%;
  background: #9b59b6;
  border-radius: 3px;
  transition: width 0.3s;
}

.source-count, .size-count {
  width: 32px;
  text-align: right;
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 12px;
}

.file-detail {
  border-top: 1px solid var(--border);
  padding-top: 16px;
  margin-top: 4px;
}

.file-detail-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.file-detail-header .section-title {
  margin-bottom: 0;
}

.detail-close {
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: 18px;
  cursor: pointer;
  padding: 0 4px;
  line-height: 1;
}

.detail-close:hover {
  color: var(--text);
}

.file-id-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.file-id-text {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text);
  word-break: break-all;
  flex: 1;
  min-width: 0;
}

.copy-btn {
  flex-shrink: 0;
  padding: 2px 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg);
  color: var(--text-secondary);
  font-size: 11px;
  cursor: pointer;
  transition: all 0.2s;
}

.copy-btn:hover {
  border-color: var(--primary);
  color: var(--primary);
}

.detail-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding: 4px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
}

.detail-label {
  font-size: 11px;
  color: var(--text-muted);
  flex-shrink: 0;
}

.detail-value {
  font-size: 12px;
  color: var(--text-secondary);
  text-align: right;
}

.detail-mono {
  font-family: var(--font-mono);
  font-size: 11px;
}
</style>
