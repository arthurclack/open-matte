// Licence notices and the version: milestone 3, slice 6. Written from
// docs/history/milestone-3.md. The build collects the licence of every package whose
// code ends up in the bundle into dist/third-party-licenses.txt (vite.config.js), the
// server sends it as plain text, and the viewer's footer and the admin's Settings link
// to it. The file starts with Open Matte's own copyright, licence and where its source
// is, and ends with a line saying it ends there. Packages that carry others inside
// their published code (hls.js) have those listed too. Vite and Rolldown, of which only
// a few helpers are in the bundle, have a note saying so, and a THIRD-PARTY-LICENSE
// beside a LICENSE, as Rolldown has, goes in too. The admin's Settings show
// package.json's version; viewers are told nothing new.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { adminBrowser, browser, startServer, tempDir } from './helpers.js';

// The web source and its build config aren't in the server's image, where
// docs/deploying.md runs the tests on the server's own Node, and Vite isn't installed
// there: these are skipped, not failed. Importing the config builds nothing.
const CONFIG = new URL('../vite.config.js', import.meta.url);
const WEB = new URL('../web/src/', import.meta.url);
let build = {};
let skip = false;
if (!fs.existsSync(CONFIG) || !fs.existsSync(WEB)) skip = 'web/ and vite.config.js are not here (the server image has neither)';
else {
  try {
    build = await import(CONFIG);
  } catch (err) {
    if (err.code !== 'ERR_MODULE_NOT_FOUND') throw err;
    skip = `Vite isn't installed (${err.message})`;
  }
}
const { FONTS, LICENCES_FILE, VENDORED, bundledPackages, licenceNotices, shippedFonts, sourceUrl, thirdPartyLicenses } = build;

const PKG = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const APACHE_TERMS = 'TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION';
const MIT = (who) => `MIT License\n\nCopyright (c) ${who}\n\nPermission is hereby granted, free of charge, ...`;
const APACHE_NOTICE = 'Copyright (c) Epsilon\n\nLicensed under the Apache License, Version 2.0 (the "License");\nhttp://www.apache.org/licenses/LICENSE-2.0';
// The build's warning while package.json names no repository; the other warnings are about packages.
const NO_REPOSITORY = /^package\.json has no repository/;
const aboutPackages = (warnings) => warnings.filter((w) => !NO_REPOSITORY.test(w));
// The file's last lines, whatever it holds.
const END = `\n\n${'='.repeat(80)}\nEnd of licences\n`;

// A project with packages in node_modules, as npm lays them out. A null file is a folder.
function writePackage(dir, json, files = {}) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(json));
  for (const [name, content] of Object.entries(files)) {
    if (content === null) fs.mkdirSync(path.join(dir, name));
    else fs.writeFileSync(path.join(dir, name), content);
  }
}

const HLS_CARRIES = {
  '@svta/cml-cmcd': '2.4.0',
  '@svta/cml-id3': '1.0.6',
  '@svta/cml-structured-field-values': '1.1.3',
  '@svta/cml-utils': '1.5.0',
  eventemitter3: '5.0.4',
  'url-toolkit': '2.2.5',
};
const project = tempDir();
const nm = path.join(project, 'node_modules');
const root = path.join(project, 'web'); // Vite's root, as in vite.config.js

