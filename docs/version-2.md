# Version 2: one tape, one borrower

A draft plan for version 2.0, written on 11 November 2026. It is not yet agreed: the
table under [To decide](#to-decide) holds the questions that are still yours. It builds
on 1.1.0, the video shop look, released on 10 November 2026, and starts from `main` at
44d4d02 (schema 7, 764 unit tests, 63 browser journeys). [roadmap.md](roadmap.md) says
what version 2 is; this says how it would be built. As each slice ships, its rules move
into [access.md](access.md) and its box in the roadmap gets ticked.

It was put together from three separate designs of 2.0 (one changing as little as
possible, one starting from the data model, one starting from the risks), each checked
against today's code. The risk-first design is the base, with parts of the other two.

## What it's for

Open Matte becomes a one-shelf video shop that lends. Each film is one tape. You send a
friend a link, and nothing happens to the tape until they press Play. Play takes it out,
and from then it is theirs until the date it's due back: they can watch it as often as
they like. Anyone else with a link sees "Out on loan" and that date, never who has it.
The tape comes back when the time runs out, when the borrower returns it, or when you
take it back. A signed-in friend can hand it back with a few words for you alone.

The look shipped in 1.1.0. Version 2 adds the behaviour, a database change (migration
8), and the new states of the screens that 1.1.0 already draws.

## Words

1.1.0 calls a ticket a tape ([access.md](access.md#words), `docs/access.md:14-32`). In
version 2 the tape is the film's one copy, and what you send is **a link**. This plan
uses the words that way. The code, the API's routes and the database keep "ticket" and
"screening", as they did in 1.1.0: a link is a row in `tickets`, its address is still
`/t/<code>`, and the playback of a loan is a row in `screenings`. The one new word in
the code is **loan**. The mock-up splits the word: its back office says link, and its
friend's pages still say tape for what was sent
(`.claude/design/vhs/app/friend/notes.md:101`). Which a friend reads, and which strings
change, is question 11 under To decide.

## Decisions

### Settled

Yours. These are not reopened here.

| When | Decision |
|---|---|
| 5 Nov 2026 | Each film is one tape, and one borrower has it at a time. Two people on one film at once is out of 2.0 (perhaps a watch-along in version 3). |
| 5 Nov 2026 | Links are sent freely, several for one film if you like. Sending a link doesn't take the tape. |
| 5 Nov 2026 | Pressing Play takes the tape, if it is in. The check and the take are one step, so two people can't both take it. |
| 5 Nov 2026 | The borrower has a set time to watch, shown as the date it is due back. |
| 5 Nov 2026 | While it is out, anyone else with a link sees "Out on loan" and the due-back date, never who has it, and can't press Play. |
| 5 Nov 2026 | It comes back when the time runs out, when the borrower returns it early ("Return it now"), or when you take the tape back. |
| The mock-up | The back office shows who has each tape and since when. Friends never see who. |
| The mock-up | On a link anyone can use, the borrower is the browser that pressed Play. Your own previews never take a tape (true today: `server/access.js:164`, `server/routes/viewer.js:146`). |
| 5 Nov 2026 | "Picked for you": your message to one person about one film, kept apart from the film's staff pick, so editing one never changes the other. |
| 5 Nov 2026 | Handing it back: four responses ("Loved it", "Still thinking about it", "Not for me", "Let's talk") with an optional message, for signed-in friends only, shared only with you, and the screen says so. |
| 5 Nov 2026 | On your card: what you have out, when it's due back, and continue watching. |
| 10 Nov 2026 | A link lends once: it is spent when its tape comes back. Taking a tape back also cancels that person's link. |
| 10 Nov 2026 | A friend responds only when handing a tape back, not after it goes back on its own (tentative). |
| 10 Nov 2026 | Loans default to 3 days, adjustable "per tape" (per link: question 1, below). Play limits go: watch as often as you like until it's due back. One clock: the time to come back and "days after the first play" become one due-back time. |
| 10 Nov 2026 | "Picked for you" is allowed on a link anyone can use. The form says whoever has the link will read it. |
| 10 Nov 2026 | A film with no artwork shows a plain kraft sleeve with the shop's logo when it has one, nothing otherwise, and never Open Matte's frame mark. Already so in 1.1.0 (`web/src/look/objects.jsx:238-269`). |
| 11 Nov 2026 | Question 1. "Per tape" means per link: the loan length is chosen for each link when you send it, with the shop's default filled in (answer a). What a due-back date can then give away is under "Never who has it". |
| 11 Nov 2026 | Question 3. At the upgrade, when two friends are part-way through the same film, one keeps it: the one playing now, else the one heard from last. The others stop, and borrow it once it's back (answer a). The notes say "update when nobody is watching", and the preview names who would be cut off. |
| 11 Nov 2026 | Question 4. At the upgrade, a link that has been played before, still has plays left and has nobody part-way through a film on it lends once more (answer a). It gets a full loan from the new Play, which can be longer than 1.x would have given. Used-up and expired links are spent. |
| 11 Nov 2026 | Question 15. At the upgrade, a friend part-way through a film on a link that 1.x would have let play again afterwards (plays left, no limit, or days left) keeps the tape for that play only. The open play is the link's one loan: due at the end of its time to come back, then the link is spent, and the preview names these links (answer a). You send a new link to anyone the preview names. |

"The mock-up" rows are things the mock-up added to the roadmap
(`.claude/design/vhs/app/notes.md`, "What's new beyond the roadmap"). They were not
among its questions, and this plan takes them as settled.

Rules from 1.x that still stand: one device plays at a time, and another may take over
after a pause, a close or about 75 seconds of quiet (`server/access.js:9`), or at once
when the holder can no longer play (in 2.0, among one borrower's own devices);
"finished" is 92% of the running time, decided on the server
(`server/access.js:11`); every access rule lives in `server/access.js`; a
link that is cancelled, or a film off the shelf, looks exactly like no such film; no
route or database field is renamed, so links stay `/t/`; the rights reminder, TMDB's
notice and the line saying what you can see are never cut.

### Our proposals

Ours. The first four are the mock-up's proposals, which we would keep. Overrule any.
Rows marked *build* are how we'd build it and need no answer. The others say what you
or a friend would notice.

| Proposal | Why |
|---|---|
| **First to press Play gets it.** The back office warns, and only warns, when you send a link for a film that is out or already has a link waiting. | Links are sent freely. A confirmation would get in the way every time. |
| **Start-by dates don't count down while the tape is out with someone else.** The smallest part is in slice 2: a start-by that passes while the tape is out doesn't show as missed until the tape is back. Giving that time back afterwards is its own slice (6), and can be left out. | Otherwise a link can run out while it is impossible to use. The slice 2 part is also what keeps "never who" true (below). |
| **Finishing the film keeps the tape** until it's due back, with "Return it now" at the end. | A scene can be watched again. "Finished" already ends nothing today. |
| **Before the first Play the page says Play takes the tape out**, with the due-back date it would have. | Play now has a consequence for other people. |
| *Build.* A loan is its own row in a new `loans` table, with the borrower stored on it. A response is a row in `responses`. | "One tape per film" and "a link lends once" become two unique indexes anyone can read. History outlives the Ledger's clean-up. Keeping or giving a link can never quietly move a tape. |
| *Build.* The upgrade changes no existing row of 1.x's own columns. It only adds. | The promise every migration has kept so far (`test/migration.test.js:103`, `:365`). |
| A loan is 1 to 30 days, counted from the moment Play is pressed. You'd notice: the send form and Settings take 1 to 30, and a 1.x link that said more lends for 30. | A browser's session lasts 90 days (`server/config.js:50`), and 1.x allowed "3650 days after first play" (`server/routes/admin.js:411`), which would lock a film for years. |
| *Build.* The borrowing browser's session is extended to a day past the due-back time, and its cookie with it: Play's answer sends the cookie again with the new life. | A session ends 90 days after it was made, never later, and the cookie is set once with that same life (`server/sessions.js:150-153`); nothing sends it again (`:157-168`). A browser that opened its first link 88 days ago would otherwise lose the tape mid-loan, and the server would go on counting the tape as out to a browser that had forgotten it. |
| The clock keeps running if the film is taken off the shelf or its files break while it is out. You'd notice: with broken files the borrower's page says the film isn't available, and still shows the due date and Return it now. Off the shelf, the borrower sees no such film and can't return it. | As the time to come back does today (`docs/access.md:286-287`). You can take the tape back or move the date (question 8). |
| While a link has the tape out: giving it to a member, letting anyone use it, and **Sign out browsers** are refused. **Restore the tape** only works for a link that never lent. **Give back** (a play) goes. You'd notice: on the page of a link that has the tape, those buttons are disabled, with a line saying why. | Each would leave a tape nobody can play, or let a link lend twice. For giving and letting anyone use it, the mock-up drew the opposite ("The tape goes with the link", tagged Open question, `.claude/design/vhs/app/office/office.js:461-462`), and 1.x allows both with a play open (`server/access.js:296-313`). So that part is yours: question 2. |
| A spent link opened in a browser that doesn't hold it shows a notice on the front page, makes no session and doesn't name the film. Its preview in a chat app shows the shop, not the film. | The link has done its job. It should tell a newcomer nothing. |
| Responses: one of the four is required on the form ("Return it now" is the way to say nothing); only for a tape borrowed on a member's own link; kept until you delete one; the text never goes in the Ledger. Beyond the mock-up's plain list: the Responses tab counts the unread ones, and each can be marked as read. | A link anyone can use may have been forwarded. Events are deleted after a year; a friend's words shouldn't vanish with them. The unread count is one column (`read_at`); say so and it goes. |
| A loan on a link anyone can use remembers the browser, not a name. If that browser was signed in, the back office shows the name while the session's row exists, and the device alone after the clean-up removes it (about a year). | Settled: the borrower there is the browser. The clean-up promises that ended sessions go (`server/retention.js:25-29`). A column for the name can be added later if you want it kept for good. |
| The receipt shows first as plain lines (taken out, due back, out to you or to this browser). The till-slip print is a separate small piece (8b). | The slip needs a new paper kind, a new typeface and its licence entry. The facts don't. |
| *Build.* The API keeps 1.1.0's `expiresAt` and `openScreening` beside the new fields until the friend's pages are rebuilt (slice 7). | Each server slice can be tried under 1.1.0's pages. |

### To decide

Yours. The plan below is written with our recommendation for each. "Waits" names the
first slice that can't be finished without your answer. Questions 1, 3, 4 and 15, which
slice 1 waited on, were answered on 11 Nov 2026 and are under [Settled](#settled); the
others keep their numbers. Questions 2, 5, 9 and 12 come first now, for slice 2.
Questions 12 to 15 came out of the plan's review. Mock-up files are cited from
`.claude/design/vhs/app/`.

| # | Question | Options | We recommend | Waits |
|---|---|---|---|---|
| 2 | **A link has the tape out. Can the link still change hands?** Two ways: the friend keeps it ("Sign in and keep it"), or you give it to someone or let anyone use it. Both are the mock-up's question 5, which drew "yes" and was not among your answers of 10 Nov. In full below the table. | (a) no: keeping only before Play, giving and letting anyone use it only while the link doesn't have the tape; (b) yes: the tape goes with the link, as the mock-up drew; (c) no, and keeping goes altogether | **(a).** A tape never moves quietly. But (a) takes away things 1.x allows and the mock-up drew, so read what it costs below. | 2 |
| 5 | **A tape was taken on a link anyone can use, and that browser is signed out (by itself, or by "Sign out every friend and member"). Or a member with a tape out has their card turned off. What happens to the tape?** A tape on a member's own link stays theirs when they sign out of one device: this is not about that. | (a) it comes back at once and the link is spent; (b) it stays out until it's due, unless you take it back; (c) another browser with the same link can carry on with it | **(a).** The film is free at once and nobody inherits a stranger's place. With (b) one press in Settings can lock several films for days. (c) tells the other holders that the borrower has gone. The sign-out confirmation would say which tape goes back. | 2 |
| 6 | **You take a tape back. What does the borrower's page show?** | (a) "Nothing on the shelf here", as a cancelled link does today, and the player says you took it back; (b) a page of its own that names the film | **(a)** for 2.0.0. It keeps the settled rule, and (b) can be added later because the loan remembers its borrower. | 3 |
| 7 | **Do members see "Out on loan, back Friday" on the members' shelf for films they have no link to?** | yes / no | **Yes.** It never says who. But it tells every member when a film is out, which goes beyond "anyone else with a link". | 5 |
| 8 | **Can you change the due-back date of a tape that is already out?** | (a) yes, earlier or later, not into the past; (b) no, only take it back | **(a).** "Can I keep it another day?" is the most likely thing a friend will ask. | 3 |
| 9 | **Can one member have two links for the same film?** | (a) yes: the second waits, and lends after the first is back; the form warns; (b) no: refuse a second while one is live | **(a).** Links are sent freely. Play takes their oldest unused link, and only that one is spent. Question 14 is what a take-back does to the second. | 2 |
| 10 | **The line saying what you can see is protected. May it change to fit loans?** Both endings are written out below the table. | (a) "this link is opened", "the tape is taken out and played"; (b) leave it word for word; (c) as (a), plus the mock-up's clause on links anyone can use: "and, while it's out, which link took it" | **(a).** Nothing new is disclosed, but "this tape" no longer means the link. | 7 |
| 11 | **Which words change now that "tape" is the film's copy and not the link?** One rule to pick for the friend's pages, then two tables, below. | the rule: (a) or (b); the tables: as proposed, or your own | **(a)**, and as proposed. | 7 |
| 12 | **A friend opens the same link anyone can use in a second browser while the first has the tape. What does the second see?** The likeliest case is one friend: Play in a chat app's own browser, then the link again in Safari or on the TV. 1.x lets the second take over after a pause (`test/journey.test.js:129-150`). | (a) the same "Out on loan" as anyone, and the link is spent once the tape is back; (b) "This link's tape is out in another browser until Fri. Carry on there, or return it there." | **(a).** It follows from two settled rules: the borrower is the browser that pressed Play, and anyone else sees "Out on loan". (b) tells every holder of a forwarded link that one of them has the tape, and ends the promise that every non-borrower gets the same answer. It reveals during the loan what (a) reveals after it. | 2 |
| 13 | **Can a signed-in friend hand a tape back with a response before reaching the end?** | (a) only once it's watched to the end, as the mock-up drew (`friend/friend.js:201-205`); (b) at any time while they have it | **(b).** "Not for me" is what someone who stops halfway would want to say. The paused page then offers "Hand it back" beside "Return it now". | 4 |
| 14 | **You take a tape back from a member who has another link for that film waiting (question 9, answer a). What happens to the other link?** | (a) it is cancelled in the same step; links anyone can use that the borrower's browser holds are named in the confirmation and left alone, because other people hold them too; (b) only the link that lent is cancelled, and the confirmation names the others and offers to cancel them | **(a).** It is what "cancels that person's link" means with two links. Otherwise the borrower's page offers Play again the moment you take the tape back. | 3 |

**Question 2, in full.** What each answer means for a friend and for you:

- **(a) Not while it's out.** A friend who presses Play on a link anyone can use and
  signs in afterwards has the tape in that browser only: it isn't on their card, it
  doesn't follow them to another device, and they can't leave a response for that
  loan. 1.x lets a link be kept with a play open (`server/access.js:263-289`); that
  stops. Keeping is also not offered while the tape is out on another link, where the
  mock-up's out page offers it (`friend/friend.js:198-200`), so a waiting link can't
  go on a card until the tape is back. The front page's "Sign in to keep them on your
  membership card" (`friend/friend.js:338`) goes. For you: when Sam has the tape and
  asks whether Jo can watch instead, you take the tape back, which cancels Sam's link,
  and send Jo a new one.
- **(b) The tape goes with the link.** Keeping moves the tape onto the friend's card:
  they can watch on any device and hand it back with a response. Giving moves it to
  whoever the link is now for, until it's due. The costs: other browsers that opened
  the link see "kept" where they saw "Out on loan", which tells them the keeper has it
  (about the size of what is accepted already, see "Never who has it"); after a give,
  the first borrower's player just stops; and one link has lent to two people.
- **(c) No keeping at all.** A link goes on a card only when you give it to a member.

**Question 10, in full.** Today (`web/src/pages/tapeWords.js:21-27`): "{Host} can see
when this tape is opened and played, the kind of device (such as “Safari on iPhone”),
and roughly how far playback gets." Signed in, it ends "…roughly how far playback gets
and, because you're signed in, that it was you." Answer (a) changes only the start, in
both: "{Host} can see when this link is opened, when the tape is taken out and played,
the kind of device (such as “Safari on iPhone”), …". The mock-up's line for a link
anyone can use ends "…roughly how far playback gets and, while it's out, which link
took it" (`friend/friend.js:162-163`). We leave that clause out of (a) because "this
link" already says it, and 1.x ties each play to its link today. Answer (c) keeps it.

**Question 11.** First the rule for a friend's pages. What you sent them is:

- **(a)** still "a tape" wherever that doesn't claim the tape is out ("Your tapes",
  "Here's your tape", "A tape from …", "This tape is for one member"), as 1.1.0 and
  the mock-up's friend pages say. The pages for a tape that is out say "link" for the
  link, as the mock-up's do ("Opening the link didn't take anything").
- **(b)** "a link" everywhere, and "tape" only for the film's copy, as in the back
  office.

We recommend (a): it is what you reviewed, and a friend's words don't change twice in
a fortnight. The back office changes either way (1.1.0's wording from the pages as
released):

| 1.1.0 says | It means | In 2.0 we propose |
|---|---|---|
| "Lend a tape", "N tapes ready", "How many tapes" | making links | "Send a link", "N links ready", "How many links". Sending doesn't lend. |
| "Lent" (the date a link was made), "Tapes lent" | links made | "Sent". **Lent** means Play took the tape. |
| "Tapes" (the back office section) | the list of links | Keeps its name: **Out now** on top, the links sent below. |
| "Take the tape back" on any link | cancel it | Only for a link that has the tape out. Otherwise "Cancel the link". |
| "Tapes keep working: people open their link or sign in again." (`web/src/admin/Settings.jsx:180`) | links survive a sign-out | "Links keep working", and which tapes go back (question 5). |
| "This tape has gone back to the shop." | the link expired | It was due and went back. Nothing else uses the line. |
| "On your card" (this link is in your account) | kept or yours | The front page section for what you have out. The other becomes "For {name} only", which the title strip already says. |
| "Paused" on the front page | an open play | "Out with you", with the due-back date. |

The friend's side, by the rule above. About 100 strings under `web/src/pages` and
`web/src/admin` say "tape"; these are the kinds, and slices 7 to 9 go through the rest
by the same rule.

| 1.1.0 says | Where | With (a) | With (b) |
|---|---|---|---|
| "Here's your tape: …" | the message you copy (`web/src/admin/Tickets.jsx:16`) | stays | "Here's your link: …" |
| "A tape from {shop}." | a link's preview in a chat app (`server/page.js:140`) | stays | "A film from {shop}." |
| "Your tapes" | the front page and the name menu (`web/src/pages/Home.jsx:44`, `web/src/site.jsx:189`) | stays, under "On your card" for what is out | "Your links" |
| "{Host} has taken that tape back." | the notice for any cancelled link (`Home.jsx:12`) | only after a take-back. A link cancelled before it lent: "{Host} has cancelled that link." | the same split |
| "That tape has been kept on someone's membership card.", "This tape has been kept" | `Home.jsx:13`, `web/src/pages/Film.jsx:155` | stays | "That link has been kept…" |
| "This tape is for one member", "This tape is for someone else" | `web/src/pages/TicketOpen.jsx:88`, `:111` | stays | "This link is for…" |
| "It also forgets 1 tape you opened from a link here" | the sign-out confirmation (`site.jsx:155-156`) | stays, and names the tapes that go back (question 5) | "forgets 1 link you opened here" |
| "This tape is now playing on another device.", "This tape is no longer valid." | the player (`web/src/pages/tapeWords.js:101`, `:108`) | stays | stays: there it is the film's copy |

## The model

| Thing | Table | Change |
|---|---|---|
| The shelf: one tape per film | `films` | none |
| A link | `tickets` | two new columns, `loan_days` and `pick_note`. `screening_limit` and `days_after_first_play` stay as history and are no longer read. |
| One time a tape goes out | `loans` | **new** |
| The playback of a loan: device, position, finished | `screenings` | none. From 2.0 one is made with each loan. `resumable_until` is written once (the due time) and never read; `voided_at` is no longer written once Give back goes (slice 9). |
| What a borrower said | `responses` | **new** |
| Browsers holding links | `session_tickets` | none |

What the database enforces, and what the code does:

| Rule | Enforced by |
|---|---|
| A film has at most one tape out | `loans_out`, a unique index on loans not yet ended, and the IMMEDIATE transaction around Play (`server/db.js:264-276`) |
| A link lends once | `loans_once`, a unique index on `ticket_id`. "Spent" is never stored: a link is spent when it has a loan that is over. |
| A response comes from the member who borrowed, once | `responses.person_id NOT NULL`, the `responses_from_borrower` trigger, `responses_once` |
| A tape is back from its due time, written down or not | code: one test for "out", used by every read (below) |

Nothing deletes a film, a link, a play or a member today, so loans refer to them
plainly, with no cascade. `session_hash` is plain text, as on `screenings`, because
ended sessions are deleted and loans never are.

### Migration 8

Appended to `MIGRATIONS` (`server/db.js:9-213`), in its style. `migrate()` runs it in
one transaction with the `user_version` bump (`server/db.js:256-261`) and needs no
change. Foreign keys are on before it runs (`server/db.js:218`), so it rebuilds no table.

```js
  // Version 2: one tape per film. The first Play on one of a film's links takes its
  // tape until it's due back, and a link lends once. A loan is one time the tape
  // went out; a screening is now the playback of one loan. From here on two links
  // can't play one film at once, and older code, which knows nothing of loans, must
  // refuse this database. Every 1.x link that could still play can take the tape,
  // or has it; one that couldn't (used up, or past its days after first play) has lent.
  `
  -- One "now" for the whole migration, in whole milliseconds. julianday works on
  -- every SQLite that Node 22.13 or later bundles.
  CREATE TEMP TABLE m8 AS SELECT CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) AS now;
  -- How long this link lends the tape for, in days. NULL: the shop's default when Play is pressed.
  ALTER TABLE tickets ADD COLUMN loan_days INTEGER CHECK (loan_days IS NULL OR loan_days BETWEEN 1 AND 30);
  -- Picked for you: the owner's note to whoever has this link. Never films.recommendation,
  -- and never label, which stays a note for the admin only.
  ALTER TABLE tickets ADD COLUMN pick_note TEXT CHECK (pick_note IS NULL OR length(pick_note) <= 2000);
  -- One time a film's tape went out. Out (ended_at NULL) until it is returned, due,
  -- taken back, or its borrower can no longer play; access.js writes the end.
  CREATE TABLE loans (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,          -- never reused, so a stale page can't name another loan
    film_id      INTEGER NOT NULL REFERENCES films(id),
    ticket_id    INTEGER NOT NULL REFERENCES tickets(id),    -- the link it was taken on
    screening_id INTEGER NOT NULL REFERENCES screenings(id), -- its playback: position, furthest, finished
    person_id    INTEGER REFERENCES people(id),              -- the borrower, when the link is for one person
    session_hash TEXT,      -- the browser that pressed Play: the borrower on a link for anyone. Plain text, as on screenings
    device       TEXT,      -- that browser, coarse; kept after its session is deleted
    taken_at     INTEGER NOT NULL,
    due_at       INTEGER NOT NULL,
    ended_at     INTEGER,
    ended_how    TEXT CHECK (ended_how IN ('returned', 'due', 'taken-back', 'signed-out', 'disabled', 'before-2.0')),
    CHECK ((ended_at IS NULL) = (ended_how IS NULL)),
    CHECK (due_at > taken_at),
    CHECK (ended_at IS NULL OR ended_at >= taken_at),
    CHECK (person_id IS NOT NULL OR session_hash IS NOT NULL OR ended_how IS 'before-2.0')
  );
  CREATE UNIQUE INDEX loans_out ON loans(film_id) WHERE ended_at IS NULL;   -- one tape per film
  CREATE UNIQUE INDEX loans_once ON loans(ticket_id);                       -- a link lends once
  CREATE UNIQUE INDEX loans_screening ON loans(screening_id);
  CREATE INDEX loans_film ON loans(film_id, taken_at);
  CREATE INDEX loans_person ON loans(person_id, taken_at) WHERE person_id IS NOT NULL;
  CREATE INDEX loans_session ON loans(session_hash) WHERE ended_at IS NULL;
  -- What a borrower said when handing a tape back. Only the admin ever reads these.
  CREATE TABLE responses (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    loan_id    INTEGER NOT NULL REFERENCES loans(id),
    person_id  INTEGER NOT NULL REFERENCES people(id),
    film_id    INTEGER NOT NULL REFERENCES films(id),
    kind       TEXT NOT NULL CHECK (kind IN ('loved-it', 'still-thinking', 'not-for-me', 'lets-talk')),
    message    TEXT CHECK (message IS NULL OR length(message) BETWEEN 1 AND 2000),
    created_at INTEGER NOT NULL,
    read_at    INTEGER
  );
  CREATE UNIQUE INDEX responses_once ON responses(loan_id);
  CREATE INDEX responses_created ON responses(created_at);
  -- Only the person who borrowed the tape: never a browser on a link for anyone.
  CREATE TRIGGER responses_from_borrower BEFORE INSERT ON responses
    WHEN NEW.person_id IS NOT (SELECT person_id FROM loans WHERE id = NEW.loan_id)
    BEGIN SELECT RAISE(ABORT, 'a response comes from the person who borrowed the tape'); END;
  -- 1. Each film's one loan: of the screenings their own holder could resume now
  -- (each ticket's latest open one, the ticket not revoked nor past its days, the
  -- film published; the ticket's person not disabled, or else the browser holding
  -- the play still signed in and still holding the ticket), the one playing, then
  -- the one heard from last. Due at the end of that play's time to come back, or at
  -- the ticket's expiry if sooner. A play nobody could resume gets no loan, so no
  -- loan is born that isn't out.
  INSERT INTO loans (film_id, ticket_id, screening_id, person_id, session_hash, device, taken_at, due_at)
  SELECT film_id, ticket_id, id, person_id, session_hash, device, started_at, due FROM (
    SELECT s.id, s.film_id, s.ticket_id, t.person_id, s.session_hash, ss.device, s.started_at,
           MIN(s.resumable_until, COALESCE(t.first_played_at + t.days_after_first_play * 86400000, s.resumable_until)) AS due,
           ROW_NUMBER() OVER (PARTITION BY s.film_id ORDER BY
             (s.active_until > m8.now) DESC, s.last_heartbeat_at DESC, s.id) AS place
    FROM screenings s JOIN tickets t ON t.id = s.ticket_id JOIN films f ON f.id = s.film_id CROSS JOIN m8
    LEFT JOIN sessions ss ON ss.id_hash = s.session_hash
    WHERE f.published = 1 AND t.revoked_at IS NULL
      AND (t.days_after_first_play IS NULL OR t.first_played_at + t.days_after_first_play * 86400000 > m8.now)
      AND s.id = (SELECT s2.id FROM screenings s2 WHERE s2.ticket_id = s.ticket_id AND s2.voided_at IS NULL
                    AND s2.resumable_until > m8.now ORDER BY s2.started_at DESC, s2.id DESC LIMIT 1)
      AND (CASE WHEN t.person_id IS NOT NULL
             THEN EXISTS (SELECT 1 FROM people p WHERE p.id = t.person_id AND p.disabled_at IS NULL)
             ELSE EXISTS (SELECT 1 FROM sessions h JOIN session_tickets st ON st.session_hash = h.id_hash AND st.ticket_id = t.id
                          LEFT JOIN people hp ON hp.id = h.person_id
                          WHERE h.id_hash = s.session_hash AND h.kind = 'viewer' AND h.revoked_at IS NULL AND h.expires_at > m8.now
                            AND (h.person_id IS NULL OR (hp.id IS NOT NULL AND hp.disabled_at IS NULL))) END)
  ) WHERE place = 1;
  -- 2. Links 1.x would no longer let play (used up, or past their days after first
  -- play, revoked or not) have lent: one ended loan each, so they are spent by the
  -- same rule as every link from now on, and a restore can't make them lend.
  INSERT INTO loans (film_id, ticket_id, screening_id, person_id, session_hash, device, taken_at, due_at, ended_at, ended_how)
  SELECT t.film_id, t.id, last.id, t.person_id, last.session_hash, ss.device, t.first_played_at, e.at, e.at, 'before-2.0'
  FROM tickets t CROSS JOIN m8
  JOIN screenings last ON last.id = (SELECT id FROM screenings WHERE ticket_id = t.id ORDER BY started_at DESC, id DESC LIMIT 1)
  LEFT JOIN sessions ss ON ss.id_hash = last.session_hash
  JOIN (SELECT t2.id AS ticket_id,
               MIN(COALESCE(t2.first_played_at + t2.days_after_first_play * 86400000, 9000000000000000),
                   COALESCE((SELECT MAX(resumable_until) FROM screenings WHERE ticket_id = t2.id AND voided_at IS NULL),
                            t2.first_played_at + t2.days_after_first_play * 86400000)) AS at
        FROM tickets t2) e ON e.ticket_id = t.id
  WHERE t.first_played_at IS NOT NULL AND t.id NOT IN (SELECT ticket_id FROM loans)
    AND ((t.days_after_first_play IS NOT NULL AND t.first_played_at + t.days_after_first_play * 86400000 <= m8.now)
      OR (t.screening_limit IS NOT NULL
          AND (SELECT COUNT(*) FROM screenings WHERE ticket_id = t.id AND voided_at IS NULL) >= t.screening_limit
          AND NOT EXISTS (SELECT 1 FROM screenings WHERE ticket_id = t.id AND voided_at IS NULL AND resumable_until > m8.now)));
  -- 3. "Valid N days after first play" becomes the loan length of a link that can
  -- still lend, at most 30 days. No row of 1.x's own columns is changed anywhere.
  UPDATE tickets SET loan_days = MIN(days_after_first_play, 30)
  WHERE days_after_first_play IS NOT NULL AND id NOT IN (SELECT ticket_id FROM loans);
  DROP TABLE temp.m8;
  `,
```

This SQL was run on 11 November, as it stands here, against databases built from
today's seven migrations by `server/db.js` (Node 26.10, SQLite 3.53.4): 25 links over
13 films with a row for every line of the table in
[Upgrading](#upgrading-an-existing-shop), then through the real `migrate()`, then on
400 random 1.x-shaped databases. It did what that table says, changed no 1.x column of
any row in any table, left `foreign_key_check` empty and `integrity_check` ok, and
made no open loan that the test for "out" below calls over. A second open loan on a
film, a second loan on a link, a response on a browser's loan and `loan_days` of 31
were each refused. One word has changed since that run, in slice 1: the last `CHECK` on
`loans` ended `ended_how = 'before-2.0'`, which is NULL for a loan that is out, and a
`CHECK` lets NULL through, so an open loan with neither a member nor a browser was
accepted. It now reads `IS`. The SQL makes the same loans either way; the schema 7
suite has the refused row. No 1.x data can break one of the unique indexes: step 1 makes at
most one open loan for a film and one for a link, and step 2 only adds ended loans for
links that have none. Only a `CHECK` can fail, and only on a row no screen can make
(`server/routes/admin.js:411`, `server/settings.js:48`). Node 22 and 24 are for CI in
slice 1.

**Not stored:** whether a link is spent, whether a tape is out (both are read from
loans), an effective start-by date (worked out, slice 6), anything about a loan in
`settings` (every setting is sent to browsers, `server/branding.js:80-83`).

## The rules

Everything here stays in `createAccess` (`server/access.js:26-28`).

### When a tape is out

One test, used by every read. A loan is live until its end is written, until it is
due, or until its borrower can no longer play (question 5, answer a). The borrower
test is the one `holderCanPlay` already uses for a session (`server/access.js:79-82`).

```js
const LIVE = `l.ended_at IS NULL AND l.due_at > :now AND (
  (l.person_id IS NOT NULL AND EXISTS (SELECT 1 FROM people p WHERE p.id = l.person_id AND p.disabled_at IS NULL))
  OR (l.person_id IS NULL AND EXISTS (SELECT 1 FROM sessions s LEFT JOIN people sp ON sp.id = s.person_id
      WHERE s.id_hash = l.session_hash AND s.kind = 'viewer' AND s.revoked_at IS NULL AND s.expires_at > :now
        AND (s.person_id IS NULL OR (sp.id IS NOT NULL AND sp.disabled_at IS NULL)))))`;
// q.filmLoan   SELECT l.* FROM loans l WHERE l.film_id = :film AND ${LIVE}     (uses loans_out)
// q.ticketLoan SELECT * FROM loans WHERE ticket_id = ?                          (at most one, ever)
// q.stale      loans with ended_at NULL that are NOT live, for one film or all

// Whose loan it is: the link's person on any device, or else the browser that pressed Play.
const isBorrower = (viewer, loan) =>
  Boolean(viewer && loan) && (loan.person_id != null ? viewer.person_id === loan.person_id : viewer.id_hash === loan.session_hash);
```

Reads never write: `filmAccess` and `mayStream` run on every playlist and segment
(`server/routes/media.js:473`), outside any transaction. The end of a loan that ran out
is written by `closeStale(filmId, now)`: first thing inside every IMMEDIATE transaction
that takes, returns, takes back, keeps or moves a due date, and every minute by a
sweeper for all films. It writes `ended_at` as the due time, or the moment the
borrower's session ended or their card was turned off if sooner (`due`, `signed-out` or
`disabled`), and logs `returned`. The time it writes is
`MAX(taken_at, MIN(due_at, COALESCE(<that moment>, :now)))`, so a clock that stepped
back, or a session row that is gone, can never break the `CHECK` on `ended_at`. One bad
row would otherwise stop every Play on its film and every sweep. The sweeper follows
`retention.start()` (`server/retention.js:88-101`, `server/index.js:19`), so tests call
it with their own clock.

One end is written where it happens, not later. Turning a member's card off
(`people.disable`, already an IMMEDIATE transaction, `server/people.js:111-122`) ends
that member's open loans as `disabled` in the same transaction, through an
`endLoansOf(personId, now)` that `access` exports; `people.js` is handed `access`
already (`server/people.js:19`, `server/app.js:59`). Turning the card on again clears
`disabled_at` (`server/people.js:124-130`), and a loan no sweep had closed in between
would otherwise come back to life: the link from spent to lent, the film from in to
out. Every other end is one-way (a revoked session is never restored, and an expired
one is only ever extended for a live loan), so those stay read from the test above.

### A link's state, the same whoever asks

`ticketStatus(ticket, now)` keeps its place and its five callers that have no viewer in
hand. It reads the link, its film, its own loan and the film's live loan. First match:

| State | When | The friend's page | In the back office |
|---|---|---|---|
| `revoked` | `revoked_at` is set (cancelled, taken back) | no such film | Cancelled, or Taken back |
| `unpublished` | the film is off the shelf | no such film | Film off the shelf |
| `unavailable` | media `error` or `missing` | the page, no Play. With the tape out: the due date, and Return it now for the borrower. With it in: "nothing has been taken out" | Film unavailable, and who has the tape if it is out |
| `spent` | it has a loan, and that loan is over | "Returned" or "It was due", no Play | Done: back in, and how |
| `lent` | its loan is live | yours, or out (below) | Has the tape |
| `expired` | never lent, its start-by has passed, and the film has no live loan taken before that date | start-by missed | Start-by missed |
| `waiting` | never lent, and the film's tape is out on another link | out | Waiting: the tape is out |
| `in` | never lent, the tape is in | Play takes it out | Not opened yet, or Opened |

Two rows need a word. `unavailable` is about the film's files, not the loan, so it
hides nothing: `loan` and `out` are filled in whatever the state, the borrower keeps
the due date and can return the tape, and the clock keeps running as the proposals
say. The mock-up's "nothing was taken" is for the tape that is in
(`.claude/design/vhs/app/friend/notes.md:55`). And a start-by that passes while the
tape is out on another link leaves the link `waiting`, not `expired`, until the tape
is back. A link that lent before its start-by stays `lent`, so without this a friend
could tell the two kinds of "out" apart by waiting for the date. A start-by that had
already passed when the tape went out stays `expired`: that link could not have lent.
Once the tape is back the link is `expired`, unless slice 6 gives it the time back.
"Never lent" has one exception, for links from 1.x: a link first played before the
upgrade met its start-by then, and 1.x stopped reading the date at the first play
(`server/access.js:118`). The upgrade lets such a link lend once more (question 4), so
a start-by is read only while `first_played_at` is empty. Slice 1's fixture has the
row (`metStartBy` in `test/schema7.js`).

`used_up` goes, and so do `expiresAt`, the counts and `open` in what it returns. It
returns `{ state, loan, out, startBy, loanDays }`, with `loanDays` the link's own or the
shop's default.

### What a viewer sees

Only `filmAccess` depends on who asks (rule 5, `docs/access.md:112-113`, gains this).

| Link state | This viewer | View | Page | Play |
|---|---|---|---|---|
| (your back office browser) | | preview | yes, with who has it | yes, never takes |
| `lent` | the borrower | `yours` | yes | resumes |
| `lent` | anyone else holding the link | `out` | yes | no |
| `waiting` | holder | `out` | yes | no |
| `in` | holder | `in` | yes | takes the tape |
| `spent`, `expired` | holder | the same name | yes | no |
| `unavailable` | holder | `unavailable`, with the tape as the rows above would give it: `yours` for the borrower, `out` for anyone else while the film's tape is out, `in` for a link that could still lend, none for one that is spent or past its start-by | yes | no |
| `revoked`, `unpublished` | | no such film, or the members' listing, as today (`server/access.js:166`, `:174`) | | |

The two `out` rows are the same on purpose (question 12). The out page says the same
to both, and only what is true for both: "**Out on loan.** Due back by Fri 6 Nov." The
mock-up's out pages add "you can play it once it's back in", "Your link still works:
open it again then" and the start-by line (`.claude/design/vhs/app/friend/friend.js:196-200`).
For a second browser on the link that lent, the first two are false, because that link
is spent when the tape comes back. So they go, and so do the start-by line and the
keep offer on the out page (question 2).

When a browser holds several links for one film, the best is chosen by view (`yours`,
`in`, `out`, `spent`, `expired`, `unavailable`), then the member's own link, then the
oldest. A film's links are all `unavailable` together; among them the choice goes by
the tape in the same order. This replaces `RANK` and `byBest`
(`server/access.js:20`, `:149-157`). The page, Play, `/api/me` and media all use that
one choice, as today.

### What can happen to a tape

| Event | Who, and the guard | Effect | Logged |
|---|---|---|---|
| Send a link | you | a `tickets` row with `loan_days` (the form's value, else NULL) and `pick_note`. Takes nothing. | `ticket-sent` |
| Open `/t/<code>` | as today (`server/routes/viewer.js:42-70`) | attaches the link to the browser, even while the tape is out. A spent link in a browser that doesn't hold it: 410 `ticket-spent`. | `opened`, from the film page |
| Play, view `in` | holder; `closeStale`, then the view is still `in` | a screening and a loan, due `now + loanDays` days; `first_played_at`. A browser's loan: its session extended to due + 1 day, and its cookie sent again (below). | `lent`, `play` |
| Play, view `yours` | the borrower. Another of their own devices active in the last 75 s and still able to play: `playing-elsewhere` | claims the screening (`server/access.js:203-208`, unchanged, among one member's devices). A browser's loan: the cookie sent again. | `play` (resumed) |
| Play, view `out`, `spent`, `expired`, `unavailable` | | 409 with the view's name | |
| Reaching 92% | the borrower's player | `finished_at`, as today (`server/access.js:250-253`). The tape stays out. | `finished` |
| Return it now, Hand it back | the borrower, loan live, and the `takenAt` sent is this loan's. A response only when the loan's member is the viewer (and question 13) | `ended_at = now`, `returned`; the screening stops; a `responses` row | `returned` |
| It comes due | nobody: the test above | written later as `due` at `due_at` | `returned`, dated `due_at` |
| A browser with a tape out is signed out, or its session ends (question 5) | nobody: the test above | written later as `signed-out`, at that moment | `returned` |
| A member's card is turned off (question 5) | you; inside `people.disable` | their open loans end as `disabled`, in the same transaction | `returned` |
| You take the tape back | by loan id, with its link's id as a check; loan live | `taken-back`; the link's `revoked_at`; its `session_tickets` rows deleted; the screening stops. A member's loan: their other never-lent links for the film are cancelled too (question 14). | `returned`, and `ticket-cancelled` for each other link |
| You cancel a link | if it has the tape, this is taking it back; otherwise today's revoke (`server/routes/admin.js:519-526`) | | `ticket-cancelled` |
| You move the due date (question 8) | loan live; refused if the new time has passed | `due_at`; a browser's session extended, and its cookie at the borrower's next Play or film page | `due-changed` |
| Restore | refused (409 `lent-once`) if the link has a loan | today's restore | `ticket-restored` |
| Give, release, Sign out browsers | refused (409 `tape-out`) while the link has the tape (question 2) | today's otherwise (`server/access.js:296-313`) | as today |
| Keep (question 2) | view `in` only | today's keep (`server/access.js:271-289`) | `ticket-kept` |
| The film's files break | | nothing ends; the clock runs. The borrower still sees the due date and can return it. | |
| The film goes off the shelf | | nothing ends; the clock runs. The borrower sees no such film and can't return it. | |

Pressing Play keeps its shape (`server/access.js:193-224`): one IMMEDIATE transaction
that runs `closeStale` for the film, then `filmAccess`, then resumes (`yours`), takes
(`in`: the screening, the loan, `first_played_at`, the two events) or answers with the
view's name. `loans_out` is the backstop for a second process on the same file. Line
`:210`, the only reader of `resumeWindowHours`, goes.

Extending the session's row (a new `prolong` in `server/sessions.js`, which only ever
lengthens) is half of it: the browser's cookie was set once, with the life the session
had then (`server/sessions.js:150-153`), and nothing sends it again
(`:157-168`). So on every 200 where the loan is this browser's, a take or a resume,
the Play route (`server/routes/viewer.js:140-160`) sends the same token again through
`sessions.setViewerCookie` (`server/sessions.js:197`), after the transaction, as
sign-in does (`server/routes/account.js:45`, `:57`). Its `Max-Age` is the row's
`expires_at` less now, so it never shortens a cookie. The token is in `req.cookies`.
The film page's `GET` does the same when the view is `yours` on a browser's loan. That
is how a due date you moved later reaches the borrower: they must open the page or
press Play to go on watching.

Taking a tape back, in its one transaction, also cancels the member's other links for
that film that never lent (the same `person_id` and `film_id`; question 14, answer a).
The candidates query already hands the borrower every link they hold for the film
(`server/access.js:35-40`), so without this their next request finds the second link,
the page offers Play where question 6 promises "Nothing on the shelf here", and Play
starts a new loan. Links anyone can use that the borrowing browser also holds are left
alone, because other people hold them too. The take-back confirmation names them, with
a way to cancel each.

The progress report decides by the loan first, which fixes two things in today's
code. A browser holding the same link as the borrower gets `playing-elsewhere` for the
borrower's screening id and 404 for any other (`server/access.js:231-232`), so it can
tell which link has the tape. And a browser whose link is taken back is told "This tape
is no longer valid", because revoking deletes its `session_tickets` row before `mayHold`
runs (`server/routes/admin.js:523`).

```js
const s = q.screening.get(screeningId);
const loan = s ? q.loanByScreening.get(s.id) : null;
const mine = isBorrower(viewer, loan);
if (!s || (!mine && s.session_hash !== viewer.id_hash)) return { error: 'not-found' };
if (!mine) return { error: 'screening-ended' };              // a 1.x play the upgrade gave no loan
if (!live(loan, now)) return { error: endedCode(loan, now) }; // returned | due | taken-back
// then unpublished or unavailable, then playing-elsewhere for the borrower's other device, then progress as today
```

`mayStream`: your back office browser, or a browser whose view is `yours` and which
holds the loan's screening. Signing in carries a browser's loan along: a `moveLoans`
statement beside `moveScreenings` (`server/sessions.js:135-136`, `:188-191`), under the
same condition. Signing in from another person's session carries nothing, as today, so
that browser's loan ends.

### Links for one member, and keeping

- A link for one member lends to the member, on every device they sign in on, one at
  a time. It shows on their card, and they can hand it back with a response.
- A link anyone can use lends to the browser that pressed Play. Other browsers with the
  same link see "Out on loan" and can't take over, even from a paused tape (question
  12). Signing in doesn't change whose loan it is (question 2).
- With their own link and a link anyone can use in one browser, Play takes their own.
  A second link for the same member and film waits, and lends after the first is back
  (question 9). Returning spends only the link that took the tape. Taking the tape
  back cancels the member's waiting links for that film as well (question 14).
- Keeping (question 2, answer a): `canKeep` (`server/access.js:263`) also needs the view
  `in`. So it is refused while the tape is out, whichever link has it, and once this
  link has lent. 1.x allows a keep with a play open; that stops.
- A film on the shelf for members, with no link: the listing and never Play, as today
  (`server/access.js:24`), plus in or out and the due-back date (question 7).

### Start-by while the tape is out (slice 6)

Slice 2 already holds the part that "never who" needs: a start-by that passes while
the tape is out doesn't make a link `expired` until the tape is back. This slice gives
the time back afterwards.

`effectiveStartBy(ticket, now)` is one function, used by `ticketStatus`, the Status
page's list (`server/booth.js:35-39`, which becomes a filter in JavaScript) and the
back office. A link that has been played has no start-by, as today
(`server/access.js:118`). Otherwise start from `start_by` and go through the film's
loans on other links in the order they were taken, leaving out `before-2.0` ones. Each
one taken before the deadline as it then stands pushes it back by the time the tape was
out since the link was made: to the loan's end, or to now while it is still out, so the
time left stands still.

## Never who has it

Only the borrower and you learn anything about a loan. While the tape is out, everyone
else gets the same answer, byte for byte, whether it went out on another link or on
their own link in another browser (question 12, answer a).

| What a non-borrower can ask | What they get | Why it can't say who |
|---|---|---|
| The film page, `access.ticket` | `state: 'out'`, `tape: 'out'`, `dueBack`, their own link's `pickNote` and `inAccount`; every other key null | One code path for both kinds of `out`. No `firstPlayedAt` (`server/films.js:85` sends it today), no `startBy`, no loan, no device, no label. |
| The same, after their link's start-by passes during the loan | still `out` | A link that lent stays `lent`, and one that didn't stays `waiting` (the state table), so the date tells nothing. |
| The same, when the film's files break during the loan | `state: 'unavailable'`, `tape: 'out'`, `dueBack` | The tape's keys don't depend on the state, for either kind of `out`. |
| `access.canKeep` | false whenever the view is `out` | Otherwise it would be true only when the tape is out on another link. |
| Play | 409 `{ error: 'out' }` | Decided before the takeover check, so `playing-elsewhere` only ever reaches the borrower's own devices. |
| Return | 409 `nothing-to-return`, also for no such film, whatever `takenAt` is sent | As keep answers today (`server/routes/viewer.js:162-172`). |
| A progress report with any screening id | 404 `not-found` | The fix above. |
| Playlists and segments | 403, empty body | The reason goes to the log and the Status page only (`server/routes/media.js:12-19`). |
| `/api/me` | the same `out` entry; member films with in or out and the date | No loan fields unless the view is `yours`. |
| Opening a link | `{ slug }`, in or out | Opening never reads the film's loan, only whether this link is spent, and takes nothing. |
| A link's preview in a chat app | title and poster, as today (`server/page.js:54-59`) | The same while the tape is out, on whichever link. Never a note, a date or a name. |
| `/api/site` | `loanDays`, the shop's default | Nothing about any loan is a setting. |
| The player's reasons for stopping | `returned`, `due`, `taken-back` reach the borrower only | Decided on the loan. |
| Your preview, the back office, the Ledger, Status | who, since when, the device | `access.tape` exists only when `via` is `admin`. |

What can still be worked out, and is accepted: **when**, not who.

- The due-back time less the loan length is when Play was pressed.
- Once a tape is back, another browser holding the same link anyone can use sees that
  link spent, so it knows the tape went out on its link.
- With a loan length per link (question 1, answer a), the same can sometimes be worked
  out while the tape is out. The page tells a holder their own link's `loanDays` before
  Play, and `/api/site` gives the shop's default. Someone whose link says 7 days, who
  saw the tape in yesterday and reads "due back in 2 days" today, knows it went out on
  another link. A length per film (answer b) gives nothing away.
- A "that tape has been kept" answer (`server/routes/viewer.js:108-109`) still says a
  link you opened was kept, as in 1.x.

## The API

No route is renamed. New routes are marked.

### The friend's side

`access.ticket` on `GET /api/films/:slug` (`server/routes/viewer.js:102-134`), built by
`ticketForViewer` (`server/films.js:75-95`), has one set of keys in every state. Bare
line numbers in this section's tables are in `server/routes/viewer.js`.

| Key | Value |
|---|---|
| `state` | `ok` (Play is offered), `out`, `spent`, `expired`, `unavailable` |
| `tape` | `in`, `yours`, `out`, or null (`spent`, `expired`). It goes by the loan, not by `state`: an `unavailable` film keeps it. |
| `loanDays` | `in`: what Play would lend, for "Play takes it out. Due back …" |
| `startBy` | `in`, `expired`: the start-by date (the effective one, from slice 6) |
| `dueBack` | whenever `tape` is `yours` or `out` |
| `loan` | whenever `tape` is `yours`: `{ takenAt, position, finishedAt, toBrowser, canRespond }`. `canRespond`: the loan's member is the viewer and the loan is live (question 13, answer b; with answer a, `finishedAt` must be set as well). The return route refuses a response by the same rule. |
| `returned` | `spent`, and only to the one who borrowed: `{ at, how }`. `how` is `returned`, or `due` for every other end (a card turned off, a link spent by the upgrade), so the page needs two lines and learns nothing else. |
| `pickNote`, `inAccount` | this link's note or null; as today |
| `expiresAt`, `openScreening` | until slice 7 only, when `yours`: `dueBack`, and `{ resumableUntil: dueBack, position }` |

`screeningLimit`, `screeningsUsed`, `screeningsLeft`, `daysAfterFirstPlay` and
`firstPlayedAt` go. `access` gains `tape: { out, borrower, takenAt, dueAt }` for your
preview only. `canKeep` follows the rule above.

| Route | Change |
|---|---|
| `POST /api/films/:slug/screenings` (Play, `:140-160`) | 200: `{ screeningId, resumed, took, position, masterUrl, takenAt, dueBack, toBrowser }`, and `resumableUntil` (equal to `dueBack`) until slice 7. When the loan is this browser's, the viewer cookie is sent again. 409: `out`, `spent`, `expired`, `unavailable`, `playing-elsewhere`, `no-ticket`. The state's name is the error code, as today (`:152`). |
| `POST /api/films/:slug/return` (new) | Body `{ takenAt, response?, message? }`. `takenAt` is required and must be the live loan's, which the page has in `loan.takenAt`: a tab left open from an earlier loan can't hand back a later one, as the loan id guards a take-back. `response` one of `loved-it`, `still-thinking`, `not-for-me`, `lets-talk`; `message` up to 2,000 characters. 200 `{ returned: { at }, responded }`. 409 `nothing-to-return` (also for no such film, and for a `takenAt` that isn't the live loan's) or `cannot-respond` (nothing changes). 400 for a message with no response, or no `takenAt`. 30 per 10 minutes through `limit()`, as keep (`:166`). |
| `POST /api/screenings/:id/heartbeat` (`:176-189`) | New 409 codes `returned`, `due`, `taken-back`. 404 for every screening that isn't the viewer's own. |
| `POST /api/tickets/open` | New 410 `ticket-spent`. |
| `GET /api/me` (`:74-94`) | `tickets[]` in the new shape, yours first by due date. `memberFilms[]` gain `tape` and `dueBack` (question 7). New `browserLoans`: the titles this browser has out on links anyone can use, for the sign-out confirmation. Nothing sits under a `membership` key, which only `/api/account` carries (`test/membership.test.js:668-673`). |
| `GET /api/site` | `loanDays` replaces `resumeWindowHours`. |

### The back office

Bare line numbers in this table are in `server/routes/admin.js`.

| Route | Change |
|---|---|
| `GET /api/admin/films`, `/films/:id` | + `tape: { state: 'in' \| 'out' \| 'off', loan }` and `links: { live, waiting, total }`. The detail adds `lending`, counted from links, loans and responses, never from events, as `viewingOf` is (`server/routes/admin.js:105-121`). `tickets.active` (`:173-179`) stays until slice 9. |
| `GET /api/admin/loans` (new) | `?live=1&film=&person=&ticket=`. Each: `{ id, film, ticket: { id, label }, borrower: { kind: 'person', person } \| { kind: 'browser', device, signedInAs }, takenAt, dueAt, endedAt, endedHow, live, playingNow, position, finished, response, otherLinks }`. `signedInAs` is there only while that browser's session row exists; after the clean-up the device stands alone. `otherLinks`, on a live loan: the borrower's other links for the film that could still lend, for the take-back confirmation (question 14). |
| `POST /api/admin/loans/:id/take-back` (new) | Body `{ ticketId }`, which must match. 200 adds `alsoCancelled`, the ids of a member's other links it cancelled. 409 `not-out`. |
| `adminTicket` (`:351-405`) | + `loan`, `loanDays`, `pickNote`, and `linkState`, the state table's back office column: `unopened`, `opened` (both `in`), `waiting`, `has` (`lent`), `done` (`spent`), `missed` (`expired`), `cancelled` (`revoked`), `off` (`unpublished`), `unavailable`. The 1.x fields stay until slice 9. |
| `POST /api/admin/tickets` (`:445-472`) | + `loanDays` (1 to 30, or null for the default) and `pickNote` (up to 2,000). `screeningLimit` and `daysAfterFirstPlay` are accepted and ignored until slice 9, then refused. Logs `ticket-sent`. |
| `PATCH /api/admin/tickets/:id` | + `pickNote`, `loanDays`. On a link that has the tape, `loanDays` moves the due date (question 8); 409 `would-end-loan` if that has passed. |
| `…/revoke`, `/restore`, `/holder`, `/sign-out-browsers` | As in "What can happen to a tape". |
| `POST /api/admin/screenings/:id/void` (`:543-548`) | Refuses a loan's screening from slice 3 (409 `tape-out`). Removed with its button, in slice 9. |
| `GET /api/admin/responses` (new) | `{ responses: [{ id, kind, message, createdAt, readAt, person, film, loan: { takenAt, dueAt, endedAt } }], unread }`. `POST …/:id/read`, `DELETE …/:id`. |
| `GET /api/admin/activity` | `kind=loans` (below). |
| `GET /api/admin/booth` | + `attention.tapes: { out, next: { film, dueAt } }` and the sweeper's last run. The start-by list uses the effective date and leaves out links that have lent. |
| `GET`, `PATCH /api/admin/settings` | `loanDays`: a whole number from 1 to 30, default 3. `resumeWindowHours` leaves `DEFAULT_SETTINGS` and `RULES` (`server/settings.js:14`, `:48`) for a `RETIRED` set that `validate` accepts and `update` drops: Settings sends it with every save today (`web/src/admin/Settings.jsx:52`), and an unknown key is a 400 (`server/settings.js:95-99`). |
| Members | The list gains `tapesOut: [{ film, dueAt }]` and `liveLinks`; a member's page gains `loans`, by the loan's `person_id`: tapes borrowed on their own links. A tape they took on a link anyone can use while signed in is a browser's loan and isn't listed there. |

## Events, the Ledger, retention and Status

`events.type` is free text, so new kinds need no migration. The list in the comment at
`server/access.js:85-90` is updated.

| Kind | When | Detail |
|---|---|---|
| `ticket-sent` | a link is made | `{ loanDays, note: true \| false }` |
| `lent` | Play takes the tape | `{ loanId, dueAt }` |
| `returned` | a loan ends; dated when it ended, so a due return is dated `due_at` | `{ loanId, how, response: true \| false }`. Never the response's text. |
| `due-changed` | you move a due date | `{ loanId, from, to }` |
| `ticket-cancelled`, `ticket-restored` | cancel and restore, which log nothing today | |

- **The Ledger.** Kinds become three sets: viewing (as today,
  `server/routes/admin.js:554`), loans (the kinds in the table above) and accounts
  (every other kind).
  Today's "not viewing" (`:565`) would file every loan under "Cards, passkeys and links".
- **Retention.** Loans and responses join what the clean-up never touches
  (`server/retention.js:5-11`). The guard that keeps a session holding a play that can
  be resumed (`:29`) becomes one that keeps a session named by a loan not yet ended,
  because `closeStale` reads when that session ended. Since when, "lent N times",
  spent and the start-by pause all come from loans, so deleting events changes none of
  them. So does who, for a member's own link. For a browser's loan the device is kept
  on the loan; the name that browser was signed in as, if any, lives on its session
  row and goes when the clean-up deletes it (`:25-29`: once the session has ended and
  no kept event names it, a year by default, `server/settings.js:30-31`). The back
  office then shows the device alone. Events about loans go with the rest, after
  `retainEventsDays`.
- **Status.** "N tapes out. The next due back is {film}, {when}." The refusal reason
  for a tape that is out is written where the others are (`server/routes/media.js:17`),
  as "the tape is out with someone else": the page shows the server's words as they come.

## Upgrading an existing shop

2.0.0 is the first release since 1.0.0 with a migration, and the first whose migration
can end something a friend is doing. The changelog's **Upgrading** note
(`CHANGELOG.md:7-9`) will say, in this order:

1. **Back up**, and copy the backup off the server (`docs/deploying.md:57-66`).
2. **Preview**, on your computer, in the 2.0 code, against the copy step 1 put there
   (`docs/deploying.md:58-66`): `node scripts/upgrade-preview.mjs ~/open-matte-backups/<file>`
   (new, slice 1; Node 22.13 or later, and nothing but `node:sqlite`). It copies that
   one file to a temporary folder, opens the copy with the new code and prints the
   loans it would make (film, link, borrower, due back), the plays it would cut off, the
   links that would be spent once their loan ends though 1.x would have let them play
   again (question 15), the links it would spend, the played links that lend once more
   and the loan lengths it would cap. It never opens the original, and deletes the copy. The report is as of the backup: the real run decides by
   the clock when the server starts, so a Play pressed in between can change it.

   It can't be run on the server as the notes stand. The app's image has no `scripts/`
   (`.dockerignore`, `Dockerfile:31`, `docs/deploying.md:194-197`), the server needs no
   Node of its own, and `scripts/deploy.sh` sends the code and restarts in one command
   (`scripts/deploy.sh:21-34`). A shop that updates with git on the server, with no
   Node on a computer, can run it there after `git checkout v2.0.0` and before
   `docker compose up -d --build`:

   ```bash
   docker run --rm --network none \
     -v /srv/open-matte/app/server:/app/server:ro -v /srv/open-matte/app/scripts:/app/scripts:ro \
     -v /srv/open-matte/backups:/backups:ro deploy-app node scripts/upgrade-preview.mjs /backups/<file>
   ```
3. **Update while nobody is watching.** Status and the Tapes page show who is.
4. The server runs migration 8 as it starts, in one transaction. If it fails, nothing
   has changed: the database is still schema 7, and 1.1.0's code still opens it.
5. **Check** Films and Tapes: each film is in, or out with one borrower.

What becomes of what is there (question 3 answer a, question 4 answer a, question 15
answer a):

| At the upgrade | After it |
|---|---|
| A film with several links nobody has played | Nothing changes. Every link waits, and the first Play takes the tape. |
| A link never played | Lends once: for the days it said "after the first play", at most 30; with none, the shop's default (3). Its start-by date is kept. |
| A link never played, its start-by passed | Start-by missed, as before. |
| One play open on a film, which its holder can still resume | It becomes the film's loan, due at the end of that play's time to come back, or at the link's expiry if sooner. The borrower is the link's member, or the browser holding the play. The position is kept. A start-by date that has passed since the first play is no bar: 1.x stopped reading it then (`server/access.js:118`). |
| That link had plays left, no limit, or days left (question 15) | The same loan, due at the same time, and the link is spent when it ends. 1.x would have let it play again: a link good for 14 days, started yesterday, is due back tomorrow, not in 13 days. The preview lists these links by name, so you can send new ones. |
| Several plays open on one film | One becomes the loan: the one playing now, then the one heard from last, then the earlier play, among those whose holder can still resume. The others get no loan. Their player stops at its next report, their page says "Out on loan", and their link lends once when the tape is back, from the beginning: the place they had reached in 1.x isn't carried over. |
| A play open that its holder can no longer resume: the browser signed out, expired, or signed out of the link ("Sign out browsers"); or the member's card turned off | No loan. 1.x would let another browser with the link take that play over at once (`server/access.js:149-151`, `:204-207`), so the link is not spent: it lends once, from the beginning. |
| A link used up, or past its days after the first play (cancelled ones too) | Spent: an ended loan marked `before-2.0`, which ended at the link's expiry, or when the last play that counts (not one given back) could no longer be resumed, if that was sooner. Restoring one can't make it lend. A play that names no browser, on a link for anyone, leaves a loan with nobody on it: the one kind of loan that may have none. |
| A link played, with plays left or no limit, nothing open | Lends once more, for as long as a link never played: its days, at most 30, or the shop's default, counted from the new Play. 1.x counted the days from the first play, so this can be longer than 1.x gave. |
| A link whose only play was given back | Lends once. Given-back plays don't count, as in 1.x. |
| A play open on a film that is off the shelf, or on a cancelled link | No loan: 1.x couldn't play it either. |
| A link that was kept, or can be | Unchanged. |
| The "Time to come back" setting | Its stored row stays and is ignored (`server/settings.js:82-88`). Loans default to 3 days. |
| A link's label | Never copied into "Picked for you". It is your private note (`server/db.js:46`). |
| Sessions, events, members, passkeys | Unchanged. |

**Going back.** 1.1.0, like every release since 1.0.0, refuses a schema 8 database
(`server/db.js:250-255`); its message is the example already in
`docs/deploying.md:421`. Going back means restoring the backup from step 1
([Rolling back](deploying.md#rolling-back), `docs/deploying.md:415-463`). Loans,
responses, "Picked for you" notes and links made since that backup are lost.

## Slices

Eleven slices, 0 to 10. Slice 0 can start today, on `main`. 1 to 6 are the server, 7 to
9 the pages, 10 the release. Each merges into a `v2` branch with every test green and
the app usable (2 and 3 merge together, as slice 2 says): until slices 7 to 9, 1.1.0's
pages keep working over the new server through the two kept fields, and say "This film
isn't available right now" for a tape that is out. 2.0.0 is released once, after slice
10: one backup, one migration, one point to go back to.

Three working rules for the branch:

- **Which database a `v2` build may open.** Only a throwaway folder, with `DATA_DIR`
  pointing at it, seeded from a copy of a backup. Never `./data`, and never either
  server. `DATA_DIR` is `./data` unless set otherwise (`server/config.js:38`,
  `.env.example:22`), `npm run dev` opens the database there (`package.json:16`,
  `server/index.js:13`) and opening migrates (`server/db.js:219`),
  so the first run of slice 1 there would take the real local database to schema 8,
  and 1.1.0 on `main` would then refuse it (`server/db.js:250-255`).
- **Migration 8 is not frozen until the 2.0.0 tag.** `migrate()` compares only the
  version number (`server/db.js:246-261`), so a database opened by an early draft keeps
  that draft's shape. When the SQL changes, every database a `v2` build has opened is
  deleted and seeded again.
- **Node 22 and 24.** The workflow runs on pushes to `main` and on pull requests
  (`.github/workflows/tests.yml:7-10`), a `v2` branch merged on this computer is
  neither, and this computer has only Node 26. A draft pull request from `v2` runs the 22, 24
  and 26 matrix on every slice with no change to the workflow. Opening it is a push to
  the public repository, so it waits for your go-ahead.

### 0. Test groundwork

- [x] Every unit test that presses Play gets a film of its own (`makeFilm`,
  `test/helpers.js:30`), and the journeys get one copy of the test film per browser
  project (`e2e/global-setup.js`, `playwright.config.js:57-64`). Most tests share
  `arrival` today, which one tape per film would turn into dozens of empty failures.
- [x] No assertion changes, and no automatic take-backs in helpers: they would hide the
  interactions version 2 has to test.

**Done when** `npm test` passes on 1.1.0's behaviour with the same 764 tests, and no two
tests in a file press Play on one film. It can merge to `main` as it is.

Built on 11 Nov 2026, not yet committed. Three things differ from the lines above:
`main` has 797 unit tests, not 764, and all 797 pass before and after; assertions
changed only where they name a film's slug; and a guard in `test/helpers.js` fails any
test that presses Play on a film another test in its file has played. The guard has one
exception, so "done when" holds with it: a journey told over several tests may press
Play again on the link its first test played (`test/journey.test.js:182`, a play given
back and then played again). The guard reads `screenings`, so slice 2 points it at loans
if Play stops writing there, and that journey is rewritten there (under
[Tests](#tests)). It watches every database `startServer` opens, and the three that
tests open themselves for `createApp` (`test/migration.test.js`, `test/backup.test.js`).
Of the journeys only chromium has been run.

### 1. Migration 8, and the upgrade

- [x] Migration 8 as above; `server/booth.js:112` then reports schema 8.
- [x] "A schema 7 database" in `test/migration.test.js`, written from this plan and not
  from the code, as the schema 6 suite was (`test/migration.test.js:277-283`).
- [x] `scripts/upgrade-preview.mjs`, with a test that the file it is given is untouched.

**Done when** the suite passes on Node 22, 24 and 26 (the draft pull request above),
the preview prints the fixture's report, and a migration that fails part-way rolls
back whole. No 1.x data can break one of the new indexes, so the fixture for that is a
schema 7 file that already has a table called `loans`: migration 8 fails at its
`CREATE TABLE`, after both `ALTER TABLE`s have run, and the test finds schema 7, no
`loan_days` or `pick_note` column, and every 1.x row as it was. Questions 1, 3, 4 and
15, which it waited on, were answered on 11 Nov 2026. Three proposals are also in this
SQL: the 1 to 30 days, the four kinds of response, and `read_at`. Overruling one later
only changes a draft, because migration 8 isn't frozen until the tag.

Built on 11 Nov 2026, not yet committed. Still open from the lines above: the suite has
run on Node 26 only, so 22 and 24 wait for the draft pull request. The shop the suite
and the preview's tests upgrade is `test/schema7.js`. The suite's rows over HTTP (the
winner streams from its position, a loser's report, another link sees `out`; under
[Tests](#tests)) need slice 2's `server/access.js` and are written there: until then
1.1.0's rules run unchanged over a schema 8 database. The preview refuses a database
that has a `-wal` file beside it: that is one a server has open, not a backup. Given a
link to a file, it looks beside the file the link leads to.

Reviewed on 11 Nov 2026; the review found nothing wrong in migration 8, and its SQL is
unchanged. What changed: the preview follows a link before it looks for a `-wal` file;
`openDb` closes the connection when opening or upgrading fails, where every release so
far left it open, so a failed upgrade leaves no `-wal` or `-shm` file beside the
database; and the fixture gained four cases, each with its test: an open play on a link
whose start-by date has passed since its first play (a loan), two plays heard from at
the same moment (the earlier one), a used-up link with a play given back between the
two that count (ended with the last that counts), and a used-up link whose play names
no browser (spent, with nobody on its loan). The suite also names every index, every
required column and every reference of the two new tables.

### 2. Loans: taking the tape

- [ ] `server/access.js`: the live test, `isBorrower`, `closeStale`, `ticketStatus`,
  `filmAccess` and its ranking, `mayStream`, `startScreening`, `heartbeat`, `canKeep`.
- [ ] Around it: `loanDays` as a setting, with the retired one, and on
  `POST /api/admin/tickets`, which logs `ticket-sent`; `moveLoans` and `prolong` in
  `server/sessions.js`, with the cookie sent again from the Play route and the film
  page; `endLoansOf` called from `people.disable`; the retention guard; the sweeper;
  the refusal reason; `ticketForViewer` with the two kept fields; Play's answer;
  `/api/me`'s `tickets`.
- [ ] The start-by rule in the state table: `waiting`, not `expired`, while the tape is
  out.

**Done when** two links pressed at once give one 200 and one 409 `out`, in one process
and from two; a non-borrower's every answer is the same for both kinds of `out`, also
after a start-by passes and with the film's files broken; a tape past due is taken by
the next link with nothing written in between; a browser whose session was made 89
days ago plays, and two days later still has its cookie and its tape; a card turned
off and on again leaves the loan ended; your preview takes nothing; and 1.1.0's page
still plays and resumes. Waits on questions 2, 5, 9 and 12.

Slice 2 is not tried on its own. Until slice 3, 1.1.0's Cancel, Restore, Give, Sign
out browsers and Give back still act on a link that has the tape, with none of the
guards above: a cancel there would leave a tape out that nobody can play. So 2 and 3
merge into `v2` together.

### 3. Coming back

- [ ] `returnTape` and `POST /api/films/:slug/return` with its `takenAt`, without
  responses yet.
- [ ] Take back by loan, with the member's other links for the film; revoke, restore,
  holder and Sign out browsers as in the rules; the void route refuses a loan's
  screening (it goes in slice 9); moving a due date, through `loanDays` on
  `PATCH /api/admin/tickets/:id`; the new events and the Ledger's three kinds.
- [ ] A spent link: `POST /api/tickets/open` answers 410 `ticket-spent` to a browser
  that doesn't hold it, and its preview shows the shop (`server/page.js:54-59`).

**Done when** a return frees the film at once, spends the link and stops the borrower's
other device at its next report; a return from a tab left open on an earlier loan
changes nothing; a take-back stops both kinds of borrower with `taken-back`, cancels
the link, and another link can take the tape, but not the same member's second link;
and a return racing a take-back has one winner. Waits on questions 6, 8 and 14.

### 4. Picked for you, and responses (server)

- [ ] `pickNote` on send and edit and in `access.ticket`; responses on return; the
  three back office routes.

**Done when** editing a note never changes the staff pick, nor the reverse; neither the
note nor `label` is in a preview or the members' listing; a response is refused from a
browser's loan, from anyone but the borrower, twice, and after the tape came back on
its own; `canRespond` and the route agree in every case; and no event holds its text.
Waits on question 13.

### 5. What the back office and the front page need to know

- [ ] Films `tape`, `links` and `lending`; `/api/admin/loans`; `adminTicket`'s `loan`,
  `loanDays` and `linkState`; Members'
  `tapesOut`; Status `attention.tapes`; `/api/me` with yours first, `browserLoans`, and
  in or out on the members' shelf.

**Done when** the API tests pass, and a test finds no borrower's name, device, label or
`takenAt` in any viewer route's answer. Waits on question 7.

### 6. Start-by while the tape is out

- [ ] `effectiveStartBy`, in `ticketStatus`, the Status list and the back office.

**Done when** a table of loans and deadlines gives the dates the function above gives.
Leaving this slice out changes one thing: a link whose start-by passed while the tape
was out shows "start-by missed" as soon as the tape is back, and you send a new one.
"Never who" doesn't depend on it, because slice 2 holds that part.

### 7. The friend's film page and player

Reuses, from 1.1.0: `Counter` (`web/src/pages/Film.jsx:271-336`), `TitleTape` and
`NarrowPage` (`web/src/pages/tape.jsx:51-73`), `Sticker` (`web/src/look/objects.jsx:297-306`),
`PlayTile`, `PlayScreen`, `OsdStrip` and `ComingBack` (`web/src/look/crt.jsx`), `Line`
(`web/src/look/ui.jsx:22`), and the words in `web/src/pages/tapeWords.js` and
`web/src/look/words.js`.

- [ ] The counter's states. In: "Play takes it out" on a two-line sticker (`Sticker`
  gains a line). Out: "Out on loan", "Back Fri 6 Nov" (a new key beside `DEADLINE_KEYS`,
  `web/src/look/words.js:43`), and the one sentence from "What a viewer sees", with no
  "your link still works", no start-by line and no keep offer. Yours: the `ComingBack`
  telly, "It's yours until…", Return it now confirmed on the page, the receipt as
  plain lines; paused, "Hand it back" as well if question 13 is (b). Then finished,
  spent, start-by missed, and unavailable in its three forms: yours (the due date and
  Return it now stay), out (the due date stays), in ("nothing has been taken out").
- [ ] `clockLines`, `goneLine` and `nextDeadline` rewritten for one clock. `PLAY_ERRORS`
  (`Film.jsx:23-33`) and `haltMessages` (`tapeWords.js:99`) learn the new codes.
- [ ] The player: `aside="Due back Sun 8 Nov"` on the paused strip (the prop exists,
  `crt.jsx:85`), an `onEnded` up to the page (`web/src/Player.jsx:463` only clears the
  strip today), and the end's three choices.
- [ ] Your preview says who has the tape. The line telling you to try a link in a
  private window (`Film.jsx:286`) says that doing so takes the tape. The two kept API
  fields go.

**Done when** every state in the mock-up's friend table that isn't a "today" state is
on the page at 1440, 390 and 320 pixels, with the out pages' words as this plan has
them where the two differ, and `test/friend-words.test.js` and `test/look.test.js` are
rewritten and pass. Waits on questions 10, 11, 12 and 13.

### 8. The friend's front page, handing it back, and notices

Reuses `Facing` and the notices (`web/src/pages/Home.jsx:86-107`, `:10-16`), `PickCard`
and `Hand` (`web/src/look/objects.jsx:275-292`), `confirmSignOut`
(`web/src/site.jsx:146-158`), and the kit's fieldset, choice and textarea pieces.

- [ ] The front page in sections: On your card (or "Out to this browser", without the
  mock-up's "Sign in to keep them on your membership card" if question 2 is (a)),
  Picked for you, your other links, On the shelf for members.
- [ ] Hand it back, as a view inside the film page and not a new route: one response
  required, "Only {host} sees this", "Return it without a note". The "Picked for you"
  sheet in the counter, apart from the staff pick card.
- [ ] Notices: a spent link (a new key), "Opening a link never takes the tape"
  (`web/src/pages/TicketOpen.jsx:149`), the sign-out confirmation naming the tapes that
  go back.
- [ ] 8b, separable: the till slip as a printed thing (a paper kind, the Doto face, its
  licence entry in `test/third-party-licenses.test.js`).

**Done when** a member sees what they have out and when it's due on every device, a
response handed back reaches the back office, and a spent link in a fresh browser shows
only the notice.

### 9. The back office

Reuses the Films table and `Mark tone="info"` for "out" (`web/src/admin/Films.jsx:57-90`,
`web/src/admin/ui.jsx:80-88`), the film page's tabs (`web/src/admin/FilmDetail.jsx:25-29`),
`TicketTable` and the send form (`web/src/admin/Tickets.jsx:106-151`, `:155-329`),
`TicketBadge` and `describeEvent` (`ui.jsx:144-155`, `:236-287`), and `attentionLine`
(`web/src/admin/facts.js:33-45`).

- [ ] Films: a Tape column in place of "Active tapes" (`Films.jsx:64`). A film's page:
  the tape panel (who, since, due back, now), and taking the tape back with a
  confirmation on the page that says what the borrower will see, which of their other
  links for the film go with it, and which links anyone can use their browser also
  holds (question 14).
- [ ] The send form: "Picked for you" with its hint, "Due back after", the warning when
  the film is out or has a link waiting. "Plays" and "Days after the first play" go.
- [ ] Tapes: Out now, then the links. A link's page: its loan and states, no Give back.
  While it has the tape, "Let anyone with the link use it", "Give it to someone else"
  and Sign out browsers are disabled, with a line saying why (question 2, answer a).
  Members: tapes out. A seventh section, Responses, with its unread count and "Mark as
  read" (`web/src/admin/AdminApp.jsx:116-135`).
- [ ] The Ledger's rows and Loans filter; Status; Settings: "Due back after, for new
  links", and what "Sign out every friend and member" does to tapes that are out
  (`web/src/admin/Settings.jsx:180`).

**Done when** every screen in the mock-up's back office table shows its version 2 parts,
and `test/office.test.js`'s word scan passes on the new screens.

### 10. Journeys, docs, rehearsal, 2.0.0

- [ ] The browser journeys below, in all four projects, twice running; the docs below,
  the changelog with its Upgrading note, the version.
- [ ] A rehearsal on a copy of the live shop's backup ([Checking a
  backup](deploying.md#checking-a-backup), `docs/deploying.md:313-349`): the preview's
  report read with you, then the upgrade, then a loan from Play to hand-back.
- [ ] After the tag, both servers are upgraded by the same five steps, each from its
  own backup: the shop, and the demo. Each upgrade waits for your go-ahead.

**Done when** the rehearsal ends with a tape lent and handed back on the copy, and
2.0.0 is tagged. The tag and the release are pushes to a public repository, so each
waits for your go-ahead.

## Tests

**Existing tests that change.** Rewritten to the new rule, not loosened.

| File | What changes |
|---|---|
| `test/migration.test.js` | `:137` the milestone 1 browser still streams: its open play is now its loan (`tape: 'yours'`, position 42). `:365` the new columns are `loan_days` and `pick_note`. `:103` holds as it is. |
| `test/screenings.test.js` | `:58-118` the resume window becomes the loan length and `loanDays`. `:122-164` takeover moves to one member's two devices. `:209` giving back a play goes. |
| `test/journey.test.js` | `:86`, `:130`, `:166`, `:186`, `:225`: plays left, a second device on one link, used up, expiry against the window and "a limit of two" become one loan's journey. `:178` goes. |
| `test/boundaries.test.js` | `:143` becomes the main race: two links, two browsers. `:157` moves to a member's devices. |
| `test/identity.test.js` | `:574-699` a link and the member's own link for one film no longer play at once; the ranking puts `yours` first. `:703` is rewritten. |
| `test/people.test.js` | `:674-737` signing in carries the loan. `:1106-1158` a holder who can no longer play: the loan ends and another link takes the film. |
| `test/keep.test.js`, `test/film-page.test.js` | Keep re-specified for question 2. `film-page.test.js:43-73`: one due date. |
| `test/retention.test.js` | `:35` loans and responses are untouched; the fixture before `:263` gets a film per state; a session named by a live loan is kept. |
| `test/activity.test.js`, `test/booth.test.js` | `activity.test.js:164` three kinds; the void at `:325` goes. `booth.test.js:128` the effective start-by, and tapes out. |
| `test/members.test.js`, `test/backup.test.js` | `members.test.js:207-211` the listing's keys, if question 7 is yes. `backup.test.js:65`, `:127` `loanDays` and `pickNote` in place of `screeningLimit`. |
| `test/branding.test.js` | `:1574` a spent link previews as the shop; the `resumeWindowHours` cases. |
| `test/friend-words.test.js`, `test/look.test.js`, `test/office.test.js` | `friend-words.test.js:46-170`, `look.test.js:64-143` and `office.test.js:70-121`: about 20 tests on the 1.x clocks and play limits, rewritten in slices 7 and 9. |

**New.**

- `test/loans.test.js`, with the clock passed in as `test/screenings.test.js` does: one
  test for each row of "What can happen to a tape", and a tape past due closed by each
  of Play, return, keep, take-back and the sweeper, with `ended_at` equal to `due_at`.
  And the rows the review added: a take-back, then Play by the same member on a second
  link (no such film, no new loan); a return carrying an earlier loan's `takenAt`
  after a second loan started (409, nothing changes); a card turned off and on with no
  sweep in between (the loan stays ended, the link stays spent); a loan whose session
  ended before `taken_at` by the clock (closed at `taken_at`, no error); a film's
  files breaking mid-loan (the borrower keeps `tape: 'yours'`, the due date and the
  return, and it stays on their card).
- `test/loans-race.test.js`. In one process: two links pressed together, Play against
  take-back, return against take-back. From two: two `worker_threads`, each with its
  own `openDb` on one file, released together many times; every round has one success
  and one live loan. One process runs its handlers one after another, so only this
  truly overlaps two writers. And a plain second insert breaks `loans_out`.
- `test/never-who.test.js`. Two browsers open one link anyone can use; a third opens
  another. The first plays. For the other two, every row of "Never who has it" is
  compared: same status and body, apart from their own link's `pickNote` and
  `inAccount`. The borrower's name, device, the link's label and `takenAt` are in none.
  Both links carry a start-by, and the comparison is made three times: at once, after
  the clock passes the start-by with the tape still out, and with the film's files
  marked broken. It starts in slice 2 and gains rows as their routes arrive: return in
  slice 3, `pickNote` in 4, the members' shelf in 5.
- One test for each way a borrower stops being able to play (sign out, sign out
  everywhere, "Sign out every friend and member", card turned off, passkey removed,
  keys taken back, signing in as someone else): the loan ends, another link takes it.
- `test/responses.test.js` and `test/picked.test.js`: slice 4's "done when".
- The schema 7 suite: a row for every line of the upgrade table, old columns compared
  one by one, `foreign_key_check`, opening it twice; then over HTTP the winner streams
  from its position, a loser's report says `screening-ended`, another link sees `out`.
  Its fixture has the rows where the outcome isn't obvious: a member whose card is
  off, alone on a film (no loan); a play in a live browser that no longer holds the
  link, after Sign out browsers (no loan); a link past its days with its time to come
  back still open (spent at its expiry); the latest play given back with an older one
  open (the older one is the loan); a link part-way with plays or days left (a
  loan due at the end of its time to come back); a play open on a link whose start-by
  date has passed since its first play (a loan); and two plays heard from at the same
  moment (the earlier one). It asserts that no open loan comes
  out of the migration already over. The failing fixture is the one in slice 1.
- Settings (the retired key is accepted and dropped); sessions: `prolong`, and with a
  session made 89 days ago, the `Set-Cookie` on Play's answer as well as the row, then
  two days on; and a loan across the clocks changing on 25 October with
  `TZ=Europe/London`.

**Browser journeys** (`npm run e2e`; not in CI, `.github/workflows/tests.yml:3`). Each
journey that presses Play holds `exclusively('tape:<slug>')` (`e2e/fixtures.js:41-57`),
and `issueTicket` stops sending `screeningLimit` (`e2e/fixtures.js:80`).

1. **Lend and return.** One browser plays, a second sees "Out on loan" with no Play, the
   first returns it with the confirmation, the second plays, the first sees spent.
2. **Take it back** (replaces `e2e/revoke.spec.js`): the player stops with the take-back
   line and the page is gone.
3. **Hand it back** as a member with a passkey; the response shows under Responses.
4. **One member, two devices** (replaces `e2e/takeover.spec.js`): "Watch here instead".
5. **Picked for you** on the send form and the friend's page; the staff pick unchanged.
6. **A spent link** in a fresh browser shows the notice.
7. Rewritten: `e2e/shell.spec.js:56-64` (plays left) and `:191-205`, the keep journey in
   `e2e/passkeys.spec.js`, and `e2e/account.spec.js`.

## Docs to update

- **`docs/access.md`**: the Words table gains link and loan, and "tape" its second
  meaning; The records; Tickets (a link lends once, "Due back after", no play limit);
  rule 5; Opening a link (spent); Link previews; Keeping a ticket; Films shown to
  members; Screenings, rewritten as Loans from the rules here; Media requests; Signing
  in and out, and Disabling people (which loans end); What is recorded, and How long
  it's kept. A new warning: trying a link in a private window takes the tape.
- **`CHANGELOG.md`**: 2.0.0, with the Upgrading note above. **`docs/deploying.md`**:
  Before you update (the preview); After an update; Backups (they now hold friends'
  responses and your notes to them); After restoring an older backup (a tape returned
  since is out again, a link spent since lends again); Rolling back.
- **`README.md`**, What it does (`README.md:55`): links and loans in place of plays and
  limits. **`docs/roadmap.md`**: the 2.0 boxes, and "Still to decide" answered from
  here. **`web/src/look/README.md`**: the new states and printed things.

## Risks

- **The upgrade can cut someone off.** With two friends part-way through one film, one
  stops. The preview names them; updating when nobody is watching avoids it.
- **A shop's data the fixtures didn't foresee** could fail a `CHECK`: a row edited by
  hand, such as "0 days after first play", which no screen can make. No 1.x data can
  break a unique index. The migration rolls back and the server won't start on 2.0.
  Nothing is lost: it is still schema 7 and 1.1.0 opens it. The rehearsal in slice 10
  is the guard.
- **The upgrade spends some links early** (question 15). A link part-way through, with
  plays or days left, gets the rest of its time to come back and no more. The preview
  names them.
- **A second browser.** A friend who presses Play in a chat app's own browser and then
  opens the link in Safari or on the TV sees "Out on loan" there, and the link is
  spent afterwards. 1.x let the second browser take over, and a link for anyone is
  expected to play inside the app (`docs/history/device-checks.md:94`). Question 12.
- **A tape past due has no end written until something writes it.** Every path that
  takes or ends a loan must call `closeStale` first. If one forgets, `loans_out` refuses
  the take loudly, and the sweeper frees the film within a minute.
- **A lost browser.** A borrower on a link anyone can use who clears their cookies, or
  used a private window, still has a live session on the server. The tape stays out
  until it's due unless you take it back. That includes you, trying a link in a private
  window as the app suggests today.
- **"Return it now" can't be undone.** On a shared television it spends the link, and
  only a new link helps. Broken files, or the film off the shelf, eat loan time too.
- **Backups now hold friends' words**, the copies kept off the server included, and
  going back loses whatever was lent, said or noted since the backup.
- **The words change twice in a fortnight.** 1.1.0 told everyone a tape is a ticket
  (`CHANGELOG.md:94-105`). Every back office string that says "tape" gets a second
  pass, the API's error messages included (`server/routes/admin.js:299`).
- **The journeys aren't in CI**, so two of them fighting over one tape would only show
  when they are run by hand before the release.
- **The end of the film is two things.** The player's `ended` and the server's 92% can
  disagree: skip the credits and no end panel shows. After a reload the page goes by
  the server's mark.
- **Cost on every segment.** The live test adds lookups to each media request. They go
  by index, but it is measured in slice 2 before going further, on a throwaway database
  as the working rules say: not on either server.

## Out of 2.0

- Two people on one film at once (a watch-along, perhaps version 3).
- Before and after notes, best watched blind, asking for a recommendation and the
  journal: 2.x, as the roadmap says.
- A page of its own for a tape taken back, a loan length per film, and responses after
  a tape goes back on its own (questions 6 and 1, and the tentative answer of 10 Nov).
- A tape that moves with its link when the link is kept or given, unless you answer
  question 2 the other way. A fuller loan for links caught part-way at the upgrade
  (question 15, answered on 11 Nov). Keeping the name behind a browser's loan after its
  session is gone.
- The main button's colour, still open from the look, is not part of this plan.
