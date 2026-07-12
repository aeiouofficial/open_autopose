#!/usr/bin/env node
// tp-cli frames / convert subcommands (FFmpeg-backed)
// Loaded by tp-cli.mjs or runnable: node api/cli/tp-frames-cli.mjs ...

import { mkdir, writeFile } from 'node:fs/promises'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  hasFfmpeg,
  exportImageSequence,
  sequenceToVideo,
  convertMedia,
  listSequence,
  probe,
  TPFrames,
} from '../ffmpeg-io.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))

function die(msg, code = 1) {
  process.stderr.write(String(msg) + '\n')
  process.exit(code)
}

function parseArgs(argv) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const key = a.slice(2)
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) out[key] = true
      else { out[key] = next; i++ }
    } else out._.push(a)
  }
  return out
}

const HELP = `tp frames / convert — FFmpeg-backed I/O

  frames export <input> --out <dir> [--format png|jpeg|tiff] [--stem frame] [--pad 4] [--fps N]
  frames import <dir|pattern> --out <video.mp4> [--fps 24]
  frames list <dir>
  convert <input> --out <output> [--preset h264|prores|webm|mov|gif|copy]
  probe <input>

Requires system ffmpeg/ffprobe (or TP_FFMPEG / TP_FFPROBE).
`

export async function runFramesCli(argv) {
  const args = parseArgs(argv)
  const cmd = args._[0]
  if (!cmd || args.help) {
    process.stdout.write(HELP)
    return
  }
  if (cmd === 'probe') {
    const input = args._[1] || die('probe: missing input')
    const j = await probe(input)
    process.stdout.write(JSON.stringify(j, null, 2) + '\n')
    return
  }
  if (cmd === 'convert') {
    if (!(await hasFfmpeg())) die('ffmpeg not found on PATH')
    const input = args._[1] || die('convert: missing input')
    const out = args.out || die('convert: --out required')
    const res = await convertMedia({ input, output: out, preset: args.preset || 'h264' })
    process.stdout.write(JSON.stringify(res, null, 2) + '\n')
    return
  }
  if (cmd === 'frames' || cmd === 'frame') {
    const sub = args._[1]
    if (sub === 'list') {
      const dir = args._[2] || die('frames list: missing dir')
      const files = await listSequence(dir)
      process.stdout.write(JSON.stringify({ count: files.length, files }, null, 2) + '\n')
      return
    }
    if (sub === 'export') {
      if (!(await hasFfmpeg())) die('ffmpeg not found on PATH')
      const input = args._[2] || die('frames export: missing input')
      const outDir = args.out || die('frames export: --out dir required')
      const res = await exportImageSequence({
        input,
        outDir,
        format: args.format || 'png',
        stem: args.stem || 'frame',
        pad: args.pad ? +args.pad : 4,
        fps: args.fps ? +args.fps : undefined,
        startNumber: args['start-number'] != null ? +args['start-number'] : 1,
      })
      process.stdout.write(JSON.stringify(res, null, 2) + '\n')
      return
    }
    if (sub === 'import') {
      if (!(await hasFfmpeg())) die('ffmpeg not found on PATH')
      const pattern = args._[2] || die('frames import: missing dir/pattern')
      const out = args.out || die('frames import: --out video required')
      const res = await sequenceToVideo({
        inputPattern: pattern,
        output: out,
        fps: args.fps ? +args.fps : 24,
      })
      process.stdout.write(JSON.stringify(res, null, 2) + '\n')
      return
    }
    die('frames: use export | import | list')
  }
  die('unknown command: ' + cmd)
}

// direct run
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1] && process.argv[1].endsWith('tp-frames-cli.mjs')) {
  runFramesCli(process.argv.slice(2)).catch((e) => die(e.message || e))
}

export { TPFrames }
