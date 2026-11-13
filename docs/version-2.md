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
| 11 Nov 2026 | Question 2. A link can't change hands while it has the tape (answer a). A friend can keep a link ("Sign in and keep it") only before Play, and only while the tape is in; you can give a link to someone, or let anyone use it, only while that link doesn't have the tape. A tape never moves quietly. What it costs: a friend who presses Play on a link anyone can use and signs in afterwards has the tape in that browser only (not on their card, not on another device, no response for that loan); a waiting link can't go on a card until the tape is back; and when Sam has the tape and Jo should watch instead, you take the tape back, which cancels Sam's link, and send Jo a new one. 1.x let a link be kept with a play open (`server/access.js:263-289`), and the mock-up drew the tape going with the link; both stop. |
| 11 Nov 2026 | Question 5. A tape taken on a link anyone can use whose browser is signed out (by itself, or by "Sign out every friend and member"), or a member's tape when their card is turned off: the tape comes back at once and the link is spent (answer a). A tape on a member's own link stays theirs when they sign out of one device. The sign-out confirmation will say which tape goes back. |
| 11 Nov 2026 | Question 9. One member may have two links for the same film (answer a). The second waits, and lends after the first is back. Play takes their oldest unused link, and only that one is spent. The form warns. |
| 11 Nov 2026 | Question 12. A second browser on a link anyone can use, while the first has the tape, sees the same "Out on loan" as anyone, and the link is spent once the tape is back (answer a). It can't take over, even from a paused tape. |
| 11 Nov 2026 | Question 14. Taking a tape back from a member cancels their other waiting links for that film in the same step (answer a). Links anyone can use that the borrower's browser also holds are named in the confirmation and left alone, because other people hold them too. |
| 11 Nov 2026 | Question 6. After a take-back the borrower's page shows "Nothing on the shelf here", as a cancelled link does today, and the player says you took it back (answer a). A page of its own can come later, because the loan remembers its borrower. |
| 11 Nov 2026 | Question 8. You can move the due-back date of a tape that is out, earlier or later, not into the past (answer a). |
| 12 Nov 2026 | Questions 16, 17, 13 and 7, answered as recommended. **16 (b):** taking a tape back from a browser where a member is signed in also cancels that member's never-lent links for the film (built with slices 2 and 3, `takeBackLoan`; listed in `alsoCancelled`). **17 (a):** a cancelled member link says so to anyone who opens it, as 1.x. **13 (b):** a signed-in friend can hand a tape back with a response at any time while they have it. **7: yes**, members see that a film on the members' shelf is out and when it is due back, never who has it. Questions 13, 16 and 17 left the table under To decide on 12 Nov 2026, with slice 4, and question 7 with slice 5, the same day. |
| 12 Nov 2026 | Questions 10, 11 and 18, answered as recommended. **10 (a):** the line saying what you can see begins "{Host} can see when this link is opened, when the tape is taken out and played, …", signed in or not; the rest is word for word. **11 (a), and both tables as proposed:** on a friend's pages what you sent them is still "a tape" wherever that doesn't claim the tape is out; pages for a tape that is out say "link" for the link; the back office says "link" for links and "tape" for the film's copy. **18 (c):** the give and release buttons show a link's "Picked for you" note with "Take the note away" ticked, and the route takes `pickNote` in the same step; until then the route keeps the note. These leave "To decide" empty. |
| 13 Nov 2026 | Questions 19, 20 and 21, answered as recommended. **19 (a):** a cancelled link's notice says "{Host} has cancelled that link." whether or not its tape was taken back; the borrower is told by the player and the film page. **20 (b):** one `BusyButton` (`aria-disabled` while busy, presses ignored) for every busy button in the app, 1.1.0's included, in one change in slice 10. **21 (a):** each browser writes dates and times in its own words. |
| 13 Nov 2026 | Question 22, answered as recommended. **(a):** the two boxes saved as you tick them (a film's Show to members, and the shop's name next to the logo) are busy as a button is: `aria-disabled` while they save, the focus kept, and a tick meanwhile changes nothing. |

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
| **Start-by dates don't count down while the tape is out with someone else.** The smallest part is in slice 2: a start-by that passes while the tape is out doesn't show as missed until the tape is back. Giving that time back afterwards is its own slice (6, built on 12 Nov 2026). You'd notice: a link's date is later by as long as the tape was out on other links since you sent it, to the minute, so it is no longer the end of a day. | Otherwise a link can run out while it is impossible to use. The slice 2 part is also what keeps "never who" true (below). |
| **Finishing the film keeps the tape** until it's due back, with "Return it now" at the end. | A scene can be watched again. "Finished" already ends nothing today. |
| **Before the first Play the page says Play takes the tape out**, with the due-back date it would have. | Play now has a consequence for other people. |
| *Build.* A loan is its own row in a new `loans` table, with the borrower stored on it. A response is a row in `responses`. | "One tape per film" and "a link lends once" become two unique indexes anyone can read. History outlives the Ledger's clean-up. Keeping or giving a link can never quietly move a tape. |
| *Build.* The upgrade changes no existing row of 1.x's own columns. It only adds. | The promise every migration has kept so far (`test/migration.test.js:103`, `:365`). |
| A loan is 1 to 30 days, counted from the moment Play is pressed. You'd notice: the send form and Settings take 1 to 30, and a 1.x link that said more lends for 30. | A browser's session lasts 90 days (`server/config.js:50`), and 1.x allowed "3650 days after first play" (`server/routes/admin.js:411`), which would lock a film for years. |
| *Build.* The borrowing browser's session is extended to a day past the due-back time, and its cookie with it: Play's answer sends the cookie again with the new life. | A session ends 90 days after it was made, never later, and the cookie is set once with that same life (`server/sessions.js:150-153`); nothing sends it again (`:157-168`). A browser that opened its first link 88 days ago would otherwise lose the tape mid-loan, and the server would go on counting the tape as out to a browser that had forgotten it. |
| The clock keeps running if the film is taken off the shelf or its files break while it is out. You'd notice: with broken files the borrower's page says the film isn't available, and still shows the due date and Return it now. Off the shelf, the borrower sees no such film and can't return it. | As the time to come back does today (`docs/access.md:286-287`). You can take the tape back or move the date (question 8). |
| While a link has the tape out: giving it to a member, letting anyone use it, and **Sign out browsers** are refused. **Restore the tape** only works for a link that never lent. **Give back** (a play) goes. You'd notice: on the page of a link that has the tape, those buttons are disabled, with a line saying why. | Each would leave a tape nobody can play, or let a link lend twice. For giving and letting anyone use it, the mock-up drew the opposite ("The tape goes with the link", tagged Open question, `.claude/design/vhs/app/office/office.js:461-462`), and 1.x allows both with a play open (`server/access.js:296-313`). That part was yours: question 2, answered (a) on 11 Nov 2026. |
| A spent link opened in a browser that doesn't hold it shows a notice on the front page, makes no session and doesn't name the film. Its preview in a chat app shows the shop, not the film. | The link has done its job. It should tell a newcomer nothing. |
| Responses: one of the four is required on the form ("Return it now" is the way to say nothing); only for a tape borrowed on a member's own link; kept until you delete one; the text never goes in the Ledger. Beyond the mock-up's plain list: the Responses tab counts the unread ones, and each can be marked as read. | A link anyone can use may have been forwarded. Events are deleted after a year; a friend's words shouldn't vanish with them. The unread count is one column (`read_at`); say so and it goes. |
| A loan on a link anyone can use remembers the browser, not a name. If that browser was signed in, the back office shows the name while the session's row exists, and the device alone after the clean-up removes it (about a year). | Settled: the borrower there is the browser. The clean-up promises that ended sessions go (`server/retention.js:25-29`). A column for the name can be added later if you want it kept for good. |
| The receipt shows first as plain lines (taken out, due back, out to you or to this browser). The till-slip print is a separate small piece (8b). Built with slice 8 on 12 Nov 2026: the Doto file was already on this computer. | The slip needs a new paper kind, a new typeface and its licence entry. The facts don't. |
| *Build.* The API keeps 1.1.0's `expiresAt` and `openScreening` beside the new fields until the friend's pages are rebuilt (slice 7). Gone from the friend's answers with slice 7, on 12 Nov 2026. The back office's link keeps its own: slice 9 rebuilt its pages without them (bar `openScreening`), and left taking them out of the API, with the tests that read them, to slice 10. | Each server slice can be tried under 1.1.0's pages. |

### To decide

