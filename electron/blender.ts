// Blender bridge: find a Blender 4.2–4.x install, run render_venue.py
// headless in a per-job directory, stream progress, cancel.
//
//   Blender -b --factory-startup --python-exit-code 1 -P render_venue.py --
//           --job <dir> [--preset p] [--res WxH] [--samples n] [--device d]
//
// Pure helpers (candidates, version parsing, args, line parsing) are unit
// tested in blender.test.ts; BlenderRunner is tested against a fake Blender.
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream, existsSync, statSync } from 'node:fs';
import { copyFile, mkdir, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import {
  BLENDER_DOWNLOAD_URL,
  type BlenderDetectResult,
  type BlenderDevice,
  type BlenderEvent,
  type BlenderInstall,
  type BlenderJob,
  type BlenderPreset,
  type BlenderRenderOptions,
  type BlenderSource,
} from '../src/platform/types';

export const BLENDER_BUNDLE_ID = 'org.blenderfoundation.blender';
/** supported: MIN ≤ version < MAX (5.x has no Intel Mac build) */
export const MIN_VERSION: [number, number] = [4, 2];
export const MAX_VERSION_EXCLUSIVE: [number, number] = [5, 0];
export const VERSION_TIMEOUT_MS = 15_000;
export const CANCEL_GRACE_MS = 5_000;

// ---- detection -------------------------------------------------------------

export interface Candidate {
  path: string;
  app: string | null;
  source: BlenderSource;
}

export function exeForApp(app: string): string {
  return join(app, 'Contents', 'MacOS', 'Blender');
}

export function appForExe(exe: string): string | null {
  const m = /^(.*\.app)\/Contents\/MacOS\/[^/]+$/.exec(exe);
  return m ? m[1] : null;
}

/** "/Applications/Blender.app" or the executable itself → executable. */
export function normalizeBlenderPath(p: string): string {
  const trimmed = p.replace(/\/+$/, '');
  return trimmed.endsWith('.app') ? exeForApp(trimmed) : trimmed;
}

/** Descending natural order: "Blender 4.5.app" before "Blender 4.2.app". */
function naturalDesc(a: string, b: string): number {
  return b.localeCompare(a, 'en', { numeric: true, sensitivity: 'base' });
}

export interface CandidateInput {
  home: string;
  /** blenderPath from settings */
  settingsPath: string | null;
  /** entry names of /Applications */
  applications: string[];
  /** entry names of ~/Applications */
  userApplications: string[];
  /** .app paths from mdfind */
  spotlight: string[];
}

/** Ordered, de-duplicated places to look for Blender. */
export function blenderCandidates(inp: CandidateInput): Candidate[] {
  const out: Candidate[] = [];
  const seen = new Set<string>();
  const add = (exe: string, source: BlenderSource): void => {
    if (seen.has(exe)) return;
    seen.add(exe);
    out.push({ path: exe, app: appForExe(exe), source });
  };
  if (inp.settingsPath) add(normalizeBlenderPath(inp.settingsPath), 'settings');
  const userApps = join(inp.home, 'Applications');
  add(exeForApp('/Applications/Blender.app'), 'applications');
  add(exeForApp(join(userApps, 'Blender.app')), 'user-applications');
  const isBlenderApp = (n: string): boolean => /^blender.*\.app$/i.test(n);
  for (const n of inp.applications.filter(isBlenderApp).sort(naturalDesc)) {
    add(exeForApp(join('/Applications', n)), 'applications');
  }
  for (const n of inp.userApplications.filter(isBlenderApp).sort(naturalDesc)) {
    add(exeForApp(join(userApps, n)), 'user-applications');
  }
  for (const app of inp.spotlight) {
    const a = app.trim();
    if (a.endsWith('.app')) add(exeForApp(a), 'spotlight');
  }
  return out;
}

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  /** "4.5.3" */
  version: string;
  /** "Blender 4.5.3 LTS" */
  label: string;
}

