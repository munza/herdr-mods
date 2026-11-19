"use strict";
// The Markdown the mods' READMEs use, and nothing more: headings (# to ###),
// paragraphs, - and 1. lists (one level), fenced code, > quotes, tables,
// <details> sections, a picture on its own line, and inline code, links, pictures, bold and
// italics. Anything else throws with its line, so a README never renders
// half right on the site while it looks fine on GitHub.

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const ITEM = /^(?:([-*])|(\d+)\.)\s+(.*)$/;
const FENCE = /^```\s*([\w-]*)\s*$/;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const IMAGE_LINE = /^!\[([^\]]*)\]\(([^)\s]+)\)$/;

function fail(file, line, message) {
  throw new Error(`${file}:${line}: ${message}`);
}

// Splits a table row on the pipes outside backticks.
function cells(row) {
  const out = [];
  let cell = "";
  let code = false;
  const body = row.trim().replace(/^\|/, "").replace(/\|$/, "");
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === "\\" && body[i + 1] === "|") { cell += "|"; i++; continue; }
    if (c === "`") code = !code;
    if (c === "|" && !code) { out.push(cell.trim()); cell = ""; continue; }
    cell += c;
  }
  out.push(cell.trim());
  return out;
}

const isTableRule = (line) => /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line);

// Markdown → [{ type, line, ... }]. Types: heading, para, image, code,
// quote, list, table.
function parse(src, file = "README.md") {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let i = 0;
  const startsBlock = (l) => l.trim() === "" || HEADING.test(l) || FENCE.test(l) || l.startsWith(">") || ITEM.test(l) || l.startsWith("|");
  while (i < lines.length) {
    const line = lines[i];
    const n = i + 1;
    if (line.trim() === "") { i++; continue; }
    if (/^\s+\S/.test(line) && !FENCE.test(line.trim())) fail(file, n, "indented text (nested lists, indented code) isn't supported; keep it flat");
    let m;
    if ((m = FENCE.exec(line))) {
      const body = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) body.push(lines[i++]);
      if (i >= lines.length) fail(file, n, "code block never closes");
      i++;
      blocks.push({ type: "code", line: n, lang: m[1], text: body.join("\n") });
      continue;
    }
    if ((m = HEADING.exec(line))) {
      if (m[1].length > 3) fail(file, n, "headings go down to ### only");
      blocks.push({ type: "heading", line: n, level: m[1].length, text: m[2] });
      i++;
      continue;
    }
    if (/^<details>\s*$/.test(line)) {
      // GitHub's collapsible section: <details>, <summary>…</summary>, then
      // Markdown, then </details>, each on its own line.
      let j = i + 1;
      while (j < lines.length && lines[j].trim() === "") j++;
      const sm = /^<summary>(.*)<\/summary>\s*$/.exec(lines[j] || "");
      if (!sm) fail(file, j + 1, "<details> needs <summary>…</summary> on the next line");
      const start = j + 1;
      let end = start;
      while (end < lines.length && !/^<\/details>\s*$/.test(lines[end])) end++;
      if (end >= lines.length) fail(file, n, "<details> never closes");
      const inner = parse(lines.slice(start, end).join("\n"), file).map((b) => ({ ...b, line: b.line + start }));
      if (inner.some((b) => b.type === "heading" || b.type === "details")) fail(file, n, "no headings or <details> inside <details>");
      blocks.push({ type: "details", line: n, summary: sm[1], blocks: inner });
      i = end + 1;
      continue;
    }
    if (/^<[a-zA-Z!/]/.test(line)) fail(file, n, "raw HTML isn't supported, except <details>");
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) fail(file, n, "horizontal rules aren't supported");
    if (line.startsWith(">")) {
      const body = [];
      while (i < lines.length && lines[i].startsWith(">")) body.push(lines[i++].replace(/^>\s?/, ""));
      blocks.push({ type: "quote", line: n, text: body.join(" ").trim() });
      continue;
    }
    if (line.startsWith("|") && i + 1 < lines.length && isTableRule(lines[i + 1])) {
      const head = cells(line);
      const rows = [];
      i += 2;
      while (i < lines.length && lines[i].startsWith("|")) {
        const row = cells(lines[i]);
        if (row.length !== head.length) fail(file, i + 1, `table row has ${row.length} cells, the header ${head.length}`);
        rows.push(row);
        i++;
      }
      blocks.push({ type: "table", line: n, head, rows });
      continue;
    }
    if ((m = ITEM.exec(line))) {
      const ordered = Boolean(m[2]);
      const items = [];
      while (i < lines.length) {
        const l = lines[i];
        const im = ITEM.exec(l);
        if (im) {
          if (Boolean(im[2]) !== ordered) fail(file, i + 1, "a list mixes - and 1. items");
          items.push(im[3]);
          i++;
        } else if (l.trim() === "") {
          // A blank line ends the list unless the next item carries on.
          let j = i;
          while (j < lines.length && lines[j].trim() === "") j++;
          const next = j < lines.length && ITEM.exec(lines[j]);
          if (next && Boolean(next[2]) === ordered) { i = j; continue; }
          break;
        } else if (/^\s+\S/.test(l)) {
          if (ITEM.test(l.trim())) fail(file, i + 1, "nested lists aren't supported; keep lists one level deep");
          items[items.length - 1] += " " + l.trim();
          i++;
        } else if (!startsBlock(l)) {
          items[items.length - 1] += " " + l.trim();
          i++;
        } else break;
      }
      blocks.push({ type: "list", line: n, ordered, items });
      continue;
    }
    const body = [];
    while (i < lines.length && !(body.length && startsBlock(lines[i]))) body.push(lines[i++].trim());
    const text = body.join(" ");
    const im = IMAGE_LINE.exec(text);
    if (im) blocks.push({ type: "image", line: n, alt: im[1], src: im[2] });
    else blocks.push({ type: "para", line: n, text });
  }
  return blocks;
}

