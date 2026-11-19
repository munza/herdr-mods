// Better Search's model: what each prefix lists, in what order, and how picks are named.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const load = () =>
  import(`data:text/javascript,${encodeURIComponent(fs.readFileSync(path.join(root, "mods/better-search/model.js"), "utf8"))}`);

const tab = (id, name, extra = {}) => ({ id, name, index: 1, active: false, status: null, ...extra });
const spaces = [
  { id: "s1", index: 1, name: "api", folder: "/api", machine: null, branch: "main", active: true, status: null, tabs: [tab("t1", "login", { active: true })] },
  { id: "vps/s2", index: 2, name: "web", folder: "/srv/web", machine: "vps", branch: "fix", active: false, status: "blocked", tabs: [tab("vps/t2", "deploy", { status: "blocked" }), tab("vps/t3", "docs")] },
];
const agent = (address, tab, status, extra = {}) => ({ address, tab, tab_name: tab, space_name: "web", status, seq: 1, pinned: false, focused: false, program: { name: "Claude Code" }, ...extra });
const agents = [agent("vps/t7", "vps/t2", "blocked", { tab_name: "deploy" }), agent("t8", "t1", "idle", { space_name: "api" }), agent("t9", "t1", "working", { space_name: "api", seq: 5 })];
const commands = [
  { name: "tab.new", args: [{ name: "name", required: false }], about: "Make a tab" },
  { name: "tab.rename", args: [{ name: "name", required: true }], about: "Rename a tab" },
  { name: "tab.move", args: [{ name: "id", required: true }], about: "Move a tab" },
  { name: "window.minimize", args: [], about: "" },
  { name: "layout.switch", args: [{ name: "name", required: false }], about: "" },
  { name: "app.settings", args: [{ name: "section", required: false }], about: "" },
  { name: "mod.open", args: [{ name: "name", required: true }], about: "" },
];

test("a leading character picks the kind; anything else searches everything", async () => {
  const { parse } = await load();
  assert.deepEqual(parse("@ clau"), { kind: "agents", q: "clau" });
  assert.deepEqual(parse(">split"), { kind: "commands", q: "split" });
  assert.deepEqual(parse("/main.js"), { kind: "files", q: "main.js" });
  assert.deepEqual(parse("~"), { kind: "spaces", q: "" });
  assert.deepEqual(parse("#12"), { kind: "prs", q: "12" });
  assert.deepEqual(parse("$ENG-3"), { kind: "issues", q: "ENG-3" });
  assert.deepEqual(parse("?error"), { kind: "output", q: "error" });
  assert.deepEqual(parse("!x"), { kind: null, q: "!x" });
});

test("with nothing typed: every tab on every machine in one list, the ones that need you first, then new work", async () => {
  const { search } = await load();
  const rows = search({ spaces, agents, machines: ["vps"], commands: [] }, "");
  assert.deepEqual(rows.map((r) => `${r.kind}:${r.title}`), [
    "tab:deploy", "tab:login", "tab:docs", "new-tab:New tab", "new-space:New space", "new-space:New space on vps",
  ]);
  assert.equal(rows[0].detail, "web · vps", "the space, and its machine, on the right");
  assert.equal(rows[0].sub, "Claude Code", "what runs in it, after its name");
  assert.equal(rows[0].agent, "vps/t7");
  assert.equal(rows[1].here, true);
  assert.equal(rows[1].sub, "Claude Code · Claude Code");
});

test("typed text: matching tabs with their space, then a few of each other kind", async () => {
  const { search } = await load();
  const rows = search({ spaces, agents, commands: [], files: ["src/deploy.sh", "README.md"] }, "deploy");
  assert.deepEqual(rows.map((r) => `${r.kind}:${r.title}`), ["head:Tabs", "tab:deploy", "head:Agents", "agent:deploy", "head:Files", "file:deploy.sh"]);
  assert.match(rows[1].detail, /^web/);
});

test("@ lists agents waiting for you first, then pinned, then newest, each saying its state", async () => {
  const { search } = await load();
  const rows = search({ agents }, "@");
  assert.deepEqual(rows.map((r) => r.id), ["vps/t7", "t9", "t8"]);
  assert.deepEqual(rows.map((r) => [r.status, r.spell, r.detail]), [["blocked", true, "web"], ["working", true, "api"], ["idle", true, "api"]]);
  const pinned = search({ agents: [...agents, agent("t10", "x", "idle", { pinned: true })] }, "@").map((r) => r.id);
  assert.deepEqual(pinned.slice(0, 3), ["vps/t7", "t9", "t10"], "pinned leads among the idle ones");
});