Yours. The plan below is written with our recommendation for each. "Waits" names the
first slice that can't be finished without your answer. Questions 1, 3, 4 and 15, which
slice 1 waited on, and questions 2, 5, 9, 12, 14, 6 and 8, which slices 2 and 3 waited
on, were answered on 11 Nov 2026 and are under [Settled](#settled). Questions 13, 16,
17 and 7 were answered on 12 Nov 2026 and are there too: 13, 16 and 17 left this table
with slice 4, and 7 with slice 5. Questions 10, 11 and 18 were answered on 12 Nov 2026
as well. Questions 12 to 15 came out of the plan's review, 16 and 17 out of the review
of slices 2 and 3, 18 out of the review of slices 4 to 6, and 19 to 21 out of the review
of slices 7 to 9 (12 Nov 2026), and 22 out of the review of slice 10 (13 Nov 2026):
none of them stops a slice, and the pages are built as we recommend. Mock-up files are cited from `.claude/design/vhs/app/`.

| # | Question | Options | We recommend | Waits |
|---|---|---|---|---|

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
| "{Host} has taken that tape back." | the notice for any cancelled link (`Home.jsx:12`) | only after a take-back. A link cancelled before it lent: "{Host} has cancelled that link." (Slice 8: opening a link can't tell the two apart, so both say "has cancelled that link"; see its "Built on" note.) | the same split |
| "That tape has been kept on someone's membership card.", "This tape has been kept" | `Home.jsx:13`, `web/src/pages/Film.jsx:155` | stays | "That link has been kept…" |
| "This tape is for one member", "This tape is for someone else" | `web/src/pages/TicketOpen.jsx:88`, `:111` | stays | "This link is for…" |
| "It also forgets 1 tape you opened from a link here" | the sign-out confirmation (`site.jsx:155-156`) | stays ("Signing out also forgets…" since slice 8), and names the tapes that go back (question 5) | "forgets 1 link you opened here" |
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
`MAX(taken_at, MIN(due_at, :now, COALESCE(<that moment>, :now)))`, so a clock that
stepped back, or a session row that is gone, can never break the `CHECK` on `ended_at`:
one bad row would otherwise stop every Play on its film and every sweep. Nor is an end
ever dated later than the moment it is written: a session whose row says it was signed
out at a time the clock hasn't reached is signed out by the test above, and its tape is
written back as `signed-out`, now, not as `due` at a date still ahead. The sweeper follows
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
| `expired` | never lent, and its start-by has passed: the date with the time the tape was out on other links given back (slice 6, below) | start-by missed | Start-by missed |
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
Once the tape is back the link has the time it waited (slice 6, below): it is `in`
again, with its date that much later, and `expired` only when that date passes.
"Never lent" has one exception, for links from 1.x: a link first played before the
upgrade met its start-by then, and 1.x stopped reading the date at the first play
(`server/access.js:118`). The upgrade lets such a link lend once more (question 4), so
a start-by is read only while `first_played_at` is empty. Slice 1's fixture has the
row (`metStartBy` in `test/schema7.js`).

`used_up` goes, and so do `expiresAt`, the counts and `open` in what it returns. It
returns `{ state, loan, out, startBy, loanDays }`, with `loanDays` the link's own or the
shop's default, and `startBy` the date the link goes by (slice 6): null for a link with
no date, and once it has been played.

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
| Play, view `in` | holder; `closeStale`, then the browser's session is still live (read again inside the step) and the view is still `in` | a screening and a loan, due `now + loanDays` days; `first_played_at`. A browser's loan: its session extended to due + 1 day, and its cookie sent again (below). | `lent`, `play` |
| Play, view `yours` | the borrower. Another of their own devices active in the last 75 s and still able to play: `playing-elsewhere` | claims the screening (`server/access.js:203-208`, unchanged, among one member's devices). A browser's loan: the cookie sent again. | `play` (resumed) |
| Play, view `out`, `spent`, `expired`, `unavailable` | | 409 with the view's name | |
| Reaching 92% | the borrower's player | `finished_at`, as today (`server/access.js:250-253`). The tape stays out. | `finished` |
| Return it now, Hand it back | the borrower, loan live, the browser's session still live (read again inside the step, as for Play), and the `takenAt` sent is this loan's. A response only when the loan's member is the viewer, at any time while they have the tape (question 13, answer b) | `ended_at = now`, `returned`; the screening stops; a `responses` row | `returned` |
| It comes due | nobody: the test above | written later as `due` at `due_at` | `returned`, dated `due_at` |
| A browser with a tape out is signed out, or its session ends (question 5) | nobody: the test above | written later as `signed-out`, at that moment | `returned` |
| A member's card is turned off (question 5) | you; inside `people.disable` | their open loans end as `disabled`, in the same transaction | `returned` |
| You take the tape back | by loan id, with its link's id as a check; loan live | `taken-back`; the link's `revoked_at`; its `session_tickets` rows deleted; the screening stops. A member's loan: their other never-lent links for the film are cancelled too (question 14). A browser's loan: the same for the member signed in on that browser at that moment, if there is one (question 16, answer b); no link anyone can use is touched. | `returned`, and `ticket-cancelled` for each other link |
| You cancel a link | if it has the tape, this is taking it back; otherwise today's revoke (`server/routes/admin.js:519-526`) | | `ticket-cancelled` |
| You move the due date (question 8) | loan live, and the days sent differ from the link's own (the same value again moves nothing); refused if the new time has passed | `due_at`; a browser's session extended, and its cookie at the borrower's next Play or film page | `due-changed` |
| Restore | refused (409 `lent-once`) if the link has a loan | today's restore | `ticket-restored` |
| Give, release, Sign out browsers | refused (409 `tape-out`) while the link has the tape (question 2) | today's otherwise (`server/access.js:296-313`). A "Picked for you" note stays on the link unless the give or release names `pickNote` in the same step, as the back office's buttons do with "Take the note away" ticked (question 18, answer c; built with slice 9). | as today |
| Keep (question 2) | view `in` only | today's keep (`server/access.js:271-289`) | `ticket-kept` |
| The film's files break | | nothing ends; the clock runs. The borrower still sees the due date and can return it. | |
| The film goes off the shelf | | nothing ends; the clock runs. The borrower sees no such film and can't return it. | |

Pressing Play keeps its shape (`server/access.js:193-224`): one IMMEDIATE transaction
that runs `closeStale` for the film, then `filmAccess`, then resumes (`yours`), takes
(`in`: the screening, the loan, `first_played_at`, the two events) or answers with the
view's name. `loans_out` is the backstop for a second process on the same file. Line
`:210`, the only reader of `resumeWindowHours`, goes. The route reads the browser's
session before the transaction begins, so the step reads it again (the live-session
test takeovers already use): a browser that a second process signed out in between
takes nothing, where its loan would have been over before it began and its link spent.

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
starts a new loan. The same goes for a member who pressed Play signed in, on a link
anyone can use (question 16, answer b). The loan is then the browser's (question 2),
but the back office shows that borrower by name, and their own link for the film would
otherwise still be on their page, with Play. So the member signed in on that browser at
the moment of the take-back loses their never-lent links for the film in the same
step, listed in `alsoCancelled`. A browser that has signed out has no tape to take back
(question 5). Links anyone can use that the borrowing browser also holds are left
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
const loanless = Boolean(s) && !loan && s.session_hash === viewer.id_hash; // a 1.x play the upgrade gave no loan
if (!mine && !loanless) return { error: 'not-found' };
if (!mine) return { error: 'screening-ended' };
if (!live(loan, now)) return { error: endedCode(loan) };      // returned | due | taken-back
// then revoked, unpublished or unavailable, then playing-elsewhere for the borrower's other device, then progress as today
```

(As built in slice 2, a play that has a loan answers only its borrower: a browser whose
session a play names, but whose loan is someone else's, gets `not-found` too, where the
first draft of these lines said `screening-ended`.)

`mayStream`: your back office browser, or a browser whose view is `yours` and which
holds the loan's screening. Signing in carries a browser's loan along: a `moveLoans`
statement beside `moveScreenings` (`server/sessions.js:135-136`, `:188-191`), under the
same condition. The loan stays the browser's (question 2), so it lives and dies with the
new session: sign-in makes that session last a day past the due time of the tape it
carries, as Play did for the old one, and the cookie it sets has that life. Otherwise a
shop whose `VIEWER_SESSION_DAYS` is shorter than a loan (the setting has no minimum)
would take the tape back days early, as `signed-out`. Signing in from another person's
session carries nothing, as today, so that browser's loan ends.

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
one the link began to wait for before the deadline as it then stands pushes it back by
the time the tape was out since the link was made: to the loan's end, or to now while
it is still out, so the time left stands still.

As built, with what the lines above left open:

- **When the wait begins.** When the tape is taken, or when the link was made if the
  tape was out already. A wait that would begin on or after the deadline as it then
  stands gives nothing back: the link had been missed by then, and could not have
  lent. So a link sent with a date already past is missed from the start, also while
  the tape is out (slice 2 alone let it wait until the tape was back, then called it
  missed), and a missed link's date never moves again.
- **Which loans.** Those taken since the link was made, and before them the last one
  taken earlier, which alone can still have been out then: one tape, so a loan ends
  before the next begins. Both are read by the `loans_film` index, so a film's history
  from before the link was made is never read. No stretch of time is given back
  twice, should two loans' recorded times overlap (a clock that stepped back).
- **Ends.** A loan that is over with no end written yet counts to the end `closeStale`
  will write (its due time, or the moment its borrower could no longer play), because
  reading writes nothing: the date is the same before the sweeper has run and after.
- **The state goes by this date and no other.** Slice 2's own test (a live loan taken
  before the date as it was set) is now the quick way to the same answer: while the
  tape is out on a loan the link began to wait for before its date, the date it goes
  by is ahead of the clock, whatever the film's earlier loans. That, and a date still
  ahead as it was set, need no loans read at all (Cost, under slice 6).
- **Reads through many links** (the Status list, and the counts of a film's and a
  member's links) read no loans for a link no loan can have moved: no loan on another
  link was taken before its date as set and still out once it was made
  (`startByMayMove`), so its date is the date as set. For the others, each film's
  loans are read once and handed to the same function (`startByReader`). A missed
  link stays missed for good, so without this they would cost more every month.
- **Who is told which date.** A friend reads one date, the one the link goes by
  (`startBy`, on a link the tape is in for or one that is missed), and none while the
  tape is out. You are told both: `startBy` is the date as you set it, which the form
  sends back as it came, `effectiveStartBy` the date the link goes by, and
  `startByPaused` whether its time stands still right now.

## Never who has it

Only the borrower and you learn anything about a loan. While the tape is out, everyone
else gets the same answer, byte for byte, whether it went out on another link or on
their own link in another browser (question 12, answer a).

| What a non-borrower can ask | What they get | Why it can't say who |
|---|---|---|
| The film page, `access.ticket` | `state: 'out'`, `tape: 'out'`, `dueBack`, their own link's `pickNote` and `inAccount`; every other key null | One code path for both kinds of `out`. No `firstPlayedAt` (`server/films.js:85` sends it today), no `startBy`, no loan, no device, no label. The note is the one on the link the page shows; a browser with two links for the film reads the same one whichever of them lent (the older, by the ranking under "What a viewer sees"). |
| The same, after their link's start-by passes during the loan | still `out`, and no `startBy` | A link that lent stays `lent`, and one that didn't stays `waiting` (the state table), so the date tells nothing. While the tape is out no viewer is told a start-by date at all, as it was set or as it now stands: the date a waiting link goes by moves with the clock, which a link that lent has no date to do. |
| The same, once the tape is back, on a link that has a start-by (slice 6) | `in`, with `startBy` later by the time the tape was out since the link was made | The sum is of when the tape went out and came back on any other link, and of nothing else: the same date whoever had it (a member, a browser, a browser a member is signed in on) and however it came back at that moment (returned, handed back with a response, taken back, due, with its end written or not). Neither moment is in the answer, nor the date as it was set. It says how long, which is under "when", below. |
| The same, when the film's files break during the loan | `state: 'unavailable'`, `tape: 'out'`, `dueBack` | The tape's keys don't depend on the state, for either kind of `out`. |
| `access.canKeep` | false whenever the view is `out` | Otherwise it would be true only when the tape is out on another link. |
| Play | 409 `{ error: 'out' }` | Decided before the takeover check, so `playing-elsewhere` only ever reaches the borrower's own devices. |
| Return, with a response or without | 409 `nothing-to-return`, also for no such film, whatever `takenAt` is sent | As keep answers today (`server/routes/viewer.js:162-172`). `cannot-respond` reaches the borrower only, so it never says whether a tape is out to a member or to a browser. |
| A progress report with any screening id | 404 `not-found` | The fix above. |
| Playlists and segments | 403, empty body | The reason goes to the log and the Status page only (`server/routes/media.js:12-19`). |
| `/api/me` | the same `out` entry; member films with `tape` (`in` or `out`) and `dueBack`; `browserLoans` empty | No loan fields unless the view is `yours`. A film on the members' shelf gives its loan's due time and nothing else, the same to every member, whoever has the tape and however they are playing it; once the tape is back it reads as it did before anyone had it, however it came back. Only a tape that is this browser's own moves a film up the list or is named in `browserLoans`. |
| Opening a link | `{ slug }`, in or out | Opening never reads the film's loan, only whether this link is spent, and takes nothing. |
| A link's preview in a chat app | title and poster, as today (`server/page.js:54-59`) | The same while the tape is out, on whichever link. Never a note, a date or a name. |
| `/api/site` | `loanDays`, the shop's default | Nothing about any loan is a setting. |
| The player's reasons for stopping | `returned`, `due`, `taken-back` reach the borrower only | Decided on the loan. |
| What a borrower said when handing a tape back | nothing, to any viewer: not to the one who said it, and not `responded` to anyone else | A tape handed back with a response looks to every other browser like one returned without. The words are in `responses`, which only the back office reads. |
| Your preview, the back office, the Ledger, Status | who, since when, the device | `access.tape` exists only when `via` is `admin`: for every other browser the film page has no such key. Everything under `/api/admin` answers 401 `not-signed-in` without your own session, to the borrower as to anyone. A viewer's answers never hold the link's label or id, the loan's id, the borrower's id or the session, nor `effectiveStartBy`, `startByPaused` or `startByAsSet`: a link's date as it was set beside the date it goes by, and whether its time stands still, are yours. |

What can still be worked out, and is accepted: **when**, not who.

- The due-back time less the loan length is when Play was pressed.
- A start-by date given back (slice 6) says how long the tape was out. Someone whose
  link said "Start by Friday" and now says Sunday 14:30 knows the tape was out for a
  day and fourteen and a half hours since their link was made, to the millisecond, and
  with the due-back date they read while it was out, when it came back: also for a
  loan they never saw, where before they knew only as closely as they looked. It is
  the same for every link with a date, whoever had the tape. Rounding what is given
  back up to whole days would tell less and keep the date at the end of a day; it is
  not built, and is offered under slice 6.
- Once a tape is back, another browser holding the same link anyone can use knows
  the tape went out on its link, and how it came back, though not who had it.
  Returned, handed back or due, that link is spent: its page says so, and anyone
  opening its address is told 410 `ticket-spent`. Taken back, the link is cancelled
  and dropped from every browser that opened it: those browsers have no such film,
  and anyone opening its address is told 410 `ticket-revoked`. Hiding the take-back
  from them would mean keeping the link in their browsers and calling it spent to
  everyone but the borrower, which reopens question 6; it is not built.
- With a loan length per link (question 1, answer a), the same can sometimes be worked
  out while the tape is out. The page tells a holder their own link's `loanDays` before
  Play, and `/api/site` gives the shop's default. Someone whose link says 7 days, who
  saw the tape in yesterday and reads "due back in 2 days" today, knows it went out on
  another link. A length per film (answer b) gives nothing away.
- A "that tape has been kept" answer (`server/routes/viewer.js:108-109`) still says a
  link you opened was kept, as in 1.x.
- A cancelled link answers 410 `ticket-revoked` to anyone who opens its address, signed
  in or not, as in 1.x (`server/routes/viewer.js:50`, before the check on whose link it
  is). So someone with a copy of a member's link can tell that it was cancelled, which
  a take-back does to it. It says nothing of who had a tape, and it stays (question 17,
  answer a).

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
| `startBy` | `in`, `expired`: the start-by date the link goes by, with the time the tape was out on other links given back (slice 6). Never the date as it was set beside it, and null while the tape is out. |
| `dueBack` | whenever `tape` is `yours` or `out` |
| `loan` | whenever `tape` is `yours`: `{ takenAt, position, finishedAt, toBrowser, canRespond }`. `canRespond`: the loan's member is the viewer and the loan is live, watched to the end or not (question 13, answer b). The return route refuses a response by the same rule. |
| `returned` | `spent`, and only to the one who borrowed: `{ at, how }`. `how` is `returned`, or `due` for every other end (a card turned off, a link spent by the upgrade), so the page needs two lines and learns nothing else. |
| `pickNote`, `inAccount` | this link's note or null; as today |
| `expiresAt`, `openScreening` | gone with slice 7 (12 Nov 2026). Until then, when `yours`: `dueBack`, and `{ resumableUntil: dueBack, position }`, for 1.1.0's pages |

`screeningLimit`, `screeningsUsed`, `screeningsLeft`, `daysAfterFirstPlay` and
`firstPlayedAt` go. `access` gains `tape: { out, borrower, takenAt, dueAt }` for your
preview only, with `borrower` as `/api/admin/loans` gives it and all three null while
the tape is in; it is there for a film off the shelf too. `canKeep` follows the rule
above.

| Route | Change |
|---|---|
| `POST /api/films/:slug/screenings` (Play, `:140-160`) | 200: `{ screeningId, resumed, took, position, masterUrl, takenAt, dueBack, toBrowser }`. Until slice 7 also `resumableUntil` (equal to `dueBack`), for 1.1.0's pages; it went with them. When the loan is this browser's, the viewer cookie is sent again. 409: `out`, `spent`, `expired`, `unavailable`, `playing-elsewhere`, `no-ticket`. The state's name is the error code, as today (`:152`). |
| `POST /api/films/:slug/return` (new) | Body `{ takenAt, response?, message? }`. `takenAt` is required and must be the live loan's, which the page has in `loan.takenAt`: a tab left open from an earlier loan can't hand back a later one, as the loan id guards a take-back. `response` one of `loved-it`, `still-thinking`, `not-for-me`, `lets-talk`; `message` up to 2,000 characters. 200 `{ returned: { at }, responded }`. Your own back office browser gets `nothing-to-return`: its page is a preview, which has no loan. 409 `nothing-to-return` (also for no such film, and for a `takenAt` that isn't the live loan's) or `cannot-respond` (nothing changes; told to the borrower of a browser's loan only, and anyone who isn't the borrower gets `nothing-to-return` with a response as without). A message is kept without the spaces around it, and one of nothing but spaces is no message. 400 for a message with no response, or no `takenAt`. 30 per 10 minutes through `limit()`, as keep (`:166`). |
| `POST /api/screenings/:id/heartbeat` (`:176-189`) | New 409 codes `returned`, `due`, `taken-back`. 404 for every screening that isn't the viewer's own. |
| `POST /api/tickets/open` | New 410 `ticket-spent`. |
| `GET /api/me` (`:74-94`) | `tickets[]` in the new shape: what this browser has out first, the soonest due back first, then the rest newest first as before. `memberFilms[]` gain `tape` (`in` or `out`) and `dueBack` (question 7); the film page of a film that is only listed stays as it was. New `browserLoans`: the titles this browser has out on links anyone can use, the soonest due first, for the sign-out confirmation; a member's own tape isn't among them, nor a film off the shelf. `linkTickets` stays. Nothing sits under a `membership` key, which only `/api/account` carries (`test/membership.test.js:668-673`). |
| `GET /api/site` | `loanDays` replaces `resumeWindowHours`. |

### The back office

Bare line numbers in this table are in `server/routes/admin.js`.

| Route | Change |
|---|---|
| `GET /api/admin/films`, `/films/:id` | + `tape: { state: 'in' \| 'out' \| 'off', loan }` and `links: { live, waiting, total }`. `off` is a film off the shelf, whatever its tape; `loan` is the live loan in every state, as `/api/admin/loans` gives it, so a film taken off the shelf with its tape out still says who has it. `live` links are not cancelled and have the tape or could still take it; `waiting` are the live ones that haven't lent (the send form's warning); `total` is every link sent. The detail adds `lending: { sent, cancelled, opened, lent, finished, responses }`, counted from links, loans and responses, never from events, as `viewingOf` is (`server/routes/admin.js:105-121`). `tickets.active` (`:173-179`) went with slice 9. |
| `GET /api/admin/loans` (new) | `?live=1&film=&person=&ticket=`; answers `{ loans }`, newest first, and 400 for a filter that isn't one, by its value or by its name (`film[]=1`, `films=1`). `person` is the loan's own member. Each: `{ id, film, ticket: { id, label }, borrower: { kind: 'person', person } \| { kind: 'browser', device, signedInAs }, takenAt, dueAt, endedAt, endedHow, live, playingNow, position, finished, response, otherLinks, screeningId }`, `screeningId` being the loan's play among its link's plays (slice 10: the link's page finds the play, and its device, by it). `person` and `signedInAs` are `{ id, name, disabled }`; `signedInAs` is there only while that browser's session row exists, and after the clean-up the device stands alone. `live` goes by the one test; for a loan that is over with no end written yet, `endedAt` and `endedHow` are what `closeStale` will write, because reading writes nothing. `response` is `{ id, kind, message, createdAt, readAt }` or null. `otherLinks`, on a live loan and empty otherwise, for the take-back confirmation (question 14): `{ id, label, kind: 'person' \| 'anyone', linkState, cancelledToo }`. `cancelledToo` ones are exactly what the take-back would list in `alsoCancelled`; the rest are links anyone can use that the borrower's browsers also hold and that could still lend, which stay. |
| `POST /api/admin/loans/:id/take-back` (new) | Body `{ ticketId }`, which must match. 200 is `{ loan, ticket, alsoCancelled }`, the loan as the list gives it: the ids of a member's other links it cancelled: the loan's member, or for a browser's loan the member signed in on that browser (question 16, answer b; empty when nobody is). 409 `not-out`. |
| `adminTicket` (`:351-405`) | + `loan` (the link's one loan, out or over, as `/api/admin/loans` gives it, or null), `loanDays` (the link's own, or null for the shop's default: sent back as it came it changes nothing), `pickNote`, `effectiveStartBy` and `startByPaused` (slice 6: the date the link goes by, null once it has been played or with no date, and whether the tape is out with someone else right now, so that its time stands still and that date moves with the clock; `startBy` stays the date as you set it, which a form sends back as it came), and `linkState`, the state table's back office column: `unopened`, `opened` (both `in`), `waiting`, `has` (`lent`), `done` (`spent`), `missed` (`expired`), `cancelled` (`revoked`), `off` (`unpublished`), `unavailable`. The 1.x fields stay until slice 9, in 1.x's words (from slice 2): `state` is `ok` for a link that is `in`, `waiting` or `lent` and `used_up` for one that is `spent`; `expiresAt` and `openScreening` are the loan's due time and playback while the link has the tape; `screeningsUsed` counts its plays. |
| `POST /api/admin/tickets` (`:445-472`) | + `loanDays` (1 to 30, or null for the default) and `pickNote` (up to 2,000 characters; a longer one is a 400 and nothing is made, where `label` is cut to its 200). `screeningLimit` and `daysAfterFirstPlay` are accepted and ignored until slice 9, then refused; the same on `PATCH`, which 1.1.0's link page still sends them to. Logs `ticket-sent`, which is not "last activity" on a link: one nobody has touched still shows none. |
| `PATCH /api/admin/tickets/:id` | + `pickNote`, `loanDays`. Only a save that names `pickNote` changes it (null, or nothing but spaces, takes the note away), and no event is logged for an edit. On a link that has the tape, a `loanDays` that differs from the link's own moves the due date (question 8); 409 `would-end-loan` if that has passed. The link's own value sent again, null included, changes nothing, so a form may send every field with each save. |
| `…/revoke`, `/restore`, `/holder`, `/sign-out-browsers` | As in "What can happen to a tape". `/holder` takes `pickNote` (slice 9, question 18 c): null or spaces take the note away, text replaces it, left out it stays; written only when the link changes hands, in the same step. |
| `POST /api/admin/screenings/:id/void` (`:543-548`) | Refused a loan's screening from slice 3 (409 `tape-out`). Removed with its button in slice 9: a 404, as any route that isn't there. |
| `GET /api/admin/responses` (new) | `{ responses: [{ id, kind, message, createdAt, readAt, person, film, loan: { takenAt, dueAt, endedAt } }], unread }`, newest first; `person` is `{ id, name, disabled }` and `film` `{ id, slug, title }`, as on a link. `POST …/:id/read` answers `{ response, unread }`, and the first time it was read stands. `DELETE …/:id` answers `{ deleted, unread }`: the loan and its `returned` event stay as they were. Both are 404 for a response that isn't there. The `DELETE` is the API's first, and like every call that changes something it must be sent as JSON (`server/app.js:152-164`), so it carries an empty body, `{}`. |
| `GET /api/admin/activity` | `kind=loans` (below). |
| `GET /api/admin/booth` | + `attention.tapes: { out, next: { film, dueAt } }` (`next` null with nothing out; a tape past due isn't counted, written down or not) and the sweeper's last run, `server.sweeper: { lastRun: { at, closed }, lastError }`, since the server started. The start-by list uses the effective date and leaves out links that have lent (slice 6, as built): links that never lent whose date, as it now stands, is within three days either side of now, the soonest first, each `{ id, label, film, person, startBy, startByAsSet, startByPaused }`. Here `startBy` is the date the link goes by, which 1.1.0's Status page shows and marks "Passed" by; `startByAsSet` is the date on the link, earlier when time has been given back. A link that waits with three days or less left stays on the list for as long as the tape is out, its date moving with the clock (`startByPaused`). |
| `GET`, `PATCH /api/admin/settings` | `loanDays`: a whole number from 1 to 30, default 3. `resumeWindowHours` leaves `DEFAULT_SETTINGS` and `RULES` (`server/settings.js:14`, `:48`) for a `RETIRED` set that `validate` accepts and `update` drops: Settings sends it with every save today (`web/src/admin/Settings.jsx:52`), and an unknown key is a 400 (`server/settings.js:95-99`). |
| Members | The list gains `tapesOut: [{ film, dueAt }]`, the soonest due first, and `liveLinks`, a count; a member's page has both and gains `loans`, by the loan's `person_id`, newest first, as `/api/admin/loans` gives them: tapes borrowed on their own links. A tape they took on a link anyone can use while signed in is a browser's loan and isn't listed there. |

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
| A link never played, its start-by passed | Start-by missed, as before. One exception, which follows from the rules for a tape that is out: if someone is part-way through that film at the upgrade (the next row) and began before the link's date passed, the link waits like any other, and once that tape is back it has the time back that the play has run since the link was sent (slice 6). Some of that time is from before the upgrade, when nothing was in the link's way. The preview doesn't name these links. |
| One play open on a film, which its holder can still resume | It becomes the film's loan, due at the end of that play's time to come back, or at the link's expiry if sooner. The borrower is the link's member, or the browser holding the play. The position is kept. A start-by date that has passed since the first play is no bar: 1.x stopped reading it then (`server/access.js:118`). |
| That link had plays left, no limit, or days left (question 15) | The same loan, due at the same time, and the link is spent when it ends. 1.x would have let it play again: a link good for 14 days, started yesterday, is due back tomorrow, not in 13 days. The preview lists these links by name, so you can send new ones. |
| Several plays open on one film | One becomes the loan: the one playing now, then the one heard from last, then the earlier play, among those whose holder can still resume. The others get no loan. Their player stops at its next report, their page says "Out on loan", and their link lends once when the tape is back, from the beginning: the place they had reached in 1.x isn't carried over. |
| A play open that its holder can no longer resume: the browser signed out, expired, or signed out of the link ("Sign out browsers"); or the member's card turned off | No loan. 1.x would let another browser with the link take that play over at once (`server/access.js:149-151`, `:204-207`), so the link is not spent: it lends once, from the beginning. |
| A link used up, or past its days after the first play (cancelled ones too) | Spent: an ended loan marked `before-2.0`, which ended at the link's expiry, or when the last play that counts (not one given back) could no longer be resumed, if that was sooner. Restoring one can't make it lend. A play that names no browser, on a link for anyone, leaves a loan with nobody on it: the one kind of loan that may have none. The loan is on the link's last play even if that one was given back, and a play given back is never counted as finished, on the loan or in a film's counts. |
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
isn't available right now" for a tape that is out. (Slice 7 rebuilt the film page and
the player, and the two fields went; the front page and the back office read neither.
Slice 8 rebuilt the front page, the notices and the sign-out questions, and slice 9 the
back office.) 2.0.0 is released once, after slice
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
[Tests](#tests)). (Slice 2: Play still writes a screening for each loan, the journey is
rewritten, and the exception went with it.) It watches every database `startServer` opens, and the three that
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

- [x] `server/access.js`: the live test, `isBorrower`, `closeStale`, `ticketStatus`,
  `filmAccess` and its ranking, `mayStream`, `startScreening`, `heartbeat`, `canKeep`.
- [x] Around it: `loanDays` as a setting, with the retired one, and on
  `POST /api/admin/tickets`, which logs `ticket-sent`; `moveLoans` and `prolong` in
  `server/sessions.js`, with the cookie sent again from the Play route and the film
  page; `endLoansOf` called from `people.disable`; the retention guard; the sweeper;
  the refusal reason; `ticketForViewer` with the two kept fields; Play's answer;
  `/api/me`'s `tickets`.
- [x] The start-by rule in the state table: `waiting`, not `expired`, while the tape is
  out.

**Done when** two links pressed at once give one 200 and one 409 `out`, in one process
and from two; a non-borrower's every answer is the same for both kinds of `out`, also
after a start-by passes and with the film's files broken; a tape past due is taken by
the next link with nothing written in between; a browser whose session was made 89
days ago plays, and two days later still has its cookie and its tape; a card turned
off and on again leaves the loan ended; your preview takes nothing; and 1.1.0's page
still plays and resumes. Questions 2, 5, 9 and 12, which it waited on, were answered on
11 Nov 2026.

Slice 2 is not tried on its own. Until slice 3, 1.1.0's Cancel, Restore, Give, Sign
out browsers and Give back still act on a link that has the tape, with none of the
guards above: a cancel there would leave a tape out that nobody can play. So 2 and 3
merge into `v2` together.

Built on 11 Nov 2026, not yet committed. 852 unit tests became 896, all passing on Node
26 (22 and 24 still wait for the draft pull request). What differs from the lines above,
or was left open by them:

- **The 1.x tests.** About 60 failed under the new rules and were rewritten, each with
  a comment saying what 1.x did and which rule replaced it. Four things have no test
  any more, because nothing does them: a second play on one link once the first could
  no longer be resumed (a link lends once), a second browser taking a link's play over
  (question 12), keeping a link with a play open (question 2), and giving a play back
  (Give back goes). A play given back in 1.x still doesn't count as finished in a
  film's numbers, and that is still tested, on a row marked as 1.x left it. Several
  tests had two friends playing one film inside one test (`test/stall.test.js`, the
  summaries in `test/activity.test.js`, `test/retention.test.js`): they now have a film
  each, or each tape comes due before the next goes out.
- **The guard in `test/helpers.js`** still reads `screenings`: Play writes one for each
  loan, when it takes the tape, and none when it resumes. So its exception for "the
  same link played again" went (no link has two plays now), and it starts watching a
  database after the plays already in it, so a shop upgraded from 1.x can be played in.
- **The upgraded shop over HTTP** is a suite of its own in `test/migration.test.js`
  ("a schema 7 shop, upgraded, over HTTP"), on a second copy of the fixture.
- **From two processes** is two `worker_threads` in `test/loans-race.test.js`, held at a
  gate each round and released in the same instant, 200 rounds. With the transaction
  around Play made not IMMEDIATE, the test fails, as it should.
- **Keys that wait for their slice.** `access.ticket` has every key of the table under
  [The friend's side](#the-friends-side) except `pickNote` and `loan.canRespond`, which
  arrive with slice 4. `access.tape` for your preview, `/api/me` with yours first and
  `browserLoans`, and 410 `ticket-spent` on opening are slices 5 and 3, as the slice
  list says.
- **The Ledger.** `ticket-sent`, `lent` and `returned` are logged. Until slice 3 gives
  loans a kind of their own they are filed with accounts and links, and until slice 9
  the page shows their kind as it is stored ("lent").
- **The back office's 1.x fields**, as the `adminTicket` row above now says. A spent
  link shows as "Used up" until slice 9.
- **Three small changes to 1.1.0's pages**, which the plan had not asked for. Settings'
  "Time to come back (hours)" became "Due back after, for new links (days)", because
  the old field had nothing left to show or save. The film page's line before Play
  counts the loan's days in hours ("…come back to it for 72 hours"), where it would
  have gone on promising 48. And the page and player know three of the new codes: `out`
  and `spent` from Play are explained by the page after it reads itself again, and a
  tape that comes due while it plays says "This tape has gone back to the shop."
- **Cost on every segment** (Risks, below), measured on a throwaway database in memory
  with 300 films and 3,000 links: `mayStream` for the browser that is playing takes
  about 10 microseconds, against 5 in 1.1.0, and a refusal about 7 against 5.
- **In a browser.** `e2e/playback.spec.js` and two journeys of `e2e/shell.spec.js` (a
  reload resumes; a browser signed out while it plays) pass in Chromium, each run alone
  on a fresh shop. Run together the journeys fail, as expected until slice 10: they
  share one film, and its tape is out after the first.

### 3. Coming back

- [x] `returnTape` and `POST /api/films/:slug/return` with its `takenAt`, without
  responses yet.
- [x] Take back by loan, with the member's other links for the film; revoke, restore,
  holder and Sign out browsers as in the rules; the void route refuses a loan's
  screening (it goes in slice 9); moving a due date, through `loanDays` on
  `PATCH /api/admin/tickets/:id`; the new events and the Ledger's three kinds.
- [x] A spent link: `POST /api/tickets/open` answers 410 `ticket-spent` to a browser
  that doesn't hold it, and its preview shows the shop (`server/page.js:54-59`).

**Done when** a return frees the film at once, spends the link and stops the borrower's
other device at its next report; a return from a tab left open on an earlier loan
changes nothing; a take-back stops both kinds of borrower with `taken-back`, cancels
the link, and another link can take the tape, but not the same member's second link;
and a return racing a take-back has one winner. Questions 6, 8 and 14, which it waited
on, were answered on 11 Nov 2026.

Built on 11 Nov 2026, not yet committed, with slice 2. 896 unit tests became 934, all
passing on Node 26 (22 and 24 still wait for the draft pull request). What differs from
the lines above, or was left open by them:

- **Where the rules are.** `returnTape`, `takeBack`, `cancelTicket`, `restoreTicket`,
  `forgetBrowsers` (Sign out browsers), `setLoanDays` and `voidScreening` are in
  `server/access.js`, beside `setTicketPerson`, which gained its guard. The routes in
  `server/routes/admin.js` only call them and turn a refusal into a 409. Each runs
  `closeStale` first, so a tape past due is never taken back, returned or held to its
  link: its end is written as `due`, at its due time.
- **A response before slice 4.** The return route already checks the body as the API
  table says (400 for no `takenAt`, a message with no response, or a response that
  isn't one of the four). A borrower who sends a response is answered 409
  `cannot-respond` and the tape stays out, so nobody's words are dropped before there
  is somewhere to keep them. Anyone else is told `nothing-to-return`, as for every
  other return that isn't theirs.
- **The take-back's answer** is `{ loan: { id, takenAt, dueAt, endedAt, endedHow },
  ticket, alsoCancelled }`: the loan as `/api/admin/loans` will give it comes with
  slice 5. An unknown loan is a 404, a missing `ticketId` a 400; a loan that is over,
  or isn't on that link, is 409 `not-out`. `POST …/revoke` on a link that has the tape
  is the same take-back, and answers the link with `tookBack` and `alsoCancelled`.
- **Question 14, to the letter.** The links cancelled with a member's tape are that
  member's other links for the film that have no loan: waiting ones, and ones past
  their start-by date. Each logs `ticket-cancelled`. The link that had the tape logs
  only `returned` (`taken-back`). A link anyone can use that the member's browser also
  holds is left alone, so that browser's page then shows that link, with the tape in.
- **Moving a due date** is whole days from when the tape was taken (`loanDays`, 1 to
  30, or null for the shop's default as it is at that moment): there is no way to name
  a time of day. A save whose days would make the tape due already is refused whole:
  its label and start-by don't change either. A date moved earlier never shortens a
  browser's session. A save that sends the days the link already has moves nothing
  (from the review, below).
- **Restore** is refused for every link that has a loan, cancelled or not: one that has
  the tape, a spent one, one taken back, and a 1.x link the upgrade marked as lent.
- **The void route** refuses every screening a loan names, also once the loan is over
  (409 `tape-out`, the plan's code). A 1.x play that no loan names can still be given
  back until the button goes.
- **A spent link for one member** opens for that member, signed in, as before; anyone
  else gets what they got before (sign in, or "for someone else"). 410 `ticket-spent`
  is for links anyone can use, in a browser that doesn't hold them. The poster address
  a spent link's preview once gave out is a 404 from then on.
- **A progress report is one step now.** Its check and its write share one IMMEDIATE
  transaction, as Play's do, so a report can't land on a tape returned or taken back
  in between. The plan had not asked for that; the race test needed it to be exact.
- **"Sign out every friend and member"** needed no code: a browser's tape comes back
  by the test for "out", and a member's own tape is theirs again when they sign in.
  Both are tested, as are the two ways a borrower stops being able to play that slice
  2 had left: signing in as someone else, and this one.
- **Races.** `test/loans-race.test.js` has four more pairs of threads, 200 rounds each:
  a return against a take-back (one winner; each wins about half), Play on another
  link against a take-back, a return against the borrower's own report, and Play
  against a return at the millisecond the tape is due. `test/loans.test.js` asks the
  first two over HTTP as well, in both orders.
- **Never who.** `test/never-who.test.js` gained the return (five ways of asking, all
  `nothing-to-return` or the same 400), a due date moved by you (the same new date
  for both), a return (the reason, and when, reach the borrower only) and a take-back
  (the borrower's page and another holder's are the same, byte for byte).
- **Five small changes to 1.1.0's pages**, so the new answers have words until slices 7
  to 9: the player says "{Host} has taken this tape back." for `taken-back` and "This
  tape has been returned." for `returned`; the front page has the mock-up's notice
  for a spent link ("That link has been used."); the link's page in the back office
  puts `tape-out`, `lent-once`, `would-end-loan` and `not-out` in words; and the
  Ledger has a Loans filter between Viewing and "Cards, passkeys and links".
- **In a browser.** The journeys were made to run over the new server, in Chromium:
  what changed in them, and why, is under "Browser journeys" in [Tests](#tests).

Slices 2 and 3 were reviewed together on 11 Nov 2026, from three sides: races, "never
who", and whether the tests fit the plan. Every row of the state table, the viewer
table, "What can happen to a tape" and "Never who has it" was read against the code,
with a random walk of 40 runs of 500 steps over HTTP, about 7,500 answers compared
between shops that differ only in who has the tape, and 73 single-rule changes to the
code, of which the tests caught 71. No leak of who has a tape was found. 934 unit tests
became 943, all passing on Node 26. What changed, each with its test:

- **Signing in with a tape out** made a new session with the shop's plain life and
  moved the browser's loan onto it. Where `VIEWER_SESSION_DAYS` is set shorter than
  the loan has left, the tape came back as `signed-out` days early and the link was
  spent. It can't happen at the default 90 days. Sign-in now makes the new session last
  a day past the due time, and its cookie with it.
- **Saving a link whose days hadn't changed** moved the due date of a tape that was out
  if the shop's default had changed since, or refused the whole save. No page sends
  `loanDays` yet, so nobody could reach it; slice 9's form will. The same would have
  moved the date of a loan the upgrade made, which isn't whole days from when it was
  taken. The link's own value sent again is now no change.
- **A tape's end dated in the future.** With the server's clock behind a session's
  sign-out time, `closeStale` wrote the tape back as `due`, at its due date, days
  ahead, and the Ledger with it. Never later than the moment of writing now.
- **Play reads the browser's session again inside its step.** Unreachable in one
  process; from a second process on the same file a Play that lost to a sign-out took
  the tape for a dead session and spent its link.
- **Tests the review found missing**, with no change to the code: a take-back from a
  member leaves their spent links for the film as they were (one of the two changes the
  tests had missed); a take-back stops the play (the other); in
  `test/never-who.test.js`, a tape out on a member's own link against one out to a
  browser, the borrower's own second device on the link that lent, and a newcomer
  opening the link that lent or one that waits; and in the upgraded shop over HTTP, a
  return and a take-back on loans the upgrade made, and restore refused for a link
  that lent before 2.0.
- **One journey** clicked "Status" wherever it found it. On a computer with a nearly
  full disk the back office shows a second Status link, and the journey failed for
  that alone, with or without version 2. It now clicks the tab
  (`e2e/admin.spec.js:65`).
- **The journeys' tape lock could lock two journeys against each other**, which showed
  once the journey above ran to its end: about one run in two had five journeys time
  out. It is one lock for a project's tapes now, not one for each film ("Browser
  journeys", under [Tests](#tests)). Only the journeys were wrong; the app was not.
- **Left to you:** questions 16 and 17 (both answered on 12 Nov 2026, under
  [Settled](#settled): 16 (b) is built, 17 (a) changes nothing). Not built, and
  offered: a minimum of 31
  for `VIEWER_SESSION_DAYS`, which would rule the first case out a second way but
  changes a 1.x setting.

### 4. Picked for you, and responses (server)

- [x] `pickNote` on send and edit and in `access.ticket`; responses on return; the
  three back office routes.

**Done when** editing a note never changes the staff pick, nor the reverse; neither the
note nor `label` is in a preview or the members' listing; a response is refused from a
browser's loan, from anyone but the borrower, twice, and after the tape came back on
its own; `canRespond` and the route agree in every case; and no event holds its text.
Question 13, which it waited on, was answered on 12 Nov 2026 (b).

Built on 12 Nov 2026, not yet committed. 943 unit tests became 985, all passing on Node
26 (22 and 24 still wait for the draft pull request). What differs from the lines
above, or was left open by them:

- **Where the rules are.** Whether a tape can be handed back with a response is one
  answer, `canRespond`, worked out in `filmAccess` (`server/access.js`): the tape is
  this viewer's, it was taken on a link for one member, and the viewer is that member.
  The film page sends that answer and `returnTape` refuses by it, so the two can't
  disagree. The response's row is written in the return's own step, dated the moment
  the tape came back.
- **Refused, and how.** A borrower who can't respond (a browser's loan, signed in or
  not) is told `cannot-respond` and the tape stays out; they can still return it
  saying nothing. Everyone else gets `nothing-to-return`, with a response as without.
  "Twice" and "after it came back on its own" need no rule of their own: once a tape is
  back there is nothing to return, so nothing to respond to. `responses_once` and the
  trigger are the backstop, and both are tested by a plain insert.
- **Your own browser has nothing to return.** The page and the route did not agree in
  one case: a browser signed in to the back office and, as a member, to the shop. Its
  film page is your preview, with no loan on it, but the return route went by the
  member's session alone, so a request written by hand could return that member's
  tape, with a response. The route now answers `nothing-to-return` to a back office
  browser, as Play there takes nothing. That goes for Return it now as well, which
  slice 3 had left open. The member returns it on a device that shows their own page.
- **A message** is kept without the spaces around it; one of nothing but spaces is no
  message. A NUL character is dropped: SQLite counts a text that begins with one as
  empty, and the table's `CHECK` would have turned such a message into a server error.
- **A note too long is refused, not cut.** `label` is cut to its 200 characters
  without a word (`optText`). A note is what a friend reads, so 2,001 characters is a
  400 and nothing is saved, on send and on edit. Spaces around a note go; one of
  nothing but spaces is no note. Several links sent together each carry the note.
- **Editing a note logs nothing.** The plan lists no event for it. `ticket-sent` says
  `note: true` or `false`, and no event holds a note's words either.
- **A preview and the members' listing** needed no code: neither ever read a link's
  note or label. They are pinned by tests that look through everything a browser is
  sent (the page of a link's address included) for the words.
- **The back office's routes**, as the API table now has them: the list is newest
  first; mark as read answers `{ response, unread }` and the first time stands; delete
  answers `{ deleted, unread }`, and leaves the loan and its `returned` event as they
  were. The `DELETE` is the API's first. Every call that changes something must be
  sent as JSON, so it carries an empty body, and slice 9's page needs a `delete` in
  `web/src/api.js` that sends one. `adminTicket` has `pickNote`; its `loan`,
  `loanDays` and `linkState` are slice 5's.
- **Never who.** `test/never-who.test.js` gained: a note of its own on every link (each
  browser reads its own and no other, and the answers are the same once that note is
  set aside); a browser with two links for a film reads the same note whichever of
  them lent; no note or label in a link's preview; a return with a response is
  `nothing-to-return` for everyone but the borrower, whether the tape is out to a
  member or to a browser; and a tape handed back with a response looks to everyone
  else like one returned without, with what was said in no answer to any viewer.
- **Breaking the rules.** 47 single changes to the code, each run against the whole
  suite: the response taken from a browser's loan, `cannot-respond` told to a
  non-borrower, the words or the kind in an event, the note sent only in some states
  or from the link that lent, the label sent as the note, a note in a preview, in the
  members' listing or in the answer to opening a link, each direction of note, label
  and staff pick changing one another, and each of the three routes doing the wrong
  thing. The tests caught all 47.
- **No change to 1.1.0's pages.** They read neither `pickNote` nor `canRespond`, send
  no response, and the link page's save doesn't name `pickNote`, so it leaves a note
  alone. The note, the hand-back and the Responses tab are slices 7 to 9.
- **Noticed, not changed.** A note stays on its link when you give the link to someone
  else, or let anyone use it: the new holder reads what you wrote for the first.
  Slice 9's forms could show the note beside those buttons. The review made this
  question 18, under [To decide](#to-decide).

### 5. What the back office and the front page need to know

- [x] Films `tape`, `links` and `lending`; `/api/admin/loans`; `adminTicket`'s `loan`,
  `loanDays` and `linkState`; Members'
  `tapesOut`; Status `attention.tapes`; `/api/me` with yours first, `browserLoans`, and
  in or out on the members' shelf.

**Done when** the API tests pass, and a test finds no borrower's name, device, label or
`takenAt` in any viewer route's answer. Question 7, which it waited on, was answered on
12 Nov 2026 (yes).

Built on 12 Nov 2026, not yet committed. 985 unit tests became 1,004, all passing on
Node 26 (22 and 24 still wait for the draft pull request). What differs from the lines
above, or was left open by them:

- **Where the rules are.** Who is told what about a loan is in `server/access.js`, in
  two marked parts. For you alone: `adminLoans`, `filmTape`, `linkCounts`,
  `filmLending`, `tapesOut`, `linkState` and `tapeForPreview`. For a viewer:
  `shelfTape` and `browserLoans`. The routes only call them. Every route that says who
  sits under `/api/admin`, behind your session, and the film page gets
  `tapeForPreview`'s answer only when its browser is yours; for any other browser the
  function returns nothing and the page has no `tape` key.
- **One loan, one shape.** `/api/admin/loans`, a film's `tape.loan`, a link's `loan`,
  a member's `loans` and the take-back's answer all give the same object, from one
  query. The list answers `{ loans }`, newest first.
- **A tape past due, not yet written down.** Reading still writes nothing. So for the
  minute before the sweeper runs, you are told the loan is no longer live, with the
  `endedAt` and `endedHow` that `closeStale` will write (one function works out both).
  The film is `in`, its link `done`, Status doesn't count it, and the members' shelf
  says in.
- **`otherLinks`** is not quite "links that could still lend". The ones marked
  `cancelledToo` are the member's other links for the film that never lent, which is
  what a take-back cancels (question 14, to the letter: waiting ones, and ones past
  their start-by date). The take-back and this list ask one function, and a test takes
  the tape back and compares. The rest are links anyone can use that the borrower's
  browsers also hold and that could still lend; they stay, and each has an id for the
  confirmation's "cancel this one too". For a member, "their browsers" are every
  browser signed in as them, not only the one that pressed Play.
- **A film's `tape.state`** is `off` whenever the film is off the shelf, and `loan` is
  filled in whatever the state: the clock runs on, and you can still take the tape
  back. Broken files don't change it (`mediaStatus` says so).
- **`links.waiting`** counts the live links that haven't lent, with the tape in or
  out: what the send form's warning asks ("already has a link waiting"). The state
  called `waiting` in the state table is narrower (the tape is out on another link).
- **`lending`** is `{ sent, cancelled, opened, lent, finished, responses }`, the
  mock-up's "How it's been lent". `lent` counts loans, the upgrade's among them.
- **A link's `loanDays`** is the link's own value, null for the shop's default, not
  the number Play would lend: a form that sends back what it was given then changes
  nothing, as slice 3's review asked. Settings has the default.
- **`browserLoans`** leaves out a film off the shelf, as `linkTickets` does: off the
  shelf is no such film. Signing out still sends that tape back.
- **The members' shelf** is `/api/me` only. The page of a film that is only listed
  stays as it was, with no key about the tape; slice 8 draws the shelf from the list.
- **Status.** The sweeper's last run is `server.sweeper`, beside the clean-up's. The
  start-by list is unchanged until slice 6.
- **Never who.** `test/never-who.test.js` gained: the main film on the members' shelf,
  read by two members with no link in each of its comparisons (in or out and the date,
  the same for both, and in again after a return with nothing of how); your own
  answers saying who (the loans list, the film, the link, Status, your preview), with
  every one of those routes refused to everyone else; and a last suite on one film
  whose tape goes out three times, to a member on their own link, to a browser, and to
  a browser a member is signed in on, playing, paused and watched to the end, and
  comes back handed back with a response, taken back, and due. Four viewers who never
  have it (no session, a link that waits, a member's own link, a member with no link)
  ask every route a viewer can reach, about 40 each time. Their answers are the same
  whoever has the tape, apart from the date, and once it is back the same as before
  anyone had it. None holds the borrower's name, device, link (label, note, id or
  code), loan id, own id, session or `takenAt`; the ids are made seven digits long so a
  plain search can't miss or mistake them. The borrower's own answers are searched for
  the label, the ids and the session too.
- **Breaking the rules.** 97 single changes to the code, each run against the whole
  suite: each filter of the loans list ignored, a loan called live until its end is
  written, each part of a borrower left out or told wrongly, each kind of link added
  to or dropped from `otherLinks`, each count off by one kind of link, `tape` wrong for
  a film off the shelf or past due, the shelf saying since when or whether a member has
  it, `browserLoans` naming somebody else's tape, `access.tape` sent to a borrower, a
  member or everyone, and the back office answering a viewer's session. The first pass
  caught all but one: a link anyone can use that had already lent was not tested as
  missing from `otherLinks`, and now is. Six of the first pass stopped the server
  outright where they should have broken one rule; they were written again, and
  caught by the tests for their rules.
- **No change to 1.1.0's pages.** They ignore the new keys. The front page already
  put a tape that is playing first, which is the same order.
- **In a browser.** All 64 journeys in the chromium project passed (one more is
  WebKit's own and skips), with none changed. Firefox, WebKit and Chrome were not run.
- **Noticed, not changed.** A viewer's return or keep that finds nothing still writes
  down a tape that had come due on that film, as every step that could take a tape
  does. It tells the viewer nothing, and the sweeper would have written the same.

### 6. Start-by while the tape is out

- [x] `effectiveStartBy`, in `ticketStatus`, the Status list and the back office.

**Done when** a table of loans and deadlines gives the dates the function above gives.
Leaving this slice out changes one thing: a link whose start-by passed while the tape
was out shows "start-by missed" as soon as the tape is back, and you send a new one.
"Never who" doesn't depend on it, because slice 2 holds that part.

Built on 12 Nov 2026, not yet committed. 1,004 unit tests became 1,049, all passing on
Node 26 (22 and 24 still wait for the draft pull request). It waited on no question.
What differs from the lines above, or was left open by them:

- **Where the rule is.** `effectiveStartBy(ticket, now)` in `server/access.js`, beside
  `lending`, which calls a link `expired` by that date and no other. `ticketStatus`
  gives it as `startBy`; the film page, `/api/me`, the Status list and the back
  office's link all read it there. What the rule's lines had left open (when a wait
  begins, which loans are read, a loan over with no end written) is under
  [Start-by while the tape is out](#start-by-while-the-tape-is-out-slice-6).
- **One thing differs from slice 2.** A link sent with its date already past, while
  the tape is out, is missed from the start. Slice 2 had it wait until the tape was
  back and called it missed then. It could never have lent either way, so it tells
  its holder nothing about the tape; and its date no longer creeps forward while the
  tape is out, which would have told them the tape was out.
- **"Never who" now does depend on this function**, in one property: a link that
  could have lent when the tape went out is never `expired` while that tape is out,
  because the date it goes by then moves with the clock. Slice 2's own test (a live
  loan the link began to wait for before its date as set) is kept as the quick way
  to that answer. Tested three ways: a test that asks every seven hours of a
  thirty-day loan, the 400 shops made at random, and `test/never-who.test.js`.
- **"Done when".** `test/start-by.test.js`: 35 rows of loans and deadlines, asked at
  82 moments, each for the date, for `ticketStatus`'s date and state, and for
  `startByPaused`. The rule told a second way, hour by hour, agrees on 400 shops made
  at random. Reading the date writes nothing, and the sweeper writing a due loan's
  end doesn't change it. Then over HTTP: four tests there, one of the Status list in
  `test/booth.test.js` and two in `test/never-who.test.js` (under [Tests](#tests)).
- **Slice 2's test of its rule** (`test/loans.test.js`, "a start-by date that passes
  while the tape is out…") ended "start-by missed. (Slice 6 would give it the time
  back.)" It now ends with the link `in`, a day left as when the tape went out,
  missed a day later, and Play taking the tape in the time given back.
- **What you are told.** A link has `startBy` (the date as you set it),
  `effectiveStartBy` and `startByPaused`. The Status list's entries have `startBy`
  (the date the link goes by: the plan's line, and what 1.1.0's page shows),
  `startByAsSet` and `startByPaused`. A film's and a member's counts of live links
  go by the date the link goes by, as does the take-back's `otherLinks`. A form that
  sends `startBy` back as it came changes nothing.
- **Never who.** `test/never-who.test.js` gained a suite of four films, alike but for
  who has the tape (a member on their own link, a browser, a browser a member is
  signed in on, a browser) and how it comes back (handed back with a response, taken
  back, returned, due with nothing written down), each with a link that waits whose
  date passes while the tape is out. Their links were made, their tapes taken and
  their tapes back at the same moments. While out: every answer the same for all
  four, "out" and the due date, and no start-by date in any answer. Once back: every
  answer the same for all four, the tape in and the date an hour and a half later,
  which is how long the tape was out; none holds when it was taken, when it came
  back, how, or the date as it was set. `effectiveStartBy`, `startByPaused` and
  `startByAsSet` joined the words no viewer's answer may hold. The main suite's
  "after their links' start-by date has passed" now moves the links' making back two
  hours with the loan (it had left the links made after the date it gave them), and
  after the return its other links are `in`, with the same later date for both,
  where they were `expired`; and since either could now take the tape, the two are
  asked everything but Play, which would take it for the first. Two rows were added to "Never who has it", and one to
  what can still be worked out: how long, which is "when".
- **Cost on every segment**, measured as slice 2 did (300 films, 3,000 links, a third
  of the tapes out, in memory), before this slice and after. Links with no start-by
  date: no change (a segment for the browser playing 10.2 and 10.3 microseconds; a
  refusal 5.5 and 5.6, or 7.2 and 7.2). The browser playing also holds a second link
  with a date still ahead: 10.3 became 10.9, with no loan read. The worst a segment
  can cost: that second link's date as set had passed before the tape went out, so
  the date is worked out on each request: 18.4 became 22.3 with two loans since the
  link was made (and 200 before it, which are not read), and 11.4 became 20.4 with
  25 since, about a third of a microsecond a loan. The film page reads the date once:
  7.2 became 9.5 with no loans, 8.3 became 17.1 with 25 since the link was made. The
  first draft read every loan the film ever had and worked the date out on every
  request, 61 microseconds a segment against 18 for a film lent 200 times; that is why the
  loans are bounded by when the link was made, and why the date is worked out only
  when it is read or could decide the state.
- **Breaking the rules.** 45 single changes to the code, each run against the whole
  suite: nothing given back, each kind of loan wrongly counted or left out (after
  the date, at its very moment, before the link was made, the link's own, another
  film's, the upgrade's ended ones, one still out, one over with no end written),
  time counted twice or past the clock, the wrong order, slice 2's rule alone, a
  link sent already missed left waiting, each of the back office's and the Status
  list's keys saying the wrong date, a friend told a date while the tape is out,
  the date as set, or either of your keys. The first pass caught 43. The two it
  missed are now tested and caught: a missed link of a film with broken files (no
  tape for it, in or out; a link with its time back has the tape in), and a link the
  borrower's browser also holds that has its time back, which the take-back's
  confirmation must name. None stopped the server.
- **One line of 1.1.0's pages.** The link's page in the back office says "If not
  started by" with the date the link goes by, where it would have shown a date
  already past on a link that can still lend (`web/src/admin/TicketDetail.jsx`). Its
  form still edits the date as you set it. The friend's page needed nothing: it
  shows the date it is given, with its time when that isn't the end of a day.
- **In a browser.** All 64 journeys in the chromium project passed (one more is
  WebKit's own and skips), with none changed. Firefox, WebKit and Chrome were not run.
- **Noticed, not changed. Yours to say:**
  - *The date given back is to the minute.* A link sent with "Start by Fri 13 Nov"
    reads "Start by Sun 15 Nov 14:30" after a tape out for a day and fourteen and a
    half hours. Rounding what is given back up to whole days would keep it at the end
    of a day, give a little more and never less, and tell its holder less about how
    long the tape was out. It would be a change to the rule above.
  - *A date you set later gets the earlier time too.* The time given back is counted
    from when the link was made, as the rule says. Change a link's start-by after the
    tape has been out, and the new date is later by that earlier time as well: set
    Friday, and it may read Sunday. Nothing records when a date was set. A column
    for it would make this exact, and migration 8 isn't frozen.
  - *At the upgrade*, the row for a link never played whose start-by passed now names
    its one exception ([Upgrading](#upgrading-an-existing-shop)). The preview doesn't
    list those links.
  - *The Status list* keeps a link that waits with three days or less left for as
    long as the tape is out, its date moving with the clock. Slice 9's page can say
    "paused" from `startByPaused`; 1.1.0's shows the date and "in 2 days".
  - *Not this slice's:* every media request reads all of its film's links to find the
    browser's own (1.x's query). A film with 200 links costs 18 microseconds a
    segment where one with ten costs 10, before this slice and after.

Slices 4, 5 and 6 were reviewed together on 12 Nov 2026, from three sides: whether
the rules hold, "never who has it", and whether the tests would catch a rule broken.
Twelve worlds, the tape going out five ways and coming back five ways, with five
viewers and a newcomer asking about 20 routes each, found no answer that said who had
the tape (one difference is how it came back, below). About 70 rules broken one at a
time were caught, but for the three below. 1,049 unit tests became 1,052, all passing
on Node 26, and the 64 journeys in the chromium project passed three runs in a row
(one more is WebKit's own and skips). What changed:

- **Status, Films and Members read every missed link's loans, each time.** Slice 6
  had them work out the date of every never-lent link whose date as set had passed:
  two statements a link for the counts of links, more for Status, whose query had
  lost its lower bound. A missed link stays missed, so that only grew: with 800 of
  them, Status ran 4,809 statements where it had run 8, and the Films list 1,806
  where it had run 3. Now a link no loan can have moved needs no loans read: its date
  is the date as set (`startByMayMove`: no loan on another link was taken before
  that date and still out once the link was made). Status's query has its old lower
  bound back for those. For the rest, each film's loans are read once for all its
  links (`startByReader`), and the same function works the dates out. The SQL test
  alone would still have read every moved link of a busy film each time. And the
  loans since a link was made are read one at a time, so the reading stops where the
  rule does. The 400 shops made at random now also check that `startByMayMove` is
  never false for a link whose date moved, and that reading a film's loans once gives
  every link the same date; and a shop with 20, then 60, links missed months ago
  (half of them with dates moved a day) runs as many statements for 60 as for 20.
  The Tickets list works out each link's state as it did in 1.x, a few statements a
  link before this slice and after; slice 9 can look at it.
- **Hand it back read the session once, before its step.** Play reads the browser's
  session again inside the step, so a browser signed out meanwhile by a second
  process on the same file takes nothing. Return it now and Hand it back did not, and
  such a browser could still hand a member's tape back with a response. Both now
  answer `nothing-to-return` there, tested with a session signed out between the
  two reads. In one process the route reads the session and runs the step in one go,
  so nothing changed for a friend.
- **The loans list ignored a filter by another name** (`film[]=1`, `films=1`) and
  listed every loan. A filter it doesn't know is refused now, as one that isn't an id was.
- **Tests the review found missing**, with no change to the code: Members' tapes out,
  the soonest due first, now has the newer loan due later, so the order can't come
  from the loans list's by chance; and the upgraded shop gained two rows in
  `test/schema7.js`: a link past its days whose only play was watched to the end and
  given back (not finished, on the loan or in its film's count, which no test had
  held), and a link nobody played whose start-by passed while Solo's play was open
  (it waits, its time stands still, and the three hours count; the preview names it
  nowhere). Over HTTP, that shop is now also asked for the loans list on the
  upgrade's loans (one with nobody on it), a response handed back on one and read,
  that link in the Status list and the film's counts, and the members' shelf.
- **The take-back can be told from a return**, by browsers holding the link that lent:
  "What can still be worked out" said only that they see that link spent. It is how
  the tape came back, not who had it; written down there, and not changed.
- **Left to you:** question 18, a "Picked for you" note on a link that changes hands.

### 7. The friend's film page and player

Reuses, from 1.1.0: `Counter` (`web/src/pages/Film.jsx:271-336`), `TitleTape` and
`NarrowPage` (`web/src/pages/tape.jsx:51-73`), `Sticker` (`web/src/look/objects.jsx:297-306`),
`PlayTile`, `PlayScreen`, `OsdStrip` and `ComingBack` (`web/src/look/crt.jsx`), `Line`
(`web/src/look/ui.jsx:22`), and the words in `web/src/pages/tapeWords.js` and
`web/src/look/words.js`.

- [x] The counter's states. In: "Play takes it out" on a two-line sticker (`Sticker`
  gains a line). Out: "Out on loan", "Back Fri 6 Nov" (a new key beside `DEADLINE_KEYS`,
  `web/src/look/words.js:43`), and the one sentence from "What a viewer sees", with no
  "your link still works", no start-by line and no keep offer. Yours: the `ComingBack`
  telly, "It's yours until…", Return it now confirmed on the page, the receipt as
  plain lines; paused, "Hand it back" as well (question 13, answer b). Then finished,
  spent, start-by missed, and unavailable in its three forms: yours (the due date and
  Return it now stay), out (the due date stays), in ("nothing has been taken out").
- [x] `clockLines`, `goneLine` and `nextDeadline` rewritten for one clock. `PLAY_ERRORS`
  (`Film.jsx:23-33`) and `haltMessages` (`tapeWords.js:99`) learn the new codes.
- [x] The player: `aside="Due back Sun 8 Nov"` on the paused strip (the prop exists,
  `crt.jsx:85`), an `onEnded` up to the page (`web/src/Player.jsx:463` only clears the
  strip today), and the end's three choices.
- [x] Your preview says who has the tape. The line telling you to try a link in a
  private window (`Film.jsx:286`) says that doing so takes the tape. The two kept API
  fields go.

**Done when** every state in the mock-up's friend table that isn't a "today" state is
on the page at 1440, 390 and 320 pixels, with the out pages' words as this plan has
them where the two differ, and `test/friend-words.test.js` and `test/look.test.js` are
rewritten and pass. Questions 10 and 11, which it waited on, were answered on 12 Nov
2026.

Built on 12 Nov 2026, not yet committed. 1,052 unit tests became 1,061, all passing on
Node 26 (22 and 24 still wait for the draft pull request). What differs from the lines
above, from the mock-up, or was left open by them:

- **Where the words are.** `web/src/pages/tapeWords.js` has every sentence the counter,
  the receipt, the end of the film and the owner's preview say (`clockLines`,
  `goneLine`, `receiptLines`, `returnQuestion`, `RETURN_ERRORS`, `endWords`,
  `previewLine`, `previewClock`), and `web/src/look/words.js` the sticker
  (`nextDeadline`, `stickerText`, with `DEADLINE_KEYS` gaining `back` and a new
  `STICKER_TOPS`). `test/friend-words.test.js` and `test/look.test.js` pin them. The
  page, `web/src/pages/Film.jsx`, only lays them out.
- **The sticker before Play.** "Play takes it out." over "Due back" and the date Play
  would give now (now plus the link's days, read again each minute while the page is
  open). A link with a start-by date to come shows that date on a one-line "Start by"
  sticker instead, as the mock-up's Hedwig does, and the line says "for 3 days from
  then": the due date isn't known until Play.
- **The out page** says "**Out on loan.** Due back by Fri 6 Nov 21:02.": the plan's
  sentence with the time, because the sticker gives only the day and the look's rule
  is that the page then says the time in words. Nothing else, as "What a viewer sees"
  has it. (Slice 7 added "This link is on your card, so it's on every device you sign in
  on." for a member's own waiting link, and "This tape is on your card…" with the tape
  in. Both went in the review of slices 7 to 9: question 11's table makes "On your card"
  the front page's section for what you have out, and the "For Sam only" strip already
  says the rest.)
- **Yours.** The telly, "It's yours until … Pick up where you left off, on this device
  or another." (a browser's tape: "Pick up where you left off."), then Hand it back
  (for a member on their own link, `loan.canRespond`) and Return it now. Return it now
  asks on the page ("**Return Test Pattern now?** It's back in the shop straight away,
  and this link won't take it out again.", Return it / Keep it), with the focus on the
  question and back on the button. Once returned the counter shows the spent state,
  "**Returned on …** Thank you. It's back in the shop." and "This link has done its
  job…", which takes the focus: the mock-up's narrow "Returned" page wasn't built,
  since the page already says it. Right after Play takes the tape, "**Taken out.**"
  stands where the clock line would (the mock-up's PLAY moment), until the first pause
  or the end of the film (the player's `onPaused`); then the counter is the ordinary
  one, "It's yours until …" with the receipt folded, as the mock-up's paused screen.
- **The receipt** is plain lines folded under "Your receipt" (a `<details>`): taken out
  when, out to the member's name or "this browser", due back when, and "Watch it as
  often as you like until then." The till slip is 8b. (Slice 8 built it: the receipt is
  now the slip, folded under the same line.)
- **Watched to the end** (the server's 92%): "Play from the start", which starts at
  0:00 whatever the position, "**You've watched it to the end.** It's still yours
  until …, so you can watch it again, or hand it back now" (or "return it now" for a
  browser), and Hand it back lit.
- **Handing it back is built**, not a placeholder: `web/src/pages/HandBack.jsx`, a view
  of the film page in the mock-up's words (one of four responses required, the
  optional message, "Only Arthur sees this…", "Return it without a note", Not now),
  its error, and "Handed back" with what was said. Slice 8 keeps it and adds the
  "Picked for you" sheet; its journey (3) is slice 10's. "Handed back" says "{Host}
  will see what you said in the back office", where the mock-up said "your note",
  because the note is optional. "Return it without a note" lands on the film page's
  spent state.
- **Spent, for someone else holding the link** (question 12's second browser): "This
  link has been used. The tape it lent is back in the shop." The mock-up had no such
  page; these are the words of the notice for a spent link.
- **Taken back** is "Nothing on the shelf here", as question 6 says. When the player on
  that page was stopped by it, the page also says "{Host} has taken this tape back.",
  which the player had just said to the same borrower.
- **Signed out while it played.** A member's own tape keeps 1.1.0's page ("Sign in to
  carry on watching…", with Sign in). A tape out to this browser from a link anyone can
  use went back when it was signed out, and its link is spent (question 5), so the page
  says "The tape went back to the shop when this browser was signed out, and the link
  that took it out won't take it out again. If you'd like to watch it again, ask
  Arthur.", with no Sign in (from the review of slices 7 to 9).
- **Unavailable**, in its three forms: the warning, then "It's still yours until …,
  and you can return it now." with Return it now (and Hand it back) for the borrower;
  "It's out on loan, due back by …" for anyone else while it's out; "Nothing has been
  taken out: the tape is still in, and your link still works." with it in. The sticker
  keeps the tape's date when it is out or yours.
- **The player.** The paused strip's right-hand line is "Due back Sun 8 Nov" (the
  countdown to come back went, and `timeLeft` with it). At the video's end the bar
  under the picture becomes STOP on a blue strip (`StopStrip`, new in `crt.jsx`;
  square, as the paused strip is, where the mock-up drew it rounded) and the three
  choices; `onEnded` tells the page, and playing or winding back brings the bar back.
  Keep it until … closes the player; Return it now closes it and asks on the counter;
  Hand it back closes it and opens the view. The owner's preview has no end panel:
  there is no loan.
- **The owner's preview** says "**Out to Sam Okafor** since …, due back …. Only you see
  who has it: friends see “Out on loan”." (a browser: "Out to a browser (Safari on
  iPhone, signed in as Jo)"), or "**In the shop.** Nobody has the tape out.", then
  "Your own previews never take the tape, so Sam Okafor keeps it. To try a link as a
  friend would, open it in a private window or another browser: pressing Play there
  takes the tape out, as it would for a friend."
- **Codes.** `PLAY_ERRORS` needed no new message: `out`, `spent`, `expired` and
  `unavailable` are explained by the counter once the page reads itself again, as
  slice 2 set up. `haltMessages` already had `returned`, `due` and `taken-back` from
  slices 2 and 3, which are every code a progress report can add. New for the page:
  `RETURN_ERRORS` (`nothing-to-return`, `cannot-respond`).
- **The two kept fields went.** `expiresAt` and `openScreening` left `access.ticket`
  (`server/films.js`) and `/api/me`, and `resumableUntil` left Play's answer
  (`server/routes/viewer.js`). Nothing else read them: the front page now goes by
  `tape` (below). The back office's link keeps its own 1.x fields until slice 9. Tests
  that held them, rewritten to say they are gone: `test/journey.test.js`,
  `test/film-page.test.js`, `test/never-who.test.js`, `test/loans.test.js`,
  `test/migration.test.js`, `test/identity.test.js`, `test/people.test.js`,
  `test/screenings.test.js`.
- **Gone from the words**, with their tests, each with a comment saying why: `playsLeft`
  (no play limits), the "Come back by" sticker and `timeLeft` (no window to come back),
  `goneLine`'s "used all its plays", and `clockLines`' window in hours.
- **The front page (slice 8's, built since)** was only kept working on the new shape: its lines say
  "Out with you" and the due date (question 11's table), "Out on loan, back …" (one
  line) or "In the shop", as the shelf for members does since the review of slices 7 to
  9 (slice 7 said "Out on loan" over "Back …", and 1.1.0's "Ready to play"),
  "Returned", "Gone back to the shop" or "Link used", and a sleeve's sticker never
  shows the date Play would give. Its sections are slice 8.
- **Journeys changed, because the plan intends it** (`e2e/shell.spec.js`): the counter
  before and after Play says "Pressing Play takes the tape out. It's yours for 2 days,
  until …" and "Taken out.", where it said "come back to it for 48 hours"; the
  one-day link's words; and the spent link's journey presses Return it now and Return
  it, where it asked the server itself. `e2e/fixtures.js`'s `playButton` also knows
  "Play from the start": the test films are eight seconds long. With those, the chromium and webkit projects
  ran twice: 107 journeys passed each time and 23 skipped, each for its own stated
  reason (14 of them WebKit's, which has no virtual passkeys), and none failed.
  Firefox and Chrome were not run as projects.
- **Seen** at 1440, 390 and 320 pixels in Chrome, on a throwaway shop: in (with and
  without a start-by, and for one member), taken out, out (and a member's waiting
  link), yours (a browser's and a member's), the question, the paused strip, the end,
  watched to the end, hand it back (and its error, and handed back), returned (a
  browser's and a member's), spent for another browser, due, start-by missed,
  unavailable in its three forms, taken back, and the owner's preview with the tape
  out and in. No page error, and nothing past either side at any width.

### 8. The friend's front page, handing it back, and notices

Reuses `Facing` and the notices (`web/src/pages/Home.jsx:86-107`, `:10-16`), `PickCard`
and `Hand` (`web/src/look/objects.jsx:275-292`), `confirmSignOut`
(`web/src/site.jsx:146-158`), and the kit's fieldset, choice and textarea pieces.

- [x] The front page in sections: On your card (or "Out to this browser", without the
  mock-up's "Sign in to keep them on your membership card": question 2, answer a),
  Picked for you, your other links, On the shelf for members.
- [x] Hand it back, as a view inside the film page and not a new route: one response
  required, "Only {host} sees this", "Return it without a note". The "Picked for you"
  sheet in the counter, apart from the staff pick card.
- [x] Notices: a spent link (a new key), "Opening a link never takes the tape"
  (`web/src/pages/TicketOpen.jsx:149`), the sign-out confirmation naming the tapes that
  go back.
- [x] 8b, separable: the till slip as a printed thing (a paper kind, the Doto face, its
  licence entry in `test/third-party-licenses.test.js`).

**Done when** a member sees what they have out and when it's due on every device, a
response handed back reaches the back office, and a spent link in a fresh browser shows
only the notice.

Built on 12 Nov 2026, not yet committed. 1,061 unit tests became 1,073, all passing on
Node 26 (22 and 24 still wait for the draft pull request). No server code changed. What
differs from the lines above, from the mock-up, or was left open by them:

- **Where the words are.** `web/src/pages/tapeWords.js` has the sections and what each
  holds (`shelfSections`, `sectionWords`), the lines under a sleeve on the members'
  shelf (`memberShelfLines`), the notices a link brings back (`noticeFor`, moved out of
  `Home.jsx`), the sign-out questions (`signOutWords`), "Opening a link never takes the
  tape" (`UNREACHABLE`) and the till slip's lines (`slipLines`, in place of slice 7's
  `receiptLines`). `test/friend-words.test.js` pins them.
- **The sections.** Signed in, under "Your tapes": **On your card** (out with you on
  your own links), **Out to this browser** (out to this browser on a link anyone can
  use, signed in or not, question 2), **Picked for you** (the other tapes on your card,
  "Tapes Arthur has sent you.", as the mock-up has it), **On this device** (the other
  tapes this browser opened from links: "your other links"; the mock-up had no such
  section) and **On the shelf for members**. Signed out: the shop's name, Out to this
  browser, then its other tapes under "Your tapes", as 1.1.0 had them, or the welcome.
  On this device's line is "Tapes you opened from a link in this browser." (its second
  sentence, "They aren't on your card.", went in the review: question 11). An empty
  section isn't shown. The page reads `/api/me` again each time it is arrived at. "On this device only", under a sleeve in 1.1.0 and slice
  7, went: the section says it.
- **A tape out with you** is a row, as the mock-up's: the sleeve, the film, its label
  tape with the "Due back" sticker, the telly (Resume, or Play from the start once
  watched to the end), "It's yours until …", Hand it back (a member on their own link)
  and Return it now, and the till slip. The mock-up's buttons led straight to the
  player and the question; here each opens the film's page and does it there (Resume
  plays, Return it now asks on the counter, Hand it back opens the view), because the
  player and the question are that page's. The address keeps no trace of it, so Back
  doesn't do it again.
- **Picked for you on the shelf** says "A note from Arthur is with it" under a tape
  whose link has a note; the note itself is on the film's page. A tape in says "In the
  shop" and one out with someone else "Out on loan, back Sun 15 Nov", as on the shelf
  for members and in the mock-up (slice 8 said "Ready to play", and "Out on loan" over
  "Back …"; the review made them one). Not the mock-up's "You can play it once it's
  back", which "What a viewer sees" took off the out page (it is false for a second
  browser on the link that lent).
- **On the shelf for members** (question 7): "In the shop", or "Out on loan, back Sun 15
  Nov" with a "Back" sticker, never who; then "No tape yet: ask Arthur". The line under
  the heading says "…but you need a tape to play one", where the mock-up said "playing
  one takes a tape": in version 2 "takes" means Play taking a tape out.
- **"Picked for you" on the film page** is a sheet off the shop's notepad (a new paper
  kind, `note`): "Picked for you" printed at its head, the note and the owner's name in
  the hand, on ruled lines, under the label tape, in every state the page shows (the
  link's own note, as `pickNote` is). The staff pick card stays on the wall. A long
  note is written smaller, as a long staff pick is.
- **Hand it back** is slice 7's view, unchanged, now also opened from the front page.
  Its response reaches the back office: the slice's run sent one from the front page
  and `/api/admin/responses` listed it, unread; `test/responses.test.js` holds the rules.
  The Responses tab is slice 9's.
- **A cancelled link's notice is not split.** Question 11's table wants "{Host} has
  taken that tape back." only after a take-back and "{Host} has cancelled that link."
  otherwise. Opening a cancelled link answers 410 `ticket-revoked` either way (the
  revoke check comes first, `server/routes/viewer.js:50`), and a browser whose tape was
  taken back no longer holds the link, so the API doesn't let the page tell them apart.
  The notice now says "{Host} has cancelled that link. If that's a surprise, ask {host}."
  in both cases, which is true of both, where 1.1.0's "has taken that tape back" claimed
  a tape had been out. The borrower is still told by the player, and by the film page
  when the player was stopped by it. To split it, the open route could answer a new
  `ticket-taken-back` for a link anyone can use (it says that link lent, which a spent
  link's `ticket-spent` already says to anyone) and for a member opening their own link,
  but not for anyone else holding a copy of a member's link: to them it would say that
  member had the tape. Not built; yours to say.
- **Signing out** asks first when it does more than sign out, from `/api/me` read
  again as you press it (`confirmSignOut`; slice 8 read the page's copy, which Play
  didn't refresh, so straight after Play it said the link "still works": the review
  found it) (`signOutWords`): "Sign out of this browser? Nosferatu is out to this browser, so it
  goes back to the shop, and the link that took it out won't take it out again.", then,
  for the other tapes it opened from links, "Signing out also forgets …; the links still
  work". Sign out everywhere adds the same sentence for this browser, and "A tape taken
  out from a link on another of them goes back to the shop too." The two lists are of
  titles, as `/api/me` gives them: two films of one title would be counted as one.
- **The spent link's notice** ("That link has been used. The tape it lent is back in
  the shop…") was built with slices 2 and 3; its journey (6) passes.
- **8b, the till slip, is built.** A Doto file was already on this computer, with its
  OFL, in the design folder (`.claude/design/fonts/doto/`): it is served as
  `web/public/fonts/Doto-Variable.ttf` (457 KB, as it came: no tool here could cut it
  down without fetching one), declared in `tokens.css` (`--till`, Courier Prime next for
  what Doto lacks), listed in `vite.config.js FONTS` and the licences file, and pinned
  by `test/third-party-licenses.test.js`. A browser fetches it only when a receipt is on
  the page. The slip (`TillSlip`, paper kind `till`, torn by `wear.js tillTeeth`) prints
  the shop, when the tape was taken out, a dotted rule, the film and its E-number, to
  whom, when it's due back, "Watch it as often as you like until then.", "Done early?
  Return it from its page." and "Thank you", as the mock-up's. The date is the browser's
  own date and time with the year ("12 Nov 2026, 21:46"), where the mock-up printed the
  weekday too. On the front page it is laid out in full; on the film page it is folded
  under "Your receipt" ("Printed when you pressed Play."), and in full just after Play
  took the tape ("Printed just now, when Play took the tape."), as the mock-up's PLAY
  moment, until the first pause. A date and its time are one unit on the slip (no-break
  spaces): "Due back" may stand over them, never split them.
- **Journeys.** None changed; none broke. The chromium and webkit projects ran twice:
  107 passed and 23 skipped each time, each skip the journey's own stated one.
- **Seen** at 1440, 390 and 320 pixels in Chrome, on a throwaway shop: the front page
  signed in (with a tape on the card, Picked for you in and out, a link opened here and
  the members' shelf in and out), the same with a tape out to this browser as well,
  signed out with a tape out to this browser, nothing yet (signed in and out), Return it
  now from the front page, Hand it back from the front page, "Picked for you" on the
  film page, the receipt opened, the slip just after Play, and the notices (spent,
  cancelled, can't reach the shop). No page error, and nothing past either side at any
  width.
- **Not built:** the mock-up's narrow "Returned" page (slice 7 left it out: the counter
  says it); the back office's Responses tab (slice 9).

### 9. The back office

Reuses the Films table and `Mark tone="info"` for "out" (`web/src/admin/Films.jsx:57-90`,
`web/src/admin/ui.jsx:80-88`), the film page's tabs (`web/src/admin/FilmDetail.jsx:25-29`),
`TicketTable` and the send form (`web/src/admin/Tickets.jsx:106-151`, `:155-329`),
`TicketBadge` and `describeEvent` (`ui.jsx:144-155`, `:236-287`), and `attentionLine`
(`web/src/admin/facts.js:33-45`).

- [x] Films: a Tape column in place of "Active tapes" (`Films.jsx:64`). A film's page:
  the tape panel (who, since, due back, now), and taking the tape back with a
  confirmation on the page that says what the borrower will see, which of their other
  links for the film go with it, and which links anyone can use their browser also
  holds (question 14).
- [x] The send form: "Picked for you" with its hint, "Due back after", the warning when
  the film is out or has a link waiting. "Plays" and "Days after the first play" go.
  The link's edit form may send "Due back after" with every save: the days a link
  already has move nothing (slice 3's review). Changing them on a link that has the
  tape moves the date, so that field says so there.
- [x] Tapes: Out now, then the links. A link's page: its loan and states, no Give back.
  While it has the tape, "Let anyone with the link use it", "Give it to someone else"
  and Sign out browsers are disabled, with a line saying why (question 2, answer a).
  Members: tapes out. A seventh section, Responses, with its unread count and "Mark as
  read" (`web/src/admin/AdminApp.jsx:116-135`).
- [x] The Ledger's rows and Loans filter; Status; Settings: "Due back after, for new
  links", and what "Sign out every friend and member" does to tapes that are out
  (`web/src/admin/Settings.jsx:180`).

**Done when** every screen in the mock-up's back office table shows its version 2 parts,
and `test/office.test.js`'s word scan passes on the new screens.

Built on 12 Nov 2026, not yet committed. 1,073 unit tests became 1,093, all passing on
Node 26 (22 and 24 still wait for the draft pull request). What differs from the lines
above, from the mock-up, or was left open by them:

- **Where the words are.** `web/src/admin/loanWords.js` has what the back office says
  about links and loans, apart from React, as `facts.js` does for the booth: who has a
  tape (`borrowerLines`, `tapeCell`, `loanNow`), a link's state (`LINK_STATES`,
  `linkStateWords`, `linkStateNote`, `endedWords`, `startByWords`), the take-back's
  question (`takeBackWords`), the send form's warnings and lines (`sendWarnings`,
  `pickHint`, `readyLines`), the Ledger's rows for links and loans (`loanEventWords`),
  the responses (`RESPONSE_WORDS`, `handedBackWhen`), and Status's and Settings' lines
  (`tapesOutLine`, `sweeperText`, `signOutEveryoneWords`). `test/office.test.js` pins
  them. The pieces are in `web/src/admin/Loans.jsx` (the tape panel, the take-back
  question, a link's state, Out now) and the new `Responses.jsx`; `ui.jsx`'s
  `TicketBadge` went, and `describeEvent` hands loan events to `loanEventWords`.
- **Films.** Film, Tape, Media, Links, Scanned, as the mock-up's. The Tape column is
  "In", "Out with Sam Okafor since Thu 12 Nov, due back Sun 15 Nov" (a browser's: your
  note on the link and its device under it) or "Off the shelf", with whoever still has
  the tape under it: the clock runs on. Links is `links.live`. 1.1.0's
  `tickets: { total, active }` left `GET /api/admin/films` with its column.
- **A film's page.** Its first tab is "Tape and links" (its count in links). The tape
  panel says who has it (their page, or "a browser, from a link anyone can use" with
  your note, its device and whom it is signed in as), when Play took it and on which
  link, when it is due back, what they are doing now (playing, paused at, watched to
  the end), with the orange "Due back" sticker; the film's heading gains "Tape out" or
  "Tape in". **Take the tape back asks on the page**, as the friend's Return it now
  does: the question takes the focus and Keep it out gives it back. It says the link
  stops working, what the borrower's player and page will say ("{Host} has taken this
  tape back.", and "Nothing on the shelf here" when no link anyone can use stays in
  their browser; otherwise that their page shows it, with Play, straight away, which
  the words follow as its box is ticked), lists the member's other links that go
  with it (`cancelledToo`), and names the links anyone can use their browsers also
  hold, which stay, each with a "Cancel … too" box: ticked ones are cancelled after
  the take-back, one request each. A browser a member is signed in on adds that
  member's own links (question 16). Once done: "Test Pattern is back in. You took it
  back from Sam Okafor, and the link it was out on is cancelled, with 1 other link."
  Tapes' "Take the tape back" opens the film's page with the question asked (the
  history's state carries the loan, and is cleared, so Back doesn't ask again).
  "How it's been lent" is `lending` (links sent and cancelled, opened, lent,
  finished, and responses), in place of 1.1.0's `viewing`, which the API still sends.
- **The send form** stays on the film's page (under "Send a link") and on Tapes, as
  1.1.0 had it, where the mock-up drew a page of its own: the member's page still
  sends you to Tapes with the member chosen. "Due back after (days)" starts at the
  shop's days and is sent with every link, so a link's days are its own from the
  start. It warns, and only warns: "{Film} is out. {Name} has it until …", "It already
  has N links waiting for the tape", and "{Name} already has a link for this film.
  This one waits…" (question 9). "Picked for you"'s hint names the member, or says
  whoever has the link reads it. The button is "Send a link for anyone with the link"
  or "Send a link to Jo only" (Q11's table; the mock-up's "Make the link"). Once made:
  "N links ready." or "Link for Jo ready.", "Open Matte doesn't send it", "Sending it
  doesn't take the tape…", and the start-by and days. Plays and "Days after the first
  play" went, and **the API refuses them now** (400, on send and on save), as this plan
  said it would from slice 9; the tests that still sent them were changed, each with a
  comment.
- **Tapes**: the two lines of the mock-up, "Send a link for", **Out now** (film, who has
  it, since, due back, Take the tape back; the soonest due first) and **Links sent**
  (for, film, state with how its tape came back under it, or for a link that hasn't
  lent its start-by day, "standing still" while the tape is out with someone else, due
  back after, last activity, Copy link). A link's state is `linkState` in words: Not opened yet,
  Opened, Waiting: the tape is out, Has the tape, Done: the tape is back in, Start-by
  missed, Cancelled (or Taken back), Film off the shelf, Film unavailable.
- **A link's page.** While it has the tape: "This link has the tape" with Take the tape
  back; Let anyone use it, Give and Sign out browsers are disabled, and a line says
  why (`aria-describedby` on each). Otherwise "Cancel the link" (a browser `confirm`,
  as 1.1.0's buttons ask), and "Restore the link" only for a link that never lent;
  one that lent says it can't be. The facts: took the tape, due back, now (or back in,
  and how), opened, start by (`effectiveStartBy`, "standing still while the tape is
  out with someone else" when paused, and the date as set when they differ by a
  minute or more), browsers, sent. The form: the label, **Picked for you**, **Due back
  after** (empty for the shop's; on a link with the tape it says changing it moves the
  due-back date, and the save says the new date), start by and the keep box (only
  before it lends). "Plays during this loan", with no Give back.
- **Question 18 (c), with a server change.** `POST /api/admin/tickets/:id/holder` takes
  `pickNote` in the same step (`access.setTicketPerson`): null, or nothing but spaces,
  takes the note away, text replaces it, left out it stays. It is written only when
  the link changes hands, so a refused give (a note too long, a card turned off, the
  tape out) or one that changes nothing leaves the note as it was. On the page, a link
  with a note shows it in "Who can use it", with "Take the note away" ticked; the
  `confirm` says whether the note goes. Tested in `test/picked.test.js` (two tests).
- **Give back is gone, route and all.** `POST /api/admin/screenings/:id/void` and
  `access.voidScreening` went, as the API table said; the route now answers 404 like
  any other, and nothing writes `voided_at`. A 1.x play given back still shows "Given
  back" in a link's plays. `test/loans.test.js`'s three checks of it say so.
- **Members.** Name, member since, passkeys, **Tapes out** (each film and "due back …")
  and **Links** (`liveLinks`), last signed in, status; 1.1.0's count of tapes went. A
  member's page has "Send Sam a link", **Tapes** (their loans: out and due back, or back
  in and how, and the response), "Links sent to Sam" and "Setup and recovery links"
  (1.1.0's "Links", renamed beside the new ones). Turning a card off, Sign out
  everywhere and taking back the keys say what happens to their tapes
  (`cardOffWords`, `browsersTapesWords`): turning the card off also sends back a tape a
  browser of theirs took out on a link anyone can use (slice 9 said links anyone can use
  "aren't affected", 1.1.0's words, which question 5 made false).
- **Responses**, the seventh section, between Members and Ledger as the mock-up has it.
  Its tab counts the unread (`aria-label` "Responses, 2 unread"), read with the films
  on every screen. Each response: the sleeve, the four words, the member and the film
  (each a link), the message or "No message.", "Handed back …" and how early, "Not
  read yet" with **Mark as read**, and **Delete** (a `confirm`, then `DELETE` with an
  empty JSON body: `api.delete` in `web/src/api.js`).
- **The Ledger.** The Loans filter was there from slice 3. Its new rows are in words:
  "You sent a link, due back 3 days after Play, with a “Picked for you” note", "You
  moved the due-back date from … to …", "You cancelled the link", "You restored the
  link"; **lent and back in are printed on strips of the till roll** (`TillSlip`, which
  gains `label` so a strip isn't named "Your receipt"), as the mock-up's: "Lent, due back
  …", "Back in: returned early | handed back with a response | it was due | you took it
  back | its browser was signed out | their card was turned off". A member's own link
  with no label is "their link" in the Who column.
- **Status.** "**3 tapes out.** The next due back is Nosferatu, Sat 14 Nov, 22:12." with a
  link to Tapes; the start-by list is of links that haven't lent, says "Paused: the
  tape is out with someone else" (`startByPaused`) and the date as set when it moved;
  the server part gains **Tapes back in** (the sweeper's last run, and its error, which
  the status line now counts as something to look at, `facts.js`). The status line
  at the foot of every screen gains "N tapes out", as the mock-up's.
- **Settings.** "Due back after, for new links (days)" was there from slice 2; its hint
  now says the send form starts with it. "Sign out everyone" says links keep working,
  a browser's tape goes back and its link won't take it out again, and a member's own
  tape stays theirs; its question names the films that would go back, read from the
  live loans when you press it. Keeping records says clearing never changes a link or
  a loan.
- **Words, by question 11's table**, in every back office file: link for what you
  send, tape for the film's one copy; "Send a link", "N links ready", "How many
  links", "Sent", "Lent" for Play taking the tape, "Take the tape back" only for a link
  that has it and "Cancel the link" otherwise, "Links keep working". The copied
  message still says "Here's your tape" (question 11, answer a). `test/office.test.js`
  scans every `.jsx` file and `loanWords.js` for 1.x's words (now with lend), for 19
  ways 1.1.0 called a link a tape or spoke of play limits and coming back, and for the
  new screens' words.
- **Not done, and why.** `adminTicket` still carries 1.x's `state`, `expiresAt`,
  `openScreening`, `screeningsUsed`, `screeningsLeft`, `screeningLimit` and
  `daysAfterFirstPlay`. The pages read only `openScreening` (which play is open, and on
  which device); the rest are read by about 20 unit tests of slices 2 to 6, which
  would have to be rewritten together. Slice 10 can take them out with the docs. The
  film page's `viewing` stays beside `lending` for the same reason.
- **Journeys changed, because the plan intends it**: `e2e/admin.spec.js` ("Send a link
  for anyone with the link", "1 link ready."), `e2e/shell.spec.js` ("Send a link to …
  only", and the link page's loan, due back in a day, where it read 1.x's Expires and
  Can come back until) and `e2e/admin-messages.spec.js` (the card-off message says
  "giving them a link"). Results under [Tests](#tests).
- **Seen** at 1440, 390 and 320 pixels in Chrome, on a throwaway shop: Films (tapes in,
  out to a member, out to a browser, off the shelf with its tape out), a film's page
  with the tape out, the take-back question (with a link that goes with it and one
  that stays), taken back, a film in, a film off the shelf with its tape out, the send
  form with its three warnings, the link ready, Tapes, a link with the tape, a link
  with a note (Take the note away), a link done, a link cancelled, Members, a member's
  page, Responses, the Ledger and its Loans filter, Status and Settings. No page error,
  and nothing past either side at any width.

Slices 7, 8 and 9 were reviewed together on 12 Nov 2026, from four sides: the look
against the mock-up (every state shot in Chromium at 1440, 390 and 320 and in WebKit at
1440 and on two iPhones), the words against question 11 and the settled words (with a
word changed at a time to see whether a test caught it), access (keyboard, focus,
names, announcements), and what a friend and the owner see along whole journeys. No
page error, nothing past either side, no text under 4.5:1, and no answer that said who
had a tape. 1,093 unit tests became 1,106, all passing on Node 26. What changed:

- **Signing out straight after Play named no tape.** The question was built from the
  page's copy of `/api/me`, which Play didn't read again, so it said the link "still
  works" while signing out sent the tape back and spent the link (question 5's promise).
  Every sign-out now asks from `/api/me` read as it is pressed (`confirmSignOut`), and
  Play reads it again too. A journey holds it (`e2e/shell.spec.js`).
- **The front page could show a tape that was back.** Handed back with a response, "Go
  to your tapes" still listed it on your card with Return it now; after Play, it was
  still "in". Hand it back reads `/api/me` again, and the front page reads it on every
  arrival. A journey holds it.
- **The take-back question promised "Nothing on the shelf here"** when a link anyone
  can use stayed in the borrower's browser, whose page then offers it with Play at once
  (and said they could take it "once it's back"). It now says which, following the
  boxes as they are ticked. A ticked link that can't be cancelled after the take-back
  is named in the news, never reported as the take-back failing.
- **Words.** The signed-out page no longer tells a browser whose tape went back to sign
  in or open its link again (question 5). Turning a card off no longer says links anyone
  can use "aren't affected"; taking back the keys says what happens to tapes, as Sign
  out everywhere does. "On your card" is only the front page's section (question 11):
  the film page's two "…is on your card" lines, and "They aren't on your card", went.
  The back office said a note was "on their tape": it's "on their link". The front page
  says "In the shop" and "Out on loan, back …" in Picked for you as on the shelf for
  members. The preview banner says Play there "never takes a tape", as the mock-up. The
  host mid-sentence on Hand it back is written as the shop writes it. Slice 9's curly
  apostrophes are straight, as everywhere else. A failed request in the back office
  says "Couldn't reach the server just now, or it had a problem. Try again in a
  moment." rather than `server-error` or "Failed to fetch" (`requestError`, in
  `useAction` and `useLoad`). The paused strip's 1.x `left` prop went.
- **Tests that didn't hold the words.** No unit test read the friend's JSX: the settled
  "Only Arthur sees this" could change and every test pass. Hand it back's, the
  signed-out page's, "Nothing on the shelf here", "Taken out.", "No tapes yet." and the
  preview banner are now `tapeWords.js` exports, pinned word for word, and every page
  under `web/src/pages` is scanned for 1.x's nouns and clocks as the back office is.
  The back office's scan skipped any run of text beside a `{…}` and only asked whether
  a phrase was anywhere: it now reads round expressions (`test/shown.js`, shared by
  both), knows "screened", and pins each screen's words in its own file. Every notice
  and return error is pinned word for word.
- **The look.** The till slip split "Sun 15 Nov," from "22:28" (no-break spaces now).
  The PLAY moment, with the slip laid out, lasted as long as the player was open; it
  ends at the first pause. A link that hasn't lent shows its start-by day under its
  state in the link lists (the mock-up's Start by column). On a phone the tape panel's
  sticker is at its foot, and at 480px and under the back office's shop name has a row
  of its own, both as the mock-up; the lines under a sleeve are in the text face.
- **Access.** At the film's end the bar under the picture went and the focus with it;
  the end's heading now takes it when it was in the player (not from the counter).
  "Keep it until …" and Hand it back's "Not now" give the focus to the counter's way on.
  The back office's "Saved."-style news is a status region there from the start, and
  takes the focus where the button pressed has gone (a take-back, a give, cancel and
  restore, Mark as read, Delete); giving a link or letting anyone use it now says so.
  Names start with the button's words ("Hand it back: Nosferatu", "Take the tape back:
  The General", "Mark as read: Sam's response to …"). Hand it back's radios say they're
  required and when one is missing; the Give it to list says why it's disabled.
- **The server, one line.** Making a link anyone can use keepable (or not) with
  `pickNote` took its note away, though it doesn't change hands; the note is now written
  only when the link changes hands, as slice 9's note says (`test/picked.test.js`).
- **Not changed, and why.** Busy buttons dropping the focus in Chromium is 1.1.0's
  pattern everywhere: question 20. The date words' comma or "at" by engine: question
  21. The cancelled-link notice: question 19. The front page's "No tapes yet." stays,
  not the mock-up's "The shelf is empty.": the shelf for members can be on the same page.
  The end's heading before the film's h1 in the page's order, and the Ledger's table
  links under 32px on a phone (1.1.0's table layout), are left for slice 10's polish.
- **Journeys changed, because the plan intends it**: `e2e/account.spec.js` and
  `e2e/passkeys.spec.js` see a kept tape by its "For … only" strip, `e2e/shell.spec.js`
  reads a straight apostrophe, and two journeys are new in `e2e/shell.spec.js`.
  With those, all four projects (chromium, firefox, webkit and the installed Chrome)
  ran three times in a row, the last two on the final code: 268 journeys, 220 passed
  and 48 skipped each time, each skip the journey's own stated one, and none failed.

### 10. Journeys, docs, rehearsal, 2.0.0

- [x] The browser journeys below, in all four projects, twice running (three, on 13 Nov 2026).
- [x] The docs below, the changelog with its Upgrading note, the version.
- [x] Left by the review of slices 7 to 9: busy buttons (question 20); the end's heading
  after the film's h1 in the page's order; the Ledger's table links at least 32px tall
  on a phone; `adminTicket`'s 1.x fields and the film page's `viewing` (slice 9's "Not
  done").
- [x] A rehearsal on a copy of the live shop's backup ([Checking a
  backup](deploying.md#checking-a-backup), `docs/deploying.md:313-349`): the preview's
  report read with you, then the upgrade, then a loan from Play to hand-back.
- [x] The tag: `CHANGELOG.md`'s heading "2.0.0 — Unreleased" dated in the same change
  that tags v2.0.0, so the changelog agrees with the tag `docs/deploying.md` checks out.
- [ ] After the tag, both servers are upgraded by the same five steps, each from its
  own backup: the shop, and the demo. Each upgrade waits for your go-ahead.

**Done when** the rehearsal ends with a tape lent and handed back on the copy, and
2.0.0 is tagged. The tag and the release are pushes to a public repository, so each
waits for your go-ahead.

Docs written on 13 Nov 2026, not yet committed, against the code as it stood in the
working tree that day (the journeys, the busy buttons and slice 9's "Not done" were
being built beside them). Each claim was read against `server/` and `web/`; every
relative link and anchor in the repository's Markdown resolves (a script checked 187).
What was written:

- **`docs/access.md`**, rewritten for version 2 and titled "Tickets, loans and
  people". It keeps 1.1.0's rule that the page says the code's names (ticket,
  screening, and now loan), with the pages' words in bold, so its anchors stay. Words
  (link and loan, and the two meanings of tape); the records (loans and responses);
  Tickets (a link lends once, Due back after, no play limit, a start-by date that gets
  back the time the tape was out with someone else, Picked for you, cancel and
  restore); both tables; rule 5; Opening a link (spent, and opening never takes the
  tape); Link previews (spent previews as the shop); Keeping a ticket (only before
  Play, with the tape in; give, release and Sign out browsers wait); Films shown to
  members (in or out, never who); Screenings rewritten as **Loans**, with **Never who
  has it**; a new **Responses** section; Media requests; Signing in and out and
  Disabling people (which tapes go back); what is recorded (the loan events, loans and
  responses) and How long it's kept (loans for good, responses until deleted, a
  session kept while a loan it took is open). The new warning is in Loans and Media
  requests: trying a link in a private window takes the tape.
- **`CHANGELOG.md`**: "2.0.0 — Unreleased", with its Upgrading note in the order of
  [Upgrading](#upgrading-an-existing-shop): back up, preview and read the report, update
  when nobody is watching, the migration (and what a failure leaves), check Films and
  Tapes; what becomes of each kind of link and play, what a friend part-way through a
  film sees, the settings (Time to come back retired; Due back after); going back is a
  restore. Then Added, Changed and Removed.
- **`docs/deploying.md`**: Before you update gains the preview step; a new section,
  Previewing an upgrade (on a computer, and the plan's `docker run` on the server);
  After an update (a failed migration, what to check after 2.0.0); Backups (they hold
  friends' responses and your notes); After restoring an older backup (a tape returned
  since is out again, a tape lent since is in and its link lends again, links, notes
  and responses since are gone); Rolling back (to 1.1.0, and what 2.0.0 loses);
  Status, the rate limits (returning a tape), moving to a new server, and the
  examples' release, `v2.0.0`.
- **`README.md`**: What it does, links and loans in place of plays and limits, and
  every other line 2.0 made false (the opening, what friends need, running it locally,
  backups, the fonts).
- **`docs/roadmap.md`**: the 2.0 boxes ticked (the website's look from its commits of
  10 and 11 Nov), "Still to decide" answered from the settled rows as "Decided", and
  what is out of 2.0 left as later.
- **`web/src/look/README.md`**: a section for version 2's printed things (the two-line
  sticker, the out sticker, the pick note, the till slip, the STOP strip, the paused
  strip's date), and the files, colour rules, classes, shell and `BusyButton` brought
  up to date.
- **Beyond the list**, because 2.0 had made them false: `docs/installing.md` (the first
  link, which takes the tape and must be returned) and `docs/import-format.md`.
- **The version**: 2.0.0 in `package.json` and `package-lock.json`. No test pins the
  number: `test/booth.test.js` reads it from `package.json`.

Not confirmed in the code, or left:

- **The preview on the server** (`docker run … deploy-app node scripts/upgrade-preview.mjs`)
  was not run: no Docker here. It rests on the image having Node 26, `/tmp` writable
  and user 1000, and `server/db.js` needing only Node's own modules, which is so.
- **The busy buttons and the back office's 1.x fields** were written up as the working
  tree had them on 13 Nov, while they were being built: the changelog's "A busy button
  keeps the focus" and its last Removed line, and `BusyButton` in the look's README.
  Checked against the code by the review below, and mended where they claimed more.
- **`SECURITY.md`** listed "a screening limit, … expiry" among the things to report
  getting round. The review below brought it up to date.
- **The website** (`site/`) was not read for 2.0 and not changed.

Built on 13 Nov 2026, not yet committed: the third box, what the review of slices 7 to
9 left. 1,106 unit tests became 1,116, all passing on Node 26.

- **Busy buttons (question 20).** `web/src/look/busy.js` has the rules: `busyProps`
  (`aria-disabled` while busy, a press ignored and its form not sent), the page's one
  status region (`#om-busy`, there from the first busy button drawn), and which button
  was pressed last, the only one that speaks. `BusyButton` (`look/ui.jsx`, with
  `useBusyNews`) is the button; `PlayTile`, the telly's Resume, the name menu and the
  logo's upload use the helpers. A button that becomes `disabled` while it has the
  focus (Save, with nothing left to save) keeps it the same way until it moves on.
  Busy that starts with no press (Play from the front page's Resume) says nothing.
  `test/busy-buttons.test.js` scans every page for a button still `disabled` while its
  request runs; `e2e/busy.spec.js` is the browser's part.
- **The end's heading after the film's h1.** As built, the player drew the end's
  choices through a portal into a band after the film's details, moved up the screen
  with CSS `order`. The headings were in order, but the keyboard's wasn't: the review
  below undid it.
- **Table links at least 32px tall on a phone**: every stacked back office table
  (`.ui-table--stack`), not only the Ledger. The review measured it at 320 and 390
  pixels: the smallest link 22 to 32px on the Ledger and 18 to 32 on Tapes, nothing
  past either side, and a row about 22 to 24px taller (a Ledger row has two links),
  not the 10px first noted.
- **1.x's fields out of the back office's API.** A link lost `state`, `expiresAt`,
  `openScreening`, `screeningsUsed`, `screeningsLeft`, `screeningLimit` and
  `daysAfterFirstPlay`, and a film's page its `viewing`. The unit tests that read them
  were rewritten to `linkState`, `loan` and `lending`, none deleted. A loan gained
  `screeningId` (in `/api/admin/loans`, and so on a link), so that a link's page finds
  the loan's play among its plays, and its device, as `openScreening` told it.

Reviewed on 13 Nov 2026, from three sides: the docs against the code, the journeys
(each run twice in full, and three rules broken one at a time in a scratch copy, each
caught by its journey), and the busy buttons and pages in Chromium, old build against
new, at 1280, 390 and 320. 1,116 unit tests became 1,117, all passing. What changed:

- **Two buttons that send a request had no busy state**, so a double press sent two:
  the player's **Watch here instead** (now a `BusyButton`, busy while Play's request
  runs, and the film page's `play` does nothing while one is under way) and the back
  office's **Sign out** ("Signing out…"; `.ui-nav__item` is drawn busy). The static
  test counts them, and a journey holds Sign out.
- **The name menu's Sign out dropped the focus to the page**, as 1.1.0's did: the item
  that had it went with the list. Choosing an item now gives the focus back to the
  menu's button, as Escape does and as a menu button should, and the button keeps it
  while it is busy and after a failure. A journey holds it.
- **The two boxes saved as they are ticked** dropped the focus too: they are busy as a
  button is now, `aria-disabled`, with a tick meanwhile ignored and the box drawn as it
  was (question 22, built as we recommend). The static test no longer lets them be
  `disabled`, and a journey holds Show to members.
- **The end of the film, in the page's order.** The portal and CSS `order` went: the
  end is drawn in the player again, straight after the picture. While the theatre is
  open the page's h1 is the film's title, hidden, ahead of it, and the title under the
  picture is the same words in a paragraph, in the same type. The page's order is now
  the order it is drawn in, at every width, and Playback help's h2 follows the h1 too.
  A journey holds it (journey 11).
- **The look.** The telly's Resume, busy, is dimmed as Play is (1.1.0 never dimmed it);
  the logo's upload, a label, is drawn busy; `.visually-hidden` has the usual -1px
  margin, so the status region at the foot of the page adds no pixel of scroll.
- **Tests.** `test/never-who.test.js` pins the device a link's page shows (the loan's
  play, found by `screeningId`, among its plays), and the loan's own device when the
  browser's session no longer names one. Journey 1's Play sent anyway must be refused
  as `out`, not just with a 409; journey 3's press with no response must send nothing
  and leave the tape out. `e2e/busy.spec.js` uses the fixtures' `asAdmin`.
- **Docs.** The changelog's busy line claimed every button: it now says every button
  that sends a request, the two boxes and the name menu, which is so. Its API line has
  `screeningId`, and so does the table above. Upgrading's step 3 and the first risk say
  what 1.1.0's Tapes can't show (a friend paused part-way is "Active", like any link
  played) and point to the preview's report. `SECURITY.md` lists 2.0's rules (taking a
  tape back, the due-back date, one tape per film, a link lending once, never who has
  it) in place of play limits and expiry. `docs/installing.md` clones v2.0.0, and says
  a test link taken back is cancelled, not spent. `docs/access.md` says "waiting setup
  or recovery link" where it meant those, now that a waiting link is a film link.
- **Not changed, and why.** `e2e/busy.spec.js` still waits 300 ms to see that presses
  while busy send nothing: a wait for something not to happen can't fail a good run,
  and nothing the page sends could be ordered after a duplicate to wait on instead.
  `useAction` doesn't refuse a second run while busy: busy buttons already ignore the
  press, and a guard there would refuse an action started inside another.
  `form.requestSubmit()` with a busy submitter still submits, as with a disabled one;
  nothing in the app calls it.

Not run: real Safari, or an iPhone (only Playwright's Chromium, Firefox and WebKit, and
the installed Chrome); the preview under Docker on the server.

Rehearsed on 13 Nov 2026, on the code committed as `1f75411`. A fresh backup of
www.openmatte.dev, made in the app's container at 17:18 (schema 7, integrity ok, the
same checksum on the server and on this Mac), was previewed and then upgraded in a
throwaway folder. The preview: no tape out after the upgrade, so no play cut off and no
link spent early; 4 links already spent, 2 that lend once more (Test Pattern's device
checks), 3 of 9 never played; everything else as it was. The copy started on 2.0.0 at
schema 8, with integrity ok and no foreign key problems. A new member made a passkey,
was sent a link for a test reel, read "Pressing Play takes the tape out", pressed Play
(200, "Out to Rehearsal") and handed it back with "Loved it" and a few words (200);
Responses read "Responses, 1 unread", and the page showed no errors. The copy was then
deleted, and the backup kept until 2.0.0 is live on both servers.

It found one thing, mended since: pressing the Tapes tab while already on Tapes (from a
member's "Send … a link") kept the page, and Out now still said no tape was out. The
page loaded its loans, links, films and members once. It now reads them again on every
visit (`web/src/admin/Tickets.jsx`, by the location's key), and journey 1 holds it: the
back office, open on Tapes before Play, sees the tape out and back in by pressing the
tab, with no reload. Without the fix that step fails.

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
| `test/activity.test.js`, `test/booth.test.js` | `activity.test.js:164` three kinds; the void at `:325` goes. `booth.test.js:128` the effective start-by. Tapes out and the sweeper are in `test/who-has-it.test.js` ("Status: tapes out, and the sweeper"). |
| `test/members.test.js`, `test/backup.test.js` | `members.test.js:207-211` the listing's keys, with `tape` and `dueBack` (question 7; done in slice 5, and in `test/picked.test.js`). `backup.test.js:65`, `:127` `loanDays` and `pickNote` in place of `screeningLimit`. |
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
  return, and it stays on their card). And from the review of slices 2 and 3: signing
  in with a tape out where the shop's sessions are shorter than the loan (the new
  session and its cookie last a day past the due time); a save that sends a link's own
  days again after the shop's default changed, and on a loan whose date is off the
  grid of whole days (nothing moves, the rest is saved); a session signed out at a time
  the clock hasn't reached (written back now, never ahead); Play for a session that
  ended since the route read it (nothing taken, the link not spent); a take-back from
  a member that leaves their spent link alone, and one that stops the play; and a
  take-back from a signed-in member's browser, which pins question 16 as built.
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
  slice 3, `pickNote` in 4, the members' shelf in 5 (and with it every route a viewer
  can reach, as four viewers, across three kinds of borrower and three ways back: the
  slice's "Built on" note has the list), and in 6 a start-by date given back: four
  films alike but for who has the tape and how it comes back, no date told while it
  is out, and the same later date for all once it is back. Another suite, on two films alike
  but for who has the tape, compares a tape out on a member's own link with one out
  to a browser, the borrower's own second device with any other member on the link
  that lent, and a newcomer opening the link that lent with one opening a link that
  waits.
- One test for each way a borrower stops being able to play (sign out, sign out
  everywhere, "Sign out every friend and member", card turned off, passkey removed,
  keys taken back, signing in as someone else): the loan ends, another link takes it.
- `test/who-has-it.test.js`: slice 5's API, one suite for each line of its list. A
  film's tape, links and lending (also off the shelf with the tape out, with broken
  files, and past due with nothing written); the loans list for a member's loan and a
  browser's, signed in before Play, after it, signed out, and after the clean-up has
  deleted the session; how each loan ended; the filters; `otherLinks` against what a
  take-back then cancels; every `linkState`; Members; Status and the sweeper; your
  preview against every viewer's page; `/api/me`'s order, `browserLoans` and the shelf.
- `test/start-by.test.js`: slice 6's "done when". A table of loans and deadlines in,
  dates out, written from the rule and asked at several moments each: no date; no
  loans; one loan; a date that passes while the tape is out (the link waits, and its
  time left stands still) and the same with the end written; taken an hour before the
  date, at its very moment and after it; several loans, each pushing the date the
  next is held to; a loan that began before the link was sent, ended or still out;
  a link sent already missed; a link's own loan, on a played link and on a row no
  screen can make; a 1.x link played before the upgrade; the upgrade's ended loans;
  another film; ends the clock hasn't reached; loans over with no end written (due,
  signed out, a card turned off); a member's loan; and overlapping times. Then the
  same rule told hour by hour (an hour with the tape out elsewhere, begun before the
  date as it then stands, moves the date an hour) against 400 shops made at random.
  Then over HTTP: the friend's page and front page, the back office's link, the
  counts of a film's and a member's links, a form sending the date back, Play in
  the time given back, a film whose files break, and the take-back's confirmation
  naming a held link that has its time back. Last, a shop with 20 and then 60 links
  missed months ago: Status, Films and Members run as many statements for 60 as for
  20, and say the same of them. The Status list is in `test/booth.test.js` (its
  window, order and three keys, by the date each link goes by).
