import fs from 'node:fs';
import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The web app lives in web/ and builds to dist/, which the server serves.
// In development, Vite proxies API, media and image requests to the server on :3000.
// The keys end in a slash because Vite matches them as prefixes: '/media' alone would
// also send a film's page, such as /mediastan, to the server.
const server = 'http://127.0.0.1:3000';

export default defineConfig({
  root: 'web',
  plugins: [react(), thirdPartyLicenses()],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    // hls.js gets a chunk of its own. It is most of the player's code and changes far
    // less often than the rest, so an update to the app doesn't make every viewer
    // download it again. It still loads only with the player. It's the full build, at
    // about 575 kB, because the light one has no alternate audio or subtitles: hence
    // the limit, above the 500 kB that Vite warns about otherwise.
    chunkSizeWarningLimit: 600,
    rolldownOptions: {
      output: { codeSplitting: { groups: [{ name: 'hls', test: /node_modules[\\/]hls\.js[\\/]/ }] } },
    },
  },
  server: {
    port: 5173,
    proxy: { '/api/': server, '/media/': server, '/artwork/': server, '/branding/': server },
  },
});

// ------------------------------------------------------------ licence notices
// The packages whose code the app sends to browsers (hls.js under Apache 2.0, React
// and the rest under MIT) ask for their licence text to go with every copy. The build
// writes them all into dist/third-party-licenses.txt, which the server sends like any
// other file in dist/ and the footers link to. The list is read from the bundle
// itself, so a package added, dropped or tree-shaken away changes the file, with no
// list here to keep up to date (except VENDORED, below). The file starts with Open
// Matte's own copyright and licence, the GPL, and where its source is: package.json's
// repository. The fonts the membership card is printed in, which the app serves from
// web/public/fonts, come last, each with its licence (FONTS, below).

export const LICENCES_FILE = 'third-party-licenses.txt';
const SELF = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export function thirdPartyLicenses() {
  return {
    name: 'open-matte:third-party-licences',
    apply: 'build',
    generateBundle(_, bundle) {
      const ids = Object.values(bundle).flatMap((out) => (out.type === 'chunk' ? out.moduleIds : []));
      const packages = bundledPackages(ids, { root: this.environment?.config.root ?? process.cwd() });
      for (const p of packages.filter((p) => !p.texts.some((t) => !t.added))) {
        this.warn(`${p.name} ${p.version} has no licence file, so ${LICENCES_FILE} has no licence text of its own (${p.licence ?? 'no licence named'}).`);
      }
      for (const p of packages.flatMap((p) => p.includes ?? []).filter((p) => p.version === 'unknown')) {
        this.warn(`${p.inside}'s package.json doesn't list ${p.name}, which VENDORED in vite.config.js says is inside it: check what it bundles now.`);
      }
      const source = sourceUrl(SELF);
      if (!source) this.warn(`package.json has no repository, so ${LICENCES_FILE} can't say where Open Matte's source code is.`);
      this.emitFile({ type: 'asset', fileName: LICENCES_FILE, source: licenceNotices(packages, { source, fonts: shippedFonts() }) });
    },
  };
}

// Where the source is, from package.json's "repository": a URL (git+ and .git
// dropped), { url }, or GitHub's short "owner/name" or "github:owner/name". Or null.
export function sourceUrl(json) {
  const given = typeof json.repository === 'string' ? json.repository : json.repository?.url;
  if (!given?.trim()) return null;
  const short = given.trim().match(/^(?:github:)?([\w.-]+\/[\w.-]+)$/);
  return short ? `https://github.com/${short[1]}` : given.trim().replace(/^git\+/, '').replace(/\.git$/, '');
}

// Packages whose published code already has other packages' code inside it, which
// then never shows up as a module id of its own. hls.js is one: its dist/hls.mjs
// bundles parts of the Common Media Library, eventemitter3 and url-toolkit, which its
// package.json lists under devDependencies, at the versions it was built with. They
// aren't installed, so their licence texts are kept in web/licences/. A test checks
// this list against the imports in the installed hls.js's src/.
export const VENDORED = {
  'hls.js': [
    { name: '@svta/cml-cmcd', licence: 'Apache-2.0', file: 'common-media-library.txt' },
    { name: '@svta/cml-id3', licence: 'Apache-2.0', file: 'common-media-library.txt' },
    // Not imported by hls.js itself, but by @svta/cml-cmcd.
    { name: '@svta/cml-structured-field-values', licence: 'Apache-2.0', file: 'common-media-library.txt' },
    { name: '@svta/cml-utils', licence: 'Apache-2.0', file: 'common-media-library.txt' },
    { name: 'eventemitter3', licence: 'MIT', file: 'eventemitter3.txt' },
    { name: 'url-toolkit', licence: 'Apache-2.0', file: 'url-toolkit.txt' },
  ],
};

