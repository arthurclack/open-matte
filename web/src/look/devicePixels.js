// Lines drawn in whole device pixels: the back office's raster (ui.css .ui-raster)
// and the blue screen's scanlines (objects.css .crt). A line every 3 CSS pixels on a
// 1.25x or 1.5x screen would land on 3 device pixels, then 4, and beat into bands; so
// the pitch is a whole number of device pixels (3 at 1x, 4 at 1.25x, 6 at 2x) given
// back in CSS pixels. Set on <body> once (everything that uses them is inside it,
// and <html>'s own style is left to Branding's preview of the theme), and again if
// the window moves to a screen with another pixel ratio.

// -> { line, pitch, soft } in CSS pixels for a screen of `dpr` device pixels to one.
// `soft` is where a scanline's softer step ends (half a device pixel past the line).
export function pixelPitch(dpr = 1) {
  const d = dpr > 0 ? dpr : 1;
  const line = Math.max(1, Math.round(d)) / d;
  const pitch = Math.max(3, Math.round(3 * d)) / d;
  const r = (n) => Math.round(n * 1000) / 1000;
  return { line: r(line), pitch: r(pitch), soft: r(line + 0.5 / d) };
}

let watching = null;
export function installDevicePixels(root = typeof document === 'undefined' ? null : document.body) {
  if (!root || typeof window === 'undefined') return;
  const set = () => {
    const { line, pitch, soft } = pixelPitch(window.devicePixelRatio || 1);
    root.style.setProperty('--ui-raster-line', `${line}px`);
    root.style.setProperty('--ui-raster-pitch', `${pitch}px`);
    root.style.setProperty('--scan-l', `${line}px`);
    root.style.setProperty('--scan-p', `${pitch}px`);
    root.style.setProperty('--scan-s', `${soft}px`);
  };
  const watch = () => {
    watching?.removeEventListener('change', moved);
    watching = window.matchMedia?.(`(resolution: ${window.devicePixelRatio || 1}dppx)`) ?? null;
    watching?.addEventListener('change', moved, { once: true });
  };
  function moved() {
    set();
    watch();
  }
  set();
  watch();
}
