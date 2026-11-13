// Picked for you (docs/version-2.md, "Browser journeys" 5, and question 18): a note
// written on the send form travels with its link, onto the friend's film page and front
// page, apart from the film's staff pick, which stays as it was. Giving a link that
// carries a note to a member shows the note, with "Take the note away" ticked, and the
// note goes in the same step. Every browser.
//
// The links are sent from the back office's own pages, so the journey holds the
// project's tapes itself (fixtures.js holdTape). It writes the film's staff pick, which
// every journey of this browser shares, and puts it back as it was before letting go.
import { admin, asAdmin, expect, film, holdTape, signedInPerson, test, unique } from './fixtures.js';

test('Picked for you on the send form and the friend’s pages, the staff pick unchanged, and the note taken away when the link is given', async ({ page, context, newContext }, testInfo) => {
  await holdTape(film);
  await asAdmin(context);
  const sam = unique('Sam', testInfo);
  const jo = unique('Jo', testInfo);
  const { person: samPerson, cookie: samCookie } = await signedInPerson(sam);
  const { cookie: joCookie } = await signedInPerson(jo);
  const staffPick = `Watch it with the lights off. ${unique('Pick', testInfo)}`;
  const forSam = `Sam, this one is for you. ${unique('Note', testInfo)}`;
  const forAnyone = `For whoever opens this. ${unique('Note', testInfo)}`;
  const before = await admin.get(`/api/admin/films/${film.id}`);

  const browser = async (cookie) => {
    const c = await newContext();
    if (cookie) await c.addCookies([cookie]);
    return c.newPage();
  };
  const note = (p) => p.getByRole('figure', { name: 'Picked for you' });
  const pick = (p) => p.getByRole('figure', { name: 'Staff pick' });

  try {
    await test.step('the film’s staff pick, written on its page', async () => {
      await page.goto(`/admin/films/${film.id}#details`);
      await page.getByRole('textbox', { name: /^Staff pick/ }).fill(staffPick);
      await page.getByRole('button', { name: 'Save details' }).click();
      await expect(page.getByRole('button', { name: 'Saved' })).toBeVisible();
    });

    await test.step('a link for Sam only, with a note: the form says who reads it', async () => {
      await page.getByRole('tab', { name: /^Tape and links/ }).click();
      await page.getByRole('radio', { name: /Only one member, signed in/ }).check();
      await page.getByRole('combobox', { name: 'Which member' }).selectOption({ label: sam });
      const field = page.getByRole('textbox', { name: /^Picked for you/ });
      await expect(field).toHaveAccessibleDescription(
        `Your note to ${sam} about this film, on their link. It's kept apart from the staff pick, so editing one never changes the other.`,
      );
      await field.fill(forSam);
      await page.getByRole('button', { name: `Send a link to ${sam} only` }).click();
      await expect(page.getByText(`Link for ${sam} ready.`)).toBeVisible();
      await expect(field).toHaveValue('');
    });

    await test.step('Sam reads the note on the film’s page, beside the staff pick, and the front page says one is with it', async () => {
      const p = await browser(samCookie);
      await p.goto(`/${film.slug}`);
      await expect(p.getByRole('heading', { level: 1, name: film.title })).toBeVisible();
      await expect(note(p)).toContainText(forSam);
      await expect(pick(p)).toContainText(staffPick);
      await expect(pick(p)).not.toContainText(forSam);
      await p.goto('/');
      const facing = p
        .getByRole('region', { name: 'Picked for you', exact: true })
        .getByRole('listitem')
        .filter({ has: p.getByRole('heading', { level: 3, name: film.title }) });
      await expect(facing).toContainText(/A note from .+ is with it/);
      // The note itself is on the film's page only.
      await expect(facing).not.toContainText(forSam);
    });

    await test.step('the staff pick is as it was', async () => {
      expect((await admin.get(`/api/admin/films/${film.id}`)).recommendation).toBe(staffPick);
      const links = await admin.get(`/api/admin/tickets?film=${film.id}&person=${samPerson.id}`);
      expect(links.map((t) => t.pickNote)).toEqual([forSam]);
    });

    const label = unique('Anyone', testInfo);
    await test.step('a link for anyone with the link, with a note: the form says whoever has it reads it', async () => {
      await page.getByRole('radio', { name: /Anyone with the link/ }).check();
      await page.getByRole('textbox', { name: 'Who is it for?' }).fill(label);
      const field = page.getByRole('textbox', { name: /^Picked for you/ });
      await expect(field).toHaveAccessibleDescription(/^Your note about this film, on the link\. Whoever has the link reads it/);
      await field.fill(forAnyone);
      await page.getByRole('button', { name: 'Send a link for anyone with the link' }).click();
      await expect(page.locator('.ui-line--done').filter({ hasText: '1 link ready.' })).toContainText(`For ${label}`);
    });
    const [link] = (await admin.get(`/api/admin/tickets?film=${film.id}&kind=anyone`)).filter((t) => t.label === label);
    expect(link.pickNote).toBe(forAnyone);

    await test.step('whoever opens it reads the note', async () => {
      const guest = await browser(null);
      await guest.goto(`/t/${link.code}`);
      await expect(note(guest)).toContainText(forAnyone);
      await expect(pick(guest)).toContainText(staffPick);
    });

    await test.step('giving it to Jo shows the note, with Take the note away ticked, and takes it away', async () => {
      await page.goto(`/admin/tickets/${link.id}`);
      await expect(page.getByText('Picked for you, on this link')).toBeVisible();
      await expect(page.locator('.of-msg')).toContainText(forAnyone);
      await expect(page.getByRole('checkbox', { name: /^Take the note away/ })).toBeChecked();
      await page.getByRole('combobox', { name: 'Give it to' }).selectOption({ label: jo });
      const asked = new Promise((resolve) =>
        page.once('dialog', async (dialog) => {
          resolve(dialog.message());
          await dialog.accept();
        }),
      );
      await page.getByRole('button', { name: 'Give', exact: true }).click();
      expect(await asked).toBe(
        `Give this link to ${jo}? Only ${jo}, signed in, can use it from now on. Browsers that opened the link lose it from the next request. The “Picked for you” note is taken away.`,
      );
      await expect(page.getByRole('status').filter({ hasText: `Given to ${jo}.` })).toHaveText(`Given to ${jo}. Only they can use it now. The “Picked for you” note was taken away.`);
      await expect(page.getByText('Picked for you, on this link')).toHaveCount(0);
      expect((await admin.get(`/api/admin/tickets/${link.id}`)).pickNote).toBeNull();
    });

    await test.step('Jo’s page has no note, and the staff pick is unchanged', async () => {
      const p = await browser(joCookie);
      await p.goto(`/${film.slug}`);
      await expect(p.getByRole('heading', { level: 1, name: film.title })).toBeVisible();
      await expect(pick(p)).toContainText(staffPick);
      await expect(note(p)).toHaveCount(0);
      expect((await admin.get(`/api/admin/films/${film.id}`)).recommendation).toBe(staffPick);
    });
  } finally {
    await admin.patch(`/api/admin/films/${film.id}`, { recommendation: before.recommendation ?? '' });
  }
});