if (!skip) {
  writePackage(nm + '/alpha', { name: 'alpha', version: '1.2.3', license: 'MIT' }, { LICENSE: MIT('Alpha'), 'README.md': '# alpha' });
  // The older form of the field, a British file name and Windows line endings.
  writePackage(nm + '/@scope/beta', { name: '@scope/beta', version: '2.0.0', license: { type: 'BSD-3-Clause' } }, { 'LICENCE.md': 'Copyright Beta\r\nAll rights reserved.\r\n' });
  // No licence file: a folder and a script that share the name don't count.
  writePackage(nm + '/gamma', { name: 'gamma', version: '0.1.0', license: 'ISC' }, { licenses: null, 'license-check.json': '{}', 'index.js': '' });
  // Nested in alpha, under two licences, each in a file of its own.
  writePackage(
    nm + '/alpha/node_modules/delta',
    { name: 'delta', version: '4.0.0', licenses: [{ type: 'MIT' }, { type: 'Apache-2.0' }] },
    { 'LICENSE-MIT': MIT('Delta'), 'LICENSE-APACHE': 'Licensed under the Apache License, Version 2.0.' },
  );
  // Apache 2.0 with only the short notice, and a NOTICE file: the licence is added.
  writePackage(nm + '/epsilon', { name: 'epsilon', version: '1.0.0', license: 'Apache-2.0' }, { LICENSE: APACHE_NOTICE, NOTICE: 'Epsilon includes software from Somebody.' });
  // Apache 2.0 that ships the licence itself: nothing is added.
  writePackage(nm + '/zeta', { name: 'zeta', version: '3.1.4', license: 'Apache-2.0' }, { LICENSE: `Apache License\nVersion 2.0, January 2004\n\n${APACHE_TERMS}\n...` });
  // A build tool whose helper the bundle carries ("\0tool/runtime.js").
  writePackage(nm + '/tool', { name: 'tool', version: '9.9.9', license: 'MIT' }, { LICENSE: MIT('Tool') });
  // Installed, but nothing of it is in the bundle.
  writePackage(nm + '/unused', { name: 'unused', version: '1.0.0', license: 'MIT' }, { LICENSE: MIT('Unused') });
  // A LICENSE that points to a THIRD-PARTY-LICENSE, with the licences of the code its
  // own is derived from, as Rolldown's does. Not in IDS: its own test bundles it.
  writePackage(
    nm + '/eta',
    { name: 'eta', version: '2.1.0', license: 'MIT' },
    { LICENSE: `${MIT('Eta')}\n\nThe licenses of the code this is derived from are in THIRD-PARTY-LICENSE.`, 'THIRD-PARTY-LICENSE': `${MIT('Rollup')}\n\n---\n\n${MIT('2020 Evan Wallace')}`, 'README.md': '# eta' },
  );
  // A package that carries others in its own code, as hls.js does, listing them as its
  // package.json does (with a devDependency that isn't carried, too).
  writePackage(
    nm + '/hls.js',
    { name: 'hls.js', version: '1.7.3', license: 'Apache-2.0', devDependencies: { ...HLS_CARRIES, mocha: '11.8.0' } },
    { LICENSE: 'Copyright (c) 2017 Dailymotion\n\nLicensed under the Apache License, Version 2.0 (the "License");' },
  );
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
}

// What a bundle's chunks list: the app's own files, files in packages (with the
// queries plugins add), and helpers the build tools write in.
const IDS = [
  `${root}/index.html`,
  `${root}/src/main.jsx`,
  `${nm}/alpha/index.js`,
  `${nm}/alpha/lib/util.js?commonjs-es-import`,
  `\0${nm}/alpha/index.js?commonjs-proxy`,
  `${nm}/@scope/beta/dist/beta.mjs`,
  `${nm}/gamma/index.js`,
  `${nm}/alpha/node_modules/delta/index.js`,
  `${nm}/epsilon/dist/epsilon.mjs`,
  `${nm}/zeta/zeta.js`,
  '\0tool/runtime.js',
  '\0tool', // a name alone, not a file in it
  '\0commonjsHelpers.js',
  '\0missing/helper.js', // names nothing installed
];

describe('which packages are in the bundle', { skip }, () => {
  test('every package a module id is in, once, by name; nothing else', () => {
    const packages = bundledPackages(IDS, { root });
    assert.deepEqual(
      packages.map((p) => `${p.name} ${p.version} ${p.licence}`),
      ['@scope/beta 2.0.0 BSD-3-Clause', 'alpha 1.2.3 MIT', 'delta 4.0.0 MIT OR Apache-2.0', 'epsilon 1.0.0 Apache-2.0', 'gamma 0.1.0 ISC', 'tool 9.9.9 MIT', 'zeta 3.1.4 Apache-2.0'],
    );
  });

  test('no ids, or only the app’s own, is no packages', () => {
    assert.deepEqual(bundledPackages([], { root }), []);
    assert.deepEqual(bundledPackages([`${root}/src/main.jsx`, '\0commonjsHelpers.js'], { root }), []);
  });

  test('each package’s licence files, as it ships them', () => {
    const by = Object.fromEntries(bundledPackages(IDS, { root }).map((p) => [p.name, p]));
    const titles = (name) => by[name].texts.map((t) => (t.added ? 'added' : t.title));
    assert.deepEqual(by.alpha.texts, [{ title: 'LICENSE', text: MIT('Alpha') }]);
    assert.deepEqual(by['@scope/beta'].texts, [{ title: 'LICENCE.md', text: 'Copyright Beta\nAll rights reserved.' }]);
    assert.deepEqual(by.gamma.texts, []);
    assert.deepEqual(titles('delta'), ['LICENSE-APACHE', 'LICENSE-MIT', 'added']);
    assert.deepEqual(titles('epsilon'), ['LICENSE', 'NOTICE', 'added']);
    assert.deepEqual(titles('zeta'), ['LICENSE']);
  });

  test('Apache 2.0 that only points to its licence gets the licence in full', () => {
    const epsilon = bundledPackages(IDS, { root }).find((p) => p.name === 'epsilon');
    const added = epsilon.texts.at(-1);
    assert.equal(added.added, true);
    assert.match(added.text, /^ +Apache License\n +Version 2\.0, January 2004\n/);
    assert.ok(added.text.includes(APACHE_TERMS));
    assert.ok(added.text.includes('END OF TERMS AND CONDITIONS'));
  });
});

