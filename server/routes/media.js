import fsp from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import { filmMedia } from '../films.js';
import { rangeKey } from '../ratelimit.js';
import { VIEWER_COOKIE, deviceLabel } from '../sessions.js';

const NO_COOKIE = 'no session cookie';

// Why a media request was refused, for the server log. No IP addresses: just
// enough to tell a missing cookie from a missing ticket or screening.
function denialReason(req, who, access, film) {
  if (!who.viewer) return (req.headers.cookie || '').includes(`${VIEWER_COOKIE}=`) ? 'session expired or unknown' : NO_COOKIE;
  const a = access.filmAccess(who, film);
  if (!a.canView) return 'no usable ticket for this film in this browser (or not signed in as its person)';
  if (a.via === 'member') return 'shown to members, but no ticket for this film in this browser';
  if (!a.canPlay) return `ticket ${a.status?.state}`;
  return 'no screening held by this browser';
}

// What kind of file a refused request was for, from its extension.
const KINDS = {
  '.m3u8': 'playlist',
  '.vtt': 'subtitles',
  ...Object.fromEntries(['.m4s', '.mp4', '.m4a', '.m4v', '.cmfv', '.cmfa', '.ts', '.aac'].map((e) => [e, 'segment'])),
  ...Object.fromEntries(['.jpg', '.jpeg', '.png', '.webp', '.avif'].map((e) => [e, 'artwork'])),
};

// Refused media requests, remembered in memory for the projection booth: how
// many of each reason since the server started, and the latest `keep` rows. A
// refusal just like one already kept (the same status, reason, kind of file,
// film and client) adds to that row's count and moves it to the top, so a player
// retrying, or a script asking again and again, is one row. A request from a
// stranger, with no session that's still signed in (no cookie, or one that has
// expired, been signed out or was made up), can come from anyone, so theirs keep
// to the latest `strangers` rows: however many there are, they can't push the
// others out. Playback help sends nothing, so these are all the server knows of
// playback going wrong. Only what's here is kept: no address, cookie, session,
// ticket, person, path or user agent, just the coarse client label the log line
// uses.
export function createRefusals({ keep = 50, strangers = 5, now = () => Date.now() } = {}) {
  const since = now();
  const recent = [];
  const byReason = {};
  let total = 0;

  function add({ status, reason, kind, film, client, stranger = false }) {
    total++;
    byReason[reason] = (byReason[reason] ?? 0) + 1;
    const same = (r) => r.status === status && r.reason === reason && r.kind === kind && r.film === film && r.client === client && r.stranger === stranger;
    const i = recent.findIndex(same);
    const row = i < 0 ? { at: 0, status, reason, kind, film, client, count: 0, stranger } : recent.splice(i, 1)[0];
    row.at = now();
    row.count++;
    recent.unshift(row);
    if (stranger) {
      const theirs = recent.filter((r) => r.stranger);
      for (const old of theirs.slice(strangers)) recent.splice(recent.indexOf(old), 1);
    }
    recent.length = Math.min(recent.length, keep);
  }

  // Newest first. Whether a row is a stranger's isn't sent: its reason says so.
  const view = (n = keep) => ({ since, total, byReason: { ...byReason }, recent: recent.slice(0, n).map(({ stranger, ...r }) => r) });

  return { add, view };
}

