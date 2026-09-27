// app:// — a privileged, standard, secure scheme serving the multi-file
// vite build. Gives the planner a stable origin (localStorage survives
// updates), a secure context (WebGPU) and fetch() of sibling files (OIDN
// weights). Two hosts:
//   app://planner/…   → dist/ (inside app.asar when packaged)
//   app://renders/…   → userData/renders/ (Blender outputs, for <img>)
import { realpath, readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { protocol } from 'electron';

export const APP_SCHEME = 'app';
export const APP_HOST = 'planner';
export const RENDERS_HOST = 'renders';
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;
export const START_URL = `${APP_ORIGIN}/index.html`;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.log': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.tza': 'application/octet-stream',
  '.bin': 'application/octet-stream',
  '.exr': 'image/x-exr',
  '.hdr': 'image/vnd.radiance',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.blend': 'application/octet-stream',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

export function mimeFor(file: string): string {
  return MIME[extname(file).toLowerCase()] ?? 'application/octet-stream';
}

export function isInside(root: string, file: string): boolean {
  const r = root.endsWith(sep) ? root : root + sep;
  return file.startsWith(r);
}

/**
 * Map a URL pathname (percent-encoded, as in `new URL(u).pathname`) to a
 * file under `root`, or null when it would escape root (../, encoded
 * %2e%2e, backslashes, NUL, absolute paths) or is malformed.
 * "/" and "dir/" map to index.html.
 */
export function resolveInside(root: string, pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return null;
  let rel = decoded.replace(/^\/+/, '');
  if (rel === '' || rel.endsWith('/')) rel += 'index.html';
  const base = resolve(root);
  const file = resolve(base, rel);
  return isInside(base, file) ? file : null;
}

export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
        codeCache: true,
      },
    },
  ]);
}

function text(status: number, body: string): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });
}

export interface AppProtocolOptions {
  /** the vite dist/ directory */
  appRoot: string;
  /** userData/renders */
  rendersRoot: string;
  log?: (msg: string) => void;
}

export function installAppProtocol(opts: AppProtocolOptions): void {
  let rendersReal: string | null = null;
  protocol.handle(APP_SCHEME, async (req) => {
    let url: URL;
    try {
      url = new URL(req.url);
    } catch {
      return text(400, 'bad url');
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return text(405, 'method not allowed');
    const isRenders = url.host === RENDERS_HOST;
    if (url.host !== APP_HOST && !isRenders) return text(404, 'not found');
    const root = isRenders ? opts.rendersRoot : opts.appRoot;
    const file = resolveInside(root, url.pathname);
    if (!file) {
      opts.log?.(`app:// blocked ${url.pathname}`);
      return text(403, 'forbidden');
    }
    try {
      if (isRenders) {
        // outputs live on the real file system: also refuse symlinks out of it
        rendersReal ??= await realpath(root);
        if (!isInside(rendersReal, await realpath(file))) return text(403, 'forbidden');
      }
      const st = await stat(file);
      if (!st.isFile()) return text(404, 'not found');
      const headers = {
        'content-type': mimeFor(file),
        'content-length': String(st.size),
        'cache-control': 'no-cache',
      };
      if (req.method === 'HEAD') return new Response(null, { status: 200, headers });
      const data = await readFile(file);
      return new Response(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), { status: 200, headers });
    } catch {
      return text(404, 'not found');
    }
  });
}
