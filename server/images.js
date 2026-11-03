// What kind of image a file is, and its size in pixels, from its first bytes.
// Only the headers are read; nothing is decoded. Anything that isn't plainly a
// PNG, JPEG or WebP, truncated or hostile files included, gives null.

const TYPES = {
  png: { ext: 'png', mime: 'image/png' },
  jpeg: { ext: 'jpg', mime: 'image/jpeg' },
  webp: { ext: 'webp', mime: 'image/webp' },
};

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const ascii = (buf, at, text) => buf.length >= at + text.length && buf.toString('latin1', at, at + text.length) === text;

function png(buf) {
  if (buf.length < 24 || !buf.subarray(0, 8).equals(PNG_SIGNATURE) || !ascii(buf, 12, 'IHDR')) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

// Walks the segments up to the first frame header (SOFn), which holds the size.
function jpeg(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) return null;
    // Any number of 0xFF fill bytes may come before a marker.
    while (i + 1 < buf.length && buf[i + 1] === 0xff) i++;
    if (i + 1 >= buf.length) return null;
    const marker = buf[i + 1];
    // End of image, or the image data, before any frame header.
    if (marker === 0xd9 || marker === 0xda || marker === 0x00) return null;
    // Restart markers and TEM stand alone, with no length.
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      i += 2;
      continue;
    }
    if (i + 4 > buf.length) return null;
    const length = buf.readUInt16BE(i + 2);
    if (length < 2) return null;
    // C4 (Huffman tables), C8 (reserved) and CC (arithmetic coding) share the SOF range.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (i + 9 > buf.length) return null;
      return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
    }
    i += 2 + length;
  }
  return null;
}

// The first chunk says which kind of WebP it is: extended, lossy or lossless.
function webp(buf) {
  if (!ascii(buf, 0, 'RIFF') || !ascii(buf, 8, 'WEBP')) return null;
  if (ascii(buf, 12, 'VP8X') && buf.length >= 30) {
    return { width: buf.readUIntLE(24, 3) + 1, height: buf.readUIntLE(27, 3) + 1 };
  }
  if (ascii(buf, 12, 'VP8 ') && buf.length >= 30 && buf[23] === 0x9d && buf[24] === 0x01 && buf[25] === 0x2a) {
    return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  }
  if (ascii(buf, 12, 'VP8L') && buf.length >= 25 && buf[20] === 0x2f) {
    const bits = buf.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  return null;
}

// { type, ext, mime, width, height }, or null.
export function imageInfo(buf) {
  if (!Buffer.isBuffer(buf)) return null;
  for (const [type, read] of [['png', png], ['jpeg', jpeg], ['webp', webp]]) {
    const size = read(buf);
    if (!size) continue;
    if (!size.width || !size.height) return null;
    return { type, ...TYPES[type], ...size };
  }
  return null;
}
