/* ============================================================================
 * Open AutoPose — numbered frame sequence utilities (shared Node/browser)
 * ----------------------------------------------------------------------------
 * Pure helpers: natural sort, frame index extraction, filename patterns,
 * zero-dependency uncompressed RGB TIFF encoder (for offline browser export).
 * ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TPFrames = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var FRAME_RE = /(?:^|[^0-9])(\d{1,8})(?=\.(?:png|jpe?g|jfif|tiff?|webp|bmp)$)/i;

  function pad(n, width) {
    var s = String(n | 0);
    var w = Math.max(1, width | 0);
    while (s.length < w) s = '0' + s;
    return s;
  }

  /** Extract trailing frame number before extension; null if none. */
  function extractFrameIndex(name) {
    if (!name) return null;
    var base = String(name).split(/[/\\]/).pop();
    var m = base.match(FRAME_RE);
    if (!m) return null;
    return parseInt(m[1], 10);
  }

  /** Natural / numeric sort for frame file names. */
  function naturalFrameSort(a, b) {
    var na = typeof a === 'string' ? a : (a && a.name) || '';
    var nb = typeof b === 'string' ? b : (b && b.name) || '';
    var ia = extractFrameIndex(na), ib = extractFrameIndex(nb);
    if (ia != null && ib != null && ia !== ib) return ia - ib;
    return na.localeCompare(nb, undefined, { numeric: true, sensitivity: 'base' });
  }

  /**
   * Build zero-based mapping: sorted entries → timeline start index.
   * If count matches totalFrames, maps from 0; else maps from inFrame.
   */
  function mapSequenceToTimeline(entryCount, totalFrames, inFrame) {
    var start = 0;
    if (entryCount === totalFrames) start = 0;
    else start = Math.max(0, inFrame | 0);
    var count = Math.min(entryCount, Math.max(0, totalFrames - start));
    return { start: start, count: count };
  }

  function frameFileName(stem, index, ext, padWidth) {
    var e = String(ext || 'png').replace(/^\./, '').toLowerCase();
    if (e === 'jpg') e = 'jpeg';
    if (e === 'tif') e = 'tiff';
    return String(stem || 'frame') + '_' + pad(index, padWidth == null ? 4 : padWidth) + '.' + e;
  }

  function isImageFrameName(name) {
    return /\.(png|jpe?g|jfif|tiff?|webp|bmp)$/i.test(name || '');
  }

  /** Encode RGB/RGBA ImageData-like buffer as uncompressed TIFF (little-endian). */
  function encodeTiffRGB(width, height, rgba) {
    var w = width | 0, h = height | 0, samples = 3;
    var stripBytes = w * h * samples;
    var rgb = new Uint8Array(stripBytes);
    for (var i = 0, j = 0; i < w * h; i++, j += 4) {
      var o = i * 3;
      rgb[o] = rgba[j]; rgb[o + 1] = rgba[j + 1]; rgb[o + 2] = rgba[j + 2];
    }
    var ifdCount = 9;
    var ifdSize = 2 + ifdCount * 12 + 4;
    var ifdOffset = 8;
    var bitsPerSampleOffset = ifdOffset + ifdSize;
    var stripOffset = bitsPerSampleOffset + 6;
    var buf = new ArrayBuffer(stripOffset + stripBytes);
    var view = new DataView(buf), u8 = new Uint8Array(buf);
    view.setUint16(0, 0x4949, true); view.setUint16(2, 42, true); view.setUint32(4, ifdOffset, true);
    view.setUint16(ifdOffset, ifdCount, true);
    function e(idx, tag, type, count, value) {
      var p = ifdOffset + 2 + idx * 12;
      view.setUint16(p, tag, true); view.setUint16(p + 2, type, true);
      view.setUint32(p + 4, count, true); view.setUint32(p + 8, value, true);
    }
    e(0,256,4,1,w); e(1,257,4,1,h); e(2,258,3,3,bitsPerSampleOffset);
    e(3,259,3,1,1); e(4,262,3,1,2); e(5,273,4,1,stripOffset);
    e(6,277,3,1,samples); e(7,278,4,1,h); e(8,279,4,1,stripBytes);
    view.setUint32(ifdOffset + 2 + ifdCount * 12, 0, true);
    view.setUint16(bitsPerSampleOffset,8,true); view.setUint16(bitsPerSampleOffset+2,8,true); view.setUint16(bitsPerSampleOffset+4,8,true);
    u8.set(rgb, stripOffset);
    return u8;
  }

  /** Infer pad width from max index or entry names. */
  function inferPadWidth(namesOrCount) {
    if (typeof namesOrCount === 'number') {
      return Math.max(4, String(Math.max(0, namesOrCount | 0)).length);
    }
    var maxDigits = 4;
    (namesOrCount || []).forEach(function (n) {
      var base = String(n).split(/[/\\]/).pop();
      var m = base.match(FRAME_RE);
      if (m) maxDigits = Math.max(maxDigits, m[1].length);
    });
    return maxDigits;
  }

  return {
    pad: pad,
    extractFrameIndex: extractFrameIndex,
    naturalFrameSort: naturalFrameSort,
    mapSequenceToTimeline: mapSequenceToTimeline,
    frameFileName: frameFileName,
    isImageFrameName: isImageFrameName,
    encodeTiffRGB: encodeTiffRGB,
    inferPadWidth: inferPadWidth,
    FRAME_RE: FRAME_RE,
  };
});
