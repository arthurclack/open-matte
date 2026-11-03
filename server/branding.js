import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { imageInfo } from './images.js';

// The cinema's logo and tab icon. Each is a PNG, JPEG or WebP of at most 1 MB,
// recognised by its bytes (never its name or the browser's say-so), and kept in
// DATA_DIR/branding under a name made from its content, so browsers can cache it
// for good and a new one replaces the old cleanly. The settings say which file
// is current; only that one is served.

export const MAX_IMAGE_BYTES = 1024 * 1024;
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
export const BRANDING_FILE = /^(logo|icon)-[a-f0-9]{16}\.(png|jpg|webp)$/;
const KINDS = new Set(['logo', 'icon']);
const MIME = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };

const bad = (message, status = 400) => Object.assign(new Error(message), { status });

export const brandingType = (file) => MIME[path.extname(file).slice(1)];

export function createBranding({ settings, dataDir }) {
  // Made on the first upload, not before: an app that never stores one leaves DATA_DIR alone.
  const dir = path.join(dataDir, 'branding');

  // Throws a 400 saying what's wrong, before anything is written.
  function checked(kind, buf) {
    const info = buf?.length ? imageInfo(buf) : null;
    if (!info) throw bad("That isn't a PNG, JPEG or WebP image.");
    const { width, height } = info;
    if (width < 16 || height < 16) throw bad(`That image is only ${width} × ${height} pixels; it needs to be at least 16 on each side.`);
    if (width > 8192 || height > 8192) throw bad(`That image is ${width} × ${height} pixels; it can be at most 8192 on each side.`);
    if (kind === 'icon') {
      if (width !== height) throw bad(`The icon must be square; this one is ${width} × ${height}.`);
      if (width < 32) throw bad(`The icon must be at least 32 × 32 pixels; this one is ${width} × ${height}.`);
    }
    return info;
  }

  // The setting first, then the file it no longer names.
  function replace(kind, value) {
    const previous = settings.get()[kind]?.file;
    settings.setFile(kind, value);
    if (previous && previous !== value?.file && BRANDING_FILE.test(previous)) fs.rmSync(path.join(dir, previous), { force: true });
  }

  function save(kind, buf) {
    if (!KINDS.has(kind)) throw new Error(`Unknown branding file ${kind}`);
    const { ext, width, height } = checked(kind, buf);
    const file = `${kind}-${crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16)}.${ext}`;
    fs.mkdirSync(dir, { recursive: true });
    const tmp = path.join(dir, `.${file}.tmp`);
    fs.writeFileSync(tmp, buf);
    fs.renameSync(tmp, path.join(dir, file));
    replace(kind, { file, width, height });
  }

  function remove(kind) {
    if (!KINDS.has(kind)) throw new Error(`Unknown branding file ${kind}`);
    replace(kind, null);
  }

  // Where /branding/<file> is on disk: only the current logo or icon, else null.
  function filePath(file) {
    const { logo, icon } = settings.get();
    if (!BRANDING_FILE.test(file) || (logo?.file !== file && icon?.file !== file)) return null;
    return path.join(dir, file);
  }

  // Settings as they're sent to browsers, the admin's included: the logo and
  // icon as an address and a size, never the stored record.
  function publicView(s = settings.get()) {
    const view = (v) => (v?.file ? { url: `/branding/${v.file}`, width: v.width, height: v.height } : null);
    return { ...s, logo: view(s.logo), icon: view(s.icon) };
  }

  return { save, remove, filePath, publicView };
}