// The packages the module ids belong to, with their licences: [{ name, version,
// licence, texts: [{ title, text, added }], includes }], by name. A text's title is
// its file's name, unless the build added the text (see APACHE below). includes, for
// a package in VENDORED, lists the packages inside it, in the same form, each with
// `inside` naming the package that carries it.
// An id is a file in a package's folder under node_modules (the innermost one, for a
// package nested in another), or a helper a build tool writes into the bundle, such as
// "\0vite/preload-helper.js" or "\0rolldown/runtime.js": that code belongs to the
// package it is named after, found in node_modules at or above `root`. The app's own
// files, and helpers that don't name an installed package, belong to nobody.
export function bundledPackages(moduleIds, { root = process.cwd() } = {}) {
  const dirs = new Set();
  for (const id of moduleIds) {
    const dir = packageDir(id, root);
    if (dir) dirs.add(dir);
  }
  const found = new Map();
  for (const dir of dirs) {
    const p = readPackage(dir);
    found.set(`${p.name}@${p.version}`, p);
  }
  return [...found.values()].sort((a, b) => compare(a.name, b.name) || compare(a.version, b.version));
}

const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const PACKAGE_NAME = /^(?:@[\w.-]+\/)?[\w.-]+$/;
// "react" from ["react", "cjs", ...], "@scope/name" from ["@scope", "name", ...].
const nameFrom = (parts) => (parts[0].startsWith('@') ? parts.slice(0, 2) : parts.slice(0, 1)).join('/');

function packageDir(id, root) {
  // Plugins mark ids of their own with a leading \0, some of them a package's file
  // ("\0/…/node_modules/react/index.js?commonjs-proxy"), and add queries.
  const virtual = id.startsWith('\0');
  const file = (virtual ? id.slice(1) : id).split('?')[0].replaceAll('\\', '/');
  const at = file.lastIndexOf('/node_modules/');
  if (at !== -1) {
    const name = nameFrom(file.slice(at + '/node_modules/'.length).split('/'));
    return PACKAGE_NAME.test(name) ? `${file.slice(0, at)}/node_modules/${name}` : null;
  }
  if (!virtual) return null;
  const parts = file.split('/');
  const name = nameFrom(parts);
  // A file inside the package, not just a name.
  if (parts.length <= name.split('/').length || !PACKAGE_NAME.test(name)) return null;
  for (let dir = path.resolve(root); ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, 'node_modules', name);
    if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate;
    if (path.dirname(dir) === dir) return null;
  }
}

// LICENSE, LICENCE.md, COPYING, LICENSE-MIT and the like, then any NOTICE (Apache 2.0
// asks for that to be passed on too). Files only, and not code that shares the name.
// THIRD-PARTY-LICENSE too: Rolldown's holds the licences of the code its own is
// derived from (Rollup's and esbuild's), and its LICENSE points to it.
const LICENCE_FILE = /^(?:third-party-)?(?:licen[cs]e|copying)(?:[.\-_][\w.-]*)?$/i;
const NOTICE_FILE = /^notice(?:[.\-_][\w.-]*)?$/i;
const CODE = /\.(?:[cm]?js|ts|json|map)$/i;

// Apache 2.0 asks for a copy of the licence itself to go with the code, but a package
// often ships only the short notice that points to it (hls.js does). Then the file
// adds the licence, from web/licences/ (web/ is what the image's build stage copies).
const APACHE = /\bApache-2\.0\b/;
const APACHE_TERMS = 'TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION';
const LICENCES_DIR = new URL('./web/licences/', import.meta.url);
const APACHE_TEXT = new URL('Apache-2.0.txt', LICENCES_DIR);

// Line endings made \n, and the blank lines around the text dropped (not the first
// line's indent: the Apache licence centres its title with spaces).
const tidy = (text) => text.replace(/\r\n?/g, '\n').replace(/^(?:[ \t]*\n)+/, '').trimEnd();

function readPackage(dir) {
  const json = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const files = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && !CODE.test(e.name))
    .map((e) => e.name)
    .sort(compare);
  const texts = [...files.filter((f) => LICENCE_FILE.test(f)), ...files.filter((f) => NOTICE_FILE.test(f))].map((file) => ({
    title: file,
    text: tidy(fs.readFileSync(path.join(dir, file), 'utf8')),
  }));
  const licence = licenceId(json);
  const p = { name: json.name || path.basename(dir), version: json.version || 'unknown', licence, texts: withApache(texts, licence) };
  if (VENDORED[p.name]) p.includes = included(p, { ...json.dependencies, ...json.devDependencies });
  return p;
}

