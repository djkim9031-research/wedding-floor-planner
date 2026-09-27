import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BlenderEvent, BlenderInstall } from '../src/platform/types';
import {
  BlenderRunner,
  LineSplitter,
  appForExe,
  blenderCandidates,
  buildBlenderArgs,
  detectBlender,
  isSafeJobFileName,
  isSupportedVersion,
  jobStamp,
  normalizeBlenderPath,
  parseBlenderLine,
  parseBlenderVersion,
  parseClock,
  sanitizeRenderOptions,
  versionWarning,
  type DetectDeps,
} from './blender';

const EXE = '/Contents/MacOS/Blender';

describe('blenderCandidates', () => {
  it('orders settings → /Applications → ~/Applications → versioned apps → Spotlight, de-duplicated', () => {
    const c = blenderCandidates({
      home: '/Users/dj',
      settingsPath: '/Volumes/Ext/Blender 4.5.app',
      applications: ['Safari.app', 'Blender 4.2.app', 'Blender.app', 'Blender 4.5.app', 'blender-5.0.app'],
      userApplications: ['Blender 4.4.app', 'Notes.app'],
      spotlight: ['/Applications/Blender.app', '/opt/Blender.app', 'not-an-app'],
    });
    expect(c.map((x) => [x.path, x.source])).toEqual([
      ['/Volumes/Ext/Blender 4.5.app' + EXE, 'settings'],
      ['/Applications/Blender.app' + EXE, 'applications'],
      ['/Users/dj/Applications/Blender.app' + EXE, 'user-applications'],
      ['/Applications/blender-5.0.app' + EXE, 'applications'],
      ['/Applications/Blender 4.5.app' + EXE, 'applications'],
      ['/Applications/Blender 4.2.app' + EXE, 'applications'],
      ['/Users/dj/Applications/Blender 4.4.app' + EXE, 'user-applications'],
      ['/opt/Blender.app' + EXE, 'spotlight'],
    ]);
    expect(c[0].app).toBe('/Volumes/Ext/Blender 4.5.app');
  });

  it('accepts an executable path from settings as-is', () => {
    const c = blenderCandidates({ home: '/h', settingsPath: '/usr/local/bin/blender', applications: [], userApplications: [], spotlight: [] });
    expect(c[0]).toEqual({ path: '/usr/local/bin/blender', app: null, source: 'settings' });
  });

  it('normalizes .app paths and finds the bundle of an executable', () => {
    expect(normalizeBlenderPath('/Applications/Blender.app/')).toBe('/Applications/Blender.app' + EXE);
    expect(appForExe('/Applications/Blender.app' + EXE)).toBe('/Applications/Blender.app');
    expect(appForExe('/usr/bin/blender')).toBeNull();
  });
});

describe('parseBlenderVersion', () => {
  it.each([
    ['Blender 4.5.3 LTS\n\tbuild date: 2025-09-12\n', '4.5.3', 'Blender 4.5.3 LTS', true],
    ['Blender 4.2.0 LTS\n', '4.2.0', 'Blender 4.2.0 LTS', true],
    ['Color management: using fallback mode\nBlender 4.4.1\n\tbuild hash: abc\n', '4.4.1', 'Blender 4.4.1', true],
    ['Blender 4.1.1\n', '4.1.1', 'Blender 4.1.1', false],
    ['Blender 5.0.0 Alpha\n', '5.0.0', 'Blender 5.0.0 Alpha', false],
    ['Blender 3.6.18 LTS (hash 1234 built 2024-01-01)\n', '3.6.18', 'Blender 3.6.18 LTS', false],
    ['Blender 4.5\n', '4.5.0', 'Blender 4.5.0', true],
  ])('%j', (out, version, label, supported) => {
    const v = parseBlenderVersion(out)!;
    expect(v.version).toBe(version);
    expect(v.label).toBe(label);
    expect(isSupportedVersion(v)).toBe(supported);
  });

  it('rejects non-Blender output', () => {
    expect(parseBlenderVersion('')).toBeNull();
    expect(parseBlenderVersion('Read blend: /tmp/x.blend\nBlender quit\n')).toBeNull();
    expect(parseBlenderVersion('zsh: command not found: blender')).toBeNull();
  });

  it('warns for 5.x and for < 4.2', () => {
    expect(versionWarning(parseBlenderVersion('Blender 5.1.0')!)).toMatch(/no Intel Mac build/);
    expect(versionWarning(parseBlenderVersion('Blender 4.1.0')!)).toMatch(/too old/);
    expect(versionWarning(parseBlenderVersion('Blender 4.5.3 LTS')!)).toBeUndefined();
  });
});