/** Parse `Blender --version` output ("Blender 4.5.3 LTS\n\tbuild date: …"). */
export function parseBlenderVersion(stdout: string): ParsedVersion | null {
  const m = /^[ \t]*Blender[ \t]+(\d+)\.(\d+)(?:\.(\d+))?([^\r\n]*)$/m.exec(stdout);
  if (!m) return null;
  const major = Number(m[1]);
  const minor = Number(m[2]);
  const patch = m[3] ? Number(m[3]) : 0;
  const version = `${major}.${minor}.${patch}`;
  const tail = m[4].replace(/\(.*$/, '').trim();
  return { major, minor, patch, version, label: `Blender ${version}${tail ? ' ' + tail : ''}` };
}

export function isSupportedVersion(v: Pick<ParsedVersion, 'major' | 'minor'>): boolean {
  const n = v.major * 1000 + v.minor;
  return n >= MIN_VERSION[0] * 1000 + MIN_VERSION[1] && n < MAX_VERSION_EXCLUSIVE[0] * 1000 + MAX_VERSION_EXCLUSIVE[1];
}

export function versionWarning(v: ParsedVersion): string | undefined {
  if (isSupportedVersion(v)) return undefined;
  if (v.major >= 5) {
    return `${v.label} is newer than supported — Render in Blender is built for Blender 4.5 LTS (5.x has no Intel Mac build).`;
  }
  return `${v.label} is too old — Render in Blender needs Blender 4.2 or newer (4.5 LTS recommended).`;
}

export interface DetectDeps {
  home: string;
  settingsPath: string | null;
  listDir(dir: string): Promise<string[]>;
  isFile(path: string): boolean;
  spotlight(): Promise<string[]>;
  /** stdout of `<exe> --version`, or null when it failed / timed out */
  runVersion(exe: string): Promise<string | null>;
}

export async function probeBlender(c: Candidate, deps: Pick<DetectDeps, 'isFile' | 'runVersion'>): Promise<BlenderInstall | null> {
  if (!deps.isFile(c.path)) return null;
  const out = await deps.runVersion(c.path);
  const v = out ? parseBlenderVersion(out) : null;
  if (!v) return null;
  return { path: c.path, app: c.app, version: v.version, label: v.label, supported: isSupportedVersion(v), source: c.source };
}

export function summarize(all: BlenderInstall[], extraWarning?: string): BlenderDetectResult {
  const best = all.find((i) => i.supported) ?? all[0] ?? null;
  let warning = extraWarning;
  if (best && !best.supported) {
    const v = parseBlenderVersion(best.label);
    warning = [warning, v ? versionWarning(v) : undefined].filter(Boolean).join(' ') || undefined;
  }
  return { found: !!best?.supported, install: best, all, warning, downloadUrl: BLENDER_DOWNLOAD_URL };
}

export async function detectBlender(deps: DetectDeps): Promise<BlenderDetectResult> {
  const [applications, userApplications, spotlight] = await Promise.all([
    deps.listDir('/Applications').catch(() => []),
    deps.listDir(join(deps.home, 'Applications')).catch(() => []),
    deps.spotlight().catch(() => []),
  ]);
  const candidates = blenderCandidates({ home: deps.home, settingsPath: deps.settingsPath, applications, userApplications, spotlight });
  const all: BlenderInstall[] = [];
  let extra: string | undefined;
  for (const c of candidates) {
    const inst = await probeBlender(c, deps);
    if (inst) all.push(inst);
    else if (c.source === 'settings') extra = `The Blender chosen in Settings (${c.app ?? c.path}) did not start.`;
  }
  return summarize(all, extra);
}

/** Real-system detection deps (macOS). `--version` results are cached by path + mtime. */
export function systemDetectDeps(home: string, settingsPath: string | null): DetectDeps {
  return {
    home,
    settingsPath,
    listDir: (dir) => readdir(dir),
    isFile: (p) => {
      try {
        return statSync(p).isFile();
      } catch {
        return false;
      }
    },
    spotlight: () =>
      new Promise((res) => {
        if (process.platform !== 'darwin') return res([]);
        execFile('mdfind', [`kMDItemCFBundleIdentifier == '${BLENDER_BUNDLE_ID}'`], { timeout: 5000 }, (err, stdout) =>
          res(err ? [] : String(stdout).split('\n').filter(Boolean)),
        );
      }),
    runVersion: cachedRunVersion,
  };
}

const versionCache = new Map<string, string | null>();

function cachedRunVersion(exe: string): Promise<string | null> {
  let key = exe;
  try {
    key += ':' + statSync(exe).mtimeMs;
  } catch {
    return Promise.resolve(null);
  }
  if (versionCache.has(key)) return Promise.resolve(versionCache.get(key)!);
  return new Promise((res) => {
    execFile(exe, ['--version'], { timeout: VERSION_TIMEOUT_MS, maxBuffer: 1 << 20 }, (err, stdout) => {
      const out = err && !stdout ? null : String(stdout);
      if (out) versionCache.set(key, out);
      res(out);
    });
  });
}

// ---- job arguments -----------------------------------------------------------

const PRESETS: BlenderPreset[] = ['draft', 'standard', 'final'];
const DEVICES: BlenderDevice[] = ['auto', 'cpu', 'gpu'];

function intIn(v: unknown, lo: number, hi: number): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi ? v : null;
}

