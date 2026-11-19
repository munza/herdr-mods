"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { build, ROOT } = require("../build.cjs");
const { parse, inline, plain, renderBlock } = require("../markdown.cjs");
const { readDoc, checkSettings, sideNav, SECTIONS } = require("../page.cjs");

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "herdr-site-"));
const navOf = (html) => /<nav class="side"[\s\S]*?<\/nav>/.exec(html)[0];

// A README in the layout site/README.md asks for.
const README = `# Demo

What it does.

## Quick start

1. Install it.

## Install

> Read ~/.config/herdr-app/AGENTS.md, then add this mod: x

## Use

Use it.

## Settings

| Key | Default | What it does |
| --- | --- | --- |
| \`a.b\` | \`15s\` | A. |
| \`on\` | \`true\` | On. |

## Update

Copy it again.

## For developers

Read the code.
`;

test("the site builds, with a page for every mod in site/mods.json", () => {
  const out = tmp();
  try {
    const { site, pages } = build({ out });
    assert.deepEqual(pages.map((p) => p.slug), site.mods.map((m) => m.slug));
    assert.ok(pages.some((p) => p.generated), "at least one page comes from a README");
    for (const p of pages) {
      const html = fs.readFileSync(p.file, "utf8");
      assert.equal(navOf(html), sideNav(site, p.slug), `${p.slug}: sidebar comes from site/mods.json`);
    }
    assert.ok(fs.existsSync(path.join(out, "index.html")) && fs.existsSync(path.join(out, "style.css")));
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test("a generated page keeps every section the hand-written pages had", () => {
  const out = tmp();
  try {
    const { pages } = build({ out });
    for (const p of pages.filter((x) => x.generated)) {
      const html = fs.readFileSync(p.file, "utf8");
      const ids = [...html.matchAll(/<h3 id="([^"]+)"/g)].map((m) => m[1]);
      const want = SECTIONS.map(([, key]) => `${p.slug}-${key}`);
      assert.deepEqual(ids.filter((id) => want.includes(id)), want, `${p.slug}: sections in order`);
      for (const id of ids) assert.ok(html.includes(`<a href="#${id}">`), `${p.slug}: ${id} is in "On this page"`);
      const version = JSON.parse(fs.readFileSync(path.join(ROOT, p.slug, "mods", p.slug, "mod.json"), "utf8")).version;
      assert.ok(html.includes(`Version ${version}`), `${p.slug}: version from mod.json`);
      assert.match(html, /<div class="prompt"><code>Read ~\/\.config\/herdr-app\/AGENTS\.md/, `${p.slug}: install prompt box`);
      assert.doesNotMatch(html, /href="[^"]*README\.md/, `${p.slug}: links to other READMEs point at their pages`);
      for (const [, src] of html.matchAll(/<img src="([^"]+)"/g)) {
        if (!/^https?:/.test(src)) assert.ok(fs.existsSync(path.join(out, "docs", src)), `${p.slug}: ${src} is in the built site`);
      }
    }
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test("the build refuses a committed copy of a generated page", () => {
  const root = tmp();
  try {
    fs.cpSync(path.join(ROOT, "site"), path.join(root, "site"), { recursive: true });
    fs.cpSync(path.join(ROOT, "docs"), path.join(root, "docs"), { recursive: true });
    const site = JSON.parse(fs.readFileSync(path.join(root, "site/mods.json"), "utf8"));
    const slug = site.groups.flatMap((g) => g.mods).find((m) => m.generated).slug;
    fs.writeFileSync(path.join(root, "docs/docs", `${slug}.html`), "<!doctype html>");
    assert.throws(() => build({ root, out: path.join(root, "_site") }), /delete the committed copy/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a README missing a section names it", () => {
  const md = README.replace(/## Update[\s\S]*?(?=## For developers)/, "");
  assert.throws(() => readDoc(md, "demo/README.md"), /missing section "## Update"/);
});

test("sections must come in order", () => {
  const md = README.replace("## Use\n\nUse it.\n\n", "").replace("## For developers", "## Use\n\nUse it.\n\n## For developers");
  assert.throws(() => readDoc(md, "demo/README.md"), /sections go in this order/);
});

test("extra sections and ### subsections are fine", () => {
  const doc = readDoc(README.replace("## Settings", "### Agents\n\nThey group.\n\n## Limits\n\nSome.\n\n## Settings"), "demo/README.md");
  assert.deepEqual(doc.sections.map((s) => s.key), ["start", "install", "use", "limits", "settings", "update", "developers"]);
});

test("the settings table must match mod.schema.json", () => {
  const doc = readDoc(README, "demo/README.md");
  const schema = (props) => ({ properties: { settings: { properties: props } } });
  const ok = { a: { type: "object", properties: { b: { default: "15s" } } }, on: { type: "boolean", default: true } };
  checkSettings(doc, schema(ok), "demo/README.md");
  assert.throws(() => checkSettings(doc, schema({ ...ok, on: { default: false } }), "x"), /on defaults to false in mod.schema.json, true in the table/);
  assert.throws(() => checkSettings(doc, schema({ ...ok, more: { default: 1 } }), "x"), /more is in mod.schema.json but not the table/);
  assert.throws(() => checkSettings(doc, schema({ on: ok.on }), "x"), /a\.b is in the table but not mod.schema.json/);
});

test("inline Markdown", () => {
  assert.equal(inline("a `<b>` **c** *d* _e_ snake_case_name"), "a <code>&lt;b&gt;</code> <b>c</b> <i>d</i> <i>e</i> snake_case_name");
  assert.equal(inline("[x **y**](../a/README.md)", { link: () => "a.html" }), '<a href="a.html">x <b>y</b></a>');
  assert.equal(inline("`tests/*.test.cjs` and `a|b`"), "<code>tests/*.test.cjs</code> and <code>a|b</code>");
  assert.equal(inline("<https://x.dev/>"), '<a href="https://x.dev/">https://x.dev/</a>');
});

test("block Markdown", () => {
  const blocks = parse("- one\n- two\n  more\n\n- three\n\n| A | B |\n| --- | --- |\n| `a\\|b` | c |\n\n```sh\nx  y\n```\n");
  assert.deepEqual(blocks.map((b) => b.type), ["list", "table", "code"]);
  assert.deepEqual(blocks[0].items, ["one", "two more", "three"]);
  assert.deepEqual(blocks[1].rows, [["`a|b`", "c"]]);
  assert.equal(renderBlock(blocks[2]), "<pre><code>x  y</code></pre>");
});

test("unsupported Markdown throws with its line", () => {
  assert.throws(() => parse("ok\n\n<div>\n", "r.md"), /r\.md:3: raw HTML/);
  assert.throws(() => parse("- a\n  - b\n", "r.md"), /r\.md:2: nested lists/);
  assert.throws(() => parse("#### deep\n", "r.md"), /r\.md:1: headings go down to ### only/);
});

test("<details> sections, as GitHub draws them", () => {
  const blocks = parse("<details>\n<summary>By **hand**</summary>\n\nRun `x`:\n\n```sh\n./sync.sh\n```\n\n</details>\n\nAfter.\n");
  assert.deepEqual(blocks.map((b) => b.type), ["details", "para"]);
  assert.equal(renderBlock(blocks[0]), "<details>\n<summary>By <b>hand</b></summary>\n<p>Run <code>x</code>:</p>\n<pre><code>./sync.sh</code></pre>\n</details>");
  assert.throws(() => parse("<details>\nno summary\n</details>\n", "r.md"), /needs <summary>/);
});

test("the home page's cards come from site/mods.json and each README", () => {
  const out = tmp();
  try {
    const { site } = build({ out });
    const html = fs.readFileSync(path.join(out, "index.html"), "utf8");
    const carded = site.groups.filter((g) => g.filter).flatMap((g) => g.mods);
    const hrefs = [...html.matchAll(/<a class="card" data-group="[^"]+" href="docs\/([^"]+)\.html">/g)].map((m) => m[1]);
    assert.deepEqual(hrefs, carded.map((m) => m.slug), "one card per mod, in list order");
    for (const g of site.groups.filter((x) => x.filter)) assert.ok(html.includes(`data-filter="${g.filter}"`), `a filter button for ${g.title}`);
    const text = (h) => h.replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
    const cards = [...html.matchAll(/<b>([^<]+)<\/b>[\s\S]*?<p>([\s\S]*?)<\/p>/g)].map((m) => ({ title: m[1], text: text(m[2]) }));
    assert.deepEqual(cards.map((c) => c.title), carded.map((m) => m.title), "card titles");
    for (const [i, mod] of carded.entries()) {
      const lead = readDoc(fs.readFileSync(path.join(ROOT, mod.slug, "README.md"), "utf8"), mod.slug).lead;
      assert.equal(cards[i].text, plain(lead), `${mod.slug}: card text is the README's summary`);
    }
    for (const card of html.match(/<a class="card"[\s\S]*?<\/a>\n/g)) assert.equal(card.match(/<a /g).length, 1, "no link inside a card, which is a link");
    for (const [, src] of html.matchAll(/<img src="([^"]+)"/g)) {
      if (!/^https?:/.test(src)) assert.ok(fs.existsSync(path.join(out, src)), `${src} is in the built site`);
    }
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test("the repository README lists the same mods as site/mods.json, in order", () => {
  const { loadSite } = require("../page.cjs");
  const site = loadSite(ROOT);
  const md = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
  const section = md.slice(md.indexOf("## The mods"), md.indexOf("\n## ", md.indexOf("## The mods") + 1));
  const listed = [...section.matchAll(/^- \[([^\]]+)\]\(([^/]+)\/README\.md\)/gm)].map((m) => ({ title: m[1], slug: m[2] }));
  const want = site.groups.filter((g) => g.filter).flatMap((g) => g.mods).map(({ title, slug }) => ({ title, slug }));
  assert.deepEqual(listed, want);
  for (const g of site.groups.filter((x) => x.filter)) assert.ok(section.includes(`### ${g.title}`), `README has a "### ${g.title}" heading`);
});
