<script lang="ts">
import { defineComponent, ref, shallowRef, computed, nextTick } from 'vue'
import FileUploader from './components/FileUploader.vue'
import Visualization from './components/Visualization.vue'
import MetricsPanel from './components/MetricsPanel.vue'
import CompactionProcessPanel from './components/CompactionProcessPanel.vue'
import { analyze, analyzeCompactionProcessTasks, type AnalysisResult, type CompactionProcessAnalysis, type CompactionProcessTask } from './parser'
import type { AliveFile } from './types'

export default defineComponent({
  name: 'App',
  components: { FileUploader, Visualization, MetricsPanel, CompactionProcessPanel },
  setup() {
    const allFiles = ref<Map<string, AliveFile>>(new Map())
    const filteredFiles = shallowRef<AliveFile[]>([])
    const regionFilter = ref('')
    const tableFilter = ref('')
    const analysisResult = shallowRef<AnalysisResult | null>(null)
    const processAnalysis = shallowRef<CompactionProcessAnalysis | null>(null)
    const allProcessTasks = shallowRef<CompactionProcessTask[]>([])
    const selectedFile = shallowRef<AliveFile | null>(null)
    const vizKey = ref(0)
    const searchQuery = ref('')
    const vizRef = ref<InstanceType<typeof Visualization> | null>(null)

    const regionIds = computed(() => {
      const regions = new Set<string>()
      for (const [, file] of allFiles.value) {
        regions.add(String(file.regionId))
      }
      return [...regions].sort()
    })

    const tableIds = computed(() => {
      const tables = new Set<string>()
      for (const [, file] of allFiles.value) {
        tables.add(String(file.tableId))
      }
      return [...tables].sort()
    })

    const processRegionIds = computed(() => {
      const regions = new Set<string>()
      for (const task of allProcessTasks.value) {
        regions.add(String(task.regionId))
      }
      return [...regions].sort()
    })

    function applyFilters() {
      const files: AliveFile[] = []
      for (const [, file] of allFiles.value) {
        if (regionFilter.value && String(file.regionId) !== regionFilter.value) continue
        if (tableFilter.value && String(file.tableId) !== tableFilter.value) continue
        files.push(file)
      }
      filteredFiles.value = files
      analysisResult.value = analyze(files)
      vizKey.value++
    }

    function applyProcessFilters() {
      const tasks = regionFilter.value
        ? allProcessTasks.value.filter(task => String(task.regionId) === regionFilter.value)
        : allProcessTasks.value
      processAnalysis.value = analyzeCompactionProcessTasks(tasks)
    }

    function handleFilesLoaded(result: { aliveFiles: AliveFile[] }) {
      console.log(`[handleFilesLoaded] Loaded ${result.aliveFiles.length} alive files from input`)
      const map = new Map<string, AliveFile>()
      for (const file of result.aliveFiles) {
        map.set(file.fileId, file)
      }
      allFiles.value = map
      processAnalysis.value = null
      allProcessTasks.value = []
      regionFilter.value = ''
      tableFilter.value = ''
      searchQuery.value = ''
      applyFilters()
    }

    function handleProcessesLoaded(result: CompactionProcessAnalysis) {
      filteredFiles.value = []
      allFiles.value = new Map()
      analysisResult.value = null
      selectedFile.value = null
      regionFilter.value = ''
      tableFilter.value = ''
      searchQuery.value = ''
      allProcessTasks.value = result.tasks
      applyProcessFilters()
    }

    function resetUpload() {
      filteredFiles.value = []
      allFiles.value = new Map()
      analysisResult.value = null
      processAnalysis.value = null
      allProcessTasks.value = []
      selectedFile.value = null
      regionFilter.value = ''
      tableFilter.value = ''
      searchQuery.value = ''
    }

    function handleRegionChange(value: string) {
      regionFilter.value = value
      if (processAnalysis.value) {
        applyProcessFilters()
      } else {
        applyFilters()
      }
    }

    function handleTableChange(value: string) {
      tableFilter.value = value
      applyFilters()
    }

    function handleFileSelected(file: AliveFile | null) {
      selectedFile.value = file
    }

    function handleSearch() {
      const q = searchQuery.value.trim()
      if (!q) { vizRef.value?.focusFile(null); return }
      const match = filteredFiles.value.find(f => f.fileId.includes(q))
      if (match) {
        vizRef.value?.focusFile(match.fileId)
        selectedFile.value = match
      }
    }

    return {
      filteredFiles,
      regionFilter,
      tableFilter,
      regionIds,
      processRegionIds,
      tableIds,
      analysisResult,
      processAnalysis,
      selectedFile,
      vizKey,
      searchQuery,
      vizRef,
      handleFilesLoaded,
      handleProcessesLoaded,
      resetUpload,
      handleRegionChange,
      handleTableChange,
      handleFileSelected,
      handleSearch,
    }
  }
})
</script>

