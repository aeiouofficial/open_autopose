/* ============================================================================
 * Open AutoPose — in-page programmatic runtime  (window.TP, tp.job/v1)
 * ----------------------------------------------------------------------------
 * This block is INJECTED verbatim at the end of the app's module script, so it
 * shares scope with the proven pipeline functions (loadFile, trackMotion,
 * bakeDepth, exportMP4/PNG/JSON, the global `state`, `vid`, `$`, …). It does
 * NOT reimplement any of them — it drives them exactly as the buttons do, which
 * is why it carries zero regression risk for the GUI workflow.
 *
 * It adds three things and nothing else:
 *   1. window.TP        — capabilities(), validateJob(), normalizeJob(),
 *                         getState(), run(job, opts)
 *   2. a postMessage control channel (drive it headless / from a parent frame)
 *   3. a deterministic tp.manifest/v1 (hashes, model + capability provenance)
 *
 * Honesty note: the numeric/render pipeline it calls needs a real GPU browser
 * (WebGPU / WebCodecs / MediaPipe / ONNX). This orchestration layer is written
 * against the verified v4.1 code paths and is syntax-checked, but a live render
 * must be smoke-tested in Chrome/Edge — it cannot run in a headless CI sandbox
 * without a GPU.
 * ========================================================================== */

const TP_VERSION = 'v1.0.0';

/* progress fan-out: wrap the existing busyProgress without changing it. */
let tpProgressSink = null;
const _tpOrigBusyProgress = busyProgress;
busyProgress = function (frac, sub) {
  _tpOrigBusyProgress(frac, sub);
  if (tpProgressSink) { try { tpProgressSink(frac, sub); } catch (_) {} }
};