function withApache(texts, licence) {
  if (!APACHE.test(licence ?? '') || texts.some((t) => t.text.includes(APACHE_TERMS))) return texts;
  const title = texts.length ? "The Apache License 2.0, which the package's licence refers to but doesn't include" : 'The Apache License 2.0';
  return [...texts, { title, text: tidy(fs.readFileSync(APACHE_TEXT, 'utf8')), added: true }];
}

// The packages inside `host`, at the versions its package.json gives. Where the host's
// own texts have the Apache License 2.0 in full, theirs point to it, rather than
// repeating it.
function included(host, declared) {
  const hostHasApache = host.texts.some((t) => t.text.includes(APACHE_TERMS));
  return VENDORED[host.name].map(({ name, licence, file }) => {
    const text = tidy(fs.readFileSync(new URL(file, LICENCES_DIR), 'utf8'));
    const texts =
      APACHE.test(licence) && hostHasApache
        ? [{ title: file, text: `${text}\n\nThe Apache License 2.0 itself is given in full under ${host.name} ${host.version}, above.` }]
        : withApache([{ title: file, text }], licence);
    return { name, version: declared[name] ?? 'unknown', licence, texts, inside: `${host.name} ${host.version}` };
  });
}

// package.json's "license", or the older "license": { type } and "licenses": [{ type }].
function licenceId(json) {
  const one = (l) => (typeof l === 'string' ? l.trim() : l?.type?.trim()) || null;
  if (json.license) return one(json.license);
  const all = Array.isArray(json.licenses) ? json.licenses.map(one).filter(Boolean) : [];
  return all.length ? all.join(' OR ') : null;
}

// ------------------------------------------------------------ fonts
// The membership card's fonts, served unchanged from web/public/fonts (they are in
// public/, so no module imports them and the bundle can't list them). Each is under
// the SIL Open Font License 1.1, not the GPL, and its licence, copyright line first,
// is kept beside it as <family>-OFL.txt, which the licences file repeats in full.
export const FONTS = [
  { name: 'Fraunces', file: 'Fraunces-Variable.ttf', licenceFile: 'Fraunces-OFL.txt', use: "the shop's name and \"Membership card\", on the front" },
  { name: 'Grape Nuts', file: 'GrapeNuts-Regular.ttf', licenceFile: 'GrapeNuts-OFL.txt', use: "the member's name, written on the back" },
  { name: 'Courier Prime', file: 'CourierPrime-Regular.ttf', licenceFile: 'CourierPrime-OFL.txt', use: 'the typed month and year, and the membership number' },
];
const FONTS_DIR = new URL('./web/public/fonts/', import.meta.url);

// FONTS with each licence's text: [{ name, file, use, licence, text }].
export function shippedFonts(dir = FONTS_DIR) {
  return FONTS.map(({ name, file, licenceFile, use }) => ({ name, file, use, licence: 'OFL-1.1', text: tidy(fs.readFileSync(new URL(licenceFile, dir), 'utf8')) }));
}

const RULE = '='.repeat(80);

// Open Matte's own copyright notice. The GPL asks for one on every copy, and the app
// sent to browsers is a copy too. The owner confirmed it.
const COPYRIGHT = 'Copyright (C) 2026 Arthur Clack';

// The build tools that write a little of their own code into the bundle (see
// bundledPackages) are listed like any other package, but almost none of either is in
// the app, and Vite's licence file is mostly the licences of packages bundled inside
// Vite for its own use. Without a note, the file would seem to say those are in the
// app. What each note says was checked against a build of Vite 8.3 with Rolldown 1.2:
// of Vite, the bundle has \0vite/preload-helper.js, and of Rolldown, \0rolldown/runtime.js,
// whose helpers wrap React's CommonJS files, and \0vite/modulepreload-polyfill.js. That
// id names Vite, but Vite 8 has Rolldown's own plugin write the code.
const NOTES = {
  vite: [
    'Vite builds the app, and only a small part of it ends up in the app: a little',
    "code that loads the app's files. Its licence file below also covers packages",
    'bundled inside Vite itself, which Vite uses for its own work and which never',
    'reach your browser.',
  ].join('\n'),
  rolldown: [
    'Rolldown is the bundler Vite uses to build the app, and only a small part of it',
    'ends up in the app: a few helpers that let the app use packages written as',
    'CommonJS modules, such as React, and a little code that helps older browsers',
    "load the app's files.",
  ].join('\n'),
};