<template>
  <div class="app">
    <header class="header">
      <div class="header-left">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="2" y="6" width="4" height="12" rx="1" fill="#4a90e2"/>
          <rect x="8" y="3" width="4" height="15" rx="1" fill="#e2844a"/>
          <rect x="14" y="8" width="4" height="10" rx="1" fill="#4a90e2"/>
          <rect x="20" y="4" width="4" height="14" rx="1" fill="#9b59b6"/>
        </svg>
        <h1>Compaction Analyzer</h1>
      </div>
      <p class="subtitle">Visualize GreptimeDB SST file lifecycle and compaction progress</p>
    </header>

    <main class="main">
      <div v-if="filteredFiles.length === 0 && !processAnalysis" class="upload-section">
        <FileUploader @files-loaded="handleFilesLoaded" @processes-loaded="handleProcessesLoaded" />
      </div>

      <div v-else-if="processAnalysis" class="analysis-section">
        <div class="toolbar">
          <div class="toolbar-left">
            <button class="back-btn" @click="resetUpload">
              &larr; Upload new input
            </button>
            <div class="file-count">
              {{ processAnalysis.totalTasks }} compaction tasks
            </div>
          </div>
          <div class="toolbar-filters">
            <div class="filter-group" v-if="processRegionIds.length > 1">
              <label>Region:</label>
              <select :value="regionFilter" @change="handleRegionChange(($event.target as HTMLSelectElement).value)">
                <option value="">All regions</option>
                <option v-for="id in processRegionIds" :key="id" :value="id">{{ id }}</option>
              </select>
            </div>
          </div>
        </div>
        <CompactionProcessPanel :analysis="processAnalysis" />
      </div>

      <div v-else class="analysis-section">
        <div class="toolbar">
          <div class="toolbar-left">
            <button class="back-btn" @click="resetUpload">
              &larr; Upload new input
            </button>
            <div class="file-count">
              {{ filteredFiles.length }} alive files
            </div>
          </div>
          <div class="toolbar-search">
            <input
              v-model="searchQuery"
              class="search-input"
              placeholder="Find file..."
              spellcheck="false"
              @keydown.enter="handleSearch"
            />
            <button class="search-btn" @click="handleSearch">Find</button>
          </div>
          <div class="toolbar-filters">
            <div class="filter-group" v-if="regionIds.length > 1">
              <label>Region:</label>
              <select :value="regionFilter" @change="handleRegionChange(($event.target as HTMLSelectElement).value)">
                <option value="">All regions</option>
                <option v-for="id in regionIds" :key="id" :value="id">{{ id }}</option>
              </select>
            </div>
            <div class="filter-group" v-if="tableIds.length > 1">
              <label>Table:</label>
              <select :value="tableFilter" @change="handleTableChange(($event.target as HTMLSelectElement).value)">
                <option value="">All tables</option>
                <option v-for="id in tableIds" :key="id" :value="id">{{ id }}</option>
              </select>
            </div>
          </div>
        </div>

        <div class="content">
          <div class="viz-container">
            <Visualization ref="vizRef" :files="filteredFiles" :key="vizKey" @file-selected="handleFileSelected" />
          </div>
          <div class="metrics-container">
            <MetricsPanel :files="filteredFiles" :analysis="analysisResult" :selected-file="selectedFile" />
          </div>
        </div>
      </div>
    </main>
  </div>
</template>

<style>
:root {
  --bg: #0f0f1a;
  --bg-surface: #1a1a2e;
  --bg-hover: #2a2a3e;
  --text: #e0e0f0;
  --text-secondary: #8888aa;
  --text-muted: #555570;
  --primary: #4a90e2;
  --primary-hover: #357abd;
  --primary-bg: rgba(74, 144, 226, 0.1);
  --border: #2a2a4a;
  --error: #ef4444;
  --success: #22c55e;
  --font-mono: 'JetBrains Mono', 'Fira Code', monospace;
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
  background: var(--bg);
  color: var(--text);
  overflow: hidden;
  height: 100vh;
}

#app {
  height: 100vh;
}

.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  max-width: 90vw;
  margin: 0 auto;
}

.header {
  padding: 16px 24px;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.header h1 {
  font-size: 20px;
  font-weight: 700;
  color: var(--text);
}

.subtitle {
  color: var(--text-secondary);
  font-size: 13px;
}

.main {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.upload-section {
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding-top: 60px;
  flex: 1;
  width: max(33.333vw, 600px);
  max-width: 100%;
  margin: 0 auto;
}

.analysis-section {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 24px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-surface);
  gap: 16px;
  flex-wrap: wrap;
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: 16px;
}

.toolbar-filters {
  display: flex;
  align-items: center;
  gap: 16px;
}

.back-btn {
  padding: 6px 14px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text-secondary);
  cursor: pointer;
  font-family: inherit;
  font-size: 13px;
  transition: all 0.2s;
}

.back-btn:hover {
  border-color: var(--primary);
  color: var(--text);
}

.file-count {
  color: var(--text-secondary);
  font-size: 13px;
  font-family: var(--font-mono);
}

.toolbar-search {
  display: flex;
  align-items: center;
  gap: 6px;
}

.search-input {
  padding: 4px 10px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text);
  font-family: inherit;
  font-size: 13px;
  width: 160px;
  outline: none;
}

.search-input:focus {
  border-color: var(--primary);
}

.search-btn {
  padding: 4px 12px;
  background: var(--primary);
  color: white;
  border: none;
  border-radius: 4px;
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s;
}

.search-btn:hover {
  background: var(--primary-hover);
}

.filter-group {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}

.filter-group label {
  color: var(--text-secondary);
}

.filter-group select {
  padding: 4px 8px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text);
  font-family: inherit;
  font-size: 13px;
}

.content {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.viz-container {
  flex: 1;
  overflow: hidden;
}

.metrics-container {
  width: 320px;
  border-left: 1px solid var(--border);
  overflow-y: auto;
  background: var(--bg-surface);
}

@media (max-width: 900px) {
  .content {
    flex-direction: column;
  }
  .metrics-container {
    width: 100%;
    border-left: none;
    border-top: 1px solid var(--border);
    max-height: 240px;
  }
}
</style>
