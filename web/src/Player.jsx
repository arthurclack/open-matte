import Hls from 'hls.js';
import { createRef, useEffect, useId, useMemo, useRef, useState } from 'react';
import { api } from './api.js';
import { useMediaSession } from './mediaSession.js';
import PlaybackHelp from './PlaybackHelp.jsx';
import { codecName, scrub } from './playbackHelp.js';
import { loadPrefs, savePrefs } from './playerPrefs.js';
import { SUBTITLE_BACKGROUNDS, SUBTITLE_SIZES, audioLabel, initialAudio, initialSubtitle, languageName, menuSubtitles, showing } from './tracks.js';

const HEARTBEAT_MS = 30 * 1000;

const HALT_MESSAGES = {
  'playing-elsewhere': 'This screening is now playing on another device.',
  'screening-ended': 'This screening has ended.',
  expired: 'This ticket has expired.',
  revoked: 'This ticket is no longer valid.',
  unavailable: "This film isn't available right now.",
  unpublished: "This film isn't available right now.",
  forbidden: 'Playback stopped: this browser is no longer allowed to stream this film.',
  'not-found': 'This ticket is no longer valid.',
  'signed-out': 'This browser has been signed out, so the film has stopped.',
  unsupported: "This browser can't play this film. Try a recent version of Safari, Chrome, Edge or Firefox.",
  error: 'Something went wrong during playback.',
};

// Halts about playback itself, rather than the ticket or the screening: their
// message offers Playback help.
const HELP_FOR = new Set(['error', 'forbidden', 'unsupported']);

// MediaError codes, by name, for Playback help.
const MEDIA_ERRORS = { 1: 'MEDIA_ERR_ABORTED', 2: 'MEDIA_ERR_NETWORK', 3: 'MEDIA_ERR_DECODE', 4: 'MEDIA_ERR_SRC_NOT_SUPPORTED' };
// Playback help keeps the last few problems, in this page only.
const ERRORS_KEPT = 10;
// readyState once the tracks are known, and once it can play.
const HAVE_METADATA = 1;
const HAVE_FUTURE_DATA = 3;
// How long the film plays before the browser's track changes count as the viewer's.
const SETTLE_SECONDS = 0.5;

const SIZE_LABELS = { small: 'Small', medium: 'Medium', large: 'Large' };
const BACKGROUND_LABELS = { shadow: 'Shadow', box: 'Box' };

