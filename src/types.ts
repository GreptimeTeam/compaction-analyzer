export interface AliveFile {
  fileId: string
  regionId: number
  tableId: number
  createdAt: number
  source: 'flush' | 'compaction' | 'list-file'
  sizeBytes: number | null
  timeRange: [number, number] | null
}

export interface PlacedFile {
  file: AliveFile
  xPx: number
  widthPx: number
}

export interface LayoutResult {
  placed: PlacedFile[]
  minTime: number
  maxTime: number
  totalWidth: number
  maxSimultaneousBytes: number
}