describe('the build writes the file', { skip }, () => {
  function run(bundle) {
    const emitted = [];
    const warnings = [];
    const ctx = { environment: { config: { root } }, emitFile: (f) => emitted.push(f), warn: (m) => warnings.push(m) };
    const plugin = thirdPartyLicenses();
    plugin.generateBundle.call(ctx, {}, bundle);
    return { plugin, emitted, warnings };
  }
  const bundle = {
    'assets/index-abc.js': { type: 'chunk', moduleIds: IDS.slice(0, 7) },
    'assets/Player-def.js': { type: 'chunk', moduleIds: IDS.slice(7) },
    'assets/index-abc.css': { type: 'asset', source: ':root{}' },
  };

  test('only when building, as dist/third-party-licenses.txt', () => {
    const { plugin, emitted } = run(bundle);
    assert.equal(plugin.apply, 'build');
    assert.equal(LICENCES_FILE, 'third-party-licenses.txt');
    assert.equal(emitted.length, 1);
    assert.equal(emitted[0].type, 'asset');
    assert.equal(emitted[0].fileName, 'third-party-licenses.txt');
  });

  test('says what it is, lists the packages, then gives each one’s licence, by name', () => {
    const text = run(bundle).emitted[0].source;
    assert.match(text, /^Licences\n\nThe web app this site sends to your browser is Open Matte\.\n/);
    assert.match(text, /\n\nThe app also includes code from the open-source packages below\./);
    const list = ['@scope/beta 2.0.0 (BSD-3-Clause)', 'alpha 1.2.3 (MIT)', 'delta 4.0.0 (MIT OR Apache-2.0)', 'epsilon 1.0.0 (Apache-2.0)', 'gamma 0.1.0 (ISC)', 'tool 9.9.9 (MIT)', 'zeta 3.1.4 (Apache-2.0)'];
    assert.ok(text.includes(list.map((l) => `  ${l}`).join('\n')), 'the list');
    const headings = [...text.matchAll(/^={80}\n(.+)\nLicence: (.+)\n={80}$/gm)].map((m) => `${m[1]} (${m[2]})`);
    // Then the fonts.
    assert.deepEqual(headings, [...list, ...FONTS.map((f) => `${f.name} (fonts/${f.file}), a font (OFL-1.1)`)]);
    assert.ok(text.includes(MIT('Alpha')) && text.includes(MIT('Delta')) && text.includes(MIT('Tool')));
    assert.ok(text.includes('Epsilon includes software from Somebody.'), 'a NOTICE is passed on');
    assert.doesNotMatch(text, /unused|Unused|missing|commonjsHelpers/);
    assert.ok(text.endsWith('\n') && !text.endsWith('\n\n'));
  });

  test('it ends with a line saying so, after the last licence', () => {
    const text = run(bundle).emitted[0].source;
    const fonts = text.indexOf(`\n${'='.repeat(80)}\n${FONTS[0].name} (fonts/`);
    assert.ok(text.slice(0, fonts).endsWith(`Apache License\nVersion 2.0, January 2004\n\n${APACHE_TERMS}\n...\n`), 'zeta, the last package, then the fonts');
    const last = shippedFonts().at(-1);
    assert.ok(text.endsWith(`${last.text}${END}`), 'the last font’s licence, then the end');
    assert.equal(text.split('End of licences').length, 2, 'once');
  });

  test('a package with more than one text says which is which', () => {
    const text = run(bundle).emitted[0].source;
    const epsilon = text.slice(text.indexOf('\nepsilon 1.0.0\n'), text.indexOf('\ngamma 0.1.0\n'));
    assert.match(epsilon, /--- Licence file ---\n\nCopyright \(c\) Epsilon/);
    assert.match(epsilon, /--- NOTICE ---\n\nEpsilon includes/);
    assert.match(epsilon, /--- The Apache License 2\.0, which the package's licence refers to but doesn't include ---\n\n +Apache License/);
    // Two licence files keep their names, which tell them apart.
    const delta = text.slice(text.indexOf('\ndelta 4.0.0\n'), text.indexOf('\nepsilon 1.0.0\n'));
    assert.match(delta, /--- LICENSE-APACHE ---\n\nLicensed under the Apache License/);
    assert.match(delta, /--- LICENSE-MIT ---\n\nMIT License/);
    assert.doesNotMatch(text, /^--- LICEN[CS]E(?:\.\w+)? ---$/m, 'a lone licence file is called that, not by its name');
    const alpha = text.slice(text.indexOf('\nalpha 1.2.3\n'), text.indexOf('\ndelta 4.0.0\n'));
    assert.doesNotMatch(alpha, /^---/m, 'one text needs no title');
  });

  test('a THIRD-PARTY-LICENSE goes in after the LICENSE, each under its name', () => {
    const packages = bundledPackages([`${nm}/eta/dist/eta.mjs`], { root });
    assert.deepEqual(packages[0].texts.map((t) => t.title), ['LICENSE', 'THIRD-PARTY-LICENSE']);
    const text = licenceNotices(packages);
    assert.ok(
      text.includes(`\neta 2.1.0\nLicence: MIT\n${'='.repeat(80)}\n\n--- LICENSE ---\n\n${MIT('Eta')}\n\nThe licenses of the code this is derived from are in THIRD-PARTY-LICENSE.\n\n--- THIRD-PARTY-LICENSE ---\n\n${MIT('Rollup')}\n\n---\n\n${MIT('2020 Evan Wallace')}${END}`),
      'both texts, in full, by name',
    );
    assert.doesNotMatch(text, /--- Licence file ---|# eta/);
  });

  test('a package with no licence file is named with its licence, says so, and the build warns', () => {
    const { emitted, warnings } = run(bundle);
    const text = emitted[0].source;
    const gamma = text.slice(text.indexOf('\ngamma 0.1.0\n'), text.indexOf('\ntool 9.9.9\n'));
    assert.match(gamma, /Licence: ISC/);
    assert.match(gamma, /The licence text wasn't found: the package has no licence file\. Its package\.json gives the licence as ISC\./);
    assert.equal(aboutPackages(warnings).length, 1);
    assert.match(aboutPackages(warnings)[0], /^gamma 0\.1\.0 has no licence file/);
  });

  test('a bundle with no packages still gets the file, saying so', () => {
    const { emitted, warnings } = run({ 'assets/index.js': { type: 'chunk', moduleIds: [`${root}/src/main.jsx`] } });
    assert.ok(emitted[0].source.includes(`\nThis build includes no third-party packages.\n\n${'='.repeat(80)}\n${FONTS[0].name} (fonts/`));
    assert.ok(licenceNotices([]).endsWith(`\nThis build includes no third-party packages.${END}`), 'and with no fonts either, nothing after it');
    assert.deepEqual(aboutPackages(warnings), []);
    assert.equal(licenceNotices([], { source: sourceUrl(PKG), fonts: shippedFonts() }), emitted[0].source);
  });

  // The start, line for line: Open Matte, its copyright, its licence, its source and
  // the TMDB logo, each a paragraph of its own, then the packages.
  const INTRO = (sourceLine) =>
    [
      'Licences',
      '',
      'The web app this site sends to your browser is Open Matte.',
      'Copyright (C) 2026 Arthur Clack',
      '',
      'It is free software: you can copy, change and share it under the GNU General',
      'Public License, version 3 or (at your option) any later version:',
      'https://www.gnu.org/licenses/gpl-3.0.html',
      '',
      sourceLine,
      '',
      "The TMDB logo (tmdb.svg) is a trademark of TMDB and isn't covered by the GPL.",
      '',
      'The app also includes code from the open-source packages below. Their licences',
      'ask for the licence text to go with every copy of the code, so each one appears',
      'here as the package ships it, followed by the licence in full where a package',
      'only points to it. This list is made when the app is built, from the packages',
      'that ended up in it.',
      '',
      '',
    ].join('\n');

  test('it starts with Open Matte’s copyright and licence, and where its source is: package.json’s repository', () => {
    const repository = { type: 'git', url: 'git+https://github.com/arthurclack/open-matte.git' };
    const text = licenceNotices([], { source: sourceUrl({ repository }) });
    assert.ok(text.startsWith(INTRO('Its source code is at https://github.com/arthurclack/open-matte')), 'the start, line for line');
    assert.ok(licenceNotices([]).startsWith(INTRO("This copy doesn't say where its source code is: ask whoever runs this site.")), 'with no source');
    // Without a repository the build says so, every time, until there is one.
    const { emitted, warnings } = run(bundle);
    assert.equal(warnings.some((w) => NO_REPOSITORY.test(w)), !sourceUrl(PKG));
    if (sourceUrl(PKG)) {
      assert.doesNotMatch(sourceUrl(PKG), /^git\+|\.git$/, 'the address a browser opens');
      assert.ok(emitted[0].source.includes(`\nCopyright (C) 2026 Arthur Clack\n\n`));
      assert.ok(emitted[0].source.includes(`\n\nIts source code is at ${sourceUrl(PKG)}\n\n`));
    }
  });

  test('it says the TMDB logo is TMDB’s, and not under the GPL, whatever the build holds', () => {
    for (const source of ['https://example.com/open-matte', null]) {
      assert.match(licenceNotices([], { source }), /\n\nThe TMDB logo \(tmdb\.svg\) is a trademark of TMDB and isn't covered by the GPL\.\n\n/);
    }
  });

  // Vite and Rolldown write a few helpers into the bundle, so they're listed, but Vite's
  // licence file is mostly the licences of the packages Vite bundles for its own use.
  test('Vite and Rolldown each have a note on how little of them is in the app, before their licence file', () => {
    const tool = (name, version, title, text) => ({ name, version, licence: 'MIT', texts: [{ title, text }] });
    const text = licenceNotices([tool('rolldown', '1.2.15', 'LICENSE', MIT('VoidZero')), tool('vite', '8.3.5', 'LICENSE.md', '# Vite core license\nVite is released under the MIT license:')]);
    const section = (name, next) => text.slice(text.indexOf(`\n${name}\n`), next ? text.indexOf(`\n${next}\n`) : text.indexOf(END));
    assert.match(
      section('vite 8.3.5'),
      /^\nvite 8\.3\.5\nLicence: MIT\n={80}\n\nVite builds the app, and only a small part of it ends up in the app: a little\ncode that loads the app's files\. Its licence file below also covers packages\nbundled inside Vite itself, which Vite uses for its own work and which never\nreach your browser\.\n\n--- Licence file ---\n\n# Vite core license\n/,
    );
    assert.match(
      section('rolldown 1.2.15', 'vite 8.3.5'),
      /^\nrolldown 1\.2\.15\nLicence: MIT\n={80}\n\nRolldown is the bundler Vite uses to build the app, and only a small part of it\nends up in the app: a few helpers that let the app use packages written as\nCommonJS modules, such as React, and a little code that helps older browsers\nload the app's files\.\n\n--- Licence file ---\n\nMIT License\n/,
    );
    for (const line of text.split('\n')) assert.ok(line.length <= 80, `a line of 80 characters at most: ${line}`);
    // Every other package has its licence straight after its heading, as before, even
    // one named after something every object inherits.
    for (const name of ['react', 'constructor']) {
      const plain = licenceNotices([tool(name, '19.3.1', 'LICENSE', MIT('Meta'))]);
      assert.ok(plain.includes(`\n${name} 19.3.1\nLicence: MIT\n${'='.repeat(80)}\n\n${MIT('Meta')}${END}`), name);
    }
  });

  // TMDB's terms let its logo be shown only as TMDB made it: not recoloured or
  // distorted. This is the "Alt short" logo TMDB publishes, byte for byte.
  test('the TMDB logo is TMDB’s own file, unchanged', () => {
    const logo = fs.readFileSync(new URL('../web/public/tmdb.svg', import.meta.url));
    assert.equal(crypto.createHash('sha256').update(logo).digest('hex'), '8e7b30f73a4020692ccca9c88bafe5dcb6f8a62a4c6bc55cd9ba82bb2cd95f6c');
  });

  test('a repository in any form package.json allows', () => {
    assert.equal(sourceUrl({ repository: 'git+https://github.com/example/open-matte.git' }), 'https://github.com/example/open-matte');
    assert.equal(sourceUrl({ repository: { type: 'git', url: 'https://git.example.com/me/open-matte.git' } }), 'https://git.example.com/me/open-matte');
    assert.equal(sourceUrl({ repository: 'example/open-matte' }), 'https://github.com/example/open-matte');
    assert.equal(sourceUrl({ repository: 'github:example/open-matte' }), 'https://github.com/example/open-matte');
    assert.equal(sourceUrl({}), null);
    assert.equal(sourceUrl({ repository: ' ' }), null);
  });
});

// hls.js publishes one file with parts of other packages built into it, so their code
// is in the hls chunk without any module id of their own. vite.config.js lists them.
describe('packages carried inside another', { skip }, () => {
  const HLS = [`${nm}/hls.js/dist/hls.mjs`];

  test('come with the package that carries them, at the versions its package.json gives', () => {
    const [hls, ...rest] = bundledPackages(HLS, { root });
    assert.deepEqual(rest, []);
    assert.equal(hls.name, 'hls.js');
    assert.deepEqual(
      hls.includes.map((p) => `${p.name} ${p.version} ${p.licence} (${p.inside})`),
      Object.entries(HLS_CARRIES).map(([name, version]) => `${name} ${version} ${name === 'eventemitter3' ? 'MIT' : 'Apache-2.0'} (hls.js 1.7.3)`),
    );
  });

  test('each with its copyright notice, and the Apache License once', () => {
    const packages = bundledPackages(HLS, { root });
    const by = Object.fromEntries(packages[0].includes.map((p) => [p.name, p.texts.map((t) => t.text).join('\n')]));
    assert.match(by.eventemitter3, /^The MIT License \(MIT\)\n\nCopyright \(c\) 2014 Arnout Kazemier\n\nPermission is hereby granted/);
    assert.match(by['url-toolkit'], /^Copyright 2016 Tom Jenkinson\n\nLicensed under the Apache License, Version 2\.0/);
    for (const name of Object.keys(HLS_CARRIES).filter((n) => n.startsWith('@svta/'))) {
      assert.match(by[name], /^Copyright 2023 Streaming Video Technology Alliance\n\nLicensed under the Apache License, Version 2\.0/, name);
    }

    const text = licenceNotices(packages);
    assert.ok(
      text.includes(['  hls.js 1.7.3 (Apache-2.0), which includes:', ...Object.entries(HLS_CARRIES).map(([n, v]) => `    ${n} ${v} (${n === 'eventemitter3' ? 'MIT' : 'Apache-2.0'})`)].join('\n')),
      'listed under hls.js',
    );
    const headings = [...text.matchAll(/^={80}\n(.+)\nLicence: (.+)\n={80}$/gm)].map((m) => m[1]);
    assert.deepEqual(headings, ['hls.js 1.7.3', ...Object.entries(HLS_CARRIES).map(([n, v]) => `${n} ${v}, inside hls.js 1.7.3`)]);
    assert.equal(text.split(APACHE_TERMS).length, 2, 'the Apache License in full, once');
    assert.equal(text.split('The Apache License 2.0 itself is given in full under hls.js 1.7.3, above.').length, 6, 'the other five point to it');
    assert.ok(text.includes('Copyright (c) 2014 Arnout Kazemier'));
  });

  test('one its package.json no longer lists has no version, and the build warns', () => {
    const other = tempDir();
    const { 'url-toolkit': _, ...fewer } = HLS_CARRIES;
    writePackage(`${other}/node_modules/hls.js`, { name: 'hls.js', version: '1.8.0', license: 'Apache-2.0', devDependencies: fewer }, { LICENSE: 'Licensed under the Apache License, Version 2.0.' });
    const warnings = [];
    const ctx = { environment: { config: { root: `${other}/web` } }, emitFile: () => {}, warn: (m) => warnings.push(m) };
    thirdPartyLicenses().generateBundle.call(ctx, {}, { 'assets/Player.js': { type: 'chunk', moduleIds: [`${other}/node_modules/hls.js/dist/hls.mjs`] } });
    assert.deepEqual(aboutPackages(warnings), [
      "hls.js 1.8.0's package.json doesn't list url-toolkit, which VENDORED in vite.config.js says is inside it: check what it bundles now.",
    ]);
  });

  // The list against the hls.js actually installed: everything its source imports from
  // another package is listed, and its package.json gives each one's version.
  const installed = new URL('../node_modules/hls.js/', import.meta.url);
  const noSource = !fs.existsSync(new URL('src/', installed)) && 'the installed hls.js has no src/ to check';
  test('match what the installed hls.js imports', { skip: noSource }, () => {
    const imported = new Set();
    const src = new URL('src/', installed);
    for (const file of fs.readdirSync(src, { recursive: true }).filter((f) => /\.[cm]?[jt]s$/.test(f))) {
      const code = fs.readFileSync(new URL(file, src), 'utf8');
      // import … from 'x', export … from 'x' and import 'x', at the start of a line.
      for (const [, spec] of code.matchAll(/^\s*(?:(?:import|export)\b[^'"`;]*?\bfrom|import)\s*['"]([^'"]+)['"]/gm)) {
        if (!spec.startsWith('.')) imported.add(spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]);
      }
    }
    const listed = VENDORED['hls.js'].map((p) => p.name);
    for (const name of imported) assert.ok(listed.includes(name), `hls.js imports ${name}, which VENDORED doesn't list`);
    const json = JSON.parse(fs.readFileSync(new URL('package.json', installed), 'utf8'));
    for (const name of listed) assert.ok({ ...json.dependencies, ...json.devDependencies }[name], `hls.js ${json.version}'s package.json doesn't list ${name}`);
  });
});

describe('the links to it', { skip }, () => {
  const source = (file) => fs.readFileSync(new URL(`../web/src/${file}`, import.meta.url), 'utf8');

  test('the viewer’s footer and the admin’s Settings link to the file the build writes', () => {
    for (const file of ['site.jsx', 'admin/Settings.jsx']) {
      assert.ok(source(file).includes(`<a href="/${LICENCES_FILE}">Licences</a>`), file);
    }
  });

  test('the Apache License 2.0 the build adds is the whole licence', () => {
    const text = fs.readFileSync(new URL('../web/licences/Apache-2.0.txt', import.meta.url), 'utf8');
    assert.ok(text.includes(APACHE_TERMS));
    for (let n = 1; n <= 9; n++) assert.match(text, new RegExp(`^ {3}${n}\\. [A-Z]`, 'm'), `section ${n}`);
    assert.ok(text.includes('END OF TERMS AND CONDITIONS'));
  });
});

// The server's side runs everywhere: it serves whatever the build wrote.
// The fonts the app is set and printed in: served as they are from web/public/fonts,
// each with its licence beside it and in the licences file, and declared once.
describe('the fonts', { skip }, () => {
  const FONTS_DIR = new URL('../web/public/fonts/', import.meta.url);
  const FONTS_CSS = 'look/tokens.css';
  // IBM Plex Mono comes in two files, one family.
  const family = (f) => f.name.replace(/ SemiBold$/, '');

  test('each is in web/public/fonts, with its OFL beside it, copyright line first', () => {
    for (const f of FONTS) {
      const font = fs.readFileSync(new URL(f.file, FONTS_DIR));
      // A TrueType file: version 1.0's tag.
      assert.equal(font.readUInt32BE(0), 0x00010000, `${f.file} is a TrueType font`);
      const licence = fs.readFileSync(new URL(f.licenceFile, FONTS_DIR), 'utf8');
      assert.match(licence, /^Copyright (?:© )?\d{4},? .+/, f.licenceFile);
      assert.match(licence, /SIL OPEN FONT LICENSE Version 1\.1/);
    }
    assert.deepEqual(
      FONTS.map((f) => f.name),
      ['Fraunces', 'Grape Nuts', 'Courier Prime', 'Libre Franklin', 'IBM Plex Mono', 'IBM Plex Mono SemiBold', 'VT323'],
    );
    // Names an address can carry as they are.
    for (const f of FONTS) assert.match(f.file, /^[A-Za-z0-9.-]+$/);
    // Every font file served is listed, with its licence: none slips in unlicensed.
    const served = fs.readdirSync(FONTS_DIR).filter((n) => /\.(ttf|otf|woff2?)$/i.test(n)).sort();
    assert.deepEqual(served, FONTS.map((f) => f.file).sort());
  });

  test('the licences file says they are under the OFL, not the GPL, and gives each licence in full', () => {
    const text = licenceNotices([], { source: sourceUrl(PKG), fonts: shippedFonts() });
    const intro = text.slice(0, text.indexOf('The app also includes code'));
    assert.match(
      intro,
      /\n\nThe app is set and printed in fonts made by others: Fraunces, Grape Nuts,\nCourier Prime, Libre Franklin, IBM Plex Mono and VT323, in fonts\/\. They are\nunder the SIL Open Font License, version 1\.1, not the GPL, and their licences\nare given in full at the end of this file\.\n\n$/,
    );
    for (const f of shippedFonts()) {
      const at = text.indexOf(`\n${f.name} (fonts/${f.file}), a font\nLicence: OFL-1.1\n`);
      assert.ok(at > 0, f.name);
      const section = text.slice(at, text.indexOf(`\n${'='.repeat(80)}\n`, at + 100));
      assert.ok(section.replace(/\s+/g, ' ').includes('A font made by others, sent unchanged: it is under the SIL Open Font License, not the GPL.'), f.name);
      assert.ok(section.includes(f.text), `${f.name}'s licence, whole`);
      assert.ok(section.includes(f.text.split('\n')[0]), `${f.name}'s copyright line`);
    }
    // Its own lines: the fonts' licences are given word for word, as their authors
    // wrapped them (IBM Plex Mono's has a line of 93), so they are left out here.
    const own = shippedFonts().reduce((rest, f) => rest.replace(f.text, ''), text);
    assert.ok(own.split('\n').every((line) => line.length <= 80 || /^(Copyright|http)/.test(line) || / {2}/.test(line) || line.includes('github.com')), 'its own lines fit 80 columns');
  });

  test('one stylesheet declares each one, from this site, letting text show while it loads', () => {
    const css = fs.readFileSync(new URL(`../web/src/${FONTS_CSS}`, import.meta.url), 'utf8');
    const faces = [...css.matchAll(/@font-face\s*{([^}]*)}/g)].map((m) => m[1]);
    assert.equal(faces.length, FONTS.length);
    for (const f of FONTS) {
      const face = faces.find((x) => x.includes(`url('/fonts/${f.file}')`));
      assert.ok(face, f.name);
      assert.ok(face.includes(`font-family: '${family(f)}'`), `${f.name} is ${family(f)}`);
      assert.match(face, new RegExp(`src: url\\('/fonts/${f.file.replace('.', '\\.')}'\\) format\\('truetype'\\);`));
      assert.match(face, /font-display: swap;/);
    }
    // Only that stylesheet: nothing else in the app asks for them.
    for (const file of fs.readdirSync(new URL('../web/src/', import.meta.url), { recursive: true })) {
      if (!/\.(css|jsx?)$/.test(file) || file === FONTS_CSS) continue;
      assert.doesNotMatch(fs.readFileSync(new URL(`../web/src/${file}`, import.meta.url), 'utf8'), /@font-face|\/fonts\//, file);
    }
  });
});

describe('serving it, and the version', () => {
  const NOTICES = 'Third-party licences\n\nThe web app this site sends to your browser includes code ...\n';
  let srv;
  before(async () => {
    const webDist = tempDir();
    fs.writeFileSync(path.join(webDist, 'index.html'), '<!doctype html><html><head><title>app</title></head><body></body></html>');
    fs.writeFileSync(path.join(webDist, 'third-party-licenses.txt'), NOTICES);
    srv = await startServer({ mediaDir: tempDir(), webDist, limits: { scale: 100 } });
  });
  after(() => srv?.close());

  test('/third-party-licenses.txt is the file, as plain text, not the app', async () => {
    const res = await fetch(`${srv.base}/third-party-licenses.txt`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /^text\/plain; charset=utf-8$/i);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(await res.text(), NOTICES);
  });

  test('the admin’s Settings carry package.json’s version', async () => {
    const admin = await adminBrowser(srv.base);
    const r = await admin.get('/api/admin/settings');
    assert.equal(r.status, 200);
    assert.equal(r.data.version, PKG.version);
    // Saving answers with the same, so the page keeps showing it.
    const saved = await admin.patch('/api/admin/settings', { cinemaName: 'Open Matte' });
    assert.equal(saved.data.version, PKG.version);
  });

  test('viewers are not told the version', async () => {
    const viewer = browser(srv.base);
    const site = await viewer.get('/api/site');
    assert.equal(site.status, 200);
    assert.ok(!('version' in site.data));
    const me = await viewer.get('/api/me');
    assert.ok(!('version' in me.data) && !('version' in (me.data.site ?? {})));
    assert.equal((await viewer.get('/api/admin/settings')).status, 401);
    const page = await viewer.get('/');
    assert.match(page.data, /id="site-data"/);
    assert.doesNotMatch(page.data, /"version"/, 'the page names no version');
  });
});
