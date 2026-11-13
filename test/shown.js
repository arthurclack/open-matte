// What a screen shows, read from its source for the word scans (test/office.test.js for
// the back office, test/friend-words.test.js for the friend's pages): the text in its
// JSX and its sentences in quotes, with comments, addresses (/api/admin/tickets), class
// lists and code left out. Not a parser: it reads the way this codebase writes JSX.
//
// JSX text may hold {…} expressions ("While this link has the tape out it can't change
// hands{person ? '' : ', and …'}: a tape never moves…"): those are read round, up to
// three deep, and the quoted words inside them are read as sentences of their own. (The
// first scan, in slice 9, skipped any run of text with a brace in it, so a 1.x word
// beside an expression went unseen: the review of slices 7 to 9 found it.)

// A {…} expression with no tag inside, up to three deep.
const BRACES = String.raw`\{(?:[^{}<>]|\{(?:[^{}<>]|\{[^{}<>]*\})*\})*\}`;
// Text between a tag's end and the next tag, or the next expression with a tag in it
// ({list.map((t) => <li>…)}): not after => or ->, and no ; or = outside braces, which
// is code.
const RUN = new RegExp(String.raw`(?<![=-])>((?:[^<>{};=]|${BRACES})*[A-Za-z](?:[^<>{};=]|${BRACES})*)(?=[<{])`, 'g');
const BRACE = new RegExp(BRACES, 'g');
const SPLIT = new RegExp(`(${BRACES})`);

export function withoutComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

export function shown(src) {
  const code = withoutComments(src);
  const out = [];
  for (const [, run] of code.matchAll(RUN)) {
    const text = run.replace(BRACE, ' ').replace(/\s+/g, ' ').trim();
    if (/[A-Za-z]/.test(text)) out.push(text);
  }
  // An apostrophe in JSX text ("doesn't") isn't a quote: blanked, so it can't pair with
  // one further on and read code as words. The quotes inside braces are kept.
  const quoted = code.replace(RUN, (m, run) => m.replace(run, () => run.split(SPLIT).map((part, i) => (i % 2 ? part : part.replace(/['"`]/g, '’'))).join('')));
  // Sentences in quotes: two words or more, and not an address or a class list.
  for (const [, , text] of quoted.matchAll(/(['"`])((?:\\.|(?!\1).)*?)\1/g)) {
    const words = text.replace(/\$\{[^}]*\}/g, ' ');
    if (!/[A-Za-z]+ [A-Za-z]/.test(words) || /^\//.test(text) || /^[a-z0-9 _-]+--?[a-z]/.test(text) || /^(ui|of|fl|ob|crt|osd)-/.test(text)) continue;
    out.push(words.trim());
  }
  return out;
}
