/* ============================================================================
 * Open AutoPose — public API TypeScript definitions (contract tp.job/v1)
 * These types describe window.TP, the Job Spec, and the Result manifest.
 * They are the typed mirror of api/tp-spec.js and api/tp.job.schema.json.
 * ========================================================================== */

export type PoseStyle = 'openpose' | 'white';
export type SilhouetteStyle = 'white' | 'black' | 'green' | 'magenta';
export type DepthEngine = 'fast' | 'vda';
export type CameraMode = 'match' | 'free';
export type OutputFormat = 'mp4' | 'png' | 'json';
export type Resolution = 'source' | 512 | 768 | 1024;

/** Frame range selector. Omit (or 'all') to process the whole clip. */
export type RangeSpec =
  | 'all'
  | { inFrame: number; outFrame: number }
  | { startSec: number; endSec: number };

export interface PoseLayerSpec {
  enabled?: boolean;          // default true
  style?: PoseStyle;          // default 'openpose'
  opacity?: number;           // 0..1, default 1
  bone?: number;              // 1..20, default 5
  joint?: number;             // 1..20, default 6
}

export interface SilhouetteLayerSpec {
  enabled?: boolean;          // default false
  style?: SilhouetteStyle;    // default 'white'
  opacity?: number;           // 0..1, default 0.45
}

export interface DepthLayerSpec {
  enabled?: boolean;          // default false
  engine?: DepthEngine;       // default 'fast'; 'vda' needs WebGPU
  opacity?: number;           // 0..1, default 1
  tint?: boolean;             // default false
  stabilize?: boolean;        // default true (anti-flicker)
  invert?: boolean;           // default false
  smooth?: number;            // integer 0..10, default 2
}

export interface OutputSpec {
  format?: OutputFormat | OutputFormat[]; // default 'mp4'
  resolution?: Resolution;                // default 'source'
}

/** A Open AutoPose render job. Contract id: 'tp.job/v1'. */
export interface TPJob {
  spec?: 'tp.job/v1';
  input?: { url: string } | null; // omit to pass a File/Blob at run time
  fps?: 'auto' | number;          // default 'auto'
  range?: RangeSpec;              // default 'all'
  characters?: number;           // 1..5, default 1
  confidence?: number;           // 0..1, default 0.5
  smoothing?: number;            // 0..1, default 0.5
  pose?: PoseLayerSpec;
  silhouette?: SilhouetteLayerSpec;
  depth?: DepthLayerSpec;
  camera?: CameraMode;           // default 'match'
  output?: OutputSpec;
}

/** Fully-defaulted job returned by TPSpec.normalizeJob(). */
export interface NormalizedTPJob {
  spec: 'tp.job/v1';
  input: { url: string } | null;
  fps: 'auto' | number;
  range: { mode: 'all' } | { mode: 'frames'; inFrame: number; outFrame: number } | { mode: 'seconds'; startSec: number; endSec: number };
  characters: number;
  confidence: number;
  smoothing: number;
  pose: Required<PoseLayerSpec>;
  silhouette: Required<SilhouetteLayerSpec>;
  depth: Required<DepthLayerSpec>;
  camera: CameraMode;
  output: { format: OutputFormat[]; resolution: Resolution };
  warnings: string[];
}

export interface ValidationResult { valid: boolean; errors: string[]; warnings: string[]; }

export interface TPCapabilities {
  appVersion: string;
  spec: 'tp.job/v1';
  webgpu: boolean;
  webcodecs: boolean;
  mp4Export: boolean;
  offscreenCanvas: boolean;
  fpsEstimate: boolean;
  depthEngines: DepthEngine[];
  poseModel: string;
  maxCharacters: number;
}

export interface TPArtifact {
  name: string;
  kind: 'mp4' | 'png-zip' | 'json';
  mime: string;
  bytes: number;
  sha256: string;
  blob: Blob;
}

