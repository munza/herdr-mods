#!/usr/bin/env node
"use strict";
// Builds the site into a folder (default _site/): a copy of docs/, with
// docs/<slug>.html generated from <slug>/README.md for every mod that
// site/mods.json marks "generated", the sidebar and pager of every docs
// page and the home page's mod cards built from that one list.
//
//   node site/build.cjs [--out _site]

const fs = require("node:fs");
const path = require("node:path");
const { loadSite, renderModPage, cardsHtml, sideNav, pager } = require("./page.cjs");

const CARDS_MARK = "<!-- Mod filters and cards: written by site/build.cjs from site/mods.json and each mod's README. -->";

const ROOT = path.resolve(__dirname, "..");

function build({ root = ROOT, out = path.join(ROOT, "_site") } = {}) {
  root = path.resolve(root);
  out = path.resolve(out);
  if (out === root || root.startsWith(out + path.sep) || out.startsWith(path.join(root, "docs") + path.sep) || out === path.join(root, "docs")) {
    throw new Error(`won't build into ${out}: pick a folder of its own, such as _site`);
  }
  const site = loadSite(root);
  const docsDir = path.join(root, "docs", "docs");
  const listed = new Set(site.mods.map((m) => m.slug));
  for (const f of fs.readdirSync(docsDir)) {
    if (f.endsWith(".html") && !listed.has(f.slice(0, -5))) throw new Error(`docs/docs/${f} isn't listed in site/mods.json`);
  }

  for (const mod of site.mods.filter((m) => m.generated)) {
    if (fs.existsSync(path.join(docsDir, `${mod.slug}.html`))) {
      throw new Error(`docs/docs/${mod.slug}.html is generated from ${mod.slug}/README.md; delete the committed copy`);
    }
  }

  fs.rmSync(out, { recursive: true, force: true });
  fs.cpSync(path.join(root, "docs"), out, { recursive: true });

  const copyMedia = (media) => {
    for (const m of media) {
      const to = path.join(out, "docs", m.to);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(path.join(root, m.from), to);
    }
  };

  const indexFile = path.join(out, "index.html");
  const index = fs.readFileSync(indexFile, "utf8");
  if (!index.includes(CARDS_MARK)) throw new Error(`docs/index.html needs this line where the mod cards go:\n  ${CARDS_MARK}`);
  const cards = cardsHtml(root, site);
  copyMedia(cards.media);
  fs.writeFileSync(indexFile, index.replace(CARDS_MARK, () => cards.html));

  const pages = [];
  for (const mod of site.mods) {
    const target = path.join(out, "docs", `${mod.slug}.html`);
    if (mod.generated) {
      const { html, media } = renderModPage(root, site, mod);
      copyMedia(media);
      fs.writeFileSync(target, html);
    } else {
      if (!fs.existsSync(target)) throw new Error(`site/mods.json lists ${mod.slug}, but docs/docs/${mod.slug}.html doesn't exist and it isn't marked "generated"`);
      const html = fs.readFileSync(target, "utf8");
      const side = /<nav class="side"[\s\S]*?<\/nav>/;
      const pg = /<nav class="pager"[\s\S]*?<\/nav>/;
      if (!side.test(html) || !pg.test(html)) throw new Error(`docs/docs/${mod.slug}.html has no sidebar or pager to replace`);
      fs.writeFileSync(target, html.replace(side, () => sideNav(site, mod.slug)).replace(pg, () => pager(site, mod.slug)));
    }
    pages.push({ slug: mod.slug, file: target, generated: Boolean(mod.generated) });
  }
  return { site, pages };
}

module.exports = { build, ROOT, CARDS_MARK };

if (require.main === module) {
  const args = process.argv.slice(2);
  const i = args.indexOf("--out");
  const out = i >= 0 ? path.resolve(args[i + 1]) : undefined;
  try {
    const { pages } = build({ out });
    const where = path.relative(process.cwd(), out || path.join(ROOT, "_site")) || ".";
    console.log(`Built ${pages.length} docs pages (${pages.filter((p) => p.generated).length} from READMEs) into ${where}/`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
