// Small file helpers shared by the web and native platform paths.
import type { FileFilter } from './types';

const MIME: Record<string, string> = {
  json: 'application/json',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  exr: 'image/x-exr',
  glb: 'model/gltf-binary',
  zip: 'application/zip',
  txt: 'text/plain',
  sh: 'text/x-shellscript',
  py: 'text/x-python',
  blend: 'application/octet-stream',
};

export function extensionOf(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

export function mimeForName(name: string): string {
  return MIME[extensionOf(name)] ?? 'application/octet-stream';
}

/** `accept` attribute for an <input type=file> from dialog filters. */
export function acceptFromFilters(filters: FileFilter[] | undefined): string {
  if (!filters?.length) return '';
  const out: string[] = [];
  for (const f of filters) {
    for (const raw of f.extensions) {
      const ext = raw.replace(/^\./, '').toLowerCase();
      if (ext === '*') return '';
      const mime = MIME[ext];
      if (mime && mime !== 'application/octet-stream' && !out.includes(mime)) out.push(mime);
      if (!out.includes('.' + ext)) out.push('.' + ext);
    }
  }
  return out.join(',');
}

/** Replace characters macOS/Windows file systems or shells dislike. */
export function sanitizeFileName(name: string, fallback = 'untitled'): string {
  const clean = name
    .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]+/g, '-')
    .replace(/^[.\s-]+/, '')
    .trim()
    .slice(0, 120);
  return clean || fallback;
}

export function textToArrayBuffer(text: string): ArrayBuffer {
  const u8 = new TextEncoder().encode(text);
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

export function arrayBufferToText(data: ArrayBuffer): string {
  return new TextDecoder().decode(new Uint8Array(data));
}

export async function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  return blob.arrayBuffer();
}

/** PNG bytes of a canvas (for Export Photo). */
export function canvasToPng(canvas: HTMLCanvasElement): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? b.arrayBuffer().then(resolve, reject) : reject(new Error('empty canvas'))), 'image/png');
  });
}

/** Browser download of a blob — the web saveFile. */
export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
