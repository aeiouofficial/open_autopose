// =============================================================================
// Open AutoPose — FFmpeg-backed frame / media I/O (CLI & gateway)
// -----------------------------------------------------------------------------
// Uses system `ffmpeg` / `ffprobe` for formats the browser cannot emit natively
// (ProRes, MKV, high-quality TIFF sequences on disk, audio-less rewrap, etc.).
// Zero npm deps. Requires ffmpeg on PATH (or TP_FFMPEG / TP_FFPROBE env).
// =============================================================================

import { spawn } from 'node:child_process'
import { mkdir, readdir, stat, writeFile, readFile, mkdtemp, rm } from 'node:fs/promises'
import { join, basename, extname, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'

const require = createRequire(import.meta.url)
// frames.js is CJS/UMD next to this file when packaged under api/
let TPFrames
try {
  TPFrames = require('./frames.js')
} catch {
  TPFrames = require('../frames.js')
}

const FFMPEG = process.env.TP_FFMPEG || 'ffmpeg'
const FFPROBE = process.env.TP_FFPROBE || 'ffprobe'

function run(cmd, args, opts = {}) {
  return new Promise((resolveP, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts })
    let out = '', err = ''
    p.stdout.on('data', (d) => { out += d })
    p.stderr.on('data', (d) => { err += d })
    p.on('error', reject)
    p.on('close', (code) => {
      if (code === 0) resolveP({ out, err, code })
      else reject(new Error(`${cmd} exited ${code}: ${err.slice(-800)}`))
    })
  })
}

export async function hasFfmpeg() {
  try {
    await run(FFMPEG, ['-version'])
    return true
  } catch {
    return false
  }
}

export async function probe(input) {
  const { out } = await run(FFPROBE, [
    '-v', 'error',
    '-print_format', 'json',
    '-show_format', '-show_streams',
    resolve(input),
  ])
  return JSON.parse(out)
}

/**
 * Export a video (or image sequence pattern) to a numbered image sequence.
 * @param  input: string, outDir: string, format?: 'png'|'jpeg'|'tiff', fps?: number|null, startNumber?: number, pad?: number, stem?: string 
 */
export async function exportImageSequence(opts) {
  const input = resolve(opts.input)
  const outDir = resolve(opts.outDir)
  // Normalize carefully: bare 'tif'/'jpg' expand, but do not re-expand 'tiff'/'jpeg'
  let fmt = String(opts.format || 'png').toLowerCase()
  if (fmt === 'jpg') fmt = 'jpeg'
  if (fmt === 'tif') fmt = 'tiff'
  const stem = opts.stem || 'frame'
  const pad = opts.pad || 4
  const startNumber = opts.startNumber != null ? opts.startNumber : 1
  await mkdir(outDir, { recursive: true })
  const fileExt = fmt === 'jpeg' ? 'jpg' : fmt === 'tiff' ? 'tif' : fmt
  const pattern = join(outDir, `${stem}_%0${pad}d.${fileExt}`)

  const args = ['-y', '-hide_banner', '-loglevel', 'error']
  if (opts.fps) args.push('-r', String(opts.fps))
  args.push('-i', input)
  if (fmt === 'jpeg') args.push('-q:v', String(opts.jpegQuality != null ? opts.jpegQuality : 2))
  if (fmt === 'tiff') args.push('-compression_algo', 'deflate')
  args.push('-start_number', String(startNumber), pattern)
  await run(FFMPEG, args)
  const files = (await readdir(outDir))
    .filter((f) => TPFrames.isImageFrameName(f))
    .sort(TPFrames.naturalFrameSort)
  return { outDir, format: fmt, files, pattern, count: files.length }
}

/**
 * Build a video from a numbered image sequence directory or glob pattern.
 * @param  inputPattern: string, output: string, fps?: number, format?: string 
 * inputPattern e.g. /path/frame_%04d.png or /path (auto-detect)
 */
