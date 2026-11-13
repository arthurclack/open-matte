// One tape, one borrower (docs/version-2.md, "Browser journeys" 1, and question 7):
// - Lend and return: one browser presses Play and takes the tape; a second, on a link of
//   its own, sees "Out on loan" and the date it's due back, with no Play; the first
//   returns it, asked on the page; the second can then take it; the first's link is
//   spent.
// - The front page's sections with a tape out: out to this browser, on your card,
//   picked for you, on this device, and the members' shelf saying a film is out and
//   when it's back, never who has it.
// Every browser: pressing Play takes the tape whether or not the browser can decode
// the film.
import { admin, asAdmin, cinemaName, expect, film, playButton, secondFilm, signedInPerson, test, unique } from './fixtures.js';

// Presses Play and waits until the server has answered.
async function pressPlay(page) {
  const started = page.waitForResponse((r) => new URL(r.url()).pathname === `/api/films/${film.slug}/screenings` && r.request().method() === 'POST');
  await playButton(page).click();
  return started;
}

// Return it now, then Return it on the page's question. `asked`: the page opened with
// the question already asked, as the front page's Return it now opens it.
async function returnIt(page, { asked = false } = {}) {
  const panel = page.locator('.fl-counter');
  if (!asked) await panel.getByRole('button', { name: 'Return it now' }).click();
  const question = panel.getByRole('group', { name: new RegExp(`^Return ${film.title} now\\?`) });
  await expect(question).toBeVisible();
  // Asking moves the focus to the question.
  await expect(question.locator('p[tabindex="-1"]')).toBeFocused();
  await expect(question).toContainText("It's back in the shop straight away, and this link won't take it out again.");
  const returned = page.waitForResponse((r) => new URL(r.url()).pathname === `/api/films/${film.slug}/return`);
  await question.getByRole('button', { name: 'Return it', exact: true }).click();
  expect((await returned).status()).toBe(200);
  await expect(panel).toContainText('Returned on');
}

