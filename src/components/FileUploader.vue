<script lang="ts">
import { defineComponent, ref } from 'vue'
import { parseInputInWorker } from '../parser-worker-client'
import type { InputMode } from '../parser'

export default defineComponent({
  name: 'FileUploader',
  emits: ['files-loaded', 'processes-loaded'],
  setup(_props, { emit }) {
    const inputMode = ref<InputMode>('alive-file-list')
    const inputMethod = ref<'upload' | 'paste'>('upload')
    const dragover = ref(false)
    const error = ref<string | null>(null)
    const fileName = ref<string | null>(null)
    const loading = ref(false)
    const parseProgress = ref(0)
    const pastedText = ref('')
    let fileContent: string | null = null

    const inputModes = [
      { value: 'alive-file-list' as const, label: 'Alive file list', desc: 'CSV export or MySQL table output from GreptimeDB (auto-detected)' },
      { value: 'compaction-log' as const, label: 'File lifecycle log', desc: 'Raw log lines from mito2::compaction::task and mito2::flush, visualized as alive SST files' },
      { value: 'compaction-process' as const, label: 'Compaction process', desc: 'Raw compaction logs summarized by task, pick time, merge time, and fan-out' },
    ]

    function parseFile(content: string, name: string) {
      error.value = null
      fileName.value = name
      fileContent = content
    }

    function handleDrop(e: DragEvent) {
      dragover.value = false
      const file = e.dataTransfer?.files?.[0]
      if (file) readFile(file)
    }

    function handleFileInput(e: Event) {
      const input = e.target as HTMLInputElement
      const file = input.files?.[0]
      if (file) readFile(file)
      input.value = ''
    }

    function readFile(file: File) {
      const reader = new FileReader()
      reader.onload = (e) => {
        const content = e.target?.result as string
        if (content) parseFile(content, file.name)
      }
      reader.readAsText(file)
    }

    async function processFile() {
      const content = inputMethod.value === 'paste' ? pastedText.value : fileContent
      if (!content) return
      loading.value = true
      parseProgress.value = 0
      error.value = null
      try {
        const result = await parseInputInWorker({
          mode: inputMode.value,
          content,
          onProgress: (progress) => { parseProgress.value = progress },
        })
        parseProgress.value = 100
        if (result.kind === 'files') {
          if (result.result.aliveFiles.length === 0) {
            error.value = 'No alive files found in the input.'
          } else {
            emit('files-loaded', result.result)
          }
        }
        if (result.kind === 'processes') {
          if (result.result.totalTasks === 0) {
            error.value = 'No compaction process tasks found in the input.'
          } else {
            emit('processes-loaded', result.result)
          }
        }
      } catch (e: any) {
        error.value = e.message || 'Failed to parse input.'
      } finally {
        loading.value = false
      }
    }

    return { inputMode, inputMethod, dragover, error, fileName, loading, parseProgress, pastedText, inputModes, handleDrop, handleFileInput, processFile }
  }
})
</script>

<template>
  <div class="file-uploader">
    <div class="input-mode-toggle">
      <button
        v-for="mode in inputModes"
        :key="mode.value"
        :class="['toggle-btn', { active: inputMode === mode.value }]"
        @click="inputMode = mode.value"
      >
        <span class="toggle-icon">{{ mode.value === 'alive-file-list' ? '&#9638;' : mode.value === 'compaction-log' ? '&#9654;' : '&#8987;' }}</span>
        {{ mode.label }}
      </button>
    </div>

    <p class="mode-desc">
      {{ inputModes.find(m => m.value === inputMode)?.desc }}
    </p>

    <section class="format-guide" aria-label="Accepted file formats">
      <div class="format-guide-header">
        <span class="format-kicker">Accepted file formats</span>
        <span class="format-note">Log modes accept plain text or JSON-lines</span>
      </div>
      <div class="format-examples">
        <div class="format-card">
          <div class="format-title">Plain log line</div>
          <code>2026-06-04T18:16:13.833807Z INFO mito2::compaction::task: Compacted SST files, region_id: 4866197946368(1133, 0), input: [...], output: [...], merge_time: 4.028s</code>
        </div>
        <div class="format-card">
          <div class="format-title">JSON log line</div>
          <code>{&quot;timestamp&quot;:&quot;2026-06-04T18:16:13.833807Z&quot;,&quot;level&quot;:&quot;INFO&quot;,&quot;fields&quot;:{&quot;message&quot;:&quot;Compacted SST files, region_id: 4866197946368(1133, 0), input: [...], output: [...]&quot;},&quot;target&quot;:&quot;mito2::compaction::task&quot;}</code>
          <span class="format-hint">The parser reads the log body from <code>fields.message</code>.</span>
        </div>
      </div>
    </section>

    <div class="input-method-toggle">
      <button
        :class="['method-btn', { active: inputMethod === 'upload' }]"
        @click="inputMethod = 'upload'"
      >Upload file</button>
      <button
        :class="['method-btn', { active: inputMethod === 'paste' }]"
        @click="inputMethod = 'paste'"
      >Paste text</button>
    </div>

    <div v-if="inputMethod === 'upload'">
      <div
        :class="['drop-zone', { dragover }]"
        @dragover.prevent="dragover = true"
        @dragleave="dragover = false"
        @drop.prevent="handleDrop"
      >
        <div class="drop-icon">&#128196;</div>
        <p>Drag &amp; drop your CSV or log file here</p>
        <p class="drop-subtitle">or</p>
        <label class="file-btn">
          Browse files
          <input type="file" accept=".csv,.log,.txt" @change="handleFileInput" />
        </label>
      </div>

      <div v-if="fileName" class="file-info">
        <span class="file-label">Selected:</span>
        <span class="file-name">{{ fileName }}</span>
      </div>
    </div>

    <div v-else>
      <textarea
        v-model="pastedText"
        class="paste-area"
        :placeholder="inputMode === 'alive-file-list' ? 'Paste raw CSV or MySQL table output here...' : 'Paste raw compaction log content here...'"
        spellcheck="false"
      ></textarea>
    </div>

    <p v-if="error" class="error-text">{{ error }}</p>

    <button
      class="analyze-btn"
      :disabled="(inputMethod === 'upload' ? !fileName : !pastedText.trim()) || loading"
      :aria-valuenow="loading ? parseProgress : undefined"
      aria-valuemin="0"
      aria-valuemax="100"
      @click="processFile"
      :role="loading ? 'progressbar' : undefined"
    >
      <span v-if="loading" class="analyze-progress-fill" :style="{ width: `${parseProgress}%` }"></span>
      <span class="analyze-btn-label">{{ loading ? `Parsing ${parseProgress}%` : 'Analyze' }}</span>
    </button>
  </div>