- `test/responses.test.js` and `test/picked.test.js`: slice 4's "done when". The first has a
  table of fifteen cases, from a member playing on their own link to your own browser
  signed in as the borrower, in each of which the page's `canRespond` and the return
  route must give the same answer, and that answer must be the plan's.
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
  Over HTTP as well, since the review of slices 2 and 3: a loan the upgrade made is
  returned by its borrower and another taken back by its loan, and restore is refused
  for a link that lent before 2.0.
- Settings (the retired key is accepted and dropped); sessions: `prolong`, and with a
  session made 89 days ago, the `Set-Cookie` on Play's answer as well as the row, then
  two days on; and a loan across the clocks changing on 25 October with
  `TZ=Europe/London`.

**Browser journeys** (`npm run e2e`; not in CI, `.github/workflows/tests.yml:3`). Each
journey that presses Play holds its browser project's tapes to itself (as built: one
lock for the project's two films, `tapes-<project>`, in `e2e/fixtures.js`; the first
draft of this line had a lock for each film), and `issueTicket` stops sending
`screeningLimit` (`e2e/fixtures.js:80`).

As built (slice 10, 13 Nov 2026), in the order this list first had them, and two more:

1. **Lend and return** (`e2e/loans.spec.js`, every browser). Two links, two browsers:
   both open the film and see what Play would do; the first presses Play; the second,
   reloaded, sees "Out on loan." and "Due back by …" with no Play, nothing of the
   other link, and a Play sent anyway is answered 409 `out`; the first presses Return it now
   and Return it on the page's question; the second, reloaded, has Play and takes the
   tape; the first, reloaded, says "Returned on …" and "This link has done its job",
   with no Play and no "Out on loan".