test('lend and return: the second browser sees it out with no Play, the first returns it, the second takes it, and the first link is spent', async ({ page, newContext }, testInfo) => {
  const first = await admin.issueTicket({ label: unique('First', testInfo) });
  const second = await admin.issueTicket({ label: unique('Second', testInfo) });
  const other = await (await newContext()).newPage();
  const counter = (p) => p.locator('.fl-counter');

  await test.step('both links open the film, and opening takes nothing', async () => {
    for (const [p, t] of [
      [page, first],
      [other, second],
    ]) {
      await p.goto(`/t/${t.code}`);
      await expect(p.getByRole('heading', { level: 1, name: film.title })).toBeVisible();
      await expect(playButton(p)).toHaveAccessibleName('Play');
      await expect(counter(p)).toContainText('Pressing Play takes the tape out.');
    }
  });

  // The back office, open on Tapes before Play, as it would be on a desk: pressing the
  // Tapes tab again shows the tape out without a reload, and back in after the return.
  const office = await (async () => {
    const context = await newContext();
    await asAdmin(context);
    return context.newPage();
  })();
  const outNowRow = office.locator('tr', { has: office.locator(`a[href="/admin/films/${film.id}"]`) }).filter({ has: office.getByRole('button', { name: /^Take the tape back/ }) });
  const tapesTab = () => office.getByRole('navigation', { name: 'Back office' }).getByRole('link', { name: 'Tapes', exact: true }).click();
  await test.step('the back office is open on Tapes, filtered, with the tape in', async () => {
    await office.goto('/admin/tickets?kind=anyone');
    await expect(office.getByRole('heading', { level: 2, name: /^Out now/ })).toBeVisible();
    await expect(outNowRow).toHaveCount(0);
  });

  await test.step('the first presses Play and takes the tape', async () => {
    expect((await pressPlay(page)).status()).toBe(200);
    await expect(counter(page)).toContainText("Taken out. It's yours until it's due back");
  });

  await test.step('pressing the Tapes tab again shows it out now, without reloading the page', async () => {
    const loaded = office.waitForResponse((r) => new URL(r.url()).pathname === '/api/admin/loans');
    await tapesTab();
    await loaded;
    await expect(outNowRow).toHaveCount(1);
  });

  await test.step('the second sees it out on loan, with the date it is back and no Play', async () => {
    await other.reload();
    await expect(other.getByRole('heading', { level: 1, name: film.title })).toBeVisible();
    await expect(counter(other)).toContainText(/Out on loan\.\s*Due back by \S/);
    await expect(playButton(other)).toHaveCount(0);
    await expect(counter(other)).not.toContainText('Pressing Play');
    // Never who has it: not the other link's label, not "this browser".
    await expect(counter(other)).not.toContainText(first.label);
    await expect(counter(other)).not.toContainText(/this browser/i);
    // Pressed anyway, as a page drawn before the tape went out would: refused, and nothing taken.
    const tried = await other.evaluate(
      (slug) =>
        fetch(`/api/films/${slug}/screenings`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).then(async (r) => ({
          status: r.status,
          body: await r.json(),
        })),
      film.slug,
    );
    // Refused because the tape is out, not for some other reason (every refusal is a 409).
    expect(tried).toEqual({ status: 409, body: { error: 'out' } });
  });

  await test.step('the first returns it, asked on the page', async () => {
    await returnIt(page);
    await expect(counter(page)).toContainText("This link has done its job: it won't take the tape out again.");
    await expect(playButton(page)).toHaveCount(0);
  });

  await test.step('pressing the Tapes tab again shows it back in', async () => {
    const loaded = office.waitForResponse((r) => new URL(r.url()).pathname === '/api/admin/loans');
    await tapesTab();
    await loaded;
    await expect(outNowRow).toHaveCount(0);
  });

  await test.step('the second can now take it', async () => {
    await other.reload();
    await expect(playButton(other)).toHaveAccessibleName('Play');
    expect((await pressPlay(other)).status()).toBe(200);
    await expect(counter(other)).toContainText("Taken out. It's yours until it's due back");
  });

  await test.step('the first link is spent: its page says so, and offers no Play', async () => {
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: film.title })).toBeVisible();
    await expect(counter(page)).toContainText('Returned on');
    await expect(counter(page)).toContainText("This link has done its job: it won't take the tape out again.");
    await expect(playButton(page)).toHaveCount(0);
    // Not "Out on loan": to its borrower, the link is done, whoever has the tape now.
    await expect(counter(page)).not.toContainText('Out on loan');
  });
});

