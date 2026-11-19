"use strict";
// One mod's README.md → its docs page, plus the sidebar and pager every
// docs page shares, built from site/mods.json.

const fs = require("node:fs");
const path = require("node:path");
const { parse, inline, plain, renderBlock, esc } = require("./markdown.cjs");

// The sections a README must have, in this order, and the anchor each keeps
// on the site (the ids the hand-written pages used, so old links still land).
const SECTIONS = [
  ["Quick start", "start"],
  ["Install", "install"],
  ["Use", "use"],
  ["Settings", "settings"],
  ["Update", "update"],
  ["For developers", "developers"],
];

const slugify = (s) => plain(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function loadSite(root) {
  const site = JSON.parse(fs.readFileSync(path.join(root, "site/mods.json"), "utf8"));
  site.mods = site.groups.flatMap((g) => g.mods);
  const seen = new Set();
  for (const m of site.mods) {
    if (seen.has(m.slug)) throw new Error(`site/mods.json lists ${m.slug} twice`);
    seen.add(m.slug);
  }
  return site;
}

// README → { title, lead, image, sections: [{ title, id, blocks }] }.
// Throws, naming the file, when the layout in site/README.md isn't followed.
function readDoc(md, file) {
  const blocks = parse(md, file);
  const where = (b) => `${file}:${b ? b.line : 1}`;
  const [h1, lead] = blocks;
  if (!h1 || h1.type !== "heading" || h1.level !== 1) throw new Error(`${where(h1)}: a README starts with "# <Mod name>"`);
  if (!lead || lead.type !== "para") throw new Error(`${where(lead)}: the line after the title is a one-paragraph summary`);
  let i = 2;
  let image = null;
  if (blocks[i] && blocks[i].type === "image") image = blocks[i++];
  const sections = [];
  for (; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.type === "heading" && b.level === 1) throw new Error(`${where(b)}: only one "# " title`);
    if (b.type === "heading" && b.level === 2) {
      sections.push({ title: b.text, line: b.line, blocks: [] });
    } else if (!sections.length) {
      throw new Error(`${where(b)}: only the summary and a picture go before "## Quick start"`);
    } else {
      sections.at(-1).blocks.push(b);
    }
  }
  const titles = sections.map((s) => s.title);
  const missing = SECTIONS.map(([t]) => t).filter((t) => !titles.includes(t));
  if (missing.length) throw new Error(`${file}: missing section${missing.length > 1 ? "s" : ""} ${missing.map((t) => `"## ${t}"`).join(", ")}`);
  const order = titles.filter((t) => SECTIONS.some(([s]) => s === t));
  if (order.join() !== SECTIONS.map(([t]) => t).join()) throw new Error(`${file}: sections go in this order: ${SECTIONS.map(([t]) => t).join(", ")}`);
  for (const s of sections) {
    const known = SECTIONS.find(([t]) => t === s.title);
    s.key = known ? known[1] : slugify(s.title);
  }
  const quick = sections.find((s) => s.key === "start");
  if (!quick.blocks.length || quick.blocks[0].type !== "list" || !quick.blocks[0].ordered) {
    throw new Error(`${file}:${quick.line}: "## Quick start" is a numbered list`);
  }
  return { title: h1.text, lead: lead.text, image, sections };
}

// The settings table in "## Settings" must name every setting in
// mod.schema.json, with its default, and nothing else.
function flattenSettings(props, prefix = "") {
  const out = {};
  for (const [k, v] of Object.entries(props || {})) {
    if (v.type === "object" && v.properties && !("default" in v)) Object.assign(out, flattenSettings(v.properties, `${prefix}${k}.`));
    else out[prefix + k] = v.default;
  }
  return out;
}