// Safari plays HLS itself, and handles HDR and AirPlay best that way.
// Everything else goes through hls.js on Media Source Extensions.
function prefersNativeHls(video) {
  const apple = /Apple/.test(navigator.vendor || '');
  return Boolean(video.canPlayType('application/vnd.apple.mpegurl')) && (apple || !Hls.isSupported());
}

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
  // The subtitles the menu offers: forced tracks aren't among them, they show by themselves.
  const listed = useMemo(() => menuSubtitles(subtitles), [subtitles]);
  // What this browser remembers from earlier films (playerPrefs.js), read once.
  const [remembered] = useState(loadPrefs);
  const [audioTracks, setAudioTracks] = useState([]); // { id, name, language, label }
  const [audioTrack, setAudioTrack] = useState(null);
  // The chosen subtitles, by index in the film's list; -1 is Off.
  const [subtitle, setSubtitle] = useState(() => initialSubtitle(subtitles, remembered.subtitles));
  // How subtitles look here, from the bar's Aa: classes on the picture's wrapper, drawn by ::cue.
  const [cueSize, setCueSize] = useState(remembered.subtitleSize);
  const [cueBackground, setCueBackground] = useState(remembered.subtitleBackground);
  const [styleOpen, setStyleOpen] = useState(false);
  const styleId = useId();
  const styleRef = useRef(null);
  const styleButtonRef = useRef(null);
  // The subtitle track the player last set showing (-1 for none), and the audio track it
  // last enabled in Safari's player. The browser's change events are checked against
  // them, so the player's own changes are never taken for the viewer's.
  const shownTrack = useRef(-1);
  const enabledAudio = useRef(null);
  // Whether the film has played for a moment or the viewer has touched the video. Before
  // that, a track the browser shows or enables by itself is its own pick as the film
  // loads, not the viewer's (Chrome shows the first subtitles it has once the player has
  // shown any; Safari follows the system's caption settings): the player's start choice
  // stands.
  const settled = useRef(false);
  // Which player runs the stream: Safari's own ('native') or hls.js ('hls').
  const [engine, setEngine] = useState(null);
  // Why it moved from Safari's player to hls.js, if it did: 'error' or 'quality'.
  const [handedOver, setHandedOver] = useState(null);
  // Quality: -1 is Auto.
  const [levels, setLevels] = useState([]); // { index, label }, best first
  const [level, setLevel] = useState(-1);
  const [current, setCurrent] = useState(null);
  const [halted, setHalted] = useState(null);
  // Where the next player should pick up: position, chosen rendition, audio track.
  const handoff = useRef({ position: startPosition(screening.position, film.media.durationSeconds), rendition: null, audioName: null });
  // Where playback really is. Once a halt has unloaded the film the video reads 0,
  // and the last progress reports and a retry still need the real position.
  const lastPosition = useRef(handoff.current.position);
  const position = () => (videoRef.current?.readyState ? videoRef.current.currentTime : lastPosition.current);
  const nativeChoices = useMemo(() => (engine === 'native' ? decodableRenditions(film.media.renditions) : []), [engine, film.media.renditions]);
  // Playback help: the panel, and the last few problems (newest last) for it. They
  // stay in this page: nothing sends them, and nothing that can hold an address is kept.
  const [helpOpen, setHelpOpen] = useState(false);
  const helpId = useId();
  const helpRef = useRef(null);
  const helpButtonRef = useRef(null);
  const errors = useRef([]);

  // The language being heard: the audio track's, or before the tracks are known (or with
  // the audio inside the picture's stream) the film's default audio. A forced track shows
  // with subtitles Off when it's in this language.
  const heard = audioTracks.find((t) => t.id === audioTrack);
  const audioLanguage = heard ? heard.language : (film.media.audio.find((a) => a.default) || film.media.audio[0])?.language || null;
  const shownIndex = showing(subtitles, subtitle, audioLanguage);
  const forcedShowing = subtitle < 0 && shownIndex >= 0;

  // An audio track for the menu, labelled with what the film's scan knows about it ("English · 5.1").
  const audioEntry = (id, name, language) => ({ id, name: name || null, language: language || null, label: audioLabel({ id, name, language }, film.media.audio) });

  function logError(source, detail, { fatal = true, status = null } = {}) {
    errors.current = [...errors.current, { at: Date.now(), source, detail, fatal, status }].slice(-ERRORS_KEPT);
  }

  function halt(code) {
    const video = videoRef.current;
    if (video?.readyState) lastPosition.current = video.currentTime;
    video?.pause();
    // Unload the film, so neither the lock screen's play button nor the browser's
    // own controls can carry on from what was buffered, with no screening and no
    // progress reports. "Watch here instead" starts a new player.
    if (hlsRef.current) {
      hlsRef.current.stopLoad();
      hlsRef.current.detachMedia();
    } else if (video) {
      video.removeAttribute('src');
      video.load();
    }
    logError('player', code);
    setHalted(code in HALT_MESSAGES ? code : 'error');
    if (code !== 'playing-elsewhere' && code !== 'unsupported') onHalt?.(code);
  }

  // While progress is reported (below): sends a report now, as paused, and resolves
  // true if the server refused the screening and the player halted with its reason.
  const reportNow = useRef(null);
  const asking = useRef(false);

  // The server refused a media request, or Safari's own player stopped with no hls.js
  // to carry on in. Usually the screening has moved on: another device took it over,
  // it ended, or the ticket went. Only a progress report hears which, so the player
  // asks with one and halts with the server's reason, for example with Watch here
  // instead after a takeover. `fallback` is for when the server still answers for this
  // browser, or can't be asked (admin preview has no screening).
  function refused(fallback) {
    if (asking.current) return;
    asking.current = true;
    // Nothing more is fetched while the server is asked.
    hlsRef.current?.stopLoad();
    const ask = reportNow.current;
    (ask ? ask() : Promise.resolve(false)).then((handled) => {
      asking.current = false;
      if (!handled) halt(fallback);
    });
  }

  // The lock screen and media keys, cleared once playback halts.
  useMediaSession(videoRef, film, !halted);

  // Pressing Play removes the button that had focus. Hand it to the video, so the
  // keyboard works straight away (Space to pause, arrows to seek) rather than
  // starting again from the top of the page. The film page scrolls to the player.
  useEffect(() => {
    if (!document.activeElement || document.activeElement === document.body) videoRef.current?.focus({ preventScroll: true });
  }, []);

  // ---- choose a player
  useEffect(() => {
    const video = videoRef.current;
    if (prefersNativeHls(video)) setEngine('native');
    else if (Hls.isSupported()) setEngine('hls');
    else {
      logError('player', 'unsupported');
      setHalted('unsupported');
    }
  }, []);

  // ---- note what the <video> itself reports, whichever player feeds it. Only the
  // kind of error, and its message with any address taken out.
  useEffect(() => {
    const video = videoRef.current;
    const onError = () => {
      const e = video.error;
      if (!e) return;
      const name = MEDIA_ERRORS[e.code] || `MediaError ${e.code}`;
      logError('video', e.message ? `${name}: ${scrub(e.message)}` : name);
    };
    video.addEventListener('error', onError);
    return () => video.removeEventListener('error', onError);
  }, []);

  // ---- load the stream (again, when Safari hands over to hls.js)
  useEffect(() => {
    if (!engine) return undefined;
    const video = videoRef.current;
    const { position: start, rendition } = handoff.current;

    if (engine === 'native') {
      video.src = screening.masterUrl;
      // The remembered audio language is applied once, when the tracks are known.
      let audioStarted = false;
      // Whether the player switched tracks for the remembered language.
      let switched = false;
      const syncAudio = () => {
        const list = video.audioTracks ? Array.from(video.audioTracks) : [];
        // Safari lists the film's audio only around loadedmetadata, and can add the
        // tracks one at a time: wait for metadata and the whole list (or until it can
        // play, if it lists fewer than the film has), or French remembered would be used
        // up on an empty or partial list and never applied.
        const whole = list.length >= film.media.audio.length || video.readyState >= HAVE_FUTURE_DATA;
        if (!audioStarted && list.length && whole && video.readyState >= HAVE_METADATA) {
          audioStarted = true;
          // Safari has already enabled the track it would play: among equal matches, that one.
          const id = initialAudio(list.map((t, i) => ({ id: i, language: t.language, default: t.enabled })), loadPrefs().audioLanguage);
          if (id != null && !list[id].enabled) {
            list.forEach((t, i) => (t.enabled = i === id));
            switched = true;
          }
          enabledAudio.current = list.findIndex((t) => t.enabled);
        }
        // As the film finishes loading, Safari can turn its own default back on beside
        // the track switched on for the remembered language (both then read as enabled).
        // That's Safari's doing, not the viewer's: until the film has played a moment,
        // the choice stands, as it does for subtitles.
        if (switched && !settled.current && enabledAudio.current >= 0 && list.some((t, i) => t.enabled !== (i === enabledAudio.current))) {
          list.forEach((t, i) => (t.enabled = i === enabledAudio.current));
        }
        setAudioTracks(list.map((t, i) => audioEntry(i, t.label, t.language)));
        const active = list.findIndex((t) => t.enabled);
        setAudioTrack(active >= 0 ? active : null);
        // Picked in Safari's or the iPhone's own menu: remembered, as if picked in the bar.
        if (audioStarted && active >= 0 && active !== enabledAudio.current) {
          enabledAudio.current = active;
          if (settled.current) savePrefs({ audioLanguage: list[active].language });
        }
      };
      const onMeta = () => {
        if (start) video.currentTime = start;
        syncAudio();
      };
      // If Safari's own player gives up, carry on in hls.js from the same moment
      // (on Auto). If that fails too, its error handling explains why.
      const onError = () => {
        if (!Hls.isSupported()) return refused('error');
        handoff.current = {
          position: video.currentTime || start,
          rendition: null,
          audioName: null,
        };
        // Playback carries on, so it isn't fatal; the video's own error says why.
        logError('player', "switched to hls.js after Safari's player stopped", { fatal: false });
        setHandedOver('error');
        setEngine('hls');
      };
      video.addEventListener('loadedmetadata', onMeta, { once: true });
      video.addEventListener('error', onError);
      video.addEventListener('canplay', syncAudio);
      video.audioTracks?.addEventListener?.('addtrack', syncAudio);
      video.audioTracks?.addEventListener?.('change', syncAudio);
      video.play().catch(() => {});
      return () => {
        // Also before metadata arrives: after a handover it would rewrite hls.js's audio list.
        video.removeEventListener('loadedmetadata', onMeta);
        video.removeEventListener('error', onError);
        video.removeEventListener('canplay', syncAudio);
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

    // The first time the tracks are known: the audio track chosen in Safari's player, kept
    // across the handover, or else the language this browser remembers. An empty list
    // (audio inside the picture's stream) isn't knowing them yet.
    let audioStarted = false;
    const syncAudio = () => {
      if (!audioStarted && hls.audioTracks.length) {
        audioStarted = true;
        const carried = handoff.current.audioName && hls.audioTracks.find((t) => t.name === handoff.current.audioName);
        handoff.current.audioName = null;
        const id = carried ? carried.id : initialAudio(hls.audioTracks.map((t) => ({ id: t.id, language: t.lang, default: t.default })), loadPrefs().audioLanguage);
        if (id != null && id !== hls.audioTrack) hls.audioTrack = id;
      }
      setAudioTracks(hls.audioTracks.map((t) => audioEntry(t.id, t.name, t.lang)));
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
      // Only the kind of error and the status: d.url, d.frag, d.response,
      // d.networkDetails, d.context and d.error can all hold the stream's address.
      logError('hls.js', `${d.type}: ${d.details}`, { fatal: Boolean(d.fatal), status: code ?? null });
      if (code === 403) return refused('forbidden');
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

  // From here on, a track the browser shows or enables is taken for the viewer's pick:
  // once the viewer touches the video, or the film has played on for a moment. Not as
  // soon as it plays: Safari can still turn the subtitles off, or its own default audio
  // back on, just after that, as it adds tracks of its own from the stream (with the
  // film already buffered, say).
  useEffect(() => {
    const video = videoRef.current;
    let playingFrom = null;
    const settle = () => {
      settled.current = true;
    };
    const onPlaying = () => {
      playingFrom ??= video.currentTime;
    };
    const onTime = () => {
      if (playingFrom != null && video.currentTime - playingFrom >= SETTLE_SECONDS) settle();
    };
    const events = ['pointerdown', 'keydown'];
    events.forEach((e) => video.addEventListener(e, settle));
    video.addEventListener('playing', onPlaying);
    video.addEventListener('timeupdate', onTime);
    return () => {
      events.forEach((e) => video.removeEventListener(e, settle));
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('timeupdate', onTime);
    };
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    const onTime = () => {
      if (video.readyState) lastPosition.current = video.currentTime;
    };
    video.addEventListener('timeupdate', onTime);
    return () => video.removeEventListener('timeupdate', onTime);
  }, []);

  // ---- report progress (not in admin preview, which has no screening)
  useEffect(() => {
    if (!screening.screeningId) return undefined;
    const video = videoRef.current;
    let stopped = false;
    // Resolves true once the server has refused the screening and the player has
    // halted. Two reports in flight can both be refused: the player halts once.
    const send = (playing, opts) => {
      if (stopped) return Promise.resolve(true);
      return api.post(`/api/screenings/${screening.screeningId}/heartbeat`, { position: position(), playing }, opts).then(
        () => false,
        (err) => {
          if (err.status !== 404 && err.status !== 409) return false;
          if (!stopped) {
            stopped = true;
            halt(err.code || 'error');
          }
          return true;
        },
      );
    };
    reportNow.current = () => send(false);
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
      reportNow.current = null;
      clearInterval(timer);
      onHide();
      stopped = true;
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('pause', onPause);
      window.removeEventListener('pagehide', onHide);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Show one subtitle track (-1: none) and turn the others off, noting which, so the
  // change events this causes aren't taken for the viewer's.
  function showTrack(index) {
    shownTrack.current = index;
    trackRefs.forEach((ref, i) => {
      if (ref.current?.track) ref.current.track.mode = i === index ? 'showing' : 'disabled';
    });
  }

  // ---- subtitles: one <track> per sidecar file. The chosen ones show, or with subtitles
  // Off, the forced track for the audio being heard, following it when the audio changes.
  useEffect(() => {
    showTrack(shownIndex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownIndex, trackRefs]);

  // ---- the browser's own subtitle menu (Safari's, the iPhone's in full screen, Chrome's):
  // a pick there moves the bar and is remembered, as if made in the bar.
  useEffect(() => {
    if (halted) return undefined;
    const list = videoRef.current.textTracks;
    const onChange = () => {
      const on = trackRefs.flatMap((ref, i) => (ref.current?.track?.mode === 'showing' ? [i] : []));
      // The browser may show its pick a moment before it turns the player's off.
      const picked = on.find((i) => i !== shownTrack.current) ?? on[0] ?? -1;
      if (picked === shownTrack.current) return;
      if (!settled.current) {
        showTrack(shownTrack.current);
        return;
      }
      // A forced track picked there counts as Off, and is remembered as Off: it shows by
      // itself whenever the audio calls for it.
      const forced = picked >= 0 && Boolean(subtitles[picked].forced);
      const chosen = forced ? -1 : picked;
      savePrefs({ subtitles: chosen < 0 ? 'off' : subtitles[chosen].language });
      setSubtitle(chosen);
      showTrack(showing(subtitles, chosen, audioLanguage));
    };
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [halted, subtitles, trackRefs, audioLanguage]);

  // Escape (focus goes back to Aa), a click elsewhere, or tabbing out closes the style panel.
  useEffect(() => {
    if (!styleOpen) return undefined;
    const close = (e) => {
      if (e.type === 'keydown') {
        if (e.key !== 'Escape') return;
        setStyleOpen(false);
        styleButtonRef.current?.focus();
      } else if (!styleRef.current?.contains(e.target)) {
        setStyleOpen(false);
      }
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    document.addEventListener('focusin', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
      document.removeEventListener('focusin', close);
    };
  }, [styleOpen]);

  // In Safari: picking a quality moves playback to hls.js at the same moment.
  // hls.js turns AirPlay off, so Auto stays on Safari's own player until then.
  function switchToChosen(key) {
    // Only an error can be retried this way: a screening that stopped (taken over,
    // ended, refused) stays stopped.
    if (halted && halted !== 'error') return;
    const rendition = nativeChoices.find((r) => r.key === key);
    if (!rendition) return;
    handoff.current = {
      position: position(),
      rendition,
      audioName: audioTracks.find((t) => t.id === audioTrack)?.name || null,
    };
    setAudioTracks([]);
    setLevels([]);
    setCurrent(null);
    // Doubles as a retry if Safari's player had stopped with an error.
    setHalted(null);
    setHandedOver('quality');
    setEngine('hls');
  }

  // A chosen rendition switches straight away; Auto hands control back to hls.js.
  function chooseLevel(value) {
    if (halted) return;
    const n = Number(value);
    if (hlsRef.current) hlsRef.current.currentLevel = n;
    setLevel(n);
  }

  // The bar's choices are the viewer's own, so they're remembered for the next film.
  function chooseAudio(id) {
    if (halted) return;
    const n = Number(id);
    if (hlsRef.current) hlsRef.current.audioTrack = n;
    else if (videoRef.current?.audioTracks) {
      enabledAudio.current = n;
      Array.from(videoRef.current.audioTracks).forEach((t, i) => (t.enabled = i === n));
    }
    setAudioTrack(n);
    savePrefs({ audioLanguage: audioTracks.find((t) => t.id === n)?.language });
  }

  function chooseSubtitle(value) {
    if (halted) return;
    const n = Number(value);
    setSubtitle(n);
    savePrefs({ subtitles: n < 0 ? 'off' : subtitles[n]?.language });
  }

  function chooseCueSize(size) {
    setCueSize(size);
    savePrefs({ subtitleSize: size });
  }

  function chooseCueBackground(background) {
    setCueBackground(background);
    savePrefs({ subtitleBackground: background });
  }

  // From the halt message: open the panel and bring it into view.
  function showHelp() {
    setHelpOpen(true);
    requestAnimationFrame(() => {
      helpRef.current?.focus({ preventScroll: true });
      helpRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }

  // Escape inside the panel: focus goes back to the link that opened it.
  function closeHelp() {
    setHelpOpen(false);
    helpButtonRef.current?.focus();
  }

  return (
    <>
      <div className={`cues-${cueSize} cues-${cueBackground}`} style={{ position: 'relative' }}>
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
              {HELP_FOR.has(halted) && (
                <button className="linklike" onClick={showHelp}>
                  Playback help
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
            <select value={audioTrack ?? ''} onChange={(e) => chooseAudio(e.target.value)} disabled={Boolean(halted)}>
              {audioTracks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {listed.length > 0 && (
          <label>
            Subtitles
            <select value={subtitle} onChange={(e) => chooseSubtitle(e.target.value)} disabled={Boolean(halted)}>
              <option value={-1}>{forcedShowing ? 'Off · signs and foreign dialogue shown' : 'Off'}</option>
              {listed.map((s) => (
                <option key={s.index} value={s.index}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {subtitles.length > 0 && (
          <div className="cue-style" ref={styleRef}>
            <button
              ref={styleButtonRef}
              type="button"
              className="cue-style-button"
              title="Subtitle style"
              aria-expanded={styleOpen}
              aria-controls={styleId}
              onClick={() => setStyleOpen(!styleOpen)}
            >
              Aa<span className="visually-hidden"> subtitle style</span>
            </button>
            {styleOpen && (
              <div id={styleId} className="cue-style-panel" role="group" aria-label="Subtitle style">
                <fieldset>
                  <legend>Size</legend>
                  {SUBTITLE_SIZES.map((size) => (
                    <label key={size}>
                      <input type="radio" name={`${styleId}-size`} checked={cueSize === size} onChange={() => chooseCueSize(size)} />
                      {SIZE_LABELS[size]}
                    </label>
                  ))}
                </fieldset>
                <fieldset>
                  <legend>Background</legend>
                  {SUBTITLE_BACKGROUNDS.map((background) => (
                    <label key={background}>
                      <input type="radio" name={`${styleId}-background`} checked={cueBackground === background} onChange={() => chooseCueBackground(background)} />
                      {BACKGROUND_LABELS[background]}
                    </label>
                  ))}
                </fieldset>
                <p>On iPhone in full screen, and on AirPlay, your device's own caption style applies (Settings ▸ Accessibility ▸ Subtitles &amp; Captioning).</p>
              </div>
            )}
          </div>
        )}
        <span className="spacer" />
        {engine === 'native' ? (
          nativeChoices.length > 1 ? (
            <label title="Picking a quality switches to Open Matte's own player. AirPlay comes back when you reload the page.">
              Quality
              <select value="-1" onChange={(e) => switchToChosen(e.target.value)} disabled={Boolean(halted) && halted !== 'error'}>
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
            <select value={level} onChange={(e) => chooseLevel(e.target.value)} disabled={Boolean(halted)}>
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
        <button ref={helpButtonRef} className="linklike" aria-expanded={helpOpen} aria-controls={helpId} onClick={() => setHelpOpen(!helpOpen)}>
          Playback help
        </button>
      </div>
      {helpOpen && (
        <PlaybackHelp
          id={helpId}
          panelRef={helpRef}
          videoRef={videoRef}
          hlsRef={hlsRef}
          errors={errors}
          engine={engine}
          handedOver={handedOver}
          renditions={film.media.renditions}
          quality={engine === 'hls' && level >= 0 ? levels.find((l) => l.index === level)?.label || 'Auto' : 'Auto'}
          audio={audioTracks.find((t) => t.id === audioTrack)?.label ?? null}
          subtitles={forcedShowing ? `Off (${languageName(subtitles[shownIndex].language)} forced subtitles showing)` : (subtitles[subtitle]?.label ?? null)}
          onClose={closeHelp}
        />
      )}
    </>
  );
}
