import Hls from 'hls.js';
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { playbackItems, playbackSummary } from './playbackHelp.js';

// What the player and this browser say about playback, read live while the panel is
// open: for a viewer to read, or to copy and send to whoever runs the shop when
// something isn't working. Opening it and copying record nothing and send nothing.

// Seconds buffered ahead of the playhead, in the stretch it's in.
function bufferedAhead(video) {
  const now = video.currentTime;
  for (let i = 0; i < video.buffered.length; i++) {
    if (video.buffered.start(i) <= now + 0.1 && now <= video.buffered.end(i)) return video.buffered.end(i) - now;
  }
  return 0;
}

// Only what the summary may hold. The screening, its address, the film's slug and
// title and anything about the ticket never go in.
function collect(video, hls, { engine, handedOver, renditions, quality, audio, subtitles, errors }) {
  const level = hls?.levels?.[hls.currentLevel];
  const MS = window.ManagedMediaSource || window.MediaSource;
  const frames = video?.getVideoPlaybackQuality?.();
  return {
    at: Date.now(),
    engine,
    hlsVersion: engine === 'hls' ? Hls.version : null,
    handedOver,
    // Safari's player only says the picture's size.
    rendition: level
      ? { height: level.height, codec: level.videoCodec, range: level.videoRange, bitrate: level.bitrate }
      : video?.videoWidth
        ? { width: video.videoWidth, height: video.videoHeight }
        : null,
    quality,
    audio,
    subtitles,
    screen: { hdr: Boolean(window.matchMedia?.('(dynamic-range: high)').matches), pixelRatio: window.devicePixelRatio, width: video?.clientWidth, height: video?.clientHeight },
    buffer: video ? { ahead: bufferedAhead(video), readyState: video.readyState } : null,
    droppedFrames: frames ? { dropped: frames.droppedVideoFrames, total: frames.totalVideoFrames } : null,
    decode: [...new Set(renditions.map((r) => r.videoCodec).filter(Boolean))].map((codec) => ({
      codec,
      supported: MS?.isTypeSupported ? MS.isTypeSupported(`video/mp4; codecs="${codec}"`) : null,
    })),
    nativeHls: video?.canPlayType('application/vnd.apple.mpegurl') || '',
    userAgent: navigator.userAgent,
    errors: [...errors],
  };
}

export default function PlaybackHelp({ id, panelRef, videoRef, hlsRef, errors, engine, handedOver, renditions, quality, audio, subtitles, onClose }) {
  const read = useCallback(
    () => collect(videoRef.current, hlsRef.current, { engine, handedOver, renditions, quality, audio, subtitles, errors: errors.current }),
    [videoRef, hlsRef, errors, engine, handedOver, renditions, quality, audio, subtitles],
  );
  const [info, setInfo] = useState(read);
  const [copied, setCopied] = useState(false);
  // The summary, held out to copy by hand when the clipboard can't be used.
  const [manual, setManual] = useState(null);
  const manualRef = useRef(null);

  // About once a second while it's open.
  useEffect(() => {
    setInfo(read());
    const timer = setInterval(() => setInfo(read()), 1000);
    return () => clearInterval(timer);
  }, [read]);

  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  useEffect(() => {
    if (!manual) return;
    manualRef.current?.focus();
    manualRef.current?.select();
  }, [manual]);

  async function copy() {
    const text = playbackSummary(read());
    try {
      await navigator.clipboard.writeText(text);
      setManual(null);
      setCopied(true);
    } catch {
      // No clipboard in this browser, or it said no.
      setManual(text);
    }
  }

  const { items, errors: problems } = playbackItems(info);
  const headId = `${id}-h`;
  // The panel names nobody (no shop, no film), as its summary doesn't: either may be
  // shown or sent to someone else.
  return (
    <section
      id={id}
      ref={panelRef}
      className="playback-help fl-help"
      tabIndex={-1}
      aria-labelledby={headId}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <h2 id={headId}>Playback help</h2>
      <p>If something isn't working, copy the summary and send it to whoever runs the shop: it leaves out addresses, names and the film's title. Nothing here is recorded or sent.</p>
      <dl>
        {items.map(([name, value]) => (
          <Fragment key={name}>
            <dt>{name}</dt>
            <dd>{value}</dd>
          </Fragment>
        ))}
        <dt>Recent problems</dt>
        <dd>
          {problems.length ? (
            <ul>
              {problems.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          ) : (
            'None'
          )}
        </dd>
      </dl>
      <div className="ui-btns">
        <button type="button" className="ui-btn ui-btn--small" onClick={copy}>
          Copy summary
        </button>
        <span className="fl-help__done" role="status">
          {copied ? 'Copied' : ''}
        </span>
      </div>
      {manual && (
        <label className="ui-field fl-help__manual">
          <span className="ui-field__label">This browser wouldn't copy it. It's selected here: copy it with ⌘C or Ctrl+C.</span>
          <textarea className="ui-textarea" ref={manualRef} readOnly value={manual} rows={8} />
        </label>
      )}
    </section>
  );
}