test("~ lists spaces with their machine and a new space on each machine", async () => {
  const { search } = await load();
  const rows = search({ spaces, machines: ["vps"] }, "~vps");
  assert.deepEqual(rows.map((r) => r.title), ["web", "New space on vps"]);
  assert.equal(rows[0].detail, "fix · vps");
  assert.deepEqual(search({ spaces }, "~").map((r) => r.title).slice(0, 2), ["web", "api"], "the one that needs you first");
});

test("> lists the commands a list can run, with their keys, recent first", async () => {
  const { commandEntries, search } = await load();
  const entries = commandEntries({ commands, layouts: ["main"], themes: ["ink"], keys: [{ section: "global", keys: "cmd-t", action: "tab.new" }], mac: true, modSettings: true });
  const ids = entries.map((e) => e.id);
  assert.ok(ids.includes('tab.rename:{}'), "needs only a name, which Herdr asks for");
  assert.ok(!ids.some((id) => id.startsWith("tab.move") || id.startsWith("window.")), "pointed commands and window buttons on a Mac stay out");
  assert.ok(ids.includes('layout.switch:{"name":"main"}') && ids.includes('app.settings:{"section":"look"}') && ids.includes('mod.open:{"name":"better-config"}'));
  assert.equal(entries.find((e) => e.name === "tab.new").key, "cmd-t");
  assert.equal(search({ commands: entries, recent: ['tab.rename:{}'] }, ">")[0].id, 'tab.rename:{}');
  assert.equal(search({ commands: entries, recent: [] }, ">renam")[0].title, "Rename tab");
});

test("/ ranks files by name, then path, and shows where each lives", async () => {
  const { search } = await load();
  const rows = search({ files: ["src/views/main.js", "main.go", "docs/maintenance.md"] }, "/main");
  assert.equal(rows.length, 3);
  assert.equal(rows.find((r) => r.path === "src/views/main.js").detail, "src/views");
  assert.deepEqual(search({ files: [] }, "/x"), []);
});

test("fuzzy matches letters in order and prefers word starts", async () => {
  const { fuzzy } = await load();
  assert.equal(fuzzy("xz", "split pane"), null);
  assert.deepEqual(fuzzy("sp", "split pane").hits, [0, 1]);
  assert.ok(fuzzy("sp", "split pane").score > fuzzy("sp", "rasp").score);
});

test("a file goes to an agent as its path, after the message", async () => {
  const { message } = await load();
  assert.equal(message("review this", "/api/a.js"), "review this\n\nFile: /api/a.js");
  assert.equal(message("hi"), "hi");
});

test("ago says how long, shortly", async () => {
  const { ago } = await load();
  const now = 10 * 86400000;
  assert.equal(ago(null, now), "");
  assert.equal(ago(now - 20000, now), "now");
  assert.equal(ago(now - 4 * 60000, now), "4m");
  assert.equal(ago(now - 3 * 3600000, now), "3h");
  assert.equal(ago(now - 2 * 86400000, now), "2d");
});

test("a blocked agent's question is the lowest line ending in ?, without its box", async () => {
  const { askOf } = await load();
  const screen = "Earlier: why?\n╭──────╮\n│ Do you want to make this edit to login.js? │\n│ ❯ 1. Yes │\n╰──────╯\n";
  assert.equal(askOf(screen), "Do you want to make this edit to login.js?");
  assert.equal(askOf("\x1b[1mAllow command?\x1b[0m"), "Allow command?");
  assert.equal(askOf("all done\n❯ "), null);
  assert.equal(askOf(null), null);
});

test("a tab that needs you shows the question and since when; the last tab is marked", async () => {
  const { search } = await load();
  const timed = spaces.map((s) => ({ ...s, tabs: s.tabs.map((t) => ({ ...t, changed_at: 1000 })) }));
  const rows = search({ spaces: timed, agents, machines: [], commands: [], asks: { "vps/t7": "Allow edit?" }, last: "t1" }, "");
  const deploy = rows.find((r) => r.title === "deploy");
  assert.equal(deploy.sub, "Allow edit?");
  assert.equal(deploy.ask, true);
  assert.equal(deploy.since, 1000);
  assert.equal(rows.find((r) => r.title === "login").last, true);
  assert.equal(search({ agents, spaces: timed, asks: { "vps/t7": "Allow edit?" } }, "@")[0].sub, "Allow edit?");
});

test("visits keep tabs newest first; previous skips here and gone tabs", async () => {
  const { visit, previous } = await load();
  let v = visit(undefined, "a");
  v = visit(v, "b");
  v = visit(v, "a");
  assert.deepEqual(v, ["a", "b"]);
  assert.deepEqual(visit(v, null), v);
  assert.equal(previous(["a", "x", "b"], "a", (id) => id !== "x"), "b");
  assert.equal(previous(["a"], "a", () => true), null);
});

