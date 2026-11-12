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

// A link as its holder sees it, from what access.filmAccess decided: one set of keys
// in every state. Only the borrower learns anything about a loan. Anyone else with a
// link for a film whose tape is out gets state and tape 'out' and the date it's due
// back, and every other key as it would be whichever link has the tape.
//   state      'ok' (Play is offered), 'out', 'spent', 'expired' or 'unavailable';
//   tape       'in', 'yours', 'out', or null (spent, expired). It goes by the loan,
//              not by state: an unavailable film keeps it;
//   loanDays   with the tape in: how many days Play would lend it for;
//   startBy    with the tape in, or once missed: the date to start by;
//   dueBack    while the tape is out, with this browser or anyone;
//   loan       while it is this browser's: when it was taken, where playback is, and
//              whether it is out to this browser (a link for anyone) or to the person;
//   returned   for a spent link, and only to the one who borrowed: when the tape came
//              back, and whether they returned it ('returned') or it was due ('due').
// expiresAt and openScreening are 1.1.0's, kept until its pages are rebuilt: the due
// date, and the place to resume from, while the tape is this browser's.
export function ticketForViewer(a) {
  if (!a?.ticket || !a.status) return null;
  const { ticket, status, view, tape } = a;
  const yours = tape === 'yours';
  const dueBack = yours || tape === 'out' ? status.out.due_at : null;
  const position = yours ? a.screening.position_seconds : null;
  return {
    state: view === 'in' || view === 'yours' ? 'ok' : view,
    tape,
    loanDays: tape === 'in' ? status.loanDays : null,
    startBy: tape === 'in' || view === 'expired' ? status.startBy : null,
    dueBack,
    loan: yours ? { takenAt: status.loan.taken_at, position, finishedAt: a.screening.finished_at, toBrowser: status.loan.person_id == null } : null,
    returned:
      view === 'spent' && a.mine
        ? { at: status.loan.ended_at ?? status.loan.due_at, how: status.loan.ended_how === 'returned' ? 'returned' : 'due' }
        : null,
    // In the signed-in person's account, so on every device they sign in on.
    inAccount: ticket.person_id != null,
    expiresAt: yours ? dueBack : null,
    openScreening: yours ? { resumableUntil: dueBack, position } : null,
  };
}
