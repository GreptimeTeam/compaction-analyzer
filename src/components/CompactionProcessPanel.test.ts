import { describe, expect, it } from 'vitest'
import source from './CompactionProcessPanel.vue?raw'

describe('CompactionProcessPanel table', () => {
  it('orders file count and size columns by input then output', () => {
    const inputCount = source.indexOf("setSort('input-files')")
    const inputSize = source.indexOf("setSort('input-size')")
    const outputCount = source.indexOf("setSort('output-files')")
    const outputSize = source.indexOf("setSort('output-size')")

    expect(inputCount).toBeGreaterThan(-1)
    expect(inputSize).toBeGreaterThan(inputCount)
    expect(outputCount).toBeGreaterThan(inputSize)
    expect(outputSize).toBeGreaterThan(outputCount)
  })

  it('sorts detail file lists by time range ascending by default', () => {
    expect(source).toContain("const inputFileSortKey = ref<CompactionProcessFileSortKey>('time-range')")
    expect(source).toContain("const inputFileSortDirection = ref<SortDirection>('asc')")
    expect(source).toContain("const outputFileSortKey = ref<CompactionProcessFileSortKey>('time-range')")
    expect(source).toContain("const outputFileSortDirection = ref<SortDirection>('asc')")
  })

  it('offers a visualization tab for compaction input/output relationships', () => {
    expect(source).toContain("const activeTab = ref<ProcessTab>('table')")
    expect(source).toContain("@click=\"activeTab = 'visualization'\"")
    expect(source).toContain('Compaction graph')
    expect(source).toContain('<svg')
  })

  it('renders file nodes as size-scaled circles', () => {
    expect(source).toContain('function fileNodeRadius')
    expect(source).toContain(':r="fileNodeRadius(node.file.sizeBytes)"')
    expect(source).toContain('function graphFileNodeClass')
    expect(source).toContain("role: GraphFileNode['role']")
  })

  it('links an output file to a later task when it becomes an input', () => {
    expect(source).toContain('const lineageLinks = computed')
    expect(source).toContain('latestOutputByFileId')
    expect(source).toContain('function lineagePath')
    expect(source).toContain('graph-lineage-link')
    expect(source).toContain('Continued input')
  })

  it('lays all tasks into one correlated left-to-right flow', () => {
    expect(source).toContain('const graphLayout = computed')
    expect(source).toContain('fileNodeById')
    expect(source).toContain('taskNodes')
    expect(source).toContain('graphLinks')
    expect(source).toContain('function graphLinkPath')
    expect(source).toContain('v-for="link in graphLayout.graphLinks"')
    expect(source).toContain('v-for="node in graphLayout.fileNodes"')
  })
})
