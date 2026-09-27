// Pure input policies for the main process (unit-tested in policy.test.ts).
import { basename } from 'node:path';
import type { FileFilter } from '../src/platform/types';

/** Hosts the app may open in the default browser (https only). */
export const EXTERNAL_HOSTS = new Set([
  'www.blender.org',
  'blender.org',
  'download.blender.org',
  'docs.blender.org',
  'github.com',
  'www.github.com',
]);

export function isAllowedExternal(url: unknown): boolean {
  if (typeof url !== 'string') return false;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && EXTERNAL_HOSTS.has(u.hostname) && !u.username && !u.password;
  } catch {
    return false;
  }
}

/** Dialog filters from the renderer → safe Electron filters. */
export function sanitizeFilters(raw: unknown): FileFilter[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((f): f is FileFilter => !!f && typeof f.name === 'string' && Array.isArray(f.extensions))
    .map((f) => ({
      name: f.name.slice(0, 60),
      extensions: f.extensions
        .filter((x): x is string => typeof x === 'string')
        .map((x) => x.replace(/^\./, ''))
        .filter((x) => /^(\*|[A-Za-z0-9]{1,10})$/.test(x)),
    }))
    .filter((f) => f.extensions.length > 0);
}

/** Suggested save name → a plain file name (no directories). */
export function safeFileName(name: unknown): string {
  const n = typeof name === 'string' ? name : '';
  const clean = basename(n.replace(/\\/g, '/'))
    .replace(/[\u0000-\u001f:]+/g, '-')
    .replace(/^\.+/, '')
    .slice(0, 120)
    .trim();
  return clean || 'untitled';
}