/* SHA-256 -> lowercase hex (Web Crypto). */
async function tpSha256(buf) {
  const d = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(d)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/* Set a DOM control's value and fire the event its handler listens for, so the
 * app's existing wiring updates `state` (and any side effects) consistently. */
function tpSet(id, value, evt) {
  const el = $(id);
  if (!el) return;
  if (el.type === 'checkbox') el.checked = !!value; else el.value = String(value);
  el.dispatchEvent(new Event(evt || 'input', { bubbles: true }));
}

function tpCapabilities() {
  return (async () => {
    let gpu = false;
    try { gpu = !!navigator.gpu && !!(await navigator.gpu.requestAdapter?.().catch(() => null)); } catch (_) {}
    return {
      appVersion: TP_VERSION,
      spec: 'tp.job/v1',
      webgpu: gpu,
      webcodecs: 'VideoEncoder' in window,
      mp4Export: 'VideoEncoder' in window,
      offscreenCanvas: 'OffscreenCanvas' in window,
      fpsEstimate: !!vid.requestVideoFrameCallback,
      depthEngines: gpu ? ['fast', 'vda'] : ['fast'],
      poseModel: 'mediapipe_pose_landmarker_full',
      maxCharacters: MAXC,
    };
  })();
}

function tpGetState() {
  return {
    hasClip: !!state.vw, width: state.vw, height: state.vh, fps: state.fps,
    durationSec: state.duration, frameCount: state.frameCount,
    inFrame: state.inFrame, outFrame: state.outFrame,
    tracked: state.tracked, trackedChars: state.trackedChars,
    depth: { source: state.depth.source, engine: state.depth.engine, backend: state.depth.backend, bakedTotal: state.depth.bakedTotal },
    busy: state.busy,
  };
}

/* ---- spec -> app control appliers ------------------------------------ */
function tpApplyCharacters(n) {
  const multi = n > 1;
  tpSet('multiChk', multi, 'change');
  if (multi) tpSet('numChars', n, 'change');
}
function tpApplyFps(fps) {
  const sel = $('fpsSel');
  if (![...sel.options].some(o => +o.value === fps)) {
    const o = document.createElement('option'); o.textContent = String(fps); sel.appendChild(o);
  }
  sel.value = String(fps);
  if (typeof sel.onchange === 'function') sel.onchange();
}
function tpApplyRange(range) {
  if (!state.frameCount) return;
  const last = state.frameCount - 1;
  let a = 0, b = last;
  if (range.mode === 'frames') { a = range.inFrame; b = range.outFrame; }
  else if (range.mode === 'seconds') { a = Math.round(range.startSec * state.fps); b = Math.round(range.endSec * state.fps) - 1; }
  state.inFrame = Math.max(0, Math.min(a, last));
  state.outFrame = Math.max(state.inFrame, Math.min(b, last));
  if (typeof rangeChanged === 'function') rangeChanged();
}
function tpApplyScalars(job) {
  tpSet('conf', job.confidence, 'input');
  tpSet('smooth', job.smoothing, 'input');
  state.smoothing = job.smoothing;   // ensure track uses it even before debounce
  state.conf = job.confidence;
}
function tpApplyLayers(job) {
  // skeleton
  tpSet('skelOn', job.pose.enabled, 'input');
  tpSet('skelStyle', job.pose.style, 'input');
  tpSet('skelOp', job.pose.opacity, 'input');
  tpSet('boneW', job.pose.bone, 'input');
  tpSet('jointW', job.pose.joint, 'input');
  // silhouette
  tpSet('silOn', job.silhouette.enabled, 'input');
  tpSet('silStyle', job.silhouette.style, 'input');
  tpSet('silOp', job.silhouette.opacity, 'input');
  // depth layer display (engine is applied separately, right before bake)
  tpSet('depthOn', job.depth.enabled, 'input');
  tpSet('depthOp', job.depth.opacity, 'input');
  tpSet('depthTintChk', job.depth.tint, 'input');
  tpSet('stabChk', job.depth.stabilize, 'input');
  tpSet('invChk', job.depth.invert, 'input');
  tpSet('smoothD', job.depth.smooth, 'input');
}
function tpApplyCamera(mode) { if (typeof setCamMode === 'function') setCamMode(mode); }
function tpApplyResolution(res) { tpSet('resSel', res, 'change'); }

/* Run one export and capture the produced blob via the tp:artifact event that
 * download() now emits. Returns { name, blob } or null if nothing was produced
 * (e.g. an unsupported encoder simply status()es and returns). */
async function tpCaptureExport(fn) {
  let captured = null;
  const onArt = ev => { captured = ev.detail; };
  window.addEventListener('tp:artifact', onArt);
  try { await fn(); } finally { window.removeEventListener('tp:artifact', onArt); }
  return captured;
}
function tpKind(name) {
  if (/\.mp4$/i.test(name)) return 'mp4';
  if (/\.zip$/i.test(name)) return 'png-zip';
  if (/\.json$/i.test(name)) return 'json';
  return 'file';
}

async function tpRun(job, opts) {
  opts = opts || {};
  if (state.busy) throw new Error('TP.run: engine is busy');
  const startedAt = new Date().toISOString();
  const T = {}; const stamp = (k, from) => { T[k] = Math.round(performance.now() - from); };

  const norm = TPSpec.normalizeJob(job);           // throws on invalid spec
  const caps = await tpCapabilities();

  // hard capability gates (fail fast + clearly rather than silently no-op)
  if (norm.output.format.includes('mp4') && !caps.webcodecs)
    throw new Error('TP.run: mp4 output requires WebCodecs (Chrome/Edge).');
  if (norm.depth.enabled && norm.depth.engine === 'vda' && !caps.webgpu)
    throw new Error('TP.run: depth engine "vda" requires WebGPU — use engine "fast".');

  // resolve input to a File + hash it
  let file = opts.file || null, srcName, srcBytes, srcSha;
  if (!file) {
    if (!norm.input || !norm.input.url) throw new Error('TP.run: no input — pass opts.file or job.input.url');
    const resp = await fetch(norm.input.url);
    if (!resp.ok) throw new Error('TP.run: could not fetch input (' + resp.status + ')');
    const buf = await resp.arrayBuffer();
    srcName = (norm.input.url.split('/').pop()) || 'input.mp4';
    file = new File([buf], srcName, { type: 'video/mp4' });
    srcBytes = buf.byteLength; srcSha = await tpSha256(buf);
  } else {
    const buf = await file.arrayBuffer();
    srcName = file.name || 'input'; srcBytes = buf.byteLength; srcSha = await tpSha256(buf);
  }

  // progress bridge -> caller + postMessage
  let stage = 'load';
  tpProgressSink = (frac) => {
    const p = { stage, frac: frac || 0 };
    if (typeof opts.onProgress === 'function') { try { opts.onProgress(p); } catch (_) {} }
    if (typeof opts.__post === 'function') opts.__post(Object.assign({ type: 'tp:progress' }, p));
  };

  try {
    // 1) character count first (short clips auto-track inside loadFile)
    tpApplyCharacters(norm.characters);

    // 2) load
    let m = performance.now();
    await loadFile(file);
    if (!state.vw) throw new Error('TP.run: could not decode the input video');
    stamp('loadMs', m);

    // 3) explicit fps overrides the estimate (also clears any auto-track)
    if (norm.fps !== 'auto') tpApplyFps(norm.fps);

    // 4) range + 5) scalars + layers + camera
    tpApplyRange(norm.range);
    tpApplyScalars(norm);
    tpApplyLayers(norm);
    tpApplyCamera(norm.camera);

    // 6) track when any output depends on landmarks (pose overlay, silhouette,
    //    or the keypoint JSON). Depth-only jobs skip tracking.
    const needTrack = norm.pose.enabled || norm.silhouette.enabled || norm.output.format.includes('json');
    stage = 'track'; m = performance.now();
    if (needTrack) { await trackMotion(); if (!state.tracked) throw new Error('TP.run: tracking found no person'); }
    stamp('trackMs', m);

    // 7) depth bake
    stage = 'bake'; m = performance.now();
    if (norm.depth.enabled) { tpSet('depthEngine', norm.depth.engine, 'change'); await bakeDepth(); }
    stamp('bakeMs', m);

    // 8) exports
    tpApplyResolution(norm.output.resolution);
    stage = 'export'; m = performance.now();
    const prevSuppress = tpSuppressDownload;
    tpSuppressDownload = (opts.download === false);
    const artifacts = [];
    for (const fmt of norm.output.format) {
      const fn = fmt === 'mp4' ? exportMP4 : fmt === 'png' ? exportPNG : exportJSON;
      const art = await tpCaptureExport(fn);
      if (art && art.blob) {
        const ab = await art.blob.arrayBuffer();
        artifacts.push({ name: art.name, kind: tpKind(art.name), mime: art.blob.type || '', bytes: ab.byteLength, sha256: await tpSha256(ab), blob: art.blob });
      }
    }
    tpSuppressDownload = prevSuppress;
    stamp('exportMs', m);

    const manifest = {
      manifest: 'tp.manifest/v1',
      app: { name: 'open-autopose', version: TP_VERSION, spec: 'tp.job/v1' },
      capabilities: caps,
      job: norm,
      source: { name: srcName, sha256: srcSha, bytes: srcBytes, width: state.vw, height: state.vh, fps: state.fps, durationSec: state.duration, frameCount: state.frameCount },
      models: { pose: 'mediapipe_pose_landmarker_full', depthEngine: norm.depth.enabled ? state.depth.engine : null, depthBackend: norm.depth.enabled ? state.depth.backend : null },
      range: { inFrame: state.inFrame, outFrame: state.outFrame, frames: state.outFrame - state.inFrame + 1 },
      artifacts: artifacts.map(a => ({ name: a.name, kind: a.kind, mime: a.mime, bytes: a.bytes, sha256: a.sha256 })),
      timingsMs: T,
      warnings: norm.warnings,
      startedAt, finishedAt: new Date().toISOString(),
    };
    return { manifest, artifacts };
  } finally {
    tpProgressSink = null;
  }
}

/* window.TP — the public surface. */
window.TP = {
  get version() { return TP_VERSION; },
  get spec() { return 'tp.job/v1'; },
  capabilities: tpCapabilities,
  validateJob: (job) => TPSpec.validateJob(job),
  normalizeJob: (job) => TPSpec.normalizeJob(job),
  getState: tpGetState,
  run: tpRun,
};

/* postMessage control channel — lets a parent frame or a headless driver submit
 * jobs and receive progress/result without touching the DOM directly.
 *   ->  { type:'tp:run', id, job, download? }
 *   <-  { type:'tp:progress', id, stage, frac }
 *   <-  { type:'tp:result', id, manifest }        (blobs stay in-page)
 *   <-  { type:'tp:error', id, error }
 * Also supports { type:'tp:capabilities', id } and { type:'tp:validate', id, job }. */
window.addEventListener('message', async (e) => {
  const msg = e.data;
  if (!msg || typeof msg !== 'object') return;
  const reply = (m) => { try { (e.source || window).postMessage(Object.assign({ id: msg.id }, m), '*'); } catch (_) {} };
  try {
    if (msg.type === 'tp:capabilities') { reply({ type: 'tp:capabilities', capabilities: await tpCapabilities() }); return; }
    if (msg.type === 'tp:validate') { reply({ type: 'tp:validate', result: TPSpec.validateJob(msg.job) }); return; }
    if (msg.type === 'tp:run') {
      const { manifest } = await tpRun(msg.job, { download: msg.download !== false, __post: reply });
      reply({ type: 'tp:result', manifest });
    }
  } catch (err) {
    reply({ type: 'tp:error', error: (err && err.message) || String(err), details: (err && err.errors) || null });
  }
});

console.log('[tp] window.TP ready — ' + TP_VERSION + ' · contract tp.job/v1. Try: await TP.capabilities()');

/* ==========================================================================
 * v4.4 — customization surface (plugins, presets, offline)
 * --------------------------------------------------------------------------
 * Mirror of the runtime embedded in the browser app. Additive and inert
 * until used. See api/PLUGINS.md and api/API.md §3a for the contract.
 * ======================================================================== */
var tpCustomLayers = [];
var tpCustomExporters = [];

function tpRegisterLayer(layer) {
  if (!layer || !layer.id) throw new Error('registerLayer: {id} required');
  tpUnregisterLayer(layer.id);
  tpCustomLayers.push(Object.assign({ enabled: true }, layer));
  if (typeof tpRenderPluginUI === 'function') tpRenderPluginUI();
}
function tpUnregisterLayer(id) {
  tpCustomLayers = tpCustomLayers.filter(function (l) { return l.id !== id; });
  if (typeof tpRenderPluginUI === 'function') tpRenderPluginUI();
}
function tpRegisterExporter(exp) {
  if (!exp || !exp.id || typeof exp.run !== 'function') throw new Error('registerExporter: {id, run()} required');
  tpCustomExporters = tpCustomExporters.filter(function (e) { return e.id !== exp.id; });
  tpCustomExporters.push(exp);
  if (typeof tpRenderPluginUI === 'function') tpRenderPluginUI();
}
async function tpRunExporter(id) {
  var exp = tpCustomExporters.find(function (e) { return e.id === id; });
  if (!exp) throw new Error('no exporter: ' + id);
  var dims = exportDims();
  var api = {
    range: tpGetState().range, fps: tpGetState().fps, dims: dims, state: tpGetState(),
    resolveDep: function (u) { return (typeof window.__TP_DEP === 'function') ? window.__TP_DEP(u) : u; },
    status: function (m) { if (typeof status === 'function') status(m); },
    forEachFrame: function (cb) { return exportFrames(cb, exp.name || exp.id); },
    emit: function (bytes, name, mime) { tpEmitDownload(bytes, name, mime); },
  };
  return exp.run(api);
}

/* Preset library — persisted in localStorage['tp.presets.v1'], normalized
 * through tp.job/v1 on apply so a bad value can't corrupt the panel. */
var TP_PRESET_KEY = 'tp.presets.v1';
function tpPresetsLoad() { try { return JSON.parse(localStorage.getItem(TP_PRESET_KEY) || '[]'); } catch (_) { return []; } }
function tpPresetsStore(list) { localStorage.setItem(TP_PRESET_KEY, JSON.stringify(list)); if (typeof tpRenderPresetUI === 'function') tpRenderPresetUI(); }
var tpPresetsApi = {
  list: function () { return tpPresetsLoad(); },
  save: function (name) {
    var list = tpPresetsLoad();
    var id = (name || 'preset').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || ('p' + Date.now());
    list = list.filter(function (p) { return p.id !== id; });
    list.push({ id: id, name: name || id, patch: tpCaptureCurrentPatch() });
    tpPresetsStore(list); return id;
  },
  apply: function (id) { var p = tpPresetsLoad().find(function (x) { return x.id === id; }); if (p) tpApplyPatch(p.patch); },
  remove: function (id) { tpPresetsStore(tpPresetsLoad().filter(function (p) { return p.id !== id; })); },
  export: function () { return JSON.stringify(tpPresetsLoad(), null, 2); },
  import: function (json) {
    var incoming = JSON.parse(json); var byId = {};
    tpPresetsLoad().concat(incoming).forEach(function (p) { byId[p.id] = p; });
    tpPresetsStore(Object.keys(byId).map(function (k) { return byId[k]; }));
  },
};
function tpApplyPatch(patch) { var norm = TPSpec.normalizeJob(patch || {}); tpApplyScalars(norm); tpApplyLayers(norm); }

/* Offline engine control (see the app's OFFLINE BOOTSTRAP script). */
var tpOfflineApi = {
  get enabled() { return !!window.__TP_OFFLINE; },
  get vendorBase() { return window.__TP_VENDOR || './vendor/'; },
  set: function (on) { try { localStorage.setItem('tp.offline', on ? '1' : '0'); } catch (_) {} location.reload(); },
};

/* Extend the public surface (v4.4). */
Object.assign(window.TP, {
  registerLayer: tpRegisterLayer,
  unregisterLayer: tpUnregisterLayer,
  registerExporter: tpRegisterExporter,
  runExporter: tpRunExporter,
  get plugins() { return { layers: tpCustomLayers.slice(), exporters: tpCustomExporters.slice() }; },
  presets: tpPresetsApi,
  offline: tpOfflineApi,
});
