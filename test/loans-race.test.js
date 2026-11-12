// Two links pressed at once on one film: exactly one loan. Version 2, slice 2
// (docs/version-2.md, "The model" and "What can happen to a tape"). One process runs
// its request handlers one after another, so two HTTP requests "at once" only take
// turns (test/boundaries.test.js has that race). Here two threads, each with a
// connection of its own to one database file, are released together, so two writers
// truly overlap: the IMMEDIATE transaction around Play serialises them, and the
// loans_out index is the backstop. This file is also the thread's own code.
//
// Slice 3 ("Coming back") adds the races around a tape that is out: a return against
// a take-back (one winner), Play on another link against a take-back, a return against
// the borrower's own progress report, and Play against a return at the very
// millisecond the tape is due. Each thread does one of these every round, with a
// clock of its own passed in, as test/screenings.test.js does.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import { test } from 'node:test';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const DAY = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------- the thread
// Opens the file for itself. For each round it says it has arrived, then watches the
// gate without sleeping, so that both threads see it open within the same instant, and
// does its one thing on that round's film: presses Play with its own link (`play`),
// returns the tape its browser has (`return`), reports progress on it (`report`), or,
// as the owner, takes the tape back (`take-back`). Says what each one answered.
if (!isMainThread) {
  const { openDb } = await import('../server/db.js');
  const { createAccess } = await import('../server/access.js');
  const { createSettings } = await import('../server/settings.js');
  const { file, name, rounds, gate, now, action = 'play' } = workerData;
  const db = openDb(file);
  const access = createAccess(db, createSettings(db));
  const viewer = { ...db.prepare('SELECT * FROM sessions WHERE id_hash = ?').get(sha256(name)) };
  const films = db.prepare('SELECT * FROM films ORDER BY id').all();
  // The tape that is out on each film before the round begins, if one is.
  const out = films.map((film) => db.prepare('SELECT * FROM loans WHERE film_id = ? AND ended_at IS NULL').get(film.id));
  const act = {
    play(round) {
      const r = access.startScreening(viewer, films[round], now + round);
      return r.error ? { error: r.error } : { took: !r.resumed, loan: r.loan.id, ticket: r.ticket.id };
    },
    return(round) {
      const r = access.returnTape(viewer, films[round], { takenAt: out[round].taken_at }, now + round);
      return r.error ? { error: r.error } : { returned: r.returned.at };
    },
    report(round) {
      const r = access.heartbeat(viewer, out[round].screening_id, { position: 50 }, now + round);
      return r.error ? { error: r.error } : { ok: true };
    },
    'take-back'(round) {
      const r = access.takeBack(out[round].id, out[round].ticket_id, now + round);
      return r.error ? { error: r.error } : { tookBack: r.loan.ended_at };
    },
  }[action];
  // [the round the gate is open for, how many arrivals so far]
  const flag = new Int32Array(gate);
  const answers = [];
  for (let round = 0; round < rounds; round++) {
    Atomics.add(flag, 1, 1);
    // Until the main thread opens the gate for this round, once both have arrived.
    while (Atomics.load(flag, 0) <= round);
    try {
      answers.push(act(round));
    } catch (err) {
      answers.push({ threw: err.message });
    }
  }
  db.close();
  parentPort.postMessage({ answers });
}

