<script lang="ts">
import { defineComponent, ref } from 'vue'
import { parseAliveFileListCsv, parseLogCsv, type InputMode } from '../parser'

export default defineComponent({
  name: 'FileUploader',
  emits: ['files-loaded'],
  setup(_props, { emit }) {
    const inputMode = ref<InputMode>('alive-file-list')
    const inputMethod = ref<'upload' | 'paste'>('upload')
    const dragover = ref(false)
    const error = ref<string | null>(null)
    const fileName = ref<string | null>(null)
    const loading = ref(false)
    const pastedText = ref('')
    let fileContent: string | null = null

    const inputModes = [
      { value: 'alive-file-list' as const, label: 'Alive file list', desc: 'Export from GreptimeDB: region_id, file_id, file_size, min_ts, max_ts, visible...' },
      { value: 'compaction-log' as const, label: 'Compaction log', desc: 'Raw log lines from mito2::compaction::task and mito2::flush' },
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

    function processFile() {
      const content = inputMethod.value === 'paste' ? pastedText.value : fileContent
      if (!content) return
      loading.value = true
      error.value = null
      try {
        let result
        if (inputMode.value === 'alive-file-list') {
          result = parseAliveFileListCsv(content)
        } else {
          result = parseLogCsv(content)
        }
        if (result.aliveFiles.length === 0) {
          error.value = 'No alive files found in the input.'
        } else {
          emit('files-loaded', result)
        }
      } catch (e: any) {
        error.value = e.message || 'Failed to parse input.'
      } finally {
        loading.value = false
      }
    }

    return { inputMode, inputMethod, dragover, error, fileName, loading, pastedText, inputModes, handleDrop, handleFileInput, processFile }
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
        <span class="toggle-icon">{{ mode.value === 'alive-file-list' ? '&#9638;' : '&#9654;' }}</span>
        {{ mode.label }}
      </button>
    </div>

    <p class="mode-desc">
      {{ inputModes.find(m => m.value === inputMode)?.desc }}
    </p>

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
        placeholder="Paste raw CSV or log content here..."
        spellcheck="false"
      ></textarea>
    </div>

    <p v-if="error" class="error-text">{{ error }}</p>

    <button
      class="analyze-btn"
      :disabled="(inputMethod === 'upload' ? !fileName : !pastedText.trim()) || loading"
      @click="processFile"
    >
      {{ loading ? 'Parsing...' : 'Analyze' }}
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

.analyze-btn:hover:not(:disabled) {
  background: var(--primary-hover);
}

.analyze-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