// The lines refused media requests write to the server log, within a budget.
// Anyone can have a request refused, as often as they like and each one a little
// different, so as with browsers' policy reports (csp.js, createCspReports) the same
// refusal (the same `key`: for logDenied, what makes one row in the booth) is
// logged once a minute at most, and once the minute is over a line says how many
// more like it there were. On top of that the log takes at most `perMinute` new
// lines a minute; past that, refusals are only counted, and once the minute is over
// one line says how many weren't logged. Strangers' requests (with no live session,
// as createRefusals has it) draw on a budget of their own, `strangers` lines a
// minute, so however many of them there are, they can't push the lines about
// viewers out of the log. The booth still counts every one.
export function createRefusalLog({ windowMs = 60 * 1000, perMinute = 30, strangers = 10, keep = 500, log = (line) => console.warn(line), now = () => Date.now() } = {}) {
  // key → { until, more, line } for the current minute's lines.
  const seen = new Map();
  // Each budget's new lines this minute, and the refusals past them that weren't logged.
  const budgets = {
    viewers: { max: perMinute, says: 'refused requests', until: 0, used: 0, dropped: 0 },
    strangers: { max: strangers, says: 'refused requests with no session', until: 0, used: 0, dropped: 0 },
  };

  // Starts a new minute for a budget once its last one is over, saying what it left out.
  function nextMinute(budget, t) {
    if (budget.until > t) return;
    if (budget.dropped) log(`media: ${budget.dropped} more ${budget.says} not logged in the minute before`);
    Object.assign(budget, { until: t + windowMs, used: 0, dropped: 0 });
  }

  function forget(key, had) {
    if (had.more) log(`${had.line}: ${had.more} more like it in the minute before`);
    seen.delete(key);
  }

  // `key` says which refusals are alike; `line` is the one to log. A repeat's line
  // replaces the one kept, so the count at the end of the minute follows the last.
  function add(key, line, { stranger = false } = {}) {
    const t = now();
    const budget = stranger ? budgets.strangers : budgets.viewers;
    nextMinute(budget, t);
    const k = `${stranger ? 'stranger' : 'viewer'} ${key}`;
    const had = seen.get(k);
    if (had && had.until > t) {
      had.more++;
      had.line = line;
      return;
    }
    if (had) forget(k, had);
    if (budget.used >= budget.max) {
      budget.dropped++;
      return;
    }
    // Never more than `keep`: forget the one that started longest ago, saying first
    // how many more it had.
    if (seen.size >= keep) {
      const [oldest, was] = seen.entries().next().value;
      forget(oldest, was);
    }
    budget.used++;
    log(line);
    seen.set(k, { until: t + windowMs, more: 0, line });
  }

  // For each minute that has ended with refusals unsaid, says how many.
  function sweep() {
    const t = now();
    for (const [key, had] of seen) if (had.until <= t) forget(key, had);
    for (const budget of Object.values(budgets)) nextMinute(budget, t);
  }

  const timer = setInterval(sweep, windowMs);
  timer.unref();
  return { add, sweep };
}

// `code` is the error code of a failed read, whose message (the reason) names
// the file's full path: the booth gets the code alone. `who` is the request's
// sessions, as sessions.load found them.
function logDenied(req, status, reason, { refusals, refusalLog, film, ext, code, who }) {
  const ua = req.get('user-agent') || '';
  const client = /AppleCoreMedia/.test(ua) ? `Apple media player (${deviceLabel(ua).split(' on ')[1]})` : deviceLabel(ua);
  // The Range header is the sender's to choose, of any length: only its start is logged.
  const range = req.headers.range ? ` - range ${req.headers.range.replace(/[^\x20-\x7e]/g, '?').slice(0, 40)}` : '';
  // So is the path, up to the size of a request's headers, and the budget below
  // counts lines, not their length: only its start is logged too.
  const where = req.path.replace(/[^\x20-\x7e]/g, '?').slice(0, 200);
  const kept = status === 500 ? `couldn't read the file${code ? ` (${code})` : ''}` : reason;
  const kind = KINDS[ext] ?? 'other';
  const stranger = !who.viewer && !who.admin;
  refusalLog.add(`${status} ${kept} ${kind} ${film.slug} ${client}`, `media ${status}: ${where} - ${reason} - ${client}${range}`, { stranger });
  refusals?.add({ status, reason: kept, kind, film: film.slug, client, stranger });
}

export const TYPES = {
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.m4s': 'video/iso.segment',
  '.mp4': 'video/mp4',
  '.m4a': 'audio/mp4',
  '.m4v': 'video/mp4',
  '.cmfv': 'video/mp4',
  '.cmfa': 'audio/mp4',
  '.ts': 'video/mp2t',
  '.aac': 'audio/aac',
  '.vtt': 'text/vtt; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
};

