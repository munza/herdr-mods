// Auto names: a tab follows what runs in it. An agent takes its terminal's title as Herdr gives
// it, a shell its folder, another program its name. The names this mod set are kept in
// `shared("better-tabs.names")`, so a name that differs from them is the person's own and is
// left alone; renaming a tab to nothing hands it back. Logic only: the bar's copy runs
// `tab.rename` from its timer, never in render.
import { spaces, panes, run, shared, setShared } from "herdr";

export const NAMES_KEY = "better-tabs.names";

// Herdr applies a rename a moment later, so the same name isn't asked for twice in this long,
// and a tab still showing the name before it isn't taken for one the person typed.
const RETRY_MS = 2000;

// A folder's last part, ~ at home and / at the root; null with no folder.
export function folderName(cwd) {
  if (!cwd) return null;
  const path = cwd.replace(/\/+$/, "");
  if (!path) return "/";
  if (/^\/(home|Users)\/[^/]+$/.test(path) || path === "/root") return "~";
  return path.slice(path.lastIndexOf("/") + 1);
}

// What a pane would call its tab, and how strongly. An agent's title is its topic, unless it's
// empty or only its folder, and then the agent goes by its name. A mod's pane has no program,
// so it names nothing.
function paneName(pane) {
  const program = pane.program;
  if (!program) return null;
  const folder = folderName(pane.cwd);
  if (program.shell) return { name: folder, rank: 1 };
  if (!program.agent) return { name: program.name || null, rank: 2 };
  const title = pane.title ?? "";
  const topic = title.trim() && title !== folder;
  return { name: topic ? title : program.name || null, rank: 3 };
}

// The name a tab's panes give it, and every name it could have had from them, so a tab named
// before this mod knew it can be told from one the person named.
function tabWants(tabId, allPanes) {
  let best = null;
  const known = new Set();
  for (const pane of allPanes) {
    if (pane.tab !== tabId) continue;
    const named = paneName(pane);
    if (!named) continue;
    for (const name of [named.name, pane.title, pane.program.name, folderName(pane.cwd)]) if (name) known.add(name);
    if (named.name && named.rank > (best?.rank ?? 0)) best = named;
  }
  return { name: best?.name ?? null, known };
}

// What to ask Herdr for now. records: tab ID → { auto: the name this mod set } or
// { manual: true }; asked: tab ID → { name, at }, this copy's requests. Returns the renames and
// the records to keep, without changing what it was given.
export function planNames(allSpaces, allPanes, records, asked, now) {
  const renames = [];
  const next = {};
  const waiting = (id) => now - (asked.get(id)?.at ?? -Infinity) < RETRY_MS;
  for (const tab of allSpaces.flatMap((space) => space.tabs)) {
    const wants = tabWants(tab.id, allPanes);
    let record = records[tab.id];
    if (!tab.named) record = undefined;
    else if (!record && wants.known.size) record = wants.known.has(tab.name) ? { auto: tab.name } : { manual: true };
    else if (record?.auto !== undefined && tab.name !== record.auto && !waiting(tab.id)) record = { manual: true };
    if (record?.manual) {
      next[tab.id] = record;
      continue;
    }
    const current = tab.named ? tab.name : null;
    if (wants.name && wants.name !== current && !(waiting(tab.id) && asked.get(tab.id).name === wants.name)) {
      renames.push({ id: tab.id, name: wants.name });
      record = { auto: wants.name };
    }
    if (record) next[tab.id] = record;
  }
  return { renames, records: next };
}

export const nameMethods = {
  nameTabs(now = Date.now()) {
    if (!this.settings.tabs.auto_name) return;
    this.askedNames ??= new Map();
    const saved = shared(NAMES_KEY) ?? {};
    const { renames, records } = planNames(spaces(), panes(), saved, this.askedNames, now);
    for (const { id, name } of renames) {
      this.askedNames.set(id, { name, at: now });
      try {
        run("tab.rename", { id, name });
      } catch (error) {
        console.warn(`better-tabs: couldn't name a tab: ${error.message ?? error}`);
      }
    }
    if (JSON.stringify(records) !== JSON.stringify(saved)) setShared(NAMES_KEY, records);
  },
};
