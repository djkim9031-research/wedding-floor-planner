/** Save a blob through the native bridge when running as the Mac app,
 * else as a browser download. */
export async function saveBlob(blob: Blob, name: string, filters = [{ name: 'PNG image', extensions: ['png'] }]): Promise<string | null> {
  const native = (window as unknown as {
    wpNative?: { saveFile(o: { name: string; filters: unknown; data: ArrayBuffer }): Promise<string | null> };
  }).wpNative;
  if (native?.saveFile) {
    return native.saveFile({ name, filters, data: await blob.arrayBuffer() });
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return name;
}

export function photoFileName(date: string, minutes: number, suffix = ''): string {
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
  const mm = String(Math.round(minutes % 60)).padStart(2, '0');
  return `wedding-venue-${date}-${hh}${mm}${suffix}.png`;
}