// sendFile's errors as the status to answer with: a missing or hidden file is a
// 404 that doesn't say why; send's own refusals (a range past the end, a failed
// If-Match) keep their 4xx; failing to read the file is a 500, which players
// retry.
export function fileErrorStatus(err) {
  const s = err.statusCode;
  return s === 403 || s === 404 || err.code === 'ENOENT' ? 404 : s >= 400 && s < 500 ? s : 500;
}

// An answer that isn't the file, as a bare status. None of the file's headers go
// with it, so it is never described, sized or cached as the file: a poster whose
// file has gone must not be a 404 cached for a week. A 416 says how long the
// file is, as it should; nothing else does.
export function sendBare(res, status) {
  for (const h of ['Content-Type', 'Content-Length', 'Cache-Control', 'ETag', 'Last-Modified', 'Accept-Ranges']) res.removeHeader(h);
  if (status !== 416) res.removeHeader('Content-Range');
  res.status(status).end();
}

// How many requests may be reading the films' folders at once, and how long one
// may wait for its answer to start. Node reads files on a small pool of threads
// (UV_THREADPOOL_SIZE: 4 unless set, 32 in the Docker image), and everything
// that reads a file waits for one of them: the web app's scripts, every page and
// the posters, as well as the films. A folder on network storage can stop
// answering rather than fail, and then each file operation on it holds its
// thread until it answers. So the films get half the threads at most, one per
// request, and the rest of the site keeps the other half.
//
// Those places are shared by everyone, so no one may hold them all. Posters and
// backdrops take a quarter of them at most (one, where there are fewer than 8): a
// link preview's poster needs no session, so anyone can ask for one, and they can
// never take the players' places. One browser holds four at most, as many as a
// player needs at once (video, audio, subtitles, and the artwork as it starts),
// and always leaves one for someone else; so does one address asking for posters.
// Of the posters' and backdrops' places, one browser or address holds all but one
// at most (createShare), so one that reads its posters slowly leaves the others
// one: in the Docker image, three of the four. Where there is only one, it can
// still hold it. A request over any of these waits for one of its own to finish.
// And a reader that stops reading loses its connection, and its place, once
// nothing has been sent for `idleMs`.
export function shareLimits(pool = Number(process.env.UV_THREADPOOL_SIZE) || 4) {
  const inFlight = Math.max(1, Math.floor(pool / 2));
  return {
    inFlight,
    artwork: Math.max(1, Math.floor(inFlight / 4)),
    perClient: Math.max(1, Math.min(4, inFlight - 1)),
    timeoutMs: 5000,
    idleMs: 20000,
  };
}

// A number of places, and the requests waiting for one, oldest first. take()
// gives a place at once if there's one free, and says so; otherwise `enter` is
// called once one is given back to it. leave() takes a request that gives up out
// of the queue.
function places(max) {
  let held = 0;
  const waiting = [];
  return {
    take(enter) {
      if (held < max) {
        held++;
        return true;
      }
      waiting.push(enter);
      return false;
    },
    leave(enter) {
      const i = waiting.indexOf(enter);
      if (i >= 0) waiting.splice(i, 1);
    },
    giveBack() {
      const next = waiting.shift();
      if (next) next();
      else held--;
    },
    get unused() {
      return held === 0 && waiting.length === 0;
    },
  };
}

