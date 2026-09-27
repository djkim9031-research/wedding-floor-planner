import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ protocol: {} }));
const { isInside, mimeFor, resolveInside } = await import('./protocol');

const ROOT = '/app/dist';

describe('resolveInside (app:// path-traversal guard)', () => {
  it('maps normal paths into the root', () => {
    expect(resolveInside(ROOT, '/index.html')).toBe(join(ROOT, 'index.html'));
    expect(resolveInside(ROOT, '/')).toBe(join(ROOT, 'index.html'));
    expect(resolveInside(ROOT, '')).toBe(join(ROOT, 'index.html'));
    expect(resolveInside(ROOT, '/assets/index-abc123.js')).toBe(join(ROOT, 'assets/index-abc123.js'));
    expect(resolveInside(ROOT, '/oidn/rt_hdr_alb_nrm_small.tza')).toBe(join(ROOT, 'oidn/rt_hdr_alb_nrm_small.tza'));
    expect(resolveInside(ROOT, '/docs/')).toBe(join(ROOT, 'docs/index.html'));
    expect(resolveInside(ROOT, '/My%20Render.png')).toBe(join(ROOT, 'My Render.png'));
    expect(resolveInside(ROOT, '/a/./b/../c.js')).toBe(join(ROOT, 'a/c.js'));
  });

  it.each([
    '/../secret.txt',
    '/../../etc/passwd',
    '/%2e%2e/%2e%2e/etc/passwd',
    '/%2E%2E%2Fetc%2Fpasswd',
    '/assets/../../dist-evil/x.js',
    '/..%2f..%2fetc/passwd',
    '/..%5c..%5cetc%5cpasswd',
    '/foo%00.html',
    '/%E0%A4%A', // malformed escape
    '/..',
  ])('blocks %s', (p) => {
    expect(resolveInside(ROOT, p)).toBeNull();
  });

  it('treats absolute-looking paths as relative to root', () => {
    expect(resolveInside(ROOT, '//etc/passwd')).toBe(join(ROOT, 'etc/passwd'));
    expect(resolveInside(ROOT, '/%2Fetc%2Fpasswd')).toBe(join(ROOT, 'etc/passwd'));
  });

  it('does not accept sibling directories sharing the prefix', () => {
    expect(isInside('/app/dist', '/app/dist-electron/main.cjs')).toBe(false);
    expect(isInside('/app/dist', '/app/dist/x')).toBe(true);
    expect(isInside('/app/dist', '/app/dist')).toBe(false);
  });
});

describe('mimeFor', () => {
  it.each([
    ['index.html', 'text/html; charset=utf-8'],
    ['assets/index-abc.js', 'text/javascript; charset=utf-8'],
    ['assets/style.CSS', 'text/css; charset=utf-8'],
    ['oidn/rt_hdr_alb_nrm.tza', 'application/octet-stream'],
    ['x.json', 'application/json; charset=utf-8'],
    ['a.png', 'image/png'],
    ['a.jpg', 'image/jpeg'],
    ['a.wasm', 'application/wasm'],
    ['LICENSE', 'application/octet-stream'],
  ])('%s → %s', (f, m) => {
    expect(mimeFor(f)).toBe(m);
  });
});
