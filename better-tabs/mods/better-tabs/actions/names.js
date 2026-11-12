// Auto names: a tab nobody named takes a name from what runs in it, once. After that it counts
// as named, like one the person named, so it's never renamed again; renaming it to "" hands it
// back. Logic only: the bar's copy asks for the names and runs `tab.rename`, outside render.
import { spaces, panes, run } from "herdr";

// A new tab's terminal can show its shell for a moment before its program starts, so a tab is
// named only once it has had something to name it by for this long. A name Herdr hasn't applied
// by then is asked for again.
const SETTLE_MS = 2000;

// A folder's last part, ~ at home and / at the root; null with no folder.
export function folderName(cwd) {
  if (!cwd) return null;
  const path = cwd.replace(/\/+$/, "");
  if (!path) return "/";
  if (/^\/(home|Users)\/[^/]+$/.test(path) || path === "/root") return "~";
  return path.slice(path.lastIndexOf("/") + 1);
}

// What a pane would call its tab, and how strongly: an agent or another program by its name in
// Herdr's program table, never its title, which agents animate; a shell by its folder. A mod's
// pane has no program, so it names nothing.
function paneName(pane) {
  const program = pane.program;
  if (program?.shell) return { name: folderName(pane.cwd), rank: 1 };
  return { name: program?.name || null, rank: program?.agent ? 3 : 2 };
}

// The names to ask for now: [{ id, name }]. since: tab ID → when it first had a name to take,
// kept by the caller between calls and pruned here.
export function tabNames(allSpaces, allPanes, since, now) {
  const names = [];
  const waiting = new Set();
  for (const tab of allSpaces.flatMap((space) => space.tabs)) {
    if (tab.named) continue;
    let best = null;
    for (const pane of allPanes) {
      if (pane.tab !== tab.id) continue;
      const named = paneName(pane);
      if (named.name && named.rank > (best?.rank ?? 0)) best = named;
    }
    if (!best) continue;
    waiting.add(tab.id);
    if (!since.has(tab.id)) since.set(tab.id, now);
    if (now - since.get(tab.id) >= SETTLE_MS) names.push({ id: tab.id, name: best.name });
  }
  for (const id of since.keys()) if (!waiting.has(id)) since.delete(id);
  return names;
}

export const nameMethods = {
  nameTabs(now = Date.now()) {
    if (!this.settings.tabs.auto_name) return;
    this.unnamedSince ??= new Map();
    for (const { id, name } of tabNames(spaces(), panes(), this.unnamedSince, now)) {
      this.unnamedSince.set(id, now);
      try {
        run("tab.rename", { id, name });
      } catch (error) {
        console.warn(`better-tabs: couldn't name a tab: ${error.message ?? error}`);
      }
    }
  },
};
