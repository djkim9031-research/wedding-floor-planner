import { platform, type FileFilter } from '../../platform/bridge';

/** Save a blob through the native save panel in the Mac app, else as a
 * browser download. Resolves with the saved path/name, or null if cancelled. */
export async function saveBlob(blob: Blob, name: string, filters: FileFilter[] = [{ name: 'PNG image', extensions: ['png'] }]): Promise<string | null> {
  return platform().saveFile({ name, filters, data: await blob.arrayBuffer() });
}
export function photoFileName(date: string, minutes: number, suffix = ''): string {
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
  const mm = String(Math.round(minutes % 60)).padStart(2, '0');
  return `wedding-venue-${date}-${hh}${mm}${suffix}.png`;
}