// Sending files from the films' folders within those limits. A request takes a
// place, waiting for one if they're all taken, and gives it back once its file
// is sent. One whose answer hasn't started in the time allowed, waiting
// included, gets a 503, which players retry: nobody waits on a share that
// doesn't answer. Even after its 503 a request keeps its place until nothing it
// started there is still waiting, because until then it holds a thread.
// `artworkPerClient` is how many of the artwork's places one client may hold: all
// but one of them unless a test says otherwise, and at least one. Not half: a
// members' page asks for every film's poster at once, and the time a poster waits
// counts towards its deadline, so on slow storage the last of a long list would
// fail, and a broken image is never asked for again. It doesn't change how many a
// client holds in all (`perClient`): its posters count towards that too.
export function createShare({ inFlight, artwork = inFlight, perClient = inFlight, artworkPerClient = Math.max(1, artwork - 1), timeoutMs, idleMs = 20000 } = shareLimits()) {
  const all = places(inFlight);
  const art = places(artwork);
  // Each client's own places, while it holds or waits for one: for anything, and
  // for posters and backdrops.
  const clients = new Map();
  const clientsArt = new Map();
  const placesOf = (map, max, key) => {
    let p = map.get(key);
    if (!p) map.set(key, (p = places(max)));
    return p;
  };

  // res.sendFile, with these headers, for the file find() looks up in a film's
  // folder (folderFile's answer). Anything else is a bare status, passed to
  // failed() first with its reason, for the log. `client` names who asks: the
  // browser's session, or for a link preview's poster the visitor's address
  // (`clientName` says which, for the log). `artwork` is true for a poster or a
  // backdrop.
  async function send(res, find, { headers = {}, failed = () => {}, client = 'anyone', clientName = 'browser', artwork: isArt = false } = {}) {
    const fail = (problem) => {
      failed(problem);
      sendBare(res, problem.status);
    };
    // The places this request needs, taken in this order (the same for every
    // request, so none waits for a place another holds while holding one it
    // needs) and given back the other way round. A poster waits for one of its
    // client's artwork places first, holding nothing meanwhile, so at most
    // `artworkPerClient` of a browser's posters hold its own places at once.
    const mine = placesOf(clients, perClient, client);
    const mineArt = isArt ? placesOf(clientsArt, artworkPerClient, client) : null;
    const gates = isArt ? [mineArt, mine, art, all] : [mine, all];
    let held = 0;
    let placed = false;
    // Where the request waits for a place, if it does.
    let waiting = null;
    const giveBackAll = () => {
      while (held > 0) gates[--held].giveBack();
      if (mine.unused) clients.delete(client);
      if (mineArt?.unused) clientsArt.delete(client);
    };
    const ready = new Promise((resolve) => {
      const next = () => {
        waiting = null;
        while (held < gates.length) {
          const gate = gates[held];
          const enter = () => {
            held++;
            next();
          };
          if (!gate.take(enter)) return void (waiting = { gate, enter });
          held++;
        }
        placed = true;
        resolve();
      };
      next();
    });
    const leaveQueue = () => {
      waiting?.gate.leave(waiting.enter);
      waiting = null;
      giveBackAll();
    };
    // What holds the places: finding the file, then send's answer and the stream
    // it reads the file with.
    let holding = 1;
    const settled = () => {
      if (--holding === 0) giveBackAll();
    };
    let stream = null;
    let late = false;
    let closed = false;
    const timer = setTimeout(() => {
      if (closed || res.headersSent) return;
      late = true;
      if (!placed) {
        const gate = waiting?.gate;
        leaveQueue();
        const s = timeoutMs / 1000;
        return fail({
          status: 503,
          reason:
            gate === mine ? `waited ${s} seconds behind ${perClient} other requests from the same ${clientName}`
            : gate === mineArt ? `waited ${s} seconds behind ${artworkPerClient} other posters and backdrops from the same ${clientName}`
            : `waited ${s} seconds for the films' folders, busy with other requests`,
        });
      }
      // send may still be opening the file: nothing it reads comes here now.
      if (stream) {
        stream.unpipe(res);
        stream.destroy();
      }
      fail({ status: 503, reason: `no answer from the films' folder within ${timeoutMs / 1000} seconds` });
    }, timeoutMs);
    res.once('close', () => {
      closed = true;
      clearTimeout(timer);
      if (!placed) leaveQueue();
    });

    await ready;
    // Answered already, or the viewer went away: nothing to do there.
    if (late || closed) return settled();
    let found;
    try {
      found = await find();
    } catch (err) {
      found = { status: 500, reason: err.message, code: err.code };
    }
    if (late || closed) return settled();
    if (found.status) {
      clearTimeout(timer);
      settled();
      return fail(found);
    }
    holding++;
    res.once('pipe', (src) => {
      stream = src;
      holding++;
      // The file is read as the viewer takes it. An answer that has started and
      // then takes nothing for idleMs (the viewer stopped reading, or the share
      // stopped answering mid-file) is cut off, so it can't keep its place for as
      // long as the connection stays open. Until the answer starts, the deadline
      // above applies instead.
      const idle = setTimeout(() => {
        if (res.headersSent && !res.writableEnded) res.destroy();
      }, idleMs);
      src.on('data', () => idle.refresh());
      src.once('close', () => {
        clearTimeout(idle);
        settled();
      });
    });
    settled();
    res.set(headers);
    res.sendFile(found.file, { root: found.root, dotfiles: 'deny' }, (err) => {
      clearTimeout(timer);
      settled();
      // Done, or the viewer went away mid-download (seeking, closing the tab).
      if (!err || err.code === 'ECONNABORTED' || res.headersSent) return;
      const status = fileErrorStatus(err);
      fail({ status, reason: err.statusCode === 403 ? 'hidden file' : status === 404 ? 'file missing from the film folder' : err.message, code: err.code });
    });
  }

  return { send };
}

