// What printed paper looks like close to: the grain of the stock, a sheet's own
// slightly uneven shade, and ink that lies a little thinner in places. Drawn on
// <canvas> elements inside each object, never as background images: the page's
// Content-Security-Policy allows no data: or blob: images (the membership card,
// MembershipCard.jsx, does the same). Seeded (wear.js), so a thing is printed the
// same every time. The browser only: these need a canvas.

import { rng } from './wear.js';

// Value noise that wraps, so a tile never shows a seam.
function periodicNoise(R, size, cells) {
  const g = Array.from({ length: cells * cells }, () => R());
  const at = (i, j) => g[(((j % cells) + cells) % cells) * cells + (((i % cells) + cells) % cells)];
  return (x, y) => {
    const fx = (x / size) * cells;
    const fy = (y / size) * cells;
    const i = Math.floor(fx);
    const j = Math.floor(fy);
    const u = fx - i;
    const v = fy - j;
    const su = u * u * (3 - 2 * u);
    const sv = v * v * (3 - 2 * v);
    const a = at(i, j);
    const b = at(i + 1, j);
    const c = at(i, j + 1);
    const d = at(i + 1, j + 1);
    return a + (b - a) * su + (c - a) * sv + (a - b - c + d) * su * sv;
  };
}

// The grain of a stock, once for the page: 256 pixels that tile, shown at half size,
// so a fibre is half a CSS pixel on any screen. Kraft is coarser and more fibrous.
const tiles = new Map();
function grainTile(kraft) {
  const key = kraft ? 'kraft' : 'paper';
  if (tiles.has(key)) return tiles.get(key);
  const S = 256;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const g = c.getContext('2d');
  if (!g) return null;
  const img = g.createImageData(S, S);
  const d = img.data;
  const R = rng(`grain:${key}`);
  const mottle = periodicNoise(R, S, 8);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      const v = (R() + R() + R()) / 3 - 0.5 + (mottle(x, y) - 0.5) * 0.17;
      const a = Math.min(1, Math.abs(v) * 2);
      if (v < 0) [d[i], d[i + 1], d[i + 2], d[i + 3]] = kraft ? [70, 50, 30, a * a * 120] : [64, 52, 40, a * a * 52];
      else [d[i], d[i + 1], d[i + 2], d[i + 3]] = [255, 252, 244, a * a * (kraft ? 70 : 60)];
    }
  }
  g.putImageData(img, 0, 0);
  // A few fibres, wrapped at the tile's edges.
  const fibres = kraft ? 260 : 46;
  for (let k = 0; k < fibres; k++) {
    const x = R() * S;
    const y = R() * S;
    const len = R.range(3, kraft ? 22 : 12);
    const ang = R() * Math.PI;
    const bend = R.range(-0.4, 0.4);
    const dark = R() < (kraft ? 0.6 : 0.45);
    g.strokeStyle = dark ? `rgba(${kraft ? '60,40,20' : '70,58,44'},${R.range(0.05, kraft ? 0.22 : 0.1).toFixed(2)})` : `rgba(255,250,238,${R.range(0.06, 0.16).toFixed(2)})`;
    g.lineWidth = R.range(0.5, kraft ? 1.4 : 0.9);
    for (const ox of [-S, 0, S]) {
      for (const oy of [-S, 0, S]) {
        g.beginPath();
        g.moveTo(x + ox, y + oy);
        g.quadraticCurveTo(x + ox + Math.cos(ang + bend) * len * 0.5, y + oy + Math.sin(ang + bend) * len * 0.5, x + ox + Math.cos(ang) * len, y + oy + Math.sin(ang) * len);
        g.stroke();
      }
    }
  }
  tiles.set(key, c);
  return c;
}

// The grain over a sheet w by h CSS pixels, starting where its seed says (gx, gy).
export function drawGrain(canvas, w, h, { gx = 0, gy = 0, kraft = false } = {}) {
  const tile = grainTile(kraft);
  const g = canvas?.getContext('2d');
  if (!tile || !g) return;
  canvas.width = Math.max(1, Math.round(w * 2));
  canvas.height = Math.max(1, Math.round(h * 2));
  const pattern = g.createPattern(tile, 'repeat');
  g.save();
  g.translate(-gx * 2, -gy * 2);
  g.fillStyle = pattern;
  g.fillRect(0, 0, canvas.width + gx * 2, canvas.height + gy * 2);
  g.restore();
}