/** Validated render options (anything out of range is dropped). */
export function sanitizeRenderOptions(raw: unknown): BlenderRenderOptions {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out: BlenderRenderOptions = {};
  if (PRESETS.includes(o.preset as BlenderPreset)) out.preset = o.preset as BlenderPreset;
  const w = intIn(o.width, 16, 16384);
  const h = intIn(o.height, 16, 16384);
  if (w !== null && h !== null) {
    out.width = w;
    out.height = h;
  }
  const s = intIn(o.samples, 1, 1_000_000);
  if (s !== null) out.samples = s;
  if (DEVICES.includes(o.device as BlenderDevice)) out.device = o.device as BlenderDevice;
  if (o.force === true) out.force = true;
  return out;
}

export function buildBlenderArgs(script: string, jobDir: string, opts: BlenderRenderOptions = {}): string[] {
  const o = sanitizeRenderOptions(opts);
  const args = ['-b', '--factory-startup', '--python-exit-code', '1', '-P', script, '--', '--job', jobDir];
  if (o.preset) args.push('--preset', o.preset);
  if (o.width && o.height) args.push('--res', `${o.width}x${o.height}`);
  if (o.samples) args.push('--samples', String(o.samples));
  if (o.device) args.push('--device', o.device);
  return args;
}

/** "20260927-181502" in local time. */
export function jobStamp(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** Job input names: flat or nested relative paths of plain segments. */
export function isSafeJobFileName(name: string): boolean {
  if (typeof name !== 'string' || name.length > 200) return false;
  return name.split('/').every((seg) => /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(seg) && !seg.includes('..'));
}

// ---- output parsing ----------------------------------------------------------

export function pct(sample: number, of: number): number {
  return of > 0 ? Math.min(100, Math.round((sample / of) * 1000) / 10) : 0;
}

/** "00:12.34" / "01:02:03.45" → seconds */
export function parseClock(s: string): number | null {
  const m = /^(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/.exec(s.trim());
  if (!m) return null;
  return (m[1] ? Number(m[1]) * 3600 : 0) + Number(m[2]) * 60 + Number(m[3]);
}

export type ParsedLine =
  | { kind: 'wp'; event: Record<string, unknown> & { ev: string } }
  | { kind: 'progress'; event: Extract<BlenderEvent, { ev: 'progress' }> };

/**
 * One stdout line → a `@@WP {json}` event from render_venue.py, or progress
 * parsed from Cycles' status line
 * ("Fra:1 Mem:… | Time:00:03.21 | Remaining:00:12.34 | … | Sample 16/128").
 */
export function parseBlenderLine(line: string): ParsedLine | null {
  const t = line.trim();
  const at = t.indexOf('@@WP ');
  if (at >= 0) {
    try {
      const o = JSON.parse(t.slice(at + 5)) as unknown;
      if (o && typeof o === 'object' && !Array.isArray(o) && typeof (o as { ev?: unknown }).ev === 'string') {
        const ev = o as Record<string, unknown> & { ev: string };
        if (ev.ev === 'progress') {
          const sample = Number(ev.sample);
          const of = Number(ev.of);
          if (ev.pct === undefined && Number.isFinite(sample) && Number.isFinite(of) && of > 0) ev.pct = pct(sample, of);
        }
        return { kind: 'wp', event: ev };
      }
    } catch {
      /* not JSON — fall through */
    }
    return null;
  }
  const s = /\bSample (\d+)\/(\d+)/.exec(t);
  if (!s) return null;
  const sample = Number(s[1]);
  const of = Number(s[2]);
  const event: Extract<BlenderEvent, { ev: 'progress' }> = { ev: 'progress', sample, of, pct: pct(sample, of) };
  const r = /Remaining:\s*((?:\d+:)?\d+:\d+(?:\.\d+)?)/.exec(t);
  if (r) {
    const eta = parseClock(r[1]);
    if (eta !== null) event.etaSec = Math.round(eta);
  }
  return { kind: 'progress', event };
}

/** Splits a byte stream into lines (\n, \r\n or bare \r). */
export class LineSplitter {
  private rest = '';
  push(chunk: string): string[] {
    const parts = (this.rest + chunk).split(/\r\n|\n|\r/);
    this.rest = parts.pop() ?? '';
    return parts;
  }
  flush(): string[] {
    const r = this.rest;
    this.rest = '';
    return r ? [r] : [];
  }
}

/** Keeps the last N lines. */
export class Tail {
  private lines: string[] = [];
  constructor(private readonly max: number) {}
  push(line: string): void {
    this.lines.push(line.length > 500 ? line.slice(0, 500) + '…' : line);
    if (this.lines.length > this.max) this.lines.shift();
  }
  text(): string {
    return this.lines.join('\n');
  }
}

// ---- job runner --------------------------------------------------------------

export interface RunnerDeps {
  /** userData/renders */
  rendersRoot: string;
  /** bundled render_venue.py */
  scriptPath: string;
  emit(jobId: string, ev: BlenderEvent): void;
  now?: () => Date;
  spawnFn?: typeof spawn;
  log?: (msg: string) => void;
  /** min ms between progress events (default 150) */
  progressIntervalMs?: number;
}

interface ActiveJob {
  job: BlenderJob;
  child: ChildProcess;
  cancelled: boolean;
  killTimer: ReturnType<typeof setTimeout> | null;
  done: Promise<void>;
}

const MAX_LOG_BYTES = 20 * 1024 * 1024;

export class BlenderRunner {
  private active: ActiveJob | null = null;
  constructor(private readonly deps: RunnerDeps) {}

  get running(): BlenderJob | null {
    return this.active?.job ?? null;
  }

  /** Resolves when the running job (if any) has fully finished. */
  whenIdle(): Promise<void> {
    return this.active?.done ?? Promise.resolve();
  }

  private async makeJobDir(): Promise<{ jobId: string; dir: string }> {
    await mkdir(this.deps.rendersRoot, { recursive: true });
    const stamp = jobStamp((this.deps.now ?? (() => new Date()))());
    for (let i = 1; i < 100; i++) {
      const jobId = i === 1 ? stamp : `${stamp}-${i}`;
      const dir = join(this.deps.rendersRoot, jobId);
      try {
        await mkdir(dir); // not recursive: fails if it exists
        return { jobId, dir };
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      }
    }
    throw new Error('could not create a job directory');
  }

  /**
   * Write the job files, copy render_venue.py next to them and start
   * Blender. Resolves once the process is spawned.
   */
  async start(install: BlenderInstall, files: Record<string, unknown>, rawOpts: unknown): Promise<BlenderJob> {
    if (this.active) throw new Error('A Blender render is already running — cancel it first.');
    const opts = sanitizeRenderOptions(rawOpts);
    if (!install.supported && !opts.force) {
      throw new Error(`${install.label} is not supported — Render in Blender needs Blender 4.2–4.5 (4.5 LTS recommended).`);
    }
    if (!existsSync(this.deps.scriptPath)) {
      throw new Error(`render_venue.py is missing (${this.deps.scriptPath}).`);
    }
    // validate everything before touching the disk
    const entries = Object.entries(files ?? {}).map(([name, data]): [string, Buffer] => {
      if (!isSafeJobFileName(name)) throw new Error(`Invalid job file name: ${JSON.stringify(name)}`);
      return [name, toBuffer(data)];
    });

    const { jobId, dir } = await this.makeJobDir();
    for (const [name, data] of entries) {
      const target = resolve(dir, name);
      if (!target.startsWith(dir + sep)) throw new Error(`Invalid job file name: ${name}`);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, data);
    }
    const script = join(dir, 'render_venue.py');
    if (!files || !('render_venue.py' in files)) await copyFile(this.deps.scriptPath, script);

    const args = buildBlenderArgs(script, dir, opts);
    const job: BlenderJob = { jobId, dir, blender: install.path, version: install.version };
    const logFile = join(dir, 'blender.log');
    const log = createWriteStream(logFile, { flags: 'a' });
    let logBytes = 0;
    const writeLog = (s: string): void => {
      if (logBytes > MAX_LOG_BYTES) return;
      logBytes += Buffer.byteLength(s);
      log.write(logBytes > MAX_LOG_BYTES ? '[log truncated]\n' : s);
    };
    writeLog(`# ${new Date().toISOString()} ${install.label}\n# ${install.path} ${args.map((a) => JSON.stringify(a)).join(' ')}\n`);

    const env: NodeJS.ProcessEnv = { ...process.env, PYTHONUNBUFFERED: '1' };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = (this.deps.spawnFn ?? spawn)(install.path, args, { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] });
    this.deps.log?.(`blender job ${jobId}: ${install.path} ${args.join(' ')}`);

    let resolveDone!: () => void;
    const done = new Promise<void>((r) => (resolveDone = r));
    const active: ActiveJob = { job, child, cancelled: false, killTimer: null, done };
    this.active = active;

    const t0 = Date.now();
    const emit = (ev: BlenderEvent): void => this.deps.emit(jobId, ev);
    const errTail = new Tail(40);
    const outTail = new Tail(20);
    let scriptResult: Record<string, unknown> | undefined;
    let scriptError: Record<string, unknown> | undefined;
    let lastProgress = 0;
    const interval = this.deps.progressIntervalMs ?? 150;

    const onLine = (line: string): void => {
      outTail.push(line);
      const p = parseBlenderLine(line);
      if (!p) return;
      const ev = p.event as Record<string, unknown> & { ev: string };
      if (ev.ev === 'result') {
        scriptResult = ev;
        return;
      }
      if (ev.ev === 'error') {
        scriptError = ev;
        return;
      }
      if (ev.ev === 'progress') {
        const now = Date.now();
        const final = typeof ev.sample === 'number' && ev.sample === ev.of;
        if (!final && now - lastProgress < interval) return;
        lastProgress = now;
      }
      if (ev.ev === 'progress' || ev.ev === 'stage') emit(ev as BlenderEvent);
    };

    const out = new LineSplitter();
    const err = new LineSplitter();
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (d: string) => {
      writeLog(d);
      for (const l of out.push(d)) onLine(l);
    });
    child.stderr?.on('data', (d: string) => {
      writeLog(d);
      for (const l of err.push(d)) errTail.push(l);
    });

    let finished = false;
    const finish = async (code: number | null, signal: NodeJS.Signals | null, spawnError?: Error): Promise<void> => {
      if (finished) return;
      finished = true;
      for (const l of out.flush()) onLine(l);
      for (const l of err.flush()) errTail.push(l);
      if (active.killTimer) clearTimeout(active.killTimer);
      writeLog(`# exit code=${code} signal=${signal}${spawnError ? ' error=' + spawnError.message : ''}\n`);
      await new Promise<void>((r) => log.end(r));
      const elapsedSec = Math.round((Date.now() - t0) / 100) / 10;
      const stderrTail = errTail.text() || outTail.text();
      try {
        if (active.cancelled) {
          emit({ ev: 'error', cancelled: true, message: 'Render cancelled', code, signal, dir, logFile });
        } else if (spawnError) {
          emit({ ev: 'error', message: `Could not start Blender: ${spawnError.message}`, dir, logFile, stderrTail });
        } else if (code === 0) {
          emit(await this.collectResult(jobId, dir, elapsedSec, scriptResult));
        } else {
          const msg =
            (typeof scriptError?.message === 'string' && scriptError.message) ||
            (code === 2 ? 'The scene package was rejected by render_venue.py' : `Blender exited with ${signal ?? 'code ' + code}`);
          emit({ ev: 'error', message: msg, code, signal, stderrTail, dir, logFile, script: scriptError });
        }
      } finally {
        if (this.active === active) this.active = null;
        resolveDone();
      }
    };
    child.on('error', (e) => void finish(null, null, e));
    child.on('close', (code, signal) => void finish(code, signal));

    emit({ ev: 'stage', stage: 'starting', message: `Starting ${install.label}`, dir });
    return job;
  }

  private async collectResult(
    jobId: string,
    dir: string,
    elapsedSec: number,
    script: Record<string, unknown> | undefined,
  ): Promise<BlenderEvent> {
    const files = (await readdir(dir, { recursive: true }).catch(() => [] as string[]))
      .map((f) => String(f).split(sep).join('/'))
      .filter((f) => existsSync(join(dir, f)) && statSync(join(dir, f)).isFile())
      .sort();
    const pick = (key: string, ext: RegExp, prefer: string[]): string | undefined => {
      const v = script?.[key];
      if (typeof v === 'string') {
        const abs = resolve(dir, v);
        if (abs.startsWith(dir + sep) && existsSync(abs)) return abs;
      }
      const names = files.filter((f) => ext.test(f));
      const hit = prefer.find((p) => names.includes(p)) ?? names[0];
      return hit ? join(dir, hit) : undefined;
    };
    const image = pick('image', /\.png$/i, ['render.png', 'panorama.png', 'out/render.png']);
    const blend = pick('blend', /\.blend$/i, ['scene.blend', 'render.blend']);
    const urls: Record<string, string> = {};
    for (const f of files) urls[f] = `app://renders/${encodeURIComponent(jobId)}/${f.split('/').map(encodeURIComponent).join('/')}`;
    return { ev: 'result', dir, files, image, blend, urls, elapsedSec, script };
  }

  /** SIGTERM, then SIGKILL after 5 s. */
  cancel(jobId: string): boolean {
    const a = this.active;
    if (!a || a.job.jobId !== jobId) return false;
    if (a.cancelled) return true;
    a.cancelled = true;
    a.child.kill('SIGTERM');
    a.killTimer = setTimeout(() => {
      if (a.child.exitCode === null && a.child.signalCode === null) a.child.kill('SIGKILL');
    }, CANCEL_GRACE_MS);
    return true;
  }

  /** On quit: stop whatever is running. */
  killAll(): void {
    const a = this.active;
    if (!a) return;
    a.cancelled = true;
    a.child.kill('SIGKILL');
  }
}

export function toBuffer(data: unknown): Buffer {
  if (typeof data === 'string') return Buffer.from(data, 'utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(new Uint8Array(data));
  if (ArrayBuffer.isView(data)) return Buffer.from(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  throw new Error('job files must be strings or ArrayBuffers');
}
