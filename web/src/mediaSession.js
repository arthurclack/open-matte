import { useEffect } from 'react';
import { useSite } from './site.jsx';

// The lock screen, Control Center, Chrome's media controls and headphone buttons:
// what's playing, where it's got to, and play, pause and ±10 s. Every action goes
// through the page's own <video>, so heartbeats and the one-device rule see it
// exactly as if the viewer had used the player. Nothing here talks to the server.

const supported = () => 'mediaSession' in navigator && typeof window.MediaMetadata === 'function';

// How often the position shown there is corrected while playing. It runs on by
// itself between corrections; seeks, pauses and rate changes correct it at once.
const POSITION_EVERY_MS = 5000;

const IMAGE_TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', avif: 'image/avif' };

// The poster as an absolute address on this site (the operating system fetches it,
// not the page), with its type when the file name says.
function artwork(posterUrl) {
  if (!posterUrl) return [];
  const url = new URL(posterUrl, location.href);
  const type = IMAGE_TYPES[url.pathname.match(/\.(\w+)$/)?.[1].toLowerCase()];
  return [type ? { src: url.href, type } : { src: url.href }];
}

// Older browsers throw for actions they don't know.
function setHandler(action, handler) {
  try {
    navigator.mediaSession.setActionHandler(action, handler);
  } catch {
    // not offered in this browser
  }
}

// active is false once the player has halted: a stopped screening mustn't leave a
// play button on the lock screen that would try to start it again.
export function useMediaSession(videoRef, film, active) {
  const site = useSite()?.site;
  const showFilm = site?.mediaSessionTitle !== false;
  const cinemaName = site?.cinemaName || 'Open Matte';
  const { title, year, posterUrl } = film;

  // The film and its poster, or only the cinema's name if the admin has asked for that.
  useEffect(() => {
    if (!active || !supported()) return undefined;
    navigator.mediaSession.metadata = new window.MediaMetadata(
      showFilm ? { title, artist: cinemaName, ...(year ? { album: String(year) } : {}), artwork: artwork(posterUrl) } : { title: cinemaName },
    );
    return () => {
      navigator.mediaSession.metadata = null;
    };
  }, [active, showFilm, cinemaName, title, year, posterUrl]);

  // The buttons, and whether it's playing and where.
  useEffect(() => {
    if (!active || !supported()) return undefined;
    const video = videoRef.current;
    const session = navigator.mediaSession;

    const seekBy = (seconds) => {
      const end = Number.isFinite(video.duration) ? video.duration : Infinity;
      video.currentTime = Math.min(end, Math.max(0, video.currentTime + seconds));
    };
    const handlers = {
      play: () => video.play().catch(() => {}),
      pause: () => video.pause(),
      seekbackward: (d) => seekBy(-(d.seekOffset || 10)),
      seekforward: (d) => seekBy(d.seekOffset || 10),
      seekto: (d) => {
        if (!Number.isFinite(d.seekTime)) return;
        if (d.fastSeek && typeof video.fastSeek === 'function') video.fastSeek(d.seekTime);
        else video.currentTime = d.seekTime;
      },
    };
    for (const [action, handler] of Object.entries(handlers)) setHandler(action, handler);

    let positionAt = 0;
    const position = () => {
      positionAt = Date.now();
      const { duration, currentTime, playbackRate } = video;
      if (!(Number.isFinite(duration) && duration > 0 && currentTime >= 0 && currentTime <= duration)) return;
      try {
        session.setPositionState({ duration, playbackRate, position: currentTime });
      } catch {
        // a value it won't take, such as a rate of 0
      }
    };
    const listeners = {
      playing: () => {
        session.playbackState = 'playing';
      },
      pause: () => {
        session.playbackState = 'paused';
        position();
      },
      play: position,
      loadedmetadata: position,
      durationchange: position,
      ratechange: position,
      seeked: position,
      timeupdate: () => {
        if (Date.now() - positionAt >= POSITION_EVERY_MS) position();
      },
    };
    for (const [event, listener] of Object.entries(listeners)) video.addEventListener(event, listener);
    session.playbackState = video.paused ? 'paused' : 'playing';
    position();

    return () => {
      for (const [event, listener] of Object.entries(listeners)) video.removeEventListener(event, listener);
      for (const action of Object.keys(handlers)) setHandler(action, null);
      session.playbackState = 'none';
      try {
        session.setPositionState();
      } catch {
        // older browsers can't clear it
      }
    };
  }, [active, videoRef]);
}