// No two sheets from one stack are quite the same: low clouds of lighter and darker,
// and a seeded cast, warmer or cooler. At half the sheet's size; it's soft anyway.
export function drawTone(canvas, w, h, seed) {
  const g = canvas?.getContext('2d');
  if (!g) return;
  const W = Math.max(8, Math.round(w / 2));
  const H = Math.max(8, Math.round(h / 2));
  const s = W / w;
  canvas.width = W;
  canvas.height = H;
  const img = g.createImageData(W, H);
  const d = img.data;
  const R = rng(`${seed}:tone`);
  const n1 = periodicNoise(R, 512, 5);
  const n2 = periodicNoise(R, 512, 13);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const v = (n1(x / s, y / s) - 0.5) * 0.9 + (n2(x / s, y / s) - 0.5) * 0.5;
      if (v > 0) [d[i], d[i + 1], d[i + 2], d[i + 3]] = [255, 251, 242, v * 0.035 * 255];
      else [d[i], d[i + 1], d[i + 2], d[i + 3]] = [60, 48, 34, -v * 0.028 * 255];
    }
  }
  g.putImageData(img, 0, 0);
  const warm = R() < 0.5;
  const lift = R.range(-1, 1);
  g.fillStyle =
    lift > 0
      ? warm
        ? `rgba(255,244,222,${(lift * 0.07).toFixed(3)})`
        : `rgba(246,248,255,${(lift * 0.06).toFixed(3)})`
      : warm
        ? `rgba(92,64,30,${(-lift * 0.05).toFixed(3)})`
        : `rgba(40,44,52,${(-lift * 0.04).toFixed(3)})`;
  g.fillRect(0, 0, W, H);
}

// Print is never quite solid: the ink lies a little thinner in places (never more
// than 8% here, so text keeps its contrast), and very rarely it missed the paper,
// leaving a pin-hole of bare stock. Drawn in the stock's own colour over the ink, at
// half the sheet's size.
export function drawWear(canvas, w, h, seed, stock) {
  const g = canvas?.getContext('2d');
  if (!g || !w || !h) return;
  const W = Math.max(4, Math.round(w / 2));
  const H = Math.max(4, Math.round(h / 2));
  canvas.width = W;
  canvas.height = H;
  const img = g.createImageData(W, H);
  const d = img.data;
  const R = rng(`${seed}:ink`);
  const n1 = periodicNoise(R, 200, 6);
  const n2 = periodicNoise(R, 200, 23);
  const [r, gr, b] = rgb(stock);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      let a = (n1(x, y) * 0.7 + n2(x, y) * 0.3) * 0.08;
      if (R() < 0.002) a = R.range(0.3, 0.6);
      [d[i], d[i + 1], d[i + 2], d[i + 3]] = [r, gr, b, Math.round(a * 255)];
    }
  }
  g.putImageData(img, 0, 0);
}

// Label tape is glossy plastic: a soft highlight band along it, never quite even.
export function drawGloss(canvas, w, h, seed) {
  const g = canvas?.getContext('2d');
  if (!g || !w || !h) return;
  const W = Math.max(8, Math.round(w / 2));
  const H = Math.max(4, Math.round(h / 2));
  canvas.width = W;
  canvas.height = H;
  const img = g.createImageData(W, H);
  const d = img.data;
  const R = rng(`${seed}:gloss`);
  const n = periodicNoise(R, 256, 7);
  const y0 = R.range(0.22, 0.34);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const cy = y0 + (n(x * 2, 0) - 0.5) * 0.12;
      const dy = (y / H - cy) / 0.13;
      const a = Math.exp(-dy * dy) * (0.06 + 0.07 * n(x * 2, 97));
      [d[i], d[i + 1], d[i + 2], d[i + 3]] = [255, 250, 240, Math.round(a * 255)];
    }
  }
  g.putImageData(img, 0, 0);
}

// "#rrggbb" or a CSS colour the canvas understands, as [r, g, b].
function rgb(color) {
  const m = /^#([0-9a-f]{6})$/i.exec(String(color || '').trim());
  if (m) return [0, 2, 4].map((i) => Number.parseInt(m[1].slice(i, i + 2), 16));
  return [233, 223, 201];
}