</template>

<style scoped>
.file-uploader {
  padding: 32px;
}

.input-mode-toggle {
  display: flex;
  gap: 0;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--border);
  margin-bottom: 16px;
}

.toggle-btn {
  flex: 1;
  padding: 10px 16px;
  border: none;
  background: var(--bg);
  color: var(--text-secondary);
  cursor: pointer;
  font-family: inherit;
  font-size: 14px;
  font-weight: 500;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  gap: 8px;
  justify-content: center;
}

.toggle-btn:not(:last-child) {
  border-right: 1px solid var(--border);
}

.toggle-btn:hover {
  background: var(--bg-hover);
}

.toggle-btn.active {
  background: var(--primary);
  color: white;
}

.mode-desc {
  color: var(--text-secondary);
  font-size: 13px;
  margin-bottom: 16px;
}

.format-guide {
  border: 1px solid var(--border);
  border-radius: 12px;
  background: linear-gradient(135deg, var(--bg) 0%, var(--bg-hover) 100%);
  padding: 14px;
  margin-bottom: 16px;
}

.format-guide-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}

.format-kicker {
  color: var(--text);
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.02em;
}

.format-note {
  color: var(--text-muted);
  font-size: 12px;
}

.format-examples {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.format-card {
  min-width: 0;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel-bg);
}

.format-title {
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 600;
  margin-bottom: 6px;
}

.format-card code {
  display: block;
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.45;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.format-hint {
  display: block;
  color: var(--text-muted);
  font-size: 11px;
  margin-top: 8px;
}

.format-hint code {
  display: inline;
  color: var(--primary);
  white-space: normal;
}

.input-method-toggle {
  display: flex;
  gap: 0;
  border-radius: 6px;
  overflow: hidden;
  border: 1px solid var(--border);
  margin-bottom: 16px;
}

.method-btn {
  flex: 1;
  padding: 6px 12px;
  border: none;
  background: var(--bg);
  color: var(--text-secondary);
  cursor: pointer;
  font-family: inherit;
  font-size: 13px;
  font-weight: 500;
  transition: all 0.2s;
}

.method-btn:not(:last-child) {
  border-right: 1px solid var(--border);
}

.method-btn:hover {
  background: var(--bg-hover);
}

.method-btn.active {
  background: var(--primary);
  color: white;
}

.paste-area {
  width: 100%;
  min-height: 200px;
  padding: 12px;
  border: 2px dashed var(--border);
  border-radius: 12px;
  background: var(--bg);
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.5;
  resize: vertical;
  outline: none;
  transition: border-color 0.2s;
  box-sizing: border-box;
}

.paste-area:focus {
  border-color: var(--primary);
}

.paste-area::placeholder {
  color: var(--text-muted);
}

.drop-zone {
  border: 2px dashed var(--border);
  border-radius: 12px;
  padding: 48px 24px;
  text-align: center;
  transition: all 0.2s;
  margin-bottom: 16px;
}

.drop-zone.dragover {
  border-color: var(--primary);
  background: var(--primary-bg);
}

.drop-icon {
  font-size: 48px;
  margin-bottom: 12px;
}

.drop-subtitle {
  color: var(--text-muted);
  font-size: 12px;
  margin: 8px 0;
}

.file-btn {
  display: inline-block;
  padding: 8px 20px;
  background: var(--primary);
  color: white;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 500;
  font-size: 13px;
  transition: background 0.2s;
}

.file-btn:hover {
  background: var(--primary-hover);
}

.file-btn input {
  display: none;
}

.file-info {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--bg);
  border-radius: 6px;
  font-size: 13px;
  margin-bottom: 16px;
}

.file-label {
  color: var(--text-secondary);
}

.file-name {
  color: var(--text);
  font-weight: 500;
  font-family: var(--font-mono);
}

.error-text {
  color: var(--error);
  font-size: 13px;
  margin-bottom: 16px;
}

.analyze-btn {
  position: relative;
  overflow: hidden;
  width: 100%;
  padding: 12px;
  background: var(--primary);
  color: white;
  border: none;
  border-radius: 8px;
  font-family: inherit;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}

.analyze-progress-fill {
  position: absolute;
  inset: 0 auto 0 0;
  background: linear-gradient(90deg, var(--primary-hover), #60a5fa);
  transition: width 0.2s ease;
}

.analyze-btn-label {
  position: relative;
  z-index: 1;
}

.analyze-btn:hover:not(:disabled) {
  background: var(--primary-hover);
}

.analyze-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

@media (max-width: 720px) {
  .format-guide-header,
  .format-examples {
    display: block;
  }

  .format-note {
    display: block;
    margin-top: 4px;
  }

  .format-card:not(:last-child) {
    margin-bottom: 10px;
  }
}
</style>