export interface TPManifest {
  manifest: 'tp.manifest/v1';
  app: { name: 'open-autopose'; version: string; spec: 'tp.job/v1' };
  capabilities: TPCapabilities;
  job: NormalizedTPJob;
  source: { name?: string; sha256?: string; bytes?: number; width: number; height: number; fps: number; durationSec: number; frameCount: number };
  models: { pose: string; depthEngine: string | null; depthBackend: string | null };
  range: { inFrame: number; outFrame: number; frames: number };
  artifacts: Array<Omit<TPArtifact, 'blob'>>;
  timingsMs: Record<string, number>;
  warnings: string[];
  startedAt: string;
  finishedAt: string;
}

export interface TPRunResult { manifest: TPManifest; artifacts: TPArtifact[]; }

export interface TPRunOptions {
  /** Source video when job.input is omitted. */
  file?: File | Blob;
  /** Progress callback: stage in {load,track,bake,export}, frac 0..1. */
  onProgress?: (p: { stage: string; frac: number; note?: string }) => void;
  /** When false, do not auto-download artifacts to disk (default true in GUI). */
  download?: boolean;
}

/** A runtime overlay layer registered via TP.registerLayer (v4.4). */
export interface TPLayer {
  id: string;
  name?: string;
  enabled?: boolean;
  draw(ctx: CanvasRenderingContext2D, info: { fi: number; w: number; h: number; state: Record<string, unknown>; frame: unknown }): void;
}

/** Arguments passed to a custom exporter's run() (v4.4). */
export interface TPExporterApi {
  range: { inFrame: number; outFrame: number; frames: number };
  fps: number;
  dims: [number, number];
  state: Record<string, unknown>;
  resolveDep(url: string): string;
  status(msg: string): void;
  forEachFrame(cb: (canvas: HTMLCanvasElement, i: number, w: number, h: number) => void | Promise<void>): Promise<void>;
  emit(bytes: Uint8Array | Blob | ArrayBuffer, filename: string, mime: string): void;
}

/** A custom output format registered via TP.registerExporter (v4.4). */
export interface TPExporter {
  id: string;
  name?: string;
  run(api: TPExporterApi): void | Promise<void>;
}

/** A saved control-panel preset (v4.4). */
export interface TPPreset { id: string; name: string; patch: TPJob; }

/** Preset library exposed as TP.presets (v4.4). */
export interface TPPresetsApi {
  list(): TPPreset[];
  save(name: string): string;
  apply(id: string): void;
  remove(id: string): void;
  export(): string;
  import(json: string): void;
}

/** Offline-engine control exposed as TP.offline (v4.4). */
export interface TPOffline {
  readonly enabled: boolean;
  readonly vendorBase: string;
  set(on: boolean): void;
}

/** The global object exposed on window as `TP`. */
export interface TPGlobal {
  readonly version: string;
  readonly spec: 'tp.job/v1';
  capabilities(): Promise<TPCapabilities>;
  validateJob(job: TPJob): ValidationResult;
  normalizeJob(job: TPJob): NormalizedTPJob;
  getState(): Record<string, unknown>;
  run(job: TPJob, opts?: TPRunOptions): Promise<TPRunResult>;
  // --- v4.4 customization surface ---
  registerLayer(layer: TPLayer): void;
  unregisterLayer(id: string): void;
  registerExporter(exp: TPExporter): void;
  runExporter(id: string, opts?: Record<string, unknown>): Promise<void>;
  readonly plugins: { layers: TPLayer[]; exporters: TPExporter[] };
  readonly presets: TPPresetsApi;
  readonly offline: TPOffline;
}

declare global {
  interface Window { TP: TPGlobal; TPSpec: {
    SPEC_VERSION: 'tp.job/v1';
    MAX_CHARACTERS: number;
    validateJob(job: TPJob): ValidationResult;
    normalizeJob(job: TPJob): NormalizedTPJob;
  }; }
}