// Inline Markdown → HTML. ctx.link(href) and ctx.image(src) map a README's
// relative paths to the page's.
function inline(text, ctx = {}) {
  const link = ctx.link || ((h) => h);
  const image = ctx.image || ((s) => ({ src: s }));
  const slots = [];
  const keep = (html) => `\u0000${slots.push(html) - 1}\u0000`;
  let s = text.replace(/`([^`]+)`/g, (_, c) => keep(`<code>${esc(c)}</code>`));
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, src) => keep(`<img src="${esc(image(src).src)}" alt="${esc(alt)}">`));
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => `${keep(`<a href="${esc(link(href))}">`)}${label}${keep("</a>")}`);
  s = s.replace(/<(https?:\/\/[^>\s]+)>/g, (_, url) => keep(`<a href="${esc(url)}">${esc(url)}</a>`));
  s = esc(s);
  s = s.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  s = s.replace(/(^|[^*\w])\*(?!\s)([^*]+?)\*(?!\w)/g, "$1<i>$2</i>");
  s = s.replace(/(^|[^\w])_(?!\s)([^_]+?)_(?!\w)/g, "$1<i>$2</i>");
  return s.replace(/\u0000(\d+)\u0000/g, (_, k) => slots[k]);
}

// Inline Markdown → plain text, for <meta name="description">.
function plain(text) {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[`*]/g, "")
    .replace(/(^|\W)_([^_]+)_(?!\w)/g, "$1$2");
}

// One non-heading block → HTML. A quote is an install prompt, drawn as the
// site's prompt box with a Copy button.
function renderBlock(b, ctx = {}) {
  switch (b.type) {
    case "para": return `<p>${inline(b.text, ctx)}</p>`;
    case "code": return `<pre><code>${esc(b.text)}</code></pre>`;
    case "quote": return `<div class="prompt"><code>${esc(b.text)}</code></div>`;
    case "list": {
      const tag = b.ordered ? "ol" : "ul";
      return `<${tag}>\n${b.items.map((t) => `  <li>${inline(t, ctx)}</li>`).join("\n")}\n</${tag}>`;
    }
    case "table": {
      const head = b.head.map((c) => `<th>${inline(c, ctx)}</th>`).join("");
      const rows = b.rows.map((r) => `  <tr>${r.map((c) => `<td>${inline(c, ctx)}</td>`).join("")}</tr>`).join("\n");
      return `<table class="keys"><thead><tr>${head}</tr></thead><tbody>\n${rows}\n</tbody></table>`;
    }
    case "details":
      return `<details>\n<summary>${inline(b.summary, ctx)}</summary>\n${b.blocks.map((x) => renderBlock(x, ctx)).join("\n")}\n</details>`;
    case "image": {
      const img = (ctx.image || ((s) => ({ src: s })))(b.src);
      const size = img.width ? ` width="${img.width}" height="${img.height}"` : "";
      return `<figure class="doc-shot"><img src="${esc(img.src)}" alt="${esc(b.alt)}"${size}></figure>`;
    }
    default: throw new Error(`can't render a ${b.type} block here`);
  }
}

module.exports = { parse, inline, plain, renderBlock, esc, cells };