describe('buildBlenderArgs', () => {
  it('builds the headless command line', () => {
    expect(buildBlenderArgs('/j/render_venue.py', '/j', { preset: 'final', width: 2560, height: 1440, samples: 1024, device: 'cpu' })).toEqual([
      '-b', '--factory-startup', '--python-exit-code', '1', '-P', '/j/render_venue.py', '--',
      '--job', '/j', '--preset', 'final', '--res', '2560x1440', '--samples', '1024', '--device', 'cpu',
    ]);
    expect(buildBlenderArgs('/s.py', '/j')).toEqual(['-b', '--factory-startup', '--python-exit-code', '1', '-P', '/s.py', '--', '--job', '/j']);
  });

  it('drops invalid options', () => {
    expect(
      sanitizeRenderOptions({ preset: 'ultra', width: 1920, height: -5, samples: 2.5, device: 'metal', force: 'yes' }),
    ).toEqual({});
    expect(sanitizeRenderOptions({ width: 800 })).toEqual({}); // res needs both
    expect(buildBlenderArgs('/s.py', '/j', { width: 99999, height: 10 } as never)).not.toContain('--res');
    expect(sanitizeRenderOptions(null)).toEqual({});
  });
});

describe('parseBlenderLine', () => {
  it('reads @@WP events', () => {
    expect(parseBlenderLine('@@WP {"ev":"stage","stage":"import","message":"Importing scene.glb"}')).toEqual({
      kind: 'wp',
      event: { ev: 'stage', stage: 'import', message: 'Importing scene.glb' },
    });
    const p = parseBlenderLine('  @@WP {"ev":"progress","sample":32,"of":128}\r');
    expect(p?.event).toEqual({ ev: 'progress', sample: 32, of: 128, pct: 25 });
    expect(parseBlenderLine('@@WP {"ev":"result","image":"render.png"}')?.event.ev).toBe('result');
  });

  it('ignores malformed @@WP lines', () => {
    expect(parseBlenderLine('@@WP {not json')).toBeNull();
    expect(parseBlenderLine('@@WP ["ev"]')).toBeNull();
    expect(parseBlenderLine('@@WP {"stage":"x"}')).toBeNull();
  });

  it("parses Cycles' status lines", () => {
    const l = 'Fra:1 Mem:245.13M (Peak 262.47M) | Time:00:03.21 | Remaining:00:12.34 | Mem:123.45M, Peak:130.00M | Scene, ViewLayer | Sample 16/128';
    expect(parseBlenderLine(l)).toEqual({ kind: 'progress', event: { ev: 'progress', sample: 16, of: 128, pct: 12.5, etaSec: 12 } });
    const long = 'Fra:1 Mem:1.2G | Time:10:00.00 | Remaining:01:02:03.50 | Scene, ViewLayer | Sample 100/1024';
    expect(parseBlenderLine(long)?.event).toMatchObject({ sample: 100, of: 1024, pct: 9.8, etaSec: 3724 });
    expect(parseBlenderLine('Fra:1 | Scene, ViewLayer | Sample 128/128')?.event).toEqual({ ev: 'progress', sample: 128, of: 128, pct: 100 });
    expect(parseBlenderLine('Fra:1 Mem:12M | Time:00:00.10 | Scene, ViewLayer | Loading render kernels')).toBeNull();
  });

  it('parses clocks', () => {
    expect(parseClock('00:12.34')).toBeCloseTo(12.34);
    expect(parseClock('02:03')).toBe(123);
    expect(parseClock('01:00:00.00')).toBe(3600);
    expect(parseClock('soon')).toBeNull();
  });
});

describe('small helpers', () => {
  it('splits lines across chunks and line endings', () => {
    const s = new LineSplitter();
    expect(s.push('a\nb')).toEqual(['a']);
    expect(s.push('c\r\nd\re')).toEqual(['bc', 'd']);
    expect(s.flush()).toEqual(['e']);
    expect(s.flush()).toEqual([]);
  });

  it('accepts only plain job file names', () => {
    for (const ok of ['scene.glb', 'scene.json', 'sky.exr', 'textures/oak_1.png', 'README.txt']) expect(isSafeJobFileName(ok)).toBe(true);
    for (const bad of ['../x', '/etc/passwd', 'a/../../b', '.hidden', 'a//b', 'x\\y', '', 'a b.png', 'a/'])
      expect(isSafeJobFileName(bad)).toBe(false);
  });

  it('stamps job dirs in local time', () => {
    expect(jobStamp(new Date(2026, 8, 27, 7, 5, 9))).toBe('20260927-070509');
  });
});