// The file itself: Open Matte's own copyright, licence and where its source is
// (`source`, a URL or null), the packages in a list, then each package's licence. A
// package carried inside another is listed, and given, after it. The last line says
// the file ends there, so a copy cut short shows it. `fonts` (shippedFonts) are named
// after the TMDB logo and given in full after the packages.
export function licenceNotices(packages, { source = null, fonts = [] } = {}) {
  const out = [
    'Licences',
    '',
    'The web app this site sends to your browser is Open Matte.',
    COPYRIGHT,
    '',
    'It is free software: you can copy, change and share it under the GNU General',
    'Public License, version 3 or (at your option) any later version:',
    'https://www.gnu.org/licenses/gpl-3.0.html',
    '',
    source ? `Its source code is at ${source}` : "This copy doesn't say where its source code is: ask whoever runs this site.",
    '',
    // The one file in the build that isn't free software (web/public/tmdb.svg).
    "The TMDB logo (tmdb.svg) is a trademark of TMDB and isn't covered by the GPL.",
    '',
    ...(fonts.length ? [...fontsParagraph(fonts), ''] : []),
    'The app also includes code from the open-source packages below. Their licences',
    'ask for the licence text to go with every copy of the code, so each one appears',
    'here as the package ships it, followed by the licence in full where a package',
    'only points to it. This list is made when the app is built, from the packages',
    'that ended up in it.',
    '',
  ];
  if (!packages.length) out.push('This build includes no third-party packages.');
  for (const p of packages) {
    out.push(`  ${p.name} ${p.version} (${p.licence ?? 'licence not stated'})${p.includes?.length ? ', which includes:' : ''}`);
    for (const i of p.includes ?? []) out.push(`    ${i.name} ${i.version} (${i.licence})`);
  }
  for (const p of packages.flatMap((p) => [p, ...(p.includes ?? [])])) {
    const heading = p.inside ? `${p.name} ${p.version}, inside ${p.inside}` : `${p.name} ${p.version}`;
    out.push('', RULE, heading, `Licence: ${p.licence ?? 'not stated'}`, RULE, '');
    // Its own notes only: NOTES[p.name] alone would also find what every object
    // inherits, for a package called constructor, say.
    const note = !p.inside && Object.hasOwn(NOTES, p.name) ? NOTES[p.name] : null;
    if (note) out.push(note, '');
    if (!p.texts.some((t) => !t.added)) {
      out.push(
        p.licence
          ? `The licence text wasn't found: the package has no licence file. Its package.json gives the licence as ${p.licence}.`
          : "The licence text wasn't found: the package has no licence file, and its package.json names no licence.",
        ...(p.texts.length ? [''] : []),
      );
    }
    // More than one text (a licence and a notice, two licences, or one added here) says
    // which is which, and so does a text after a note, so the note isn't read as part of it.
    const titled = p.texts.length > 1 || p.texts.some((t) => t.added) || Boolean(note);
    // A package's one licence file is called that. Two or more keep their names, which
    // tell them apart (LICENSE-MIT, LICENSE-APACHE), and so does a NOTICE, the name the
    // Apache License gives it.
    const licenceFiles = p.texts.filter((t) => !t.added && LICENCE_FILE.test(t.title));
    p.texts.forEach((t, i) => {
      const label = licenceFiles.length === 1 && t === licenceFiles[0] ? 'Licence file' : t.title;
      if (titled) out.push(...(i ? [''] : []), `--- ${label} ---`, '');
      out.push(t.text);
    });
  }
  for (const f of fonts) {
    out.push('', RULE, `${f.name} (fonts/${f.file}), a font`, `Licence: ${f.licence}`, RULE, '');
    out.push(...wrap(`Used for ${f.use} of the membership card. A font made by others, sent unchanged: it is under the SIL Open Font License, not the GPL.`), '');
    out.push(f.text);
  }
  out.push('', RULE, 'End of licences');
  return `${out.join('\n')}\n`;
}

// "The membership card is printed in fonts made by others: Fraunces, Grape Nuts and
// Courier Prime, ...".
function fontsParagraph(fonts) {
  const names = fonts.map((f) => f.name);
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0];
  return wrap(
    `The membership card is printed in ${fonts.length === 1 ? 'a font' : 'fonts'} made by others: ${list}, in fonts/. ` +
      `${fonts.length === 1 ? 'It is' : 'They are'} under the SIL Open Font License, version 1.1, not the GPL, and ` +
      `${fonts.length === 1 ? 'its licence is' : 'their licences are'} given in full at the end of this file.`,
  );
}

// Lines of at most 80 characters, like the rest of the file.
function wrap(text) {
  const lines = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (line && line.length + 1 + word.length > 80) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  return [...lines, line];
}
