export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export function validateImage(bytes: Uint8Array, mime: string, filename: string) {
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error('Image must be between 1 byte and 8 MB.');
  if (!/\.(png|jpe?g)$/i.test(filename)) throw new Error('Only PNG, JPG and JPEG files are supported.');
  const png = [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v);
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (!(png && mime === 'image/png') && !(jpeg && mime === 'image/jpeg')) throw new Error('Image content does not match a supported PNG or JPEG type.');
  return png ? 'image/png' : 'image/jpeg';
}
export async function readLimited(request: Request, limit: number): Promise<ArrayBuffer> {
  if (Number(request.headers.get('content-length')) > limit) throw new Error('Request is too large.');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('Request body is missing.');
  const chunks: Uint8Array[] = []; let total = 0;
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    total += value.byteLength;
    if (total > limit) { await reader.cancel(); throw new Error('Request is too large.'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes.buffer;
}