describe('detectBlender', () => {
  const fake = (versions: Record<string, string | null>, over: Partial<DetectDeps> = {}): DetectDeps => ({
    home: '/Users/dj',
    settingsPath: null,
    listDir: async (d) => (d === '/Applications' ? ['Blender.app', 'Blender 5.0.app', 'Blender 4.5.app'] : []),
    isFile: (p) => p in versions,
    spotlight: async () => [],
    runVersion: async (p) => versions[p] ?? null,
    ...over,
  });

  it('prefers the first supported install and lists all', async () => {
    const r = await detectBlender(
      fake({
        ['/Applications/Blender.app' + EXE]: 'Blender 5.0.1\n',
        ['/Applications/Blender 4.5.app' + EXE]: 'Blender 4.5.3 LTS\n',
      }),
    );
    expect(r.found).toBe(true);
    expect(r.install?.version).toBe('4.5.3');
    expect(r.install?.app).toBe('/Applications/Blender 4.5.app');
    expect(r.all.map((i) => i.version)).toEqual(['5.0.1', '4.5.3']);
    expect(r.downloadUrl).toBe('https://www.blender.org/download/lts/4-5/');
  });

  it('reports an unsupported-only install with a warning', async () => {
    const r = await detectBlender(fake({ ['/Applications/Blender.app' + EXE]: 'Blender 5.0.1\n' }));
    expect(r.found).toBe(false);
    expect(r.install?.supported).toBe(false);
    expect(r.warning).toMatch(/5\.x has no Intel Mac build/);
  });

  it('flags a broken settings path and finds nothing', async () => {
    const r = await detectBlender(fake({ '/bad/Blender': null }, { settingsPath: '/bad/Blender', listDir: async () => [] }));
    expect(r.found).toBe(false);
    expect(r.install).toBeNull();
    expect(r.warning).toMatch(/chosen in Settings/);
  });

  it('survives failing directory listings and Spotlight', async () => {
    const r = await detectBlender(
      fake(
        { ['/Applications/Blender.app' + EXE]: 'Blender 4.2.9 LTS' },
        { listDir: async () => Promise.reject(new Error('EPERM')), spotlight: async () => Promise.reject(new Error('x')) },
      ),
    );
    expect(r.found).toBe(true);
  });
});

// ---- job runner against a fake Blender (a shell script) ------------------------

const FAKE_BLENDER = `#!/bin/sh
# args: -b --factory-startup --python-exit-code 1 -P <script> -- --job <dir> ...
job=""
while [ $# -gt 0 ]; do
  if [ "$1" = "--job" ]; then job="$2"; fi
  shift
done
mode=$(cat "$job/mode.txt" 2>/dev/null)
echo "Blender 4.5.3 LTS (hash deadbeef)"
echo '@@WP {"ev":"stage","stage":"import","message":"Importing scene.glb"}'
if [ "$mode" = "fail" ]; then
  echo "Traceback (most recent call last):" >&2
  echo "RuntimeError: scene.json missing camera" >&2
  echo '@@WP {"ev":"error","message":"scene.json missing camera"}'
  exit 1
fi
if [ "$mode" = "hang" ]; then
  trap 'echo got-term >&2; exit 143' TERM
  echo "Fra:1 | Scene, ViewLayer | Sample 1/64"
  while true; do sleep 0.1; done
fi
printf 'Fra:1 Mem:12M | Time:00:01.00 | Remaining:00:03.00 | Scene, ViewLayer | Sample 16/64\\n'
printf 'Fra:1 Mem:12M | Time:00:02.00 | Remaining:00:02.00 | Scene, ViewLayer | Sample 32/64\\nFra:1 | Scene, ViewLayer | Sample 64/64\\n'
printf 'png' > "$job/render.png"
printf 'blend' > "$job/scene.blend"
echo '@@WP {"ev":"result","image":"render.png","blend":"scene.blend","samples":64}'
exit 0
`;

