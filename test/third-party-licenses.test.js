// Licence notices and the version: milestone 3, slice 6. Written from docs/milestone-3.md.
// The build collects the licence of every package whose code ends up in the bundle into
// dist/third-party-licenses.txt (vite.config.js), the server sends it as plain text, and
// the viewer's footer and the admin's Settings link to it. The file starts with Open
// Matte's own licence and where its source is. Packages that carry others inside their
// published code (hls.js) have those listed too. The admin's Settings show
// package.json's version; viewers are told nothing new.
import assert from 'node:assert/strict';
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
const { LICENCES_FILE, VENDORED, bundledPackages, licenceNotices, sourceUrl, thirdPartyLicenses } = build;

const PKG = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const APACHE_TERMS = 'TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION';
const MIT = (who) => `MIT License\n\nCopyright (c) ${who}\n\nPermission is hereby granted, free of charge, ...`;
const APACHE_NOTICE = 'Copyright (c) Epsilon\n\nLicensed under the Apache License, Version 2.0 (the "License");\nhttp://www.apache.org/licenses/LICENSE-2.0';
// The build's warning while package.json names no repository; the other warnings are about packages.
const NO_REPOSITORY = /^package\.json has no repository/;
const aboutPackages = (warnings) => warnings.filter((w) => !NO_REPOSITORY.test(w));

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
    assert.match(text, /^Licences\n\nThe web app this site sends to your browser is Open Matte\./);
    assert.match(text, /\n\nIt also includes code from the open-source packages below\./);
    const list = ['@scope/beta 2.0.0 (BSD-3-Clause)', 'alpha 1.2.3 (MIT)', 'delta 4.0.0 (MIT OR Apache-2.0)', 'epsilon 1.0.0 (Apache-2.0)', 'gamma 0.1.0 (ISC)', 'tool 9.9.9 (MIT)', 'zeta 3.1.4 (Apache-2.0)'];
    assert.ok(text.includes(list.map((l) => `  ${l}`).join('\n')), 'the list');
    const headings = [...text.matchAll(/^={80}\n(.+)\nLicence: (.+)\n={80}$/gm)].map((m) => `${m[1]} (${m[2]})`);
    assert.deepEqual(headings, list);
    assert.ok(text.includes(MIT('Alpha')) && text.includes(MIT('Delta')) && text.includes(MIT('Tool')));
    assert.ok(text.includes('Epsilon includes software from Somebody.'), 'a NOTICE is passed on');
    assert.doesNotMatch(text, /unused|Unused|missing|commonjsHelpers/);
    assert.ok(text.endsWith('\n') && !text.endsWith('\n\n'));
  });

  test('a package with more than one text says which is which', () => {
    const text = run(bundle).emitted[0].source;
    const epsilon = text.slice(text.indexOf('\nepsilon 1.0.0\n'), text.indexOf('\ngamma 0.1.0\n'));
    assert.match(epsilon, /--- LICENSE ---\n\nCopyright \(c\) Epsilon/);
    assert.match(epsilon, /--- NOTICE ---\n\nEpsilon includes/);
    assert.match(epsilon, /--- The Apache License 2\.0, which the package's licence refers to but doesn't include ---\n\n +Apache License/);
    const alpha = text.slice(text.indexOf('\nalpha 1.2.3\n'), text.indexOf('\ndelta 4.0.0\n'));
    assert.doesNotMatch(alpha, /^---/m, 'one text needs no title');
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
    assert.match(emitted[0].source, /This build includes no third-party packages\.\n$/);
    assert.deepEqual(aboutPackages(warnings), []);
    assert.equal(licenceNotices([], { source: sourceUrl(PKG) }), emitted[0].source);
  });

  test('it starts with Open Matte’s own licence, and where its source is: package.json’s repository', () => {
    const text = licenceNotices([], { source: 'https://example.com/open-matte' });
    assert.match(text, /^Licences\n\nThe web app this site sends to your browser is Open Matte\. It is free software:\n/);
    assert.match(text, /GNU General Public License, version 3\n\(https:\/\/www\.gnu\.org\/licenses\/gpl-3\.0\.html\)\.\nIts source code is at https:\/\/example\.com\/open-matte\n/);
    assert.match(licenceNotices([]), /\nThis copy doesn't say where its source code is: ask whoever runs this site\.\n/);
    // Without a repository the build says so, every time, until there is one.
    const { emitted, warnings } = run(bundle);
    assert.equal(warnings.some((w) => NO_REPOSITORY.test(w)), !sourceUrl(PKG));
    if (sourceUrl(PKG)) assert.ok(emitted[0].source.includes(`Its source code is at ${sourceUrl(PKG)}\n`));
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
// is in the Player chunk without any module id of their own. vite.config.js lists them.
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
