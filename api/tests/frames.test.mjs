import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const F = require(resolve(__dirname, '..', 'frames.js'))

describe('TPFrames natural sort + naming', () => {
  it('extracts frame indices from common patterns', () => {
    assert.equal(F.extractFrameIndex('frame_0001.png'), 1)
    assert.equal(F.extractFrameIndex('render-12.tif'), 12)
    assert.equal(F.extractFrameIndex('shot.0042.jpeg'), 42)
    assert.equal(F.extractFrameIndex('nope.png'), null)
  })

  it('naturalFrameSort orders numerically not lexicographically', () => {
    const names = ['frame_10.png', 'frame_2.png', 'frame_1.png']
    const sorted = names.slice().sort(F.naturalFrameSort)
    assert.deepEqual(sorted, ['frame_1.png', 'frame_2.png', 'frame_10.png'])
  })

  it('frameFileName pads and normalizes extensions', () => {
    assert.equal(F.frameFileName('clip', 7, 'png', 4), 'clip_0007.png')
    assert.equal(F.frameFileName('clip', 7, 'jpg', 4), 'clip_0007.jpeg')
    assert.equal(F.frameFileName('clip', 7, 'tif', 3), 'clip_007.tiff')
  })

  it('mapSequenceToTimeline prefers full-clip alignment', () => {
    assert.deepEqual(F.mapSequenceToTimeline(100, 100, 10), { start: 0, count: 100 })
    assert.deepEqual(F.mapSequenceToTimeline(20, 100, 10), { start: 10, count: 20 })
  })

  it('encodeTiffRGB produces a valid TIFF header', () => {
    const w = 2, h = 2
    const rgba = new Uint8ClampedArray([255,0,0,255, 0,255,0,255, 0,0,255,255, 255,255,255,255])
    const tiff = F.encodeTiffRGB(w, h, rgba)
    assert.equal(tiff[0], 0x49)
    assert.equal(tiff[1], 0x49)
    assert.equal(tiff[2], 42)
    assert.ok(tiff.length > 100)
  })

  it('isImageFrameName accepts png/jpeg/tiff/webp', () => {
    assert.equal(F.isImageFrameName('a.PNG'), true)
    assert.equal(F.isImageFrameName('a.tif'), true)
    assert.equal(F.isImageFrameName('a.mp4'), false)
  })
})
