// What a notification says, from an agent and its screen. Nothing here touches Herdr, so the
// tests run it as it is.
//
//   Claude Code / lantern-app - NEEDS YOU    title: whose, in which space, and its status
//   Fix the login form                       tab: the tab, when it says more than the space
//   Do you want to make this edit?           message: its question, or how its reply began

export const WORDS = { blocked: "NEEDS YOU", done: "DONE" };
// A message longer than this is cut at a word, about two lines of a banner.
export const MESSAGE_MAX = 140;

const ANSI = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07/g;
// Box sides, bullets and markers agents put at a line's start or end.
const EDGES = /^[\s│┃║|╭╰>❯●○◆⏺•*\-]+|[\s│┃║|╮╯]+$/g;
// What sits under an agent's last reply: its prompt, status bar, timing line, tool output and
// rules. Claude Code's "✻ Worked for 12s", "⏵⏵ auto mode", "⎿ Read …" and its notices that say
// how to turn them off; Codex's "› " prompt.
const CHROME = /^\s*(?:[❯›>$]|[⏵✻※⎿]|\[hc\]|[─━═╌┄\-_\s]*$)|shift\+tab|esc to |turn off (?:with|recaps)|\? for shortcuts|ctrl\+[a-z] to/i;
// The person's own prompt line, above which an agent's reply can't have begun.
const PROMPT = /^\s*[❯›]\s/;
// A reply's first line. Not a tool call such as "⏺ Bash(npm test)".
const REPLY = /^\s*[⏺•●]\s+(?![\w.-]+\()/;

export function agentName(agent) {
  return agent.program?.name || agent.app || agent.title || agent.address;
}

export function title(agent) {
  const space = (agent.space_name ?? "").trim();
  const who = space ? `${agentName(agent)} / ${space}` : agentName(agent);
  return `${who} - ${WORDS[agent.status]}`;
}

// The tab, when it says something the space doesn't: one named like its space, or only by its
// number, is left out.
export function tab(agent) {
  const name = (agent.tab_name ?? "").trim();
  if (!name || name === (agent.space_name ?? "").trim() || /^\d+$/.test(name)) return "";
  return name;
}

function lines(screen) {
  return (screen ?? "").replace(ANSI, "").split("\n");
}

function clean(line) {
  return line.replace(EDGES, "").replace(/\s+/g, " ").trim();
}

function cut(text, max = MESSAGE_MAX) {
  if (text.length <= max) return text;
  const room = text.slice(0, max - 1);
  const word = room.lastIndexOf(" ");
  return `${(word > max / 2 ? room.slice(0, word) : room).replace(/[\s,;:.]+$/, "")}…`;
}

// What an agent waiting for you asks: the lowest line ending in "?".
export function question(screen) {
  const all = lines(screen);
  for (let i = all.length - 1; i >= 0; i--) {
    const line = clean(all[i]);
    if (line.length > 3 && line.endsWith("?")) return cut(line);
  }
  return null;
}

// How a finished agent's last reply began. Its end is the lowest line that isn't the prompt,
// status bar or other chrome. It began at the last reply marker (⏺) above that, short of the
// person's own prompt line, or else where that paragraph began.
export function result(screen) {
  const all = lines(screen);
  let end = all.length - 1;
  while (end >= 0 && (CHROME.test(all[end]) || !/\p{L}/u.test(all[end]))) end--;
  if (end < 0) return null;
  let start = end;
  while (start > 0 && all[start - 1].trim() && !PROMPT.test(all[start - 1])) start--;
  for (let i = end; i >= 0 && !PROMPT.test(all[i]); i--) {
    if (REPLY.test(all[i])) { start = i; break; }
  }
  const text = all.slice(start, end + 1).map(clean).filter(Boolean).join(" ");
  return text ? cut(text) : null;
}

export function message(agent, screen) {
  return agent.status === "blocked" ? question(screen) : result(screen);
}

// GNOME and other daemons read a notification's body as markup.
export function escapeMarkup(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Everything a notification says. macOS shows the tab as its own line; Linux has only a title
// and a body, so `body` starts with it there, joined by " · ": GNOME shows a banner's body on
// one line, with a newline as a plain space.
export function alert(agent, screen) {
  const where = tab(agent);
  const said = message(agent, screen);
  return {
    title: title(agent),
    tab: where,
    message: said ?? "",
    body: [where, said].filter(Boolean).join(" · "),
  };
}