test("sections say how many there are, and Tab shows all of one", async () => {
  const { search, drill } = await load();
  const files = Array.from({ length: 8 }, (_, i) => `src/item${i}.js`);
  const rows = search({ spaces, agents, commands: [], files }, "item");
  const head = rows.find((r) => r.kind === "head" && r.section === "files");
  assert.equal(head.more, "5 of 8");
  assert.equal(drill(rows, rows.length - 1, "item"), "/item");
  assert.equal(drill(search({ spaces, agents, commands: [], files }, "deploy"), 1, "deploy"), null, "Tabs already show them all");
  const loading = search({ spaces, agents, commands: [], files: null }, "deploy");
  assert.deepEqual(loading.at(-1), { kind: "head", title: "Files", section: "files", more: "reading…" });
});

test('? finds lines agents printed, newest first, cut around the match', async () => {
  const { search } = await load();
  const output = { "vps/t7": "npm ERR! missing script\nok\nTypeError: x is undefined", t8: `${"a".repeat(100)} TypeError here` };
  const rows = search({ agents, output }, '?typeerror');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].agent, "vps/t7");
  assert.equal(rows[0].title, "TypeError: x is undefined");
  assert.deepEqual(rows[0].hits.slice(0, 2), [0, 1]);
  assert.ok(rows[1].title.startsWith("…"));
  assert.equal(rows[1].title.slice(rows[1].hits[0], rows[1].hits[0] + 9), "TypeError");
  assert.deepEqual(search({ agents, output }, '?t'), [], "one letter matches everything");
});

test('? lists a line once per agent, without the marks drawn before it', async () => {
  const { search } = await load();
  const rows = search({ agents, output: { t8: "  ⎿  Error: boom\nx\n  ⎿  Error: boom" } }, '?error');
  assert.deepEqual(rows.map((r) => r.title), ["Error: boom"]);
});

test("# lists PRs and $ issues from the panels' helpers", async () => {
  const { search } = await load();
  const prs = [{ number: 12, title: "Fix login", state: "MERGED", isDraft: false, headRefName: "fix-login", author: { login: "ann" }, repository: "o/r", url: "https://github.com/o/r/pull/12" }];
  const issues = [{ identifier: "ENG-3", title: "Login fails", state: { name: "In Progress" }, assignee: { displayName: "sam" }, url: "https://linear.app/x" }];
  assert.deepEqual(search({ prs, issues }, "#login").map((r) => [r.kind, r.title, r.sub, r.state, r.detail, r.repo]), [["pr", "#12 Fix login", "ann · fix-login", "merged", "github.com/o/r/pull/12", "o/r"]]);
  assert.deepEqual(search({ prs, issues }, "$login").map((r) => [r.kind, r.title, r.sub, r.state, r.ref, r.identifier]), [["issue", "ENG-3 Login fails", "sam", "In Progress", "linear:ENG-3", "ENG-3"]]);
  const gh = { source: "github", number: 16, title: "Use titles", state: "CLOSED", assignees: [], author: { login: "jo" }, url: "https://github.com/o/r/issues/16" };
  assert.deepEqual(search({ issues: [gh] }, "$").map((r) => [r.title, r.sub, r.state, r.detail, r.ref, r.identifier]), [["#16 Use titles", "jo", "closed", "github.com/o/r/issues/16", "github:16", null]]);
  assert.deepEqual(search({ prs: null }, "#"), [], "nothing while it looks");
  assert.deepEqual(search({ issues: { error: "no key" } }, "$"), []);
});

test("a GitHub remote names its repository; others don't", async () => {
  const { githubRepo } = await load();
  assert.equal(githubRepo("git@github.com:munza/herdr-mods.git\n"), "munza/herdr-mods");
  assert.equal(githubRepo("https://github.com/munza/herdr-mods"), "munza/herdr-mods");
  assert.equal(githubRepo("ssh://git@github-work/o/r.git"), "o/r");
  assert.equal(githubRepo("https://gitlab.com/o/r.git"), null);
  assert.equal(githubRepo(""), null);
});

test("reveal picks a mod's block in its stack and shows what's hidden on the way", async () => {
  const { reveal } = await load();
  const root = { id: "root", type: "row", children: [
    { id: "panel", type: "column", hidden: true, children: [
      { id: "panel-body", type: "stack", active: "files", children: [
        { id: "files", type: "block", content: { mod: "better-files" } },
        { id: "pull-requests", type: "block", content: { mod: "branch-pr" } },
      ] },
    ] },
  ] };
  assert.deepEqual(reveal(root, "branch-pr"), [["layout.select", { stack: "panel-body", child: "pull-requests" }], ["layout.show", { id: "panel" }]]);
  assert.deepEqual(reveal(root, "better-files"), [["layout.show", { id: "panel" }]]);
  assert.equal(reveal(root, "branch-issue"), null);
});
