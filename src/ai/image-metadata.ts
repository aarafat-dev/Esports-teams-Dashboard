export interface ImageMetadata {
  mime: string;
  bytes: number;
  width: number | null;
  height: number | null;
  sha256: string;
}

function readU16(bytes: Uint8Array, offset: number) { return (bytes[offset] << 8) | bytes[offset + 1]; }
function readU32(bytes: Uint8Array, offset: number) { return (bytes[offset] * 0x1000000) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3]; }

function dimensions(bytes: Uint8Array, mime: string): { width: number | null; height: number | null } {
  if (mime === 'image/png' && bytes.length >= 24 && readU32(bytes, 0) === 0x89504e47) return { width: readU32(bytes, 16), height: readU32(bytes, 20) };
  if (mime !== 'image/jpeg' || bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return { width: null, height: null };
  let offset = 2;
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) { offset++; continue; }
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 1 >= bytes.length) break;
    const length = readU16(bytes, offset);
    if (length < 2 || offset + length > bytes.length) break;
    const sof = (marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf);
    if (sof && length >= 7) return { width: readU16(bytes, offset + 5), height: readU16(bytes, offset + 3) };
    offset += length;
  }
  return { width: null, height: null };
}

export async function inspectImage(bytes: Uint8Array, mime: string): Promise<ImageMetadata> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource);
  const sha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  return { mime, bytes: bytes.byteLength, ...dimensions(bytes, mime), sha256 };
}