// ---------------------------------------------------------------- the tests
if (isMainThread) {
  const { openDb } = await import('../server/db.js');
  const { createAccess } = await import('../server/access.js');
  const { createSettings } = await import('../server/settings.js');
  const { tempDir } = await import('./helpers.js');

  // A shop with `rounds` films, each with a link for each of two browsers. With
  // `lent`, the left browser has every film's tape, taken at the shop's `now`.
  function shop(rounds, { lent = false } = {}) {
    const file = path.join(tempDir(), 'open-matte.db');
    const db = openDb(file);
    const now = Date.now();
    const browsers = ['left', 'right'];
    for (const name of browsers) {
      db.prepare("INSERT INTO sessions (id_hash, kind, device, created_at, last_seen_at, expires_at) VALUES (?, 'viewer', 'Safari on Mac', ?, ?, ?)").run(sha256(name), now, now, now + 90 * DAY);
    }
    const links = [];
    for (let i = 0; i < rounds; i++) {
      const film = Number(db.prepare("INSERT INTO films (slug, title, published, media_status, created_at, updated_at) VALUES (?, ?, 1, 'ok', ?, ?)").run(`film-${i}`, `Film ${i}`, now, now).lastInsertRowid);
      links.push(
        browsers.map((name, j) => {
          const id = Number(db.prepare('INSERT INTO tickets (code, film_id, created_at) VALUES (?, ?, ?)').run(`code${j}${String(i).padStart(8, '0')}`, film, now).lastInsertRowid);
          db.prepare('INSERT INTO session_tickets (session_hash, ticket_id, added_at) VALUES (?, ?, ?)').run(sha256(name), id, now);
          return id;
        }),
      );
    }
    if (lent) {
      const access = createAccess(db, createSettings(db));
      const left = { ...db.prepare('SELECT * FROM sessions WHERE id_hash = ?').get(sha256('left')) };
      for (const film of db.prepare('SELECT * FROM films ORDER BY id').all()) assert.equal(access.startScreening(left, film, now).error, undefined);
    }
    return { file, db, now, browsers, links };
  }

  // Two threads, each doing its one thing on the same film in the same instant, round
  // after round. `threads` is [[browser, action, clock], [browser, action, clock]].
  // Returns what each answered, round by round.
  async function together(file, rounds, threads) {
    const gate = new SharedArrayBuffer(8);
    const flag = new Int32Array(gate);
    const workers = threads.map(([name, action, now]) => new Worker(new URL(import.meta.url), { workerData: { file, name, rounds, gate, now, action } }));
    try {
      // A thread that fails stops the test, not the run.
      let failed = null;
      const done = workers.map(
        (w) =>
          new Promise((resolve, reject) => {
            w.on('error', (err) => reject((failed = err)));
            w.on('message', (m) => m.answers && resolve(m.answers));
          }),
      );
      for (const d of done) d.catch(() => {});
      // Each round, the gate opens only once both threads are at it.
      for (let round = 0; round < rounds; round++) {
        while (Atomics.load(flag, 1) < 2 * (round + 1)) {
          if (failed) throw failed;
          await new Promise((resolve) => setImmediate(resolve));
        }
        Atomics.store(flag, 0, round + 1);
      }
      return await Promise.all(done);
    } finally {
      await Promise.all(workers.map((w) => w.terminate()));
    }
  }
  const filmOf = (db, round) => db.prepare('SELECT id FROM films WHERE slug = ?').get(`film-${round}`).id;
  const loansOf = (db, filmId) => db.prepare('SELECT * FROM loans WHERE film_id = ? ORDER BY id').all(filmId).map((l) => ({ ...l }));
  const returnedEvents = (db, loan) =>
    db.prepare("SELECT * FROM events WHERE type = 'returned' AND ticket_id = ?").all(loan.ticket_id).map((e) => JSON.parse(e.detail)).filter((d) => d.loanId === loan.id);

  test('two threads, each with its own connection, pressing Play on two links for one film at the same moment, round after round: every round has one tape out and one refusal', async () => {
    const ROUNDS = 200;
    const { file, db, now, browsers, links } = shop(ROUNDS);
    const gate = new SharedArrayBuffer(8);
    const flag = new Int32Array(gate);
    const workers = browsers.map((name) => new Worker(new URL(import.meta.url), { workerData: { file, name, rounds: ROUNDS, gate, now } }));
    try {
      // A thread that fails stops the test, not the run.
      let failed = null;
      const done = workers.map(
        (w) =>
          new Promise((resolve, reject) => {
            w.on('error', (err) => reject((failed = err)));
            w.on('message', (m) => m.answers && resolve(m.answers));
          }),
      );
      for (const d of done) d.catch(() => {});
      // Each round, the gate opens only once both threads are at it.
      for (let round = 0; round < ROUNDS; round++) {
        while (Atomics.load(flag, 1) < 2 * (round + 1)) {
          if (failed) throw failed;
          await new Promise((resolve) => setImmediate(resolve));
        }
        Atomics.store(flag, 0, round + 1);
      }
      const [left, right] = await Promise.all(done);

      const wins = [0, 0];
      for (let round = 0; round < ROUNDS; round++) {
        const pair = [left[round], right[round]];
        const took = pair.filter((a) => a.took);
        const refused = pair.filter((a) => a.error);
        assert.equal(took.length, 1, `round ${round}: ${JSON.stringify(pair)}`);
        assert.deepEqual(refused, [{ error: 'out' }], `round ${round}: ${JSON.stringify(pair)}`);
        wins[pair.indexOf(took[0])]++;
        // One loan on the film, out, on the winner's link; one screening; nothing else.
        const filmId = db.prepare('SELECT id FROM films WHERE slug = ?').get(`film-${round}`).id;
        const loans = db.prepare('SELECT * FROM loans WHERE film_id = ?').all(filmId);
        assert.equal(loans.length, 1, `round ${round}`);
        assert.deepEqual([loans[0].id, loans[0].ticket_id, loans[0].ended_at], [took[0].loan, took[0].ticket, null]);
        assert.ok(links[round].includes(loans[0].ticket_id));
        assert.equal(db.prepare('SELECT COUNT(*) AS n FROM screenings WHERE film_id = ?').get(filmId).n, 1, `round ${round}`);
      }
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM loans').get().n, ROUNDS);
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM events WHERE type = 'lent'").get().n, ROUNDS);
      assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
      // Not a foregone conclusion: over 200 rounds, each thread got there first sometimes.
      assert.ok(wins[0] > 0 && wins[1] > 0, `each thread won some rounds: ${wins.join(' and ')}`);
    } finally {
      await Promise.all(workers.map((w) => w.terminate()));
      db.close();
    }
  });

  test('two connections, the second pressing Play while the first is still inside its transaction: it waits, then sees the tape out', () => {
    const { file, db, now, browsers, links } = shop(1);
    const other = openDb(file);
    try {
      const [left, right] = browsers.map((name) => ({ ...db.prepare('SELECT * FROM sessions WHERE id_hash = ?').get(sha256(name)) }));
      const film = db.prepare('SELECT * FROM films').get();
      const took = createAccess(db, createSettings(db)).startScreening(left, film, now);
      assert.equal(took.error, undefined);
      // A second process on the same file: its own connection, its own statements.
      const refused = createAccess(other, createSettings(other)).startScreening(right, film, now);
      assert.equal(refused.error, 'out');
      assert.deepEqual(other.prepare('SELECT ticket_id FROM loans').all().map((l) => l.ticket_id), [links[0][0]]);
    } finally {
      other.close();
      db.close();
    }
  });

  test('the backstop: a plain second loan on a film whose tape is out is refused by the database itself', () => {
    const { db, now, browsers, links } = shop(1);
    try {
      const left = { ...db.prepare('SELECT * FROM sessions WHERE id_hash = ?').get(sha256(browsers[0])) };
      const film = db.prepare('SELECT * FROM films').get();
      const took = createAccess(db, createSettings(db)).startScreening(left, film, now);
      // As a second process that skipped the check would write it: another link, another play.
      const play = Number(
        db.prepare('INSERT INTO screenings (ticket_id, film_id, session_hash, started_at, resumable_until, last_heartbeat_at, active_until) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(links[0][1], film.id, sha256(browsers[1]), now, now + 3 * DAY, now, now).lastInsertRowid,
      );
      const insert = db.prepare('INSERT INTO loans (film_id, ticket_id, screening_id, session_hash, taken_at, due_at) VALUES (?, ?, ?, ?, ?, ?)');
      assert.throws(() => insert.run(film.id, links[0][1], play, sha256(browsers[1]), now, now + 3 * DAY), /UNIQUE constraint failed: loans\.film_id/);
      // And once the first is over, the same insert goes through: one tape, lent again.
      db.prepare("UPDATE loans SET ended_at = ?, ended_how = 'returned' WHERE id = ?").run(now + 1, took.loan.id);
      assert.doesNotThrow(() => insert.run(film.id, links[0][1], play, sha256(browsers[1]), now + 2, now + 3 * DAY));
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM loans WHERE film_id = ? AND ended_at IS NULL').get(film.id).n, 1);
    } finally {
      db.close();
    }
  });

  // ------------------------------------------------------------ slice 3: coming back
  test('a return racing a take-back, round after round: one winner, the loan ended once, and the link cancelled only when the owner won', async (t) => {
    const ROUNDS = 200;
    const { file, db, now } = shop(ROUNDS, { lent: true });
    try {
      const [returns, takeBacks] = await together(file, ROUNDS, [['left', 'return', now + 1000], ['left', 'take-back', now + 1000]]);
      const wins = { returned: 0, 'taken-back': 0 };
      for (let round = 0; round < ROUNDS; round++) {
        const pair = [returns[round], takeBacks[round]];
        const said = `round ${round}: ${JSON.stringify(pair)}`;
        const [loan, ...more] = loansOf(db, filmOf(db, round));
        assert.deepEqual(more, [], said);
        assert.ok(loan.ended_at !== null && ['returned', 'taken-back'].includes(loan.ended_how), said);
        const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(loan.ticket_id);
        const holders = db.prepare('SELECT COUNT(*) AS n FROM session_tickets WHERE ticket_id = ?').get(loan.ticket_id).n;
        if (loan.ended_how === 'returned') {
          assert.deepEqual(pair, [{ returned: loan.ended_at }, { error: 'not-out' }], said);
          assert.deepEqual([ticket.revoked_at, holders], [null, 1], 'returned: the link is spent, not cancelled');
        } else {
          assert.deepEqual(pair, [{ error: 'nothing-to-return' }, { tookBack: loan.ended_at }], said);
          assert.deepEqual([ticket.revoked_at, holders], [loan.ended_at, 0], 'taken back: the link is cancelled');
        }
        assert.deepEqual(returnedEvents(db, loan).map((d) => d.how), [loan.ended_how], `${said}: logged once`);
        wins[loan.ended_how]++;
      }
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM events WHERE type = 'returned'").get().n, ROUNDS);
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM loans WHERE ended_at IS NULL').get().n, 0);
      assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
      t.diagnostic(`who got there first: ${JSON.stringify(wins)}`);
      assert.ok(wins.returned > 0 && wins['taken-back'] > 0, `each won some rounds: ${JSON.stringify(wins)}`);
    } finally {
      db.close();
    }
  });

  test('Play on another link racing a take-back: the tape is always taken back, and the other link takes it only if it pressed after', async (t) => {
    const ROUNDS = 200;
    const { file, db, now, links } = shop(ROUNDS, { lent: true });
    try {
      const [plays, takeBacks] = await together(file, ROUNDS, [['right', 'play', now + 1000], ['left', 'take-back', now + 1000]]);
      const outcomes = { out: 0, took: 0 };
      for (let round = 0; round < ROUNDS; round++) {
        const said = `round ${round}: ${JSON.stringify([plays[round], takeBacks[round]])}`;
        const [first, ...later] = loansOf(db, filmOf(db, round));
        assert.deepEqual([first.ticket_id, first.ended_how, takeBacks[round]], [links[round][0], 'taken-back', { tookBack: first.ended_at }], said);
        if (plays[round].error) {
          // Pressed first: the tape was still out, and nothing was taken.
          assert.deepEqual([plays[round], later], [{ error: 'out' }, []], said);
          outcomes.out++;
        } else {
          assert.deepEqual(later.map((l) => [l.id, l.ticket_id, l.ended_at]), [[plays[round].loan, links[round][1], null]], said);
          assert.equal(plays[round].took, true, said);
          outcomes.took++;
        }
        assert.ok(later.length <= 1, said);
      }
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM (SELECT film_id FROM loans WHERE ended_at IS NULL GROUP BY film_id HAVING COUNT(*) > 1)').get().n, 0, 'never two tapes out for one film');
      t.diagnostic(`what Play was told: ${JSON.stringify(outcomes)}`);
      assert.ok(outcomes.out > 0 && outcomes.took > 0, `both orders happened: ${JSON.stringify(outcomes)}`);
    } finally {
      db.close();
    }
  });

  test('a return racing the borrower’s own progress report: the return always goes through, and a report lands before it or is told "returned"', async (t) => {
    const ROUNDS = 200;
    const { file, db, now } = shop(ROUNDS, { lent: true });
    try {
      const [returns, reports] = await together(file, ROUNDS, [['left', 'return', now + 1000], ['left', 'report', now + 1000]]);
      const outcomes = { before: 0, after: 0 };
      for (let round = 0; round < ROUNDS; round++) {
        const said = `round ${round}: ${JSON.stringify([returns[round], reports[round]])}`;
        const [loan] = loansOf(db, filmOf(db, round));
        assert.deepEqual([loan.ended_how, returns[round]], ['returned', { returned: loan.ended_at }], said);
        const play = db.prepare('SELECT * FROM screenings WHERE id = ?').get(loan.screening_id);
        if (reports[round].ok) {
          assert.equal(play.position_seconds, 50, `${said}: it landed before the return`);
          outcomes.before++;
        } else {
          assert.deepEqual(reports[round], { error: 'returned' }, said);
          assert.equal(play.position_seconds, 0, `${said}: a report after the return moves nothing`);
          outcomes.after++;
        }
        assert.ok(play.active_until <= loan.ended_at, `${said}: playing nowhere once it is back`);
        assert.equal(returnedEvents(db, loan).length, 1, said);
      }
      t.diagnostic(`the report landed: ${JSON.stringify(outcomes)}`);
      assert.ok(outcomes.before > 0 && outcomes.after > 0, `both orders happened: ${JSON.stringify(outcomes)}`);
    } finally {
      db.close();
    }
  });

  test('at the millisecond a tape is due: Play on another link always takes it, and the borrower’s return a millisecond earlier either got in first or finds it came due', async (t) => {
    const ROUNDS = 200;
    const { file, db, now, links } = shop(ROUNDS, { lent: true });
    try {
      const due = now + 3 * DAY;
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM loans WHERE due_at = ?').get(due).n, ROUNDS);
      // Each thread's clock is `now + round`, so every film gets a due time of its own.
      db.prepare('UPDATE loans SET due_at = due_at + (film_id - (SELECT MIN(id) FROM films))').run();
      const [plays, returns] = await together(file, ROUNDS, [['right', 'play', due], ['left', 'return', due - 1]]);
      const ends = { returned: 0, due: 0 };
      for (let round = 0; round < ROUNDS; round++) {
        const said = `round ${round}: ${JSON.stringify([plays[round], returns[round]])}`;
        const [first, second, ...more] = loansOf(db, filmOf(db, round));
        assert.deepEqual(more, [], said);
        // The other link's Play, at the due time itself: never "out".
        assert.deepEqual([plays[round].took, plays[round].loan], [true, second.id], said);
        assert.deepEqual([second.ticket_id, second.taken_at, second.ended_at], [links[round][1], due + round, null], said);
        // The first loan ended once: returned a millisecond before it was due, or due.
        if (first.ended_how === 'returned') assert.deepEqual([first.ended_at, returns[round]], [due + round - 1, { returned: due + round - 1 }], said);
        else assert.deepEqual([first.ended_how, first.ended_at, returns[round]], ['due', due + round, { error: 'nothing-to-return' }], said);
        assert.deepEqual(returnedEvents(db, first).map((d) => d.how), [first.ended_how], said);
        ends[first.ended_how]++;
      }
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM loans WHERE ended_at IS NULL').get().n, ROUNDS, 'one tape out for each film');
      t.diagnostic(`how the first loan ended: ${JSON.stringify(ends)}`);
      assert.ok(ends.returned > 0 && ends.due > 0, `both orders happened: ${JSON.stringify(ends)}`);
    } finally {
      db.close();
    }
  });

  test('one connection, in each order, at the due millisecond: a millisecond before, the tape is the borrower’s; at the moment itself, it is anyone’s', () => {
    const { db, now, browsers, links } = shop(4, { lent: true });
    try {
      const access = createAccess(db, createSettings(db));
      const [left, right] = browsers.map((name) => ({ ...db.prepare('SELECT * FROM sessions WHERE id_hash = ?').get(sha256(name)) }));
      const films = db.prepare('SELECT * FROM films ORDER BY id').all();
      const loan = (i) => ({ ...db.prepare('SELECT * FROM loans WHERE ticket_id = ?').get(links[i][0]) });
      const due = now + 3 * DAY;

      // A millisecond before: everything of the borrower's goes, and the other link is refused.
      assert.equal(access.startScreening(right, films[0], due - 1).error, 'out');
      assert.deepEqual(access.heartbeat(left, loan(0).screening_id, { position: 9 }, due - 1), { ok: true });
      assert.equal(access.startScreening(left, films[0], due - 1).resumed, true);
      assert.equal(loan(0).ended_at, null);
      // At the moment itself, the borrower first: every one of theirs is refused, and the other link takes it.
      assert.deepEqual(access.heartbeat(left, loan(0).screening_id, { position: 10 }, due), { error: 'due' });
      assert.equal(access.startScreening(left, films[0], due).error, 'spent');
      assert.equal(access.returnTape(left, films[0], { takenAt: now }, due).error, 'nothing-to-return');
      assert.equal(access.takeBack(loan(0).id, links[0][0], due).error, 'not-out');
      assert.deepEqual([loan(0).ended_at, loan(0).ended_how], [due, 'due']);
      assert.equal(access.startScreening(right, films[0], due).resumed, false);

      // The other link first, then the borrower: the same.
      assert.equal(access.startScreening(right, films[1], due).resumed, false);
      assert.deepEqual([loan(1).ended_at, loan(1).ended_how], [due, 'due']);
      assert.deepEqual(access.heartbeat(left, loan(1).screening_id, { position: 10 }, due), { error: 'due' });
      assert.equal(access.returnTape(left, films[1], { takenAt: now }, due).error, 'nothing-to-return');

      // A return a millisecond before, then Play at the moment: returned, not due.
      assert.deepEqual(access.returnTape(left, films[2], { takenAt: now }, due - 1).returned, { at: due - 1 });
      assert.equal(access.startScreening(right, films[2], due - 1).resumed, false, 'free at once');
      // A take-back a millisecond before, then the borrower's report at the moment: taken back, not due.
      assert.equal(access.takeBack(loan(3).id, links[3][0], due - 1).loan.ended_how, 'taken-back');
      assert.deepEqual(access.heartbeat(left, loan(3).screening_id, { position: 10 }, due), { error: 'taken-back' });
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM events WHERE type = 'returned'").get().n, 4);
    } finally {
      db.close();
    }
  });
}