// The front page's sections (web/src/pages/Home.jsx, tapeWords.js sectionWords), and
// question 7: a film on the members' shelf says it is out, and when it is back, never who
// has it. The film is put on the members' shelf for this journey only: the journey holds
// the project's tapes (fixtures.js), so no other journey of this browser presses Play on
// it meanwhile. Members in other browsers' journeys may see it on their shelf (the shop
// is shared), and none counts the shelf; one that did would share this window through
// exclusively('members-shelf', …).
test('the front page with a tape out: each section, and the members’ shelf saying out, never who', async ({ page, context, newContext }, testInfo) => {
  const name = unique('Mo', testInfo);
  const { person, cookie } = await signedInPerson(name);
  await context.addCookies([cookie]);
  const anyone = await admin.issueTicket({ label: unique('Guest', testInfo) });
  const before = await admin.get(`/api/admin/films/${film.id}`);
  await admin.patch(`/api/admin/films/${film.id}`, { memberVisible: true });
  try {
    const section = (p, heading) => p.getByRole('region', { name: heading, exact: true });
    const facing = (p, heading, title) => section(p, heading).getByRole('listitem').filter({ has: p.getByRole('heading', { level: 3, name: title, exact: true }) });

    await test.step('signed in with nothing out, the film is on the members’ shelf, in the shop', async () => {
      await page.goto('/');
      await expect(page.getByRole('heading', { level: 1, name: 'Your tapes' })).toBeVisible();
      await expect(facing(page, 'On the shelf for members', film.title)).toContainText('In the shop');
    });

    const guest = await (await newContext()).newPage();
    await test.step('a browser not signed in takes the tape on a link anyone can use, and finds it under Out to this browser', async () => {
      await guest.goto(`/t/${anyone.code}`);
      expect((await pressPlay(guest)).status()).toBe(200);
      await guest.goto('/');
      await expect(guest.getByRole('heading', { level: 1, name: cinemaName() })).toBeVisible();
      const out = section(guest, 'Out to this browser');
      await expect(out.getByRole('heading', { level: 3, name: film.title })).toBeVisible();
      await expect(out.getByRole('button', { name: `Return it now: ${film.title}` })).toBeVisible();
      await expect(out.getByRole('group', { name: 'Your receipt' })).toContainText('Out to this browser');
      // A link anyone can use asks for no response.
      await expect(out.getByRole('button', { name: `Hand it back: ${film.title}` })).toHaveCount(0);
    });

    await test.step('the member’s shelf says it is out, and the day it is back, never who has it', async () => {
      await page.reload();
      const item = facing(page, 'On the shelf for members', film.title);
      await expect(item).toContainText(/Out on loan, back\s+\S/);
      await expect(item).not.toContainText('In the shop');
      await expect(item).not.toContainText(anyone.label);
      await expect(item).not.toContainText(/browser/i);
      await expect(section(page, 'On your card')).toHaveCount(0);
    });

    await admin.issueTicket({ personId: person.id });
    const another = await admin.issueTicket({ label: unique('Other film', testInfo), for: secondFilm });
    await test.step('a link sent to the member is under Picked for you, out on loan; one opened here is under On this device', async () => {
      await page.goto(`/t/${another.code}`);
      await expect(page.getByRole('heading', { level: 1, name: secondFilm.title })).toBeVisible();
      await page.goto('/');
      const picked = facing(page, 'Picked for you', film.title);
      await expect(picked).toContainText(/Out on loan, back\s+\S/);
      await expect(picked).not.toContainText(anyone.label);
      // The member holds a link for it now: it has left the members' shelf.
      await expect(page.getByRole('heading', { level: 3, name: film.title, exact: true })).toHaveCount(1);
      await expect(facing(page, 'On this device', secondFilm.title)).toContainText('In the shop');
    });

    await test.step('the guest returns it from the front page, asked on the film’s page', async () => {
      await section(guest, 'Out to this browser').getByRole('button', { name: `Return it now: ${film.title}` }).click();
      await expect(guest).toHaveURL((url) => url.pathname === `/${film.slug}`);
      await returnIt(guest, { asked: true });
    });

    await test.step('the member’s link is in the shop again; Play takes it, and it is on their card', async () => {
      await page.reload();
      await expect(facing(page, 'Picked for you', film.title)).toContainText('In the shop');
      await page.getByRole('heading', { level: 3, name: film.title, exact: true }).getByRole('link').click();
      await expect(page.getByRole('heading', { level: 1, name: film.title })).toBeVisible();
      expect((await pressPlay(page)).status()).toBe(200);
      await page.goto('/');
      const card = section(page, 'On your card');
      await expect(card).toContainText("What you have out, and when it's due back.");
      await expect(card.getByRole('heading', { level: 3, name: film.title })).toBeVisible();
      await expect(card.getByRole('button', { name: `Hand it back: ${film.title}` })).toBeVisible();
      await expect(card.getByRole('button', { name: `Return it now: ${film.title}` })).toBeVisible();
      await expect(card.getByRole('group', { name: 'Your receipt' })).toContainText(`Out to ${name}`);
      await expect(section(page, 'Picked for you')).toHaveCount(0);
      await expect(page.getByRole('heading', { level: 3, name: film.title, exact: true })).toHaveCount(1);
    });
  } finally {
    await admin.patch(`/api/admin/films/${film.id}`, { memberVisible: before.memberVisible });
  }
});
