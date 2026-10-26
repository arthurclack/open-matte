import Hls from 'hls.js';
import { createRef, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.js';

const HEARTBEAT_MS = 30 * 1000;

const HALT_MESSAGES = {
  'playing-elsewhere': 'This screening is now playing on another device.',
  'screening-ended': 'This screening has ended.',
  expired: 'This ticket has expired.',
  used_up: 'This ticket has been used up.',
  revoked: 'This ticket is no longer valid.',
  unavailable: "This film isn't available right now.",
  unpublished: "This film isn't available right now.",
  forbidden: 'Playback stopped: this browser is no longer allowed to stream this film.',
  'not-found': 'This ticket is no longer valid.',
  unsupported: "This browser can't play this film. Try a recent version of Safari, Chrome, Edge or Firefox.",
  error: 'Something went wrong during playback.',
};

// Safari plays HLS itself, and handles HDR and AirPlay best that way.
// Everything else goes through hls.js on Media Source Extensions.
function prefersNativeHls(video) {
  const apple = /Apple/.test(navigator.vendor || '');
  return Boolean(video.canPlayType('application/vnd.apple.mpegurl')) && (apple || !Hls.isSupported());
}

const codecName = (c = '') => (/^(hvc1|hev1)/.test(c) ? 'HEVC' : /^avc/.test(c) ? 'H.264' : /^av01/.test(c) ? 'AV1' : c.split('.')[0]);

function levelLabel(level) {
  if (!level) return null;
  const range = level.videoRange && level.videoRange !== 'SDR' ? ' HDR' : '';
  return `${level.height}p ${codecName(level.videoCodec)}${range}`;
}

const qualityLabel = (level, bitrate) => `${levelLabel(level)} · ${((bitrate || 0) / 1e6).toFixed(1)} Mbit/s`;

// The renditions this browser could play through hls.js, from the film's scan
// data. Safari starts on its own player, which can't be told a quality, so its
// menu is built from these; picking one hands playback over to hls.js.
function decodableRenditions(renditions = []) {
  const MS = window.ManagedMediaSource || window.MediaSource;
  if (!MS?.isTypeSupported) return [];
  const hdrScreen = window.matchMedia?.('(dynamic-range: high)').matches;
  return renditions
    .filter((r) => r.videoCodec && MS.isTypeSupported(`video/mp4; codecs="${r.videoCodec}"`) && (r.videoRange === 'SDR' || hdrScreen))
    .map((r, i) => ({ ...r, key: `r${i}`, label: qualityLabel(r, r.bandwidth) }))
    .sort((a, b) => b.height - a.height || b.bandwidth - a.bandwidth);
}

// The hls.js level for a rendition chosen from the scan's list. hls.js may have
// dropped that exact rendition (a codec or HDR check of its own), so fall back to
// the closest one it kept: same height, then the nearest lower, then the lowest.
function matchLevel(levels, wanted) {
  const tries = [
    (l) => l.bitrate === wanted.bandwidth && l.height === wanted.height,
    (l) => l.height === wanted.height && codecName(l.videoCodec) === codecName(wanted.videoCodec),
    (l) => l.height === wanted.height,
  ];
  for (const t of tries) {
    const i = levels.findIndex(t);
    if (i >= 0) return i;
  }
  let best = -1;
  levels.forEach((l, i) => {
    const lower = l.height <= wanted.height;
    const bestLower = best >= 0 && levels[best].height <= wanted.height;
    if (best < 0 || (lower && (!bestLower || l.height > levels[best].height)) || (!lower && !bestLower && l.height < levels[best].height)) best = i;
  });
  return best;
}

// Resume from the saved position unless it's right at the start or the end.
function startPosition(position, duration) {
  if (!position || position < 15) return 0;
  if (duration && position > duration * 0.95) return 0;
  return position;
}

export default function Player({ film, screening, onHalt, onReclaim }) {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const subtitles = film.media.subtitles;
  const trackRefs = useMemo(() => subtitles.map(() => createRef()), [subtitles]);
  const [audioTracks, setAudioTracks] = useState([]); // { id, label }
  const [audioTrack, setAudioTrack] = useState(null);
  const [subtitle, setSubtitle] = useState(() => subtitles.findIndex((s) => s.default));
  // Which player runs the stream: Safari's own ('native') or hls.js ('hls').
  const [engine, setEngine] = useState(null);
  // Quality: -1 is Auto.
  const [levels, setLevels] = useState([]); // { index, label }, best first
  const [level, setLevel] = useState(-1);
  const [current, setCurrent] = useState(null);
  const [halted, setHalted] = useState(null);
  // Where the next player should pick up: position, chosen rendition, audio track.
  const handoff = useRef({ position: startPosition(screening.position, film.media.durationSeconds), rendition: null, audioName: null });
  const nativeChoices = useMemo(() => (engine === 'native' ? decodableRenditions(film.media.renditions) : []), [engine, film.media.renditions]);

  function halt(code) {
    const video = videoRef.current;
    video?.pause();
    hlsRef.current?.stopLoad();
    setHalted(code in HALT_MESSAGES ? code : 'error');
    if (code !== 'playing-elsewhere' && code !== 'unsupported') onHalt?.();
  }

  // ---- choose a player
  useEffect(() => {
    const video = videoRef.current;
    if (prefersNativeHls(video)) setEngine('native');
    else if (Hls.isSupported()) setEngine('hls');
    else setHalted('unsupported');
  }, []);

  // ---- load the stream (again, when Safari hands over to hls.js)
  useEffect(() => {
    if (!engine) return undefined;
    const video = videoRef.current;
    const { position: start, rendition, audioName } = handoff.current;

    if (engine === 'native') {
      video.src = screening.masterUrl;
      const onMeta = () => {
        if (start) video.currentTime = start;
      };
      const syncAudio = () => {
        const list = video.audioTracks ? Array.from(video.audioTracks) : [];
        setAudioTracks(list.map((t, i) => ({ id: i, label: t.label || t.language || `Track ${i + 1}` })));
        const active = list.findIndex((t) => t.enabled);
        setAudioTrack(active >= 0 ? active : null);
      };
      // If Safari's own player gives up, carry on in hls.js from the same moment
      // (on Auto). If that fails too, its error handling explains why.
      const onError = () => {
        if (!Hls.isSupported()) return halt('error');
        handoff.current = {
          position: video.currentTime || start,
          rendition: null,
          audioName: null,
        };
        setEngine('hls');
      };
      video.addEventListener('loadedmetadata', onMeta, { once: true });
      video.addEventListener('error', onError);
      video.audioTracks?.addEventListener?.('addtrack', syncAudio);
      video.audioTracks?.addEventListener?.('change', syncAudio);
      video.play().catch(() => {});
      return () => {
        video.removeEventListener('error', onError);
        video.audioTracks?.removeEventListener?.('addtrack', syncAudio);
        video.audioTracks?.removeEventListener?.('change', syncAudio);
        video.removeAttribute('src');
        video.load();
      };
    }

    const hdrScreen = window.matchMedia?.('(dynamic-range: high)').matches;
    const hls = new Hls({
      // Don't fetch 4K for a small window; quality stays on Auto otherwise.
      capLevelToPlayerSize: true,
      startPosition: start || -1,
      videoPreference: { preferHDR: hdrScreen, allowedVideoRanges: hdrScreen ? ['SDR', 'PQ', 'HLG'] : ['SDR'] },
    });
    hlsRef.current = hls;
    let networkRetries = 0;

    const syncAudio = () => {
      // Keep the audio track chosen in Safari's player across the handover.
      const carried = handoff.current.audioName && hls.audioTracks.find((t) => t.name === handoff.current.audioName);
      handoff.current.audioName = null;
      if (carried && carried.id !== hls.audioTrack) hls.audioTrack = carried.id;
      setAudioTracks(hls.audioTracks.map((t) => ({ id: t.id, label: t.name || t.lang || `Track ${t.id + 1}` })));
      setAudioTrack(hls.audioTrack);
    };
    hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, syncAudio);
    hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, syncAudio);
    // hls.js drops renditions this browser can't decode, so these are all playable.
    const syncLevels = () => {
      setLevels(
        hls.levels
          .map((l, index) => ({ index, height: l.height || 0, bitrate: l.bitrate || 0, label: qualityLabel(l, l.bitrate) }))
          .sort((a, b) => b.height - a.height || b.bitrate - a.bitrate),
      );
    };
    hls.on(Hls.Events.LEVELS_UPDATED, syncLevels);
    hls.on(Hls.Events.LEVEL_SWITCHED, (_, d) => setCurrent(levelLabel(hls.levels[d.level])));
    hls.on(Hls.Events.MANIFEST_PARSED, (_, d) => {
      if (!d.levels.length) halt('unsupported');
      syncLevels();
      // Arriving from Safari's player with a quality already chosen.
      if (rendition) {
        const i = matchLevel(hls.levels, rendition);
        if (i >= 0) {
          hls.currentLevel = i;
          setLevel(i);
        }
        handoff.current.rendition = null;
      }
    });
    hls.on(Hls.Events.ERROR, (_, d) => {
      const code = d.response?.code ?? d.networkDetails?.status;
      if (code === 403) return halt('forbidden');
      if (!d.fatal) return;
      if (d.type === Hls.ErrorTypes.NETWORK_ERROR && networkRetries++ < 3) {
        hls.startLoad();
      } else if (d.type === Hls.ErrorTypes.MEDIA_ERROR) {
        hls.recoverMediaError();
      } else {
        halt(d.details === Hls.ErrorDetails.MANIFEST_INCOMPATIBLE_CODECS_ERROR ? 'unsupported' : 'error');
      }
    });
    hls.loadSource(screening.masterUrl);
    hls.attachMedia(video);
    video.play().catch(() => {});

    return () => {
      hls.destroy();
      hlsRef.current = null;
    };
    // The player is keyed by screening; only the engine changes while mounted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine]);

  // ---- report progress (not in admin preview, which has no screening)
  useEffect(() => {
    if (!screening.screeningId) return undefined;
    const video = videoRef.current;
    let stopped = false;
    const send = (playing, opts) => {
      if (stopped) return;
      api
        .post(`/api/screenings/${screening.screeningId}/heartbeat`, { position: video.currentTime, playing }, opts)
        .catch((err) => {
          if (err.status === 404 || err.status === 409) {
            stopped = true;
            halt(err.code || 'error');
          }
        });
    };
    const timer = setInterval(() => {
      if (!video.paused && !video.ended) send(true);
    }, HEARTBEAT_MS);
    const onPlaying = () => send(true);
    const onPause = () => send(false);
    const onHide = () => send(false, { keepalive: true });
    video.addEventListener('playing', onPlaying);
    video.addEventListener('pause', onPause);
    window.addEventListener('pagehide', onHide);
    return () => {
      clearInterval(timer);
      onHide();
      stopped = true;
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('pause', onPause);
      window.removeEventListener('pagehide', onHide);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- subtitles: one <track> per sidecar file, shown on request
  useEffect(() => {
    trackRefs.forEach((ref, i) => {
      if (ref.current?.track) ref.current.track.mode = i === subtitle ? 'showing' : 'disabled';
    });
  }, [subtitle, trackRefs]);

  // In Safari: picking a quality moves playback to hls.js at the same moment.
  // hls.js turns AirPlay off, so Auto stays on Safari's own player until then.
  function switchToChosen(key) {
    const rendition = nativeChoices.find((r) => r.key === key);
    if (!rendition) return;
    const video = videoRef.current;
    handoff.current = {
      position: video.currentTime,
      rendition,
      audioName: audioTracks.find((t) => t.id === audioTrack)?.label || null,
    };
    setAudioTracks([]);
    setLevels([]);
    setCurrent(null);
    // Doubles as a retry if Safari's player had stopped with an error.
    setHalted(null);
    setEngine('hls');
  }

  // A chosen rendition switches straight away; Auto hands control back to hls.js.
  function chooseLevel(value) {
    const n = Number(value);
    if (hlsRef.current) hlsRef.current.currentLevel = n;
    setLevel(n);
  }

  function chooseAudio(id) {
    const n = Number(id);
    if (hlsRef.current) hlsRef.current.audioTrack = n;
    else if (videoRef.current?.audioTracks) {
      Array.from(videoRef.current.audioTracks).forEach((t, i) => (t.enabled = i === n));
    }
    setAudioTrack(n);
  }

  return (
    <>
      <div style={{ position: 'relative' }}>
        <video ref={videoRef} controls playsInline preload="metadata" poster={film.backdropUrl || undefined}>
          {subtitles.map((s, i) => (
            <track key={s.url} ref={trackRefs[i]} kind="subtitles" src={s.url} srcLang={s.language} label={s.label} />
          ))}
        </video>
        {halted && (
          <div className="player-message">
            <div>
              <p>{HALT_MESSAGES[halted]}</p>
              {halted === 'playing-elsewhere' && (
                <button className="btn primary" onClick={onReclaim}>
                  Watch here instead
                </button>
              )}
            </div>
          </div>
        )}
      </div>
      <div className="player-bar">
        {audioTracks.length > 1 && (
          <label>
            Audio
            <select value={audioTrack ?? ''} onChange={(e) => chooseAudio(e.target.value)}>
              {audioTracks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {subtitles.length > 0 && (
          <label>
            Subtitles
            <select value={subtitle} onChange={(e) => setSubtitle(Number(e.target.value))}>
              <option value={-1}>Off</option>
              {subtitles.map((s, i) => (
                <option key={s.url} value={i}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <span className="spacer" />
        {engine === 'native' ? (
          nativeChoices.length > 1 ? (
            <label title="Picking a quality switches to Open Matte's own player. AirPlay comes back when you reload the page.">
              Quality
              <select value="-1" onChange={(e) => switchToChosen(e.target.value)}>
                <option value="-1">Auto</option>
                {nativeChoices.map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <span title="Safari's player picks the quality itself">Quality: Auto</span>
          )
        ) : levels.length > 1 ? (
          <label title="Auto adjusts to your connection and screen">
            Quality
            <select value={level} onChange={(e) => chooseLevel(e.target.value)}>
              <option value={-1}>Auto{level === -1 && current ? ` (${current})` : ''}</option>
              {levels.map((l) => (
                <option key={l.index} value={l.index}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>
        ) : (
          current && <span>Quality: {current}</span>
        )}
        {screening.preview && <span className="badge">Preview</span>}
      </div>
    </>
  );
}
