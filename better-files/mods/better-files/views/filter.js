// The filter row under the header, and the matches it shows in place of the tree.
import { h_flex } from "gpui-base";
import { findMatches, foldersTo, matchRows, MAX_INDEXED, MAX_MATCHES } from "../files/filter.js";
import { IconButton, Message, TextField } from "./ui.js";

const thousands = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

export const filterMethods = {
  filterText() {
    return this.filter?.value().trim() ?? "";
  },

  clearFilter(cx) {
    this.filter.set_value("");
    cx.notify();
  },

  // Worked out again only when the words or the list of files change, not on every redraw.
  matches() {
    const text = this.filterText();
    const index = this.index?.key === this.key ? this.index : null;
    if (this.matched?.index !== index || this.matched?.text !== text) {
      const found = findMatches(index, text);
      this.matched = { index, text, ...found, rows: matchRows(found.hits) };
    }
    return this.matched;
  },

  // Enter opens the first file that matches, as a click would.
  openFirstMatch(cx) {
    const hit = this.matches().hits.find((h) => !h.dir);
    if (hit) this.openFile(this.fileOf(hit.path), cx);
  },

  // A folder picked from the matches opens in the tree, with the filter cleared. Its folders
  // are read here, as a click on a chevron does: a refresh skips a tree that is still loading.
  revealFolder(relative, cx) {
    const { root, on, key } = this;
    const folders = foldersTo(relative, true);
    for (const folder of folders) this.folders.add(folder);
    this.scrollTo = relative;
    this.clearFilter(cx);
    cx.spawn(async (cx) => {
      try {
        for (const folder of folders) await this.loadFolder(folder, root, on, key);
      } catch (e) {
        if (this.key === key) this.treeError = e.message ?? String(e);
      }
      cx.notify();
    });
  },

  filterRow(t) {
    const text = this.filterText();
    return h_flex()
      .id("files-filter")
      .flex_none()
      .px(10)
      .py(8)
      .gap(6)
      .items_center()
      .border_b(1)
      .border_color(t.border)
      .on_key_down((event, cx) => {
        if (event.key !== "escape" || !text) return;
        cx.stop_propagation();
        this.clearFilter(cx);
      })
      .child(TextField({ id: "files-filter-input", state: this.filter }))
      .when(Boolean(text), (el) =>
        el.child(
          IconButton({ id: "files-filter-clear", icon: "close", label: "Clear filter", small: true, onClick: (cx) => this.clearFilter(cx) }),
        ),
      );
  },

  matchesView(body, t) {
    if (this.indexError) return body.child(Message(this.indexError, true));
    const { hits, more, rows, index } = this.matches();
    if (!index) return body.child(Message("Searching…"));
    if (!hits.length) return body.child(Message("No matches."));
    body.children(rows.map((r) => this.row(r.relative, r.name, r.dir, r.depth, t, r)));
    if (more) body.child(Message(`Showing the first ${MAX_MATCHES} matches.`));
    if (index.capped) body.child(Message(`This folder is large, so only part of it was searched (at most ${thousands(MAX_INDEXED)} files).`));
    return body;
  },
};