function checkSettings(doc, schema, file) {
  const expected = flattenSettings(schema?.properties?.settings?.properties);
  const section = doc.sections.find((s) => s.key === "settings");
  const table = section.blocks.find((b) => b.type === "table");
  if (!Object.keys(expected).length) return;
  if (!table) throw new Error(`${file}: "## Settings" needs a table of Key | Default | What it does`);
  const strip = (c) => c.replace(/^`|`$/g, "");
  const rows = Object.fromEntries(table.rows.map((r) => [strip(r[0]), strip(r[1])]));
  const problems = [];
  for (const [key, def] of Object.entries(expected)) {
    const want = typeof def === "string" && def !== "" ? def : JSON.stringify(def);
    // An empty-string default may be shown as `""` or left blank.
    const got = def === "" && rows[key] === "" ? '""' : rows[key];
    if (!(key in rows)) problems.push(`${key} is in mod.schema.json but not the table`);
    else if (got !== want) problems.push(`${key} defaults to ${want} in mod.schema.json, ${rows[key]} in the table`);
  }
  for (const key of Object.keys(rows)) if (!(key in expected)) problems.push(`${key} is in the table but not mod.schema.json`);
  if (problems.length) throw new Error(`${file}: settings table is out of date:\n  ${problems.join("\n  ")}`);
}

// Width and height of a PNG or GIF, so the page doesn't jump as it loads.
function imageSize(file) {
  const b = fs.readFileSync(file);
  if (b.toString("ascii", 1, 4) === "PNG") return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  if (b.toString("ascii", 0, 3) === "GIF") return { width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
  return {};
}

function sideNav(site, current) {
  const rows = site.groups.flatMap((g) => [
    `        <h4>${esc(g.title)}</h4>`,
    ...g.mods.map((m) => m.slug === current
      ? `        <a href="${m.slug}.html" class="on" aria-current="page">${esc(m.title)}</a>`
      : `        <a href="${m.slug}.html">${esc(m.title)}</a>`),
  ]);
  return `<nav class="side" aria-label="Mods">\n${rows.join("\n")}\n      </nav>`;
}

function pager(site, current) {
  const i = site.mods.findIndex((m) => m.slug === current);
  const prev = site.mods[i - 1];
  const next = site.mods[i + 1];
  return `<nav class="pager" aria-label="More docs">${prev ? `<a href="${prev.slug}.html"><span>Previous</span>${esc(prev.title)}</a>` : ""}${next ? `<a class="next" href="${next.slug}.html"><span>Next</span>${esc(next.title)}</a>` : ""}</nav>`;
}

// Reads <slug>/README.md and checks it against the mod's files.
function loadMod(root, mod) {
  const file = `${mod.slug}/README.md`;
  const doc = readDoc(fs.readFileSync(path.join(root, file), "utf8"), file);
  if (doc.title !== mod.title) throw new Error(`${file}: titled "${doc.title}", but site/mods.json calls it "${mod.title}"`);
  const modDir = path.join(root, mod.slug, "mods", mod.slug);
  const manifest = JSON.parse(fs.readFileSync(path.join(modDir, "mod.json"), "utf8"));
  const schemaFile = path.join(modDir, "mod.schema.json");
  if (fs.existsSync(schemaFile)) checkSettings(doc, JSON.parse(fs.readFileSync(schemaFile, "utf8")), file);
  return { file, doc, manifest };
}

// Maps a README's relative links and pictures to paths from a page in
// `base` ("docs/docs" for a docs page, "docs" for the home page). Pictures
// outside docs/ are copied into docs/media/<slug>/; `media` collects them
// as { from, to }, `to` relative to the built site's docs/ folder.
function resolver(root, site, mod, file, base, media) {
  const resolve = (p) => {
    const abs = path.posix.normalize(path.posix.join(mod.slug, p));
    if (abs.startsWith("..")) throw new Error(`${file}: ${p} points outside the repository`);
    if (!fs.existsSync(path.join(root, abs))) throw new Error(`${file}: ${p} doesn't exist`);
    return abs;
  };
  const link = (href) => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("#")) return href;
    const [p, hash] = href.split("#");
    const abs = resolve(p);
    const tail = hash ? `#${hash}` : "";
    const readme = /^([^/]+)\/README\.md$/.exec(abs);
    if (readme && site.mods.some((m) => m.slug === readme[1])) return path.posix.relative(base, `docs/docs/${readme[1]}.html`) + tail;
    if (abs.startsWith("docs/")) return path.posix.relative(base, abs) + tail;
    const kind = fs.statSync(path.join(root, abs)).isDirectory() ? "tree" : "blob";
    return `${site.repo}/${kind}/main/${abs}${tail}`;
  };
  const image = (src) => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(src)) return { src };
    const abs = resolve(src);
    const size = imageSize(path.join(root, abs));
    if (abs.startsWith("docs/")) return { src: path.posix.relative(base, abs), ...size };
    const to = `media/${mod.slug}/${path.posix.basename(abs)}`;
    if (!media.some((m) => m.to === to)) media.push({ from: abs, to });
    return { src: path.posix.relative(base, `docs/docs/${to}`), ...size };
  };
  return { link, image };
}