describe('BlenderRunner', () => {
  let tmp: string;
  let exe: string;
  let script: string;
  let events: Array<[string, BlenderEvent]>;
  let runner: BlenderRunner;
  const install = (over: Partial<BlenderInstall> = {}): BlenderInstall => ({
    path: exe,
    app: null,
    version: '4.5.3',
    label: 'Blender 4.5.3 LTS',
    supported: true,
    source: 'applications',
    ...over,
  });
  const terminal = (): Promise<BlenderEvent> =>
    new Promise((res) => {
      const t = setInterval(() => {
        const last = events.find(([, e]) => e.ev === 'result' || e.ev === 'error');
        if (last) {
          clearInterval(t);
          res(last[1]);
        }
      }, 20);
    });

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'wp-blender-'));
    exe = join(tmp, 'fake-blender.sh');
    writeFileSync(exe, FAKE_BLENDER);
    chmodSync(exe, 0o755);
    script = join(tmp, 'render_venue.py');
    writeFileSync(script, '# fake script\n');
    events = [];
    let n = 0;
    runner = new BlenderRunner({
      rendersRoot: join(tmp, 'renders'),
      scriptPath: script,
      emit: (id, ev) => events.push([id, ev]),
      now: () => new Date(2026, 8, 27, 18, 15, 2 + n++),
      progressIntervalMs: 0,
    });
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it('writes the job, streams progress and ends with one result', async () => {
    const glb = new Uint8Array([0x67, 0x6c, 0x54, 0x46]).buffer;
    const job = await runner.start(install(), { 'scene.glb': glb, 'scene.json': '{"schema":"wp-scene/1"}' }, { preset: 'draft' });
    expect(job.jobId).toBe('20260927-181502');
    expect(runner.running?.jobId).toBe(job.jobId);
    const end = await terminal();
    await runner.whenIdle();
    expect(runner.running).toBeNull();

    expect(readFileSync(join(job.dir, 'scene.glb'))).toEqual(Buffer.from([0x67, 0x6c, 0x54, 0x46]));
    expect(readFileSync(join(job.dir, 'scene.json'), 'utf8')).toBe('{"schema":"wp-scene/1"}');
    expect(existsSync(join(job.dir, 'render_venue.py'))).toBe(true);
    const log = readFileSync(join(job.dir, 'blender.log'), 'utf8');
    expect(log).toContain('"--preset" "draft"');
    expect(log).toContain('Sample 32/64');

    const kinds = events.map(([id, e]) => (expect(id).toBe(job.jobId), e.ev));
    expect(kinds[0]).toBe('stage');
    expect(kinds.filter((k) => k === 'result' || k === 'error')).toEqual(['result']);
    expect(events.map(([, e]) => e).filter((e) => e.ev === 'progress')).toEqual([
      { ev: 'progress', sample: 16, of: 64, pct: 25, etaSec: 3 },
      { ev: 'progress', sample: 32, of: 64, pct: 50, etaSec: 2 },
      { ev: 'progress', sample: 64, of: 64, pct: 100 },
    ]);
    expect(end).toMatchObject({
      ev: 'result',
      dir: job.dir,
      image: join(job.dir, 'render.png'),
      blend: join(job.dir, 'scene.blend'),
      script: { ev: 'result', samples: 64 },
    });
    if (end.ev !== 'result') throw new Error('expected result');
    expect(end.files).toEqual(expect.arrayContaining(['render.png', 'scene.blend', 'scene.glb', 'blender.log']));
    expect(end.urls['render.png']).toBe(`app://renders/${job.jobId}/render.png`);
  });

  it('reports failures with the script message and stderr tail', async () => {
    await runner.start(install(), { 'mode.txt': 'fail' }, {});
    const end = await terminal();
    expect(end).toMatchObject({ ev: 'error', message: 'scene.json missing camera', code: 1 });
    if (end.ev !== 'error') throw new Error('expected error');
    expect(end.stderrTail).toContain('RuntimeError');
    expect(end.logFile).toMatch(/blender\.log$/);
  });

  it('cancels with SIGTERM and allows only one job at a time', async () => {
    const job = await runner.start(install(), { 'mode.txt': 'hang' }, {});
    await expect(runner.start(install(), {}, {})).rejects.toThrow(/already running/);
    await new Promise((r) => setTimeout(r, 200));
    expect(runner.cancel('nope')).toBe(false);
    expect(runner.cancel(job.jobId)).toBe(true);
    const end = await terminal();
    expect(end).toMatchObject({ ev: 'error', cancelled: true });
    await runner.whenIdle();
    expect(runner.running).toBeNull();
  });

  it('refuses unsupported Blender, bad names and a missing script', async () => {
    await expect(runner.start(install({ supported: false, label: 'Blender 5.0.0' }), {}, {})).rejects.toThrow(/not supported/);
    await expect(runner.start(install(), { '../evil.py': 'x' }, {})).rejects.toThrow(/Invalid job file name/);
    rmSync(script);
    await expect(runner.start(install(), {}, {})).rejects.toThrow(/render_venue\.py is missing/);
    expect(runner.running).toBeNull();
  });

  it('turns a spawn failure into an error event', async () => {
    await runner.start(install({ path: join(tmp, 'no-such-blender') }), {}, {});
    const end = await terminal();
    expect(end).toMatchObject({ ev: 'error' });
    if (end.ev !== 'error') throw new Error('expected error');
    expect(end.message).toMatch(/Could not start Blender|ENOENT/);
    await runner.whenIdle();
    expect(runner.running).toBeNull();
  });
});