// A file in a film's folder, by its path there: { root, file } to pass to
// sendFile, or { status, reason } when it can't be served (no reason: nothing
// worth logging). Where the file really is must be inside the folder too, so a
// symlink can't serve something from elsewhere on the server.
export async function folderFile(mediaDir, film, rel) {
  // No file's name holds a NUL: there is no such file, and nothing to log.
  if (rel.includes('\0')) return { status: 404 };
  const root = path.join(mediaDir, film.slug);
  const file = path.resolve(root, rel);
  if (!file.startsWith(root + path.sep)) return { status: 404 };
  let real;
  let realRoot;
  try {
    // One after the other: on a share that doesn't answer, each holds a thread
    // (see shareLimits), and a request may hold one.
    real = await fsp.realpath(file);
    realRoot = await fsp.realpath(root);
  } catch (err) {
    // Anything but a missing file (permissions, network storage briefly
    // unavailable) is the server's problem, and players retry those.
    const missing = ['ENOENT', 'ENOTDIR', 'ENAMETOOLONG'].includes(err.code);
    return missing ? { status: 404, reason: 'file missing from the film folder' } : { status: 500, reason: err.message, code: err.code };
  }
  if (!real.startsWith(realRoot + path.sep)) return { status: 404, reason: 'symlink to a file outside the film folder' };
  return { root: realRoot, file: path.relative(realRoot, real) };
}

