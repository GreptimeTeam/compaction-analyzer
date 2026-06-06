import { describe, expect, it } from 'vitest'
import source from './App.vue?raw'

describe('App upload layout', () => {
  it('sizes the uploader area to one third of the viewport with a 600px minimum', () => {
    expect(source).toContain('width: max(33.333vw, 600px)')
  })
})