// "Needs" as a list → "Git, `gh`" on a page, "Git and `gh`" on a card.
const needsList = (needs, last) => (needs || []).map((n) => inline(n)).reduce((acc, n, i, all) => (i === 0 ? n : acc + (i === all.length - 1 ? last : ", ") + n), "");

// The home page's filter buttons and one card per mod, for every group in
// site/mods.json with a "filter".
function cardsHtml(root, site) {
  const media = [];
  const groups = site.groups.filter((g) => g.filter);
  const buttons = [
    `      <button type="button" class="on" data-filter="all" aria-pressed="true">All</button>`,
    ...groups.map((g) => `      <button type="button" data-filter="${esc(g.filter)}" aria-pressed="false">${esc(g.label || g.title)}</button>`),
  ];
  const cards = groups.flatMap((g) => g.mods.map((mod) => {
    if (!mod.generated) throw new Error(`site/mods.json: ${mod.slug} has a card, so it must be "generated" from its README`);
    const { file, doc } = loadMod(root, mod);
    const ctx = resolver(root, site, mod, file, "docs", media);
    const img = doc.image ? ctx.image(doc.image.src) : null;
    const shot = img ? `<div class="shot"><img src="${esc(img.src)}" alt="${esc(doc.image.alt)}" loading="lazy"${img.width ? ` width="${img.width}" height="${img.height}"` : ""}></div>` : `<div class="shot"></div>`;
    const needs = mod.needs && mod.needs.length ? `Needs ${needsList(mod.needs, " and ")}` : "Nothing extra";
    // The card is a link, so links in the summary keep only their text.
    return `      <a class="card" data-group="${esc(g.filter)}" href="docs/${mod.slug}.html">
        ${shot}
        <div class="meta"><b>${esc(mod.title)}</b><span class="folder mono">${mod.slug}</span></div>
        <p>${inline(doc.lead.replace(/(^|[^!])\[([^\]]+)\]\([^)\s]+\)/g, "$1$2"), ctx)}</p>
        <div class="needs">${needs}</div>
      </a>`;
  }));
  const html = `<div class="filters" role="group" aria-label="Filter mods">\n${buttons.join("\n")}\n    </div>\n    <div class="grid">\n${cards.join("\n")}\n    </div>`;
  return { html, media };
}

