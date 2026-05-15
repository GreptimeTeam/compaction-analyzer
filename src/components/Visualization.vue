<script lang="ts">
import { defineComponent, ref, onMounted, onBeforeUnmount, type PropType, watch } from 'vue'
import { createVisualization, formatBytes, formatDuration } from '../visualization'
import type { AliveFile } from '../types'

export default defineComponent({
  name: 'Visualization',
  props: {
    files: {
      type: Array as PropType<AliveFile[]>,
      required: true,
    },
  },
  setup(props) {
    const canvasRef = ref<HTMLCanvasElement | null>(null)
    const tooltipFile = ref<AliveFile | null>(null)
    const tooltipPos = ref({ x: 0, y: 0 })
    let viz: ReturnType<typeof createVisualization> | null = null

    function initViz() {
      if (viz) {
        viz.destroy()
        viz = null
      }
      if (canvasRef.value && props.files.length > 0) {
        viz = createVisualization(canvasRef.value, props.files)
        viz.onHover((file, pos) => {
          tooltipFile.value = file
          tooltipPos.value = pos
        })
      }
    }

    onMounted(initViz)
    watch(() => props.files, initViz, { deep: false })
    onBeforeUnmount(() => { if (viz) viz.destroy() })

    function formatSource(source: string): string {
      switch (source) {
        case 'flush': return 'Flush'
        case 'compaction': return 'Compaction'
        case 'list-file': return 'List File'
        default: return source
      }
    }

    return { canvasRef, tooltipFile, tooltipPos, formatBytes, formatDuration, formatSource }
  }
})
</script>

<template>
  <div class="viz-wrapper">
    <div class="canvas-container">
      <canvas ref="canvasRef"></canvas>
    </div>

    <div class="viz-legend">
      <span class="legend-item">
        <span class="legend-swatch" style="background: #4a90e2"></span> Flush
      </span>
      <span class="legend-item">
        <span class="legend-swatch" style="background: #9b59b6"></span> Compaction
      </span>
      <span class="legend-item">
        <span class="legend-swatch" style="background: #27ae60"></span> List File
      </span>
      <span class="legend-item">
        <span class="legend-swatch" style="background: #e2844a"></span> Overlapping
      </span>
      <span class="hint">Scroll to pan &middot; Ctrl+scroll to zoom</span>
    </div>

    <div
      v-if="tooltipFile"
      class="tooltip"
      :style="{
        left: (tooltipPos.x + 16) + 'px',
        top: (tooltipPos.y - 8) + 'px',
      }"
    >
      <div class="tooltip-header">{{ tooltipFile.fileId }}</div>
      <div class="tooltip-row">
        <span class="tooltip-label">Size:</span>
        <span>{{ tooltipFile.sizeBytes != null ? formatBytes(tooltipFile.sizeBytes) : 'N/A' }}</span>
      </div>
      <div class="tooltip-row">
        <span class="tooltip-label">Time:</span>
        <span v-if="tooltipFile.timeRange">
          {{ new Date(tooltipFile.timeRange[0]).toISOString().slice(0, 19) }}Z
          &rarr;
          {{ new Date(tooltipFile.timeRange[1]).toISOString().slice(0, 19) }}Z
        </span>
        <span v-else>N/A</span>
      </div>
      <div v-if="tooltipFile.timeRange" class="tooltip-row">
        <span class="tooltip-label">Duration:</span>
        <span>{{ formatDuration(tooltipFile.timeRange[1] - tooltipFile.timeRange[0]) }}</span>
      </div>
      <div class="tooltip-row">
        <span class="tooltip-label">Source:</span>
        <span>{{ formatSource(tooltipFile.source) }}</span>
      </div>
      <div class="tooltip-row">
        <span class="tooltip-label">Region/Table:</span>
        <span>{{ tooltipFile.regionId }} / {{ tooltipFile.tableId }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.viz-wrapper {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.canvas-container {
  flex: 1;
  overflow: hidden;
}

canvas {
  display: block;
  width: 100%;
  height: 100%;
}

.viz-legend {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 8px 16px;
  border-top: 1px solid var(--border);
  background: var(--bg-surface);
  font-size: 12px;
  flex-wrap: wrap;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--text-secondary);
}

.legend-swatch {
  width: 12px;
  height: 12px;
  border-radius: 2px;
  display: inline-block;
}

.hint {
  color: var(--text-muted);
  margin-left: auto;
  font-size: 11px;
}

.tooltip {
  position: fixed;
  z-index: 1000;
  background: #1e1e36;
  border: 1px solid #3a3a5a;
  border-radius: 8px;
  padding: 12px 16px;
  pointer-events: none;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
  max-width: 420px;
  backdrop-filter: blur(8px);
}

.tooltip-header {
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
  margin-bottom: 8px;
  word-break: break-all;
}

.tooltip-row {
  display: flex;
  gap: 8px;
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.6;
}

.tooltip-label {
  color: var(--text-muted);
  min-width: 70px;
  flex-shrink: 0;
}
</style>
