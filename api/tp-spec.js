/* ============================================================================
 * Open AutoPose — Job Spec validator & normalizer  (contract: tp.job/v1)
 * ----------------------------------------------------------------------------
 * ONE canonical source of truth for the API contract. It is deliberately
 * dependency-free and written in UMD style so the *exact same bytes* run in:
 *   • the browser app  (attached as globalThis.TPSpec, embedded in the HTML)
 *   • Node.js          (require('./tp-spec.js') — used by the test suite & CLI)
 * Keeping a single implementation means the page can never validate a job
 * differently than the tests / tooling do.
 *
 * Two entry points:
 *   validateJob(spec)  -> { valid, errors[], warnings[] }   (never throws)
 *   normalizeJob(spec) -> fully-defaulted canonical job      (throws if invalid)
 * ========================================================================== */
(function (root) {
  'use strict';

  var SPEC_VERSION = 'tp.job/v1';
  var MAX_CHARACTERS = 5;              // mirrors MAXC in the app
  var POSE_STYLES = ['openpose', 'white'];
  var SIL_STYLES = ['white', 'black', 'green', 'magenta'];
  var DEPTH_ENGINES = ['fast', 'vda'];
  var CAMERAS = ['match', 'free'];
  var FORMATS = ['mp4', 'png', 'jpeg', 'tiff', 'json', 'openpose', 'webm'];
  var RESOLUTIONS = ['source', 512, 768, 1024];

  /* ---- tiny type helpers (no deps) ------------------------------------- */
  function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function isInt(v) { return isNum(v) && Math.floor(v) === v; }
  function isBool(v) { return typeof v === 'boolean'; }
  function isStr(v) { return typeof v === 'string'; }
  function inRange(v, lo, hi) { return isNum(v) && v >= lo && v <= hi; }
  function oneOf(v, arr) { return arr.indexOf(v) !== -1; }
  function has(o, k) { return isObj(o) && Object.prototype.hasOwnProperty.call(o, k); }

  /* Pull a value with a default + validation. Pushes an error and returns the
   * default when the supplied value is present but invalid. */
  function pick(obj, key, def, ok, errs, label) {
    if (!has(obj, key) || obj[key] === undefined || obj[key] === null) return def;
    if (ok(obj[key])) return obj[key];
    errs.push((label || key) + ': invalid value ' + JSON.stringify(obj[key]));
    return def;
  }

  /* ---- range normalization --------------------------------------------- *
   * Accepts: 'all' | { inFrame, outFrame } | { startSec, endSec }.
   * Returns a canonical descriptor; frame resolution against real fps/duration
   * happens at runtime (the validator can only sanity-check shape here). */
  function normRange(range, errs) {
    if (range === undefined || range === null || range === 'all') return { mode: 'all' };
    if (!isObj(range)) { errs.push('range: must be "all" or an object'); return { mode: 'all' }; }
    if (has(range, 'inFrame') || has(range, 'outFrame')) {
      var a = range.inFrame, b = range.outFrame;
      if (!isInt(a) || a < 0) { errs.push('range.inFrame: expected integer >= 0'); a = 0; }
      if (!isInt(b) || b < 0) { errs.push('range.outFrame: expected integer >= 0'); b = a; }
      if (isInt(a) && isInt(b) && b < a) errs.push('range.outFrame must be >= range.inFrame');
      return { mode: 'frames', inFrame: a, outFrame: b };
    }
    if (has(range, 'startSec') || has(range, 'endSec')) {
      var s = range.startSec, e = range.endSec;
      if (!isNum(s) || s < 0) { errs.push('range.startSec: expected number >= 0'); s = 0; }
      if (!isNum(e) || e < 0) { errs.push('range.endSec: expected number >= 0'); e = s; }
      if (isNum(s) && isNum(e) && e <= s) errs.push('range.endSec must be > range.startSec');
      return { mode: 'seconds', startSec: s, endSec: e };
    }
    errs.push('range: object must contain inFrame/outFrame or startSec/endSec');
    return { mode: 'all' };
  }

  /* ---- output normalization -------------------------------------------- */
  function normOutput(out, errs, warns) {
    var o = isObj(out) ? out : {};
    if (out !== undefined && !isObj(out)) errs.push('output: expected object');
    var fmt = has(o, 'format') ? o.format : 'mp4';
    var list = Array.isArray(fmt) ? fmt.slice() : [fmt];
    if (!list.length) { errs.push('output.format: at least one format required'); list = ['mp4']; }
    for (var i = 0; i < list.length; i++) {
      if (!oneOf(list[i], FORMATS)) errs.push('output.format: unknown format ' + JSON.stringify(list[i]) + ' (allowed: ' + FORMATS.join(', ') + ')');
    }
    var res = pick(o, 'resolution', 'source', function (v) { return oneOf(v, RESOLUTIONS); }, errs, 'output.resolution');
    return { format: list, resolution: res };
  }

  /* ---- main validate --------------------------------------------------- */
  function validateJob(spec) {
    var errs = [], warns = [];
    if (!isObj(spec)) { return { valid: false, errors: ['job must be an object'], warnings: [] }; }

    if (has(spec, 'spec') && spec.spec !== SPEC_VERSION)
      warns.push('spec: expected "' + SPEC_VERSION + '", got ' + JSON.stringify(spec.spec) + ' — proceeding under ' + SPEC_VERSION);

    // input may be omitted here and supplied at run time (File/Blob) instead.
    if (has(spec, 'input') && spec.input !== null) {
      if (!isObj(spec.input) || !isStr(spec.input.url))
        errs.push('input: expected { url: string } (or omit and pass a File at run time)');
    }

    if (has(spec, 'fps') && spec.fps !== 'auto' && !inRange(spec.fps, 1, 120))
      errs.push('fps: expected "auto" or a number in [1,120]');

    normRange(spec.range, errs);

    if (has(spec, 'characters') && (!isInt(spec.characters) || !inRange(spec.characters, 1, MAX_CHARACTERS)))
      errs.push('characters: expected integer in [1,' + MAX_CHARACTERS + ']');
    if (has(spec, 'confidence') && !inRange(spec.confidence, 0, 1)) errs.push('confidence: expected number in [0,1]');
    if (has(spec, 'smoothing') && !inRange(spec.smoothing, 0, 1)) errs.push('smoothing: expected number in [0,1]');

    if (has(spec, 'pose')) {
      var p = spec.pose;
      if (!isObj(p)) errs.push('pose: expected object'); else {
        if (has(p, 'enabled') && !isBool(p.enabled)) errs.push('pose.enabled: expected boolean');
        if (has(p, 'style') && !oneOf(p.style, POSE_STYLES)) errs.push('pose.style: expected one of ' + POSE_STYLES.join(', '));
        if (has(p, 'opacity') && !inRange(p.opacity, 0, 1)) errs.push('pose.opacity: expected number in [0,1]');
        if (has(p, 'bone') && !inRange(p.bone, 1, 20)) errs.push('pose.bone: expected number in [1,20]');
        if (has(p, 'joint') && !inRange(p.joint, 1, 20)) errs.push('pose.joint: expected number in [1,20]');
      }
    }
    if (has(spec, 'silhouette')) {
      var s = spec.silhouette;
      if (!isObj(s)) errs.push('silhouette: expected object'); else {
        if (has(s, 'enabled') && !isBool(s.enabled)) errs.push('silhouette.enabled: expected boolean');
        if (has(s, 'style') && !oneOf(s.style, SIL_STYLES)) errs.push('silhouette.style: expected one of ' + SIL_STYLES.join(', '));
        if (has(s, 'opacity') && !inRange(s.opacity, 0, 1)) errs.push('silhouette.opacity: expected number in [0,1]');
      }
    }
    if (has(spec, 'depth')) {
      var d = spec.depth;
      if (!isObj(d)) errs.push('depth: expected object'); else {
        if (has(d, 'enabled') && !isBool(d.enabled)) errs.push('depth.enabled: expected boolean');
        if (has(d, 'engine') && !oneOf(d.engine, DEPTH_ENGINES)) errs.push('depth.engine: expected one of ' + DEPTH_ENGINES.join(', '));
        if (has(d, 'opacity') && !inRange(d.opacity, 0, 1)) errs.push('depth.opacity: expected number in [0,1]');
        if (has(d, 'tint') && !isBool(d.tint)) errs.push('depth.tint: expected boolean');
        if (has(d, 'stabilize') && !isBool(d.stabilize)) errs.push('depth.stabilize: expected boolean');
        if (has(d, 'invert') && !isBool(d.invert)) errs.push('depth.invert: expected boolean');
        if (has(d, 'smooth') && (!isInt(d.smooth) || !inRange(d.smooth, 0, 10))) errs.push('depth.smooth: expected integer in [0,10]');
      }
    }
    if (has(spec, 'camera') && !oneOf(spec.camera, CAMERAS)) errs.push('camera: expected one of ' + CAMERAS.join(', '));

    normOutput(spec.output, errs, warns);

    /* ---- cross-field warnings (valid, but worth flagging) ---- */
    var outFmts = normOutput(spec.output, [], []).format;
    var poseOn = !has(spec, 'pose') || !has(spec.pose, 'enabled') ? true : spec.pose.enabled;
    var depthOn = has(spec, 'depth') && has(spec.depth, 'enabled') ? spec.depth.enabled : false;
    if (oneOf('json', outFmts) && !poseOn)
      warns.push('output json requires pose tracking; tracking will run even though pose.enabled=false.');
    if (oneOf('mp4', outFmts))
      warns.push('mp4 output needs WebCodecs (Chrome/Edge) at run time.');
    if (depthOn && has(spec.depth, 'engine') && spec.depth.engine === 'vda')
      warns.push('depth.engine "vda" (Consistent) requires WebGPU + a model download at run time.');
    if (!poseOn && !depthOn && !(has(spec, 'silhouette') && spec.silhouette && spec.silhouette.enabled))
      warns.push('no layers enabled — output would be an empty control track.');

    return { valid: errs.length === 0, errors: errs, warnings: warns };
  }

  /* ---- normalize (throws on invalid) ----------------------------------- */
  function normalizeJob(spec) {
    var res = validateJob(spec);
    if (!res.valid) {
      var err = new Error('Invalid tp.job/v1: ' + res.errors.join('; '));
      err.errors = res.errors; err.warnings = res.warnings;
      throw err;
    }
    var s = isObj(spec) ? spec : {};
    var errs = [];
    var pose = isObj(s.pose) ? s.pose : {};
    var sil = isObj(s.silhouette) ? s.silhouette : {};
    var depth = isObj(s.depth) ? s.depth : {};
    var job = {
      spec: SPEC_VERSION,
      input: has(s, 'input') && isObj(s.input) ? { url: s.input.url } : null,
      fps: (s.fps === 'auto' || s.fps === undefined || s.fps === null) ? 'auto' : s.fps,
      range: normRange(s.range, errs),
      characters: pick(s, 'characters', 1, function (v) { return isInt(v) && inRange(v, 1, MAX_CHARACTERS); }, errs),
      confidence: pick(s, 'confidence', 0.5, function (v) { return inRange(v, 0, 1); }, errs),
      smoothing: pick(s, 'smoothing', 0.5, function (v) { return inRange(v, 0, 1); }, errs),
      pose: {
        enabled: pick(pose, 'enabled', true, isBool, errs),
        style: pick(pose, 'style', 'openpose', function (v) { return oneOf(v, POSE_STYLES); }, errs),
        opacity: pick(pose, 'opacity', 1, function (v) { return inRange(v, 0, 1); }, errs),
        bone: pick(pose, 'bone', 5, function (v) { return inRange(v, 1, 20); }, errs),
        joint: pick(pose, 'joint', 6, function (v) { return inRange(v, 1, 20); }, errs),
      },
      silhouette: {
        enabled: pick(sil, 'enabled', false, isBool, errs),
        style: pick(sil, 'style', 'white', function (v) { return oneOf(v, SIL_STYLES); }, errs),
        opacity: pick(sil, 'opacity', 0.45, function (v) { return inRange(v, 0, 1); }, errs),
      },
      depth: {
        enabled: pick(depth, 'enabled', false, isBool, errs),
        engine: pick(depth, 'engine', 'fast', function (v) { return oneOf(v, DEPTH_ENGINES); }, errs),
        opacity: pick(depth, 'opacity', 1, function (v) { return inRange(v, 0, 1); }, errs),
        tint: pick(depth, 'tint', false, isBool, errs),
        stabilize: pick(depth, 'stabilize', true, isBool, errs),
        invert: pick(depth, 'invert', false, isBool, errs),
        smooth: pick(depth, 'smooth', 2, function (v) { return isInt(v) && inRange(v, 0, 10); }, errs),
      },
      camera: pick(s, 'camera', 'match', function (v) { return oneOf(v, CAMERAS); }, errs),
      output: normOutput(s.output, errs, []),
    };
    job.warnings = res.warnings;
    return job;
  }

  var api = {
    SPEC_VERSION: SPEC_VERSION,
    MAX_CHARACTERS: MAX_CHARACTERS,
    enums: { POSE_STYLES: POSE_STYLES, SIL_STYLES: SIL_STYLES, DEPTH_ENGINES: DEPTH_ENGINES, CAMERAS: CAMERAS, FORMATS: FORMATS, RESOLUTIONS: RESOLUTIONS },
    validateJob: validateJob,
    normalizeJob: normalizeJob,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TPSpec = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