// /media/<slug>/<path>. Every request is checked against the viewer's session:
// artwork needs whatever lets you see the film page (a ticket, or being signed
// in, for a film shown to members); master and child playlists, init and media
// segments, audio and subtitles need a screening that this browser holds.
// Knowing a file path is not enough.
export function mediaRoutes({ db, sessions, access, mediaDir, metadata, refusals, refusalLog, share, counter }) {
  const router = express.Router();
  const filmBySlug = db.prepare('SELECT * FROM films WHERE slug = ?');

  router.get('/media/:slug/*rest', async (req, res) => {
    const rel = path.posix.normalize([].concat(req.params.rest).join('/'));
    const ext = path.extname(rel).toLowerCase();
    // A kind of file never served, for any film.
    if (!TYPES[ext]) return res.status(404).end();
    // The sessions before the film. Loading one can write when it was last seen
    // (sessions.js), which the person's account page shows for each of their
    // browsers: a session touched only when the film is real would say which
    // films there are.
    const who = { viewer: sessions.load(req, 'viewer'), admin: sessions.load(req, 'admin') };
    const film = filmBySlug.get(req.params.slug);
    // No such film is answered as a film this browser may not have, so the
    // answer doesn't say which films there are. Nothing to log.
    if (!film) return res.status(403).end();
    const about = { refusals, refusalLog, film, ext, who };
    const media = filmMedia(film);
    const isArtwork = rel === media.poster || rel === media.backdrop;
    const allowed = isArtwork ? access.filmAccess(who, film).canView : access.mayStream(who, film);
    if (!allowed) {
      logDenied(req, 403, denialReason(req, who, access, film), about);
      return res.status(403).end();
    }
    if (film.media_status === 'missing') return res.status(404).end();

    await share.send(res, () => folderFile(mediaDir, film, rel), {
      // This browser's places, whichever session let it in.
      client: `session ${(who.viewer ?? who.admin).id_hash}`,
      artwork: isArtwork,
      headers: {
        'Content-Type': TYPES[ext],
        // Only the viewer's own browser may keep any of them. Artwork's address
        // changes with the image (?v=). Playlists, segments and the rest keep
        // their names when a film is encoded again into its folder, so the
        // browser asks each time; unchanged, the answer is a 304.
        'Cache-Control': isArtwork ? 'private, max-age=86400' : 'private, no-cache',
      },
      failed: ({ status, reason, code }) => reason && logDenied(req, status, reason, { ...about, code }),
    });
  });

  // /artwork/<slug>/<file>: posters and backdrops downloaded from TMDb.
  // Same rule as the folder's artwork: whatever shows you the page. But a refusal
  // here is answered as no such film, not as a 403 like /media's: the file's name
  // is the start of a hash of the image's path at TMDb (metadata.js), which anyone
  // can look up, and a film's slug is its folder's name, often just its title. A
  // 403 would tell anyone who asks for a film's likely poster that the film is
  // here, published or not. So no such film, no such file, a browser that may not
  // see it and one over either limit all get the same bare 404, and the file
  // itself is only looked at for a browser that may have it.
  //
  // The limits slow down guessing names, so they count only the answers that find
  // nothing: a poster that is sent tells its browser nothing it may not know, and
  // a household sharing one IPv4 address loads a poster for every film on a page
  // on each of its devices. Two thousand every ten minutes per client (an IPv4
  // address, or an IPv6 /64) gives a script asking for name after name a little
  // over three a second. Anyone can have an IPv6 /48 for nothing, and with it
  // 65,536 /64s, so each /48 has six thousand as well (rangeKey), whichever of its
  // /64s they come from. Over either limit, nothing is looked up, recorded or
  // counted, so a script hammering from one /64 can't use up its neighbours' share
  // of the /48.
  const artworkCount = counter({ windowMs: 10 * 60 * 1000, max: 2000 });
  const artworkRangeCount = counter({ windowMs: 10 * 60 * 1000, max: 6000, key: rangeKey });
  // An answer that found nothing, counted against both limits. Only a request
  // within both gets this far.
  const noSuchArtwork = (req, res) => {
    artworkCount(req);
    artworkRangeCount(req);
    sendBare(res, 404);
  };
  router.get('/artwork/:slug/:file', (req, res) => {
    if (artworkCount.over(req) || artworkRangeCount.over(req)) return sendBare(res, 404);
    // The sessions before the film and its file, as on /media, so that no such
    // film touches a session just as a refusal does.
    const who = { viewer: sessions.load(req, 'viewer'), admin: sessions.load(req, 'admin') };
    const film = filmBySlug.get(req.params.slug);
    const file = film && metadata.artworkPath(film, req.params.file);
    if (!file) return noSuchArtwork(req, res);
    const about = { refusals, refusalLog, film, ext: path.extname(file).toLowerCase(), who };
    if (!access.filmAccess(who, film).canView) {
      // Still a refusal for the booth and the log, with the status it was answered with.
      logDenied(req, 404, denialReason(req, who, access, film), about);
      return noSuchArtwork(req, res);
    }
    // The file name changes whenever the image does.
    res.set('Cache-Control', 'private, max-age=604800, immutable');
    res.sendFile(file, (err) => {
      if (!err || err.code === 'ECONNABORTED' || res.headersSent) return;
      const status = fileErrorStatus(err);
      if (status === 404 || status === 500) logDenied(req, status, status === 404 ? 'downloaded artwork missing from the data folder' : err.message, { ...about, code: err.code });
      sendBare(res, status);
    });
  });

  return router;
}
