// Shapes film and ticket rows for the viewer-facing API.

export function filmMedia(film) {
  try {
    return JSON.parse(film.media || 'null') || {};
  } catch {
    return {};
  }
}

export function filmArtwork(film) {
  try {
    return JSON.parse(film.artwork || 'null') || {};
  } catch {
    return {};
  }
}

// The version changes when the image file does (older scans didn't record one).
const fileUrl = (film, file, version) => (file ? `/media/${film.slug}/${file}?v=${version || film.scanned_at || 0}` : null);

// Artwork downloaded from TMDb wins over the folder's; its file name changes
// whenever the image does, so it needs no version parameter.
export function artworkUrl(film, kind) {
  const downloaded = filmArtwork(film)[kind]?.file;
  if (downloaded) return `/artwork/${film.slug}/${downloaded}`;
  const media = filmMedia(film);
  return fileUrl(film, media[kind], media[`${kind}Version`]);
}

export function filmSummary(film) {
  return {
    slug: film.slug,
    title: film.title,
    year: film.year,
    runtimeMinutes: film.runtime_minutes,
    directors: film.directors,
    posterUrl: artworkUrl(film, 'poster'),
  };
}

export function filmDetail(film) {
  const media = filmMedia(film);
  const variants = media.variants || [];
  return {
    ...filmSummary(film),
    originalTitle: film.original_title,
    country: film.country,
    synopsis: film.synopsis,
    recommendation: film.recommendation,
    contentNote: film.content_note,
    backdropUrl: artworkUrl(film, 'backdrop'),
    media: {
      durationSeconds: media.durationSeconds ?? null,
      subtitles: (media.subtitles || []).map(({ file, language, label, forced, default: isDefault }) => ({
        url: `/media/${film.slug}/${file}`, language, label, forced, default: isDefault,
      })),
      audio: (media.audio || []).map(({ name, language, channels, default: isDefault, characteristics }) => ({
        name, language, channels, default: isDefault, description: /describes-video/.test(characteristics || ''),
      })),
      // For the quality menu in browsers that start on their own HLS player (Safari).
      renditions: variants.map((v) => ({ height: v.height, videoCodec: v.videoCodec, videoRange: v.videoRange || 'SDR', bandwidth: v.bandwidth })),
      maxHeight: Math.max(0, ...variants.map((v) => v.height || 0)) || null,
      hdr: variants.some((v) => v.videoRange && v.videoRange !== 'SDR'),
    },
  };
}

// The master playlist URL is only handed out once a screening has started.
export const masterUrl = (film) => {
  const media = filmMedia(film);
  return media.hls ? `/media/${film.slug}/${media.hls}` : null;
};

export function ticketForViewer(ticket, status) {
  if (!ticket || !status) return null;
  return {
    state: status.state,
    screeningLimit: status.screeningLimit,
    screeningsUsed: status.screeningsUsed,
    screeningsLeft: status.screeningsLeft,
    startBy: status.startBy,
    daysAfterFirstPlay: ticket.days_after_first_play,
    expiresAt: status.expiresAt,
    firstPlayedAt: ticket.first_played_at,
    openScreening: status.open ? { resumableUntil: status.open.resumable_until, position: status.open.position_seconds } : null,
  };
}