2. **Take it back** (`e2e/revoke.spec.js`, every browser that plays the film). The
   owner takes the tape back on the film's page in the back office, in a browser of its
   own: the tape panel says who has it ("a browser, from a link anyone can use", with
   the link's label), Take the tape back asks first on the page, Keep it out changes
   nothing and gives the focus back, Take it back says "… is back in. You took it back
   from that browser, and the link it was out on is cancelled." Then, as before: the
   player's next request is answered 409, it says "{Host} has taken this tape back.",
   the page is "Nothing on the shelf here", the media is refused, the lock screen
   forgets the film.
3. **Hand it back** (`e2e/passkeys.spec.js`, Chromium and Chrome: the virtual
   authenticator is the Chrome DevTools Protocol's, so Firefox and WebKit skip as the
   rest of that file does). A member set up from their setup link signs out, opens the
   link sent to them, signs in with the passkey there and presses Play; Hand it back
   takes the focus, says only the owner reads it, and pressed with no response says
   "Not handed back yet.", sends nothing and leaves the tape out; then Loved it and a message, and "Handed back" says what was
   said. In the back office the Responses tab is named "Responses, N unread" (N is the
   shop's, which other journeys share), the response shows "Not read yet", the member,
   the film, the message and how early; Mark as read says so, the tab shows the count
   the page read after it, and the focus is on Delete.
4. **One member, two devices** (`e2e/takeover.spec.js`): checked as it was, unchanged.
5. **Picked for you** (`e2e/picked.spec.js`, every browser). The film's staff pick is
   written on its page; a link for one member is sent from the film's send form with a
   note (the field's hint says it's kept apart from the staff pick); the member's film
   page has the note and the staff pick, each in its own figure, and the front page
   says "A note from … is with it" without the note; the staff pick is as written.
   Question 18: a link for anyone, with a note, sent from the form (its hint says
   whoever has the link reads it); a guest reads the note; on the link's page the note
   shows with Take the note away ticked; Give asks "… The “Picked for you” note is taken
   away." and says it was; the member it went to has no note, and the staff pick is
   unchanged. The staff pick is put back as it was before the journey lets go of the
   tapes.
6. **A spent link** (`e2e/shell.spec.js`): checked as it was, unchanged.
7. **The rewritten ones**: `e2e/shell.spec.js`, the keep journeys of
   `e2e/passkeys.spec.js` and `e2e/account.spec.js`, checked as they were.
8. **The front page with a tape out** (`e2e/loans.spec.js`, every browser; question 7).
   The film is shown to members for the journey only, and put back as it was. Signed in
   with nothing out, it's on "On the shelf for members", "In the shop". A browser not
   signed in takes it on a link anyone can use and finds it under "Out to this
   browser", with Return it now and a receipt "Out to this browser", and no Hand it
   back. The member's shelf then says "Out on loan, back …", nothing of the label or a
   browser. A link sent to the member puts it under "Picked for you", out on loan, and
   off the members' shelf; a link for the other film opened there is under "On this
   device". The guest's Return it now on the front page opens the film's page with the
   question asked and the focus on it; returned, the member's link is "In the shop";
   their Play puts it "On your card", with Hand it back, Return it now and a receipt
   "Out to {name}".
9. **Signing out names the tape that goes back** (`e2e/shell.spec.js`, question 5):
   the question, dismissed, names it; accepted, the browser is signed out, its link
   opened afresh says "That link has been used.", and a new link has Play.
10. **Busy buttons** (`e2e/busy.spec.js`, every browser; questions 20 and 22): with its
    request held and then refused, the button keeps the focus, is `aria-disabled`, a
    second press sends nothing, the status region says it is busy, and after the error
    it works again with the focus still on it. Status's Refresh, the back office's
    Sign out, a film's Show to members (a box: a second tick changes nothing), the
    friend's Play and Return it, and the name menu's Sign out, which gives the focus
    back to the menu's button. None of the held requests reaches the server.
11. **The end of the film in the page's order** (`e2e/keyboard.spec.js`, every browser
    that plays the film): played to its end, the end's heading takes the focus, the
    page's headings are the film's title (h1) then "That's the end." (h2), the choices
    come before the film's details in the page as on the screen, and Tab from the last
    of them goes on into the page, not to its foot.

Begun with slices 2 and 3, on 11 Nov 2026, in Chromium only; the rest is slice 10's.
Run as they were, 19 of the 64 journeys failed, nearly all because they share one film
and its tape was out after the first Play. What changed:

- **One tape, one journey at a time** (`e2e/fixtures.js`). `admin.issueTicket` holds
  the project's tapes for its journey (`holdTape`, the lock `tapes-<project>`), and
  stops sending `screeningLimit`. When the journey ends, every link that has lent, for
  each film it sent a link for, is cancelled, which takes the tape back if it is still
  out, so the next journey finds it in. Waiting for another journey's tapes doesn't
  count against a journey's own time. A journey that makes its link in the back
  office's pages calls `holdTape` itself; none presses Play on such a link today.
  As first built the lock was one for each film (`tape-<slug>`). Two journeys send
  links for both films, in opposite orders (the admin's, and the two-film journey of
  `e2e/tracks.spec.js`); when they overlapped, each held one tape and waited for the
  other until both timed out, and three more journeys behind them. One lock for both
  films can't do that, and costs nothing: only those two journeys use the second film.
- **Take it back** (journey 2) is `e2e/revoke.spec.js`, rewritten: the report is
  answered 409, the player says "{Host} has taken this tape back.", never "no longer
  valid", and the page is gone. Its second journey, a play given back mid-film, went
  with Give back.
- **One member, two devices** (journey 4) is `e2e/takeover.spec.js`, rewritten: the
  second device is the same member signed in again (`anotherDevice`), not a second
  browser on a link anyone can use.
- **A spent link** (journey 6) is new in `e2e/shell.spec.js`. There is no Return it
  now button until slice 7, so the page returns the tape by asking the server itself.
  (Slice 7: it presses Return it now, and Return it on the page's question.)
- **Journey 7.** `e2e/shell.spec.js`: "3 plays left" became the line that says how
  long the link lends for (`loanDays: 2`, "for 48 hours"), and the link "valid one day
  after its first play" became one that lends for a day. `e2e/account.spec.js`: the
  other browser opens the link and no longer plays it before the member keeps it
  (question 2). The keep journey in `e2e/passkeys.spec.js` needed nothing: it never
  pressed Play, and only failed while another journey's tape was out.
- Journeys 1, 3 and 5 wait for the pages they walk through (slices 7 to 9).

With that, all 64 journeys in the chromium project passed (one more is WebKit's own and
skips), twice running, when slices 2 and 3 were built. The review of 11 Nov 2026 did
not see that again at first, for two reasons, both mended since:

- Its own two runs had 63 pass and one fail, `e2e/admin.spec.js`, at its Status step:
  nothing to do with version 2. The back office's status line shows a second "Status"
  link whenever the server has something to look at, and the computer running the
  journeys had under a tenth of its disk free. The journey now clicks the tab in the
  back office's navigation.
- With that mended the admin's journey reaches its Ledger step, where it sends a link
  for the second film and then one for the main film. Of the next two runs, one
  passed (64) and one had 59 pass and 5 time out after six minutes, waiting for a
  tape: the lock for each film, held in opposite orders by two journeys, as the first
  bullet above says. With one lock for a project's tapes, three runs in a row passed:
  64 each, one skipped, about a minute each, as before.

Firefox, WebKit and Chrome have not been run.

Slice 9 (12 Nov 2026) changed three journeys for its words, as its "Built on" note
says (`e2e/admin.spec.js`, `e2e/shell.spec.js`, `e2e/admin-messages.spec.js`). The
first run after the back office was rebuilt had the one-day link's step fail in both
projects: it looked for a 24-hour clock where the journeys' browsers use a 12-hour one.
With that mended, the chromium and webkit projects ran three times: 107 passed and 23
skipped each time, each skip the journey's own stated one, none failed. Firefox and
Chrome were not run as projects.

Slice 10 (13 Nov 2026) wrote journeys 1, 3, 5, 8 and 9 above, moved journey 2's
take-back onto the film's page in the back office, and checked 4, 6 and 7 against the
pages as built, which needed nothing. `e2e/fixtures.js` gained `asAdmin` (the back
office in a browser of its own, signed in without the form) and `admin.get`. With
`e2e/busy.spec.js`, written beside them for question 20, that makes 73 journeys in each
of the four projects, 292 in all. The first full run (`npm run e2e`: chromium, firefox,
webkit and the installed Chrome) had 241 pass, 50 skip and one fail: the busy
journey's film page in WebKit, "what the Content-Security-Policy blocked", one console
line, "Refused to apply a stylesheet…". Repeated on its own it failed about one run in
fifteen. It was the journeys' guard, not the app: WebKit reports its own drop-down
menu's styles (`BROWSERS_OWN`) when it gets round to drawing the player's menus, which
can be during the guard's last 50 ms wait; the console line came in just before the
guard stopped watching and the event that sets it aside just after, so the line was
left alone. The guard now hears a report of the browser's own even after it stops
watching (it can only set a line aside, never fail one); repeated forty times the
journey passed forty. Then three full runs in a row: 242 passed and 50 skipped each
time, about three and a half minutes each, none failed and none flaky. Each skip is the
journey's own stated one: virtual passkeys need the Chrome DevTools Protocol (Firefox
and WebKit skip them), some journeys run in one project or one engine only (an edit to
what every browser shares, Back and Forward, how hls.js runs, the card's ink measured
once, WebKit's own drawing of SVG filters), a browser that can't play the film or whose
own HLS player doesn't say when a request is refused, and WebKit's video taking no
Space and giving no screenshots of the card.

The review of slice 10 (13 Nov 2026) added three journeys to `e2e/busy.spec.js` and
one to `e2e/keyboard.spec.js` (journeys 10 and 11 above): 77 in each project, 308 in
all. Its first full run had 256 pass, 50 skip and 2 fail, both the new back office
Sign out journey (Firefox and Chrome): Status's page can have a "Tapes" link of its own
(it did while another journey's tape was out), and the journey now looks for the one
in the navigation. Then two
full runs in a row: 258 passed and 50 skipped each time, none failed and none flaky,
about three and a half minutes each, the skips as before.

## Docs to update

- **`docs/access.md`**: the Words table gains link and loan, and "tape" its second
  meaning; The records; Tickets (a link lends once, "Due back after", no play limit,
  and a start-by date that gets back the time the tape was out with someone else);
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
- **`SECURITY.md`** (added by slice 10's review): what's in scope, in 2.0's rules, with
  [Never who has it](access.md#never-who-has-it).

## Risks

- **The upgrade can cut someone off.** With two friends part-way through one film, one
  stops. The preview names them. Updating when nobody is playing (no "Playing now" on
  1.1.0's Tapes) stops nobody mid-film, but a friend paused part-way still counts, and
  shows on Tapes only as "Active": the preview is the list to go by.
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
  when they are run by hand before the release. (It did, once, in the review of slices
  2 and 3: "Browser journeys", under Tests.)
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
- A tape that moves with its link when the link is kept or given (question 2, answered
  on 11 Nov). A fuller loan for links caught part-way at the upgrade
  (question 15, answered on 11 Nov). Keeping the name behind a browser's loan after its
  session is gone.
- The main button's colour, still open from the look, is not part of this plan.