// Renders <slug>/README.md. Returns { html, media: [{ from, to }] }, media
// paths relative to the repo root and the built site's docs/ folder.
function renderModPage(root, site, mod) {
  const { file, doc, manifest } = loadMod(root, mod);
  const repo = site.repo;
  const media = [];
  const ctx = resolver(root, site, mod, file, "docs/docs", media);

  const id = (s) => `${mod.slug}-${s}`;
  const body = doc.sections.map((s) => {
    const parts = [`  <h3 id="${id(s.key)}">${inline(s.title, ctx)}</h3>`];
    for (const b of s.blocks) {
      if (b.type === "heading") parts.push(`  <h4 id="${id(slugify(b.text))}">${inline(b.text, ctx)}</h4>`);
      // Indent for readability, except inside <pre>, where it would show.
      else parts.push(b.type === "code" ? `  ${renderBlock(b, ctx)}` : renderBlock(b, ctx).replace(/^/gm, "  "));
    }
    return parts.join("\n");
  }).join("\n\n");

  const meta = [`<span>Version ${esc(manifest.version)}</span>`];
  if (mod.needs && mod.needs.length) meta.push(`<span>Needs: ${needsList(mod.needs, ", ")}</span>`);
  meta.push(`<a href="${repo}/tree/main/${mod.slug}">Source on GitHub</a>`);
  const shot = doc.image ? `\n  ${renderBlock(doc.image, ctx)}` : "";
  const toc = doc.sections.map((s) => `      <a href="#${id(s.key)}">${inline(s.title, ctx)}</a>`).join("\n");
  const description = plain(doc.lead);

  const html = `<!doctype html>
<!-- Generated by site/build.cjs from ${file}. Edit the README, not this file. -->
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(plain(doc.title))} · Herdr Mods Docs</title>
<meta name="description" content="${esc(description)}">
<meta name="theme-color" content="#0e0f11">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@100..900&amp;family=JetBrains+Mono:wght@100..800&amp;display=swap">
<link rel="stylesheet" href="../style.css">
</head>
<body>
<div class="wrap">
  <nav class="site-nav">
    <a class="brand" href="../">Herdr Mods</a>
    <div class="links">
      <a href="../#why">Why</a>
      <a href="../#mods">Mods</a>
      <a href="../#estro">Layout</a>
      <a href="../#build">Build your own</a>
      <a href="${site.mods[0].slug}.html" class="on">Docs</a>
    </div>
    <a class="pill" href="${repo}">GitHub</a>
  </nav>

  <div class="docs">
      ${sideNav(site, mod.slug)}
    <main>
<article class="doc" id="${mod.slug}">
  <h2>${inline(doc.title, ctx)}</h2>
  <p class="lead">${inline(doc.lead, ctx)}</p>
  <p class="meta-line">${meta.join("")}</p>${shot}

${body}
</article>
      ${pager(site, mod.slug)}
    </main>
    <nav class="toc" aria-label="On this page">
      <h4>On this page</h4>
${toc}
    </nav>
  </div>

  <footer class="site-foot">
    <span>Herdr Mods · <a href="${repo}/blob/main/LICENSE">Apache-2.0</a></span>
    <span><a href="${repo}/tree/main/${mod.slug}">This mod on GitHub</a> · <a href="https://herdr.dev/">herdr.dev</a></span>
  </footer>
</div>
<script>
  // Highlight the section being read in "On this page".
  const links = new Map([...document.querySelectorAll(".toc a")].map((a) => [a.hash.slice(1), a]));
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) {
      for (const a of links.values()) a.classList.remove("on");
      links.get(e.target.id)?.classList.add("on");
    }
  }, { rootMargin: "0px 0px -75% 0px" });
  document.querySelectorAll("main h3[id]").forEach((el) => io.observe(el));
  // A Copy button on each install prompt.
  for (const box of document.querySelectorAll(".prompt")) {
    const b = Object.assign(document.createElement("button"), { className: "copy", type: "button", textContent: "Copy" });
    b.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(box.querySelector("code").textContent); b.textContent = "Copied"; }
      catch { b.textContent = "Select and copy"; }
      setTimeout(() => (b.textContent = "Copy"), 1600);
    });
    box.append(b);
  }
</script>
</body>
</html>
`;
  return { html, media };
}

module.exports = { SECTIONS, loadSite, loadMod, cardsHtml, readDoc, checkSettings, flattenSettings, sideNav, pager, renderModPage, slugify };