/** Detect stem/pad/start/ext from sorted frame filenames like shot_0001.png */
function detectSequencePattern(files) {
	const first = files[0]
	const ext = extname(first).slice(1)
	const m = String(first).match(/^(.*?)[_-]?(\d+)\.([A-Za-z0-9]+)$/)
	if (!m) return null
	const stem = m[1].replace(/[_-]$/, '') || 'frame'
	const start = parseInt(m[2], 10)
	const pad = Math.max(m[2].length, TPFrames.inferPadWidth(files))
	// Ensure all files share stem + sequential numeric pattern
	const re = new RegExp('^' + stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[_-]?(\d+)\.' + ext + '$', 'i')
	const ok = files.every((f) => re.test(f))
	if (!ok) return null
	return { stem, start, pad, ext }
}

export async function sequenceToVideo(opts) {
	const input = resolve(opts.inputPattern)
	const fps = opts.fps || 24
	const output = resolve(opts.output)
	const st = await stat(input).catch(() => null)

	if (st && st.isDirectory()) {
		const dir = input
		const files = (await readdir(dir))
			.filter((f) => TPFrames.isImageFrameName(f) && !f.startsWith('._'))
			.sort(TPFrames.naturalFrameSort)
		if (!files.length) throw new Error('No image frames in directory: ' + dir)

		const det = detectSequencePattern(files)
		if (det) {
			const pattern = join(dir, `${det.stem}_%0${det.pad}d.${det.ext}`)
			// Also try stem-%0Nd if underscore pattern missing on disk — probe first file name sep
			const sep = files[0].includes(det.stem + '_') ? '_' : files[0].includes(det.stem + '-') ? '-' : '_'
			const pattern2 = join(dir, `${det.stem}${sep}%0${det.pad}d.${det.ext}`)
			const tryPatterns = [pattern2, pattern]
			let lastErr = null
			for (const p of tryPatterns) {
				try {
					await run(FFMPEG, [
						'-y', '-hide_banner', '-loglevel', 'error',
						'-framerate', String(fps),
						'-start_number', String(det.start),
						'-i', p,
						'-c:v', 'libx264', '-pix_fmt', 'yuv420p',
						output,
					])
					return { output, count: files.length, pattern: p }
				} catch (e) { lastErr = e }
			}
			// glob fallback
			try {
				const glob = join(dir, `${det.stem}*${det.ext.startsWith('.') ? det.ext : '.' + det.ext}`.replace(/\.\./g, '.'))
				// use concat demuxer instead of brittle glob
				throw lastErr || new Error('pattern failed')
			} catch {
				/* fall through to concat */
			}
		}

		// concat demuxer — works for any naming as long as sort order is correct.
		// Keep the temporary list outside the user's frame folder and always remove it.
		const tempDir = await mkdtemp(join(tmpdir(), 'tp-concat-'))
		const listPath = join(tempDir, 'frames.txt')
		const body = files.map((f) => {
			const abs = join(dir, f).replace(/'/g, "'\\''")
			return `file '${abs}'`
		}).join('\n') + '\n'
		try {
			await writeFile(listPath, body, 'utf8')
			await run(FFMPEG, [
				'-y', '-hide_banner', '-loglevel', 'error',
				'-f', 'concat', '-safe', '0',
				'-r', String(fps),
				'-i', listPath,
				'-c:v', 'libx264', '-pix_fmt', 'yuv420p',
				output,
			])
			return { output, count: files.length, pattern: 'concat-demuxer' }
		} finally {
			await rm(tempDir, { recursive: true, force: true }).catch(() => {})
		}
	}

	// Explicit ffmpeg pattern path (e.g. /path/frame_%04d.png)
	await run(FFMPEG, [
		'-y', '-hide_banner', '-loglevel', 'error',
		'-framerate', String(fps),
		'-i', input,
		'-c:v', 'libx264', '-pix_fmt', 'yuv420p',
		output,
	])
	return { output, pattern: input }
}

/**
 * Transcode / remux with ffmpeg. `preset` shortcuts common pro formats.
 */
export async function convertMedia(opts) {
  const input = resolve(opts.input)
  const output = resolve(opts.output)
  const preset = (opts.preset || 'h264').toLowerCase()
  const args = ['-y', '-hide_banner', '-loglevel', 'error', '-i', input]
  switch (preset) {
    case 'h264':
    case 'mp4':
      args.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-an'); break
    case 'prores':
      args.push('-c:v', 'prores_ks', '-profile:v', '3', '-an'); break
    case 'webm':
      args.push('-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '32', '-an'); break
    case 'mov':
      args.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-an', '-f', 'mov'); break
    case 'gif':
      args.push('-vf', 'fps=12,scale=512:-1:flags=lanczos', '-loop', '0'); break
    case 'copy':
      args.push('-c', 'copy'); break
    default:
      if (opts.vf) args.push('-vf', opts.vf)
      if (opts.videoCodec) args.push('-c:v', opts.videoCodec)
      else args.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p')
      args.push('-an')
  }
  if (opts.extraArgs && Array.isArray(opts.extraArgs)) args.push(...opts.extraArgs)
  args.push(output)
  await run(FFMPEG, args)
  return { output, preset }
}

export async function listSequence(dir) {
  const files = (await readdir(resolve(dir)))
    .filter((f) => TPFrames.isImageFrameName(f))
    .sort(TPFrames.naturalFrameSort)
  return files.map((name) => ({
    name,
    index: TPFrames.extractFrameIndex(name),
  }))
}

export { TPFrames, FFMPEG, FFPROBE, run }
