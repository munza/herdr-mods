// Better Alerts against stand-ins for Herdr. Nothing here posts a real notification or reads a
// real screen.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.join(__dirname, "../mods/better-alerts");

function harness({ platform = "linux", settings = null, exec, screens = {}, checking = false } = {}) {
  const live = { agents: [], terminals: [], focused: null, active: true };
  const ran = [], read = [], timers = [], warned = [], badges = [];
  let settingsReads = 0;
  const cx = { notify() {}, spawn(fn) { fn(cx); }, timer: { every: (ms, fn) => timers.push({ ms, fn }) } };
  const context = {
    View: class {},
    div: () => ({ kind: "div" }),
    agents: () => live.agents,
    terminals: () => live.terminals,
    focused: () => live.focused,
    window: () => ({ platform, active: live.active }),
    appHome: () => "/app",
    checking: () => checking,
    setBadge: (text) => badges.push(text),
    hc: async (args) => (read.push(args), screens[args[1]] == null ? { code: 1, stdout: "", stderr: "no such terminal" } : { code: 0, stdout: screens[args[1]], stderr: "" }),
    readTextFile: async () => {
      settingsReads++;
      return settings ? JSON.stringify({ settings }) : null;
    },
    exec: exec ?? (async (bin, args) => (ran.push([bin, ...args]), { code: 0, stdout: "", stderr: "" })),
    console: { ...console, warn: (m) => warned.push(m) },
  };
  vm.createContext(context);
  const source = ["settings.js", "words.js", "main.js"]
    .map((f) => fs.readFileSync(path.join(root, f), "utf8"))
    .join("\n")
    .replace(/^import\s+[\s\S]*?;$/gm, "")
    .replace(/^export default (\w+);?$/m, "globalThis.Mod = $1;")
    .replace(/^export default class (\w+)/m, "globalThis.Mod = class $1")
    .replace(/^export /gm, "");
  vm.runInContext(source, context);
  const agent = (address, status, over = {}) => ({
    address, status, tab: `tab-${address}`, space_name: "lantern-app", tab_name: "Fix the login form",
    program: { name: "Claude Code" }, ...over,
  });
  const start = () => {
    const mod = new context.Mod();
    mod.init({}, cx);
    return mod;
  };
  // Runs the timer, then lets the posts it started read the screen and hand over.
  const tick = async () => { timers.forEach((t) => t.fn(cx)); await settle(); };
  // The notifications posted: [title, body, target] from the detached script's arguments.
  const posted = () => ran.map((r) => r.slice(-3)).map(([title, body, target]) => ({ title, body, target: JSON.parse(target) }));
  return { live, ran, read, timers, warned, badges, get settingsReads() { return settingsReads; }, agent, start, tick, posted, cx, context };
}
function settle() {
  return new Promise((done) => setImmediate(done));
}

test("an agent that needs you posts a notification, once", async () => {
  const h = harness();
  h.live.agents = [h.agent("t1", "working")];
  h.start();
  h.live.agents = [h.agent("t1", "blocked")];
  await h.tick();
  await h.tick();
  assert.deepEqual(h.posted(), [{ title: "Claude Code / lantern-app - NEEDS YOU", body: "Fix the login form", target: { terminal: "t1" } }]);
});

test("a finished agent posts only after it was busy, and only when you aren't looking at it", async () => {
  const h = harness();
  h.live.agents = [h.agent("t1", "working"), h.agent("t2", "idle"), h.agent("t3", "working")];
  h.live.focused = { tab: "tab-t3" };
  h.start();
  h.live.agents = [h.agent("t1", "done"), h.agent("t2", "done"), h.agent("t3", "done")];
  await h.tick();
  assert.deepEqual(h.posted().map((p) => p.title + " " + p.target.terminal), ["Claude Code / lantern-app - DONE t1"]);
  // Looking at its tab but with Herdr in the background counts as not looking.
  h.live.active = false;
  h.live.agents = [h.agent("t3", "working")];
  await h.tick();
  h.live.agents = [h.agent("t3", "done")];
  await h.tick();
  assert.deepEqual(h.posted().map((p) => p.target.terminal), ["t1", "t3"]);
});

test("agents already in a state when it starts, sub-agents and agents that left post nothing", async () => {
  const h = harness();
  h.live.agents = [h.agent("t1", "blocked")];
  h.live.terminals = [{ address: "t9", parent: "t1" }];
  h.start();
  h.live.agents = [h.agent("t1", "blocked"), h.agent("t9", "working")];
  await h.tick();
  h.live.agents = [h.agent("t1", "blocked"), h.agent("t9", "blocked")];
  await h.tick();
  assert.deepEqual(h.posted(), []);
  // An agent that leaves and comes back starts fresh.
  h.live.agents = [];
  await h.tick();
  h.live.agents = [h.agent("t1", "blocked")];
  await h.tick();
  assert.deepEqual(h.posted().map((p) => p.target.terminal), ["t1"]);
});

test("the name is the program's, else the app's, the title's, or the address", async () => {
  const h = harness();
  const kinds = [
    h.agent("a", "working", { program: { name: "Codex" } }),
    h.agent("b", "working", { program: null, app: "pi" }),
    h.agent("c", "working", { program: null, app: null, title: "Review" }),
    h.agent("d", "working", { program: null, app: null, title: null }),
  ];
  h.live.agents = kinds;
  h.start();
  h.live.agents = kinds.map((a) => ({ ...a, status: "blocked" }));
  await h.tick();
  assert.deepEqual(h.posted().map((p) => p.title), ["Codex / lantern-app - NEEDS YOU", "pi / lantern-app - NEEDS YOU", "Review / lantern-app - NEEDS YOU", "d / lantern-app - NEEDS YOU"]);
});

test("the notification is handed to notify-send in a detached shell, and a click opens the agent", async () => {
  const h = harness();
  h.live.agents = [h.agent("t1", "working")];
  h.start();
  h.live.agents = [h.agent("t1", "blocked")];
  await h.tick();
  const [bin, flag, detach, , script] = h.ran[0];
  assert.equal(bin, "sh");
  assert.equal(flag, "-c");
  assert.match(detach, /^setsid -f sh -c "\$1" sh "\$2" "\$3" "\$4" >\/dev\/null 2>&1 <\/dev\/null$/);
  assert.match(script, /notify-send -a Herdr -i herdr-app -A default=Open -- "\$1" "\$2"/);
  assert.match(script, /herdr-app do agent\.focus "\$3"/);
  assert.match(script, /hl\.dsp\.focus\(\{ window = "class:\^\(herdr-app\)\$" \}\)'[^\n]*\|\|\n\s*hyprctl dispatch focuswindow 'class:\^\(herdr-app\)\$'/);
});

test("each kind of alert can be turned off in the settings", async () => {
  const h = harness({ settings: { alerts: { done: false } } });
  h.live.agents = [h.agent("t1", "working"), h.agent("t2", "working")];
  h.start();
  await settle();
  h.live.agents = [h.agent("t1", "done"), h.agent("t2", "blocked")];
  await h.tick();
  assert.deepEqual(h.posted().map((p) => p.target.terminal), ["t2"]);
  const off = harness({ settings: { alerts: { blocked: false } } });
  off.live.agents = [off.agent("t1", "working")];
  off.start();
  await settle();
  off.live.agents = [off.agent("t1", "blocked")];
  await off.tick();
  assert.deepEqual(off.posted(), []);
});

test("on Windows it does nothing; on Linux and macOS it checks twice a second; it draws nothing", async () => {
  const h = harness({ platform: "windows" });
  h.live.agents = [h.agent("t1", "working")];
  const mod = h.start();
  assert.equal(h.timers.length, 0);
  assert.deepEqual(mod.render(), { kind: "div" });
  for (const platform of ["linux", "macos"]) {
    const on = harness({ platform });
    on.start();
    assert.deepEqual(on.timers.map((t) => t.ms), [500]);
    assert.deepEqual(on.badges, platform === "macos" ? [null] : []);
  }
});

test("check mode reads no settings and starts no timers, notifications or badges", () => {
  const h = harness({ platform: "macos", checking: true });
  h.live.agents = [h.agent("t1", "blocked")];
  const mod = h.start();
  assert.equal(h.settingsReads, 0);
  assert.equal(h.timers.length, 0);
  assert.deepEqual(h.ran, []);
  assert.deepEqual(h.badges, []);
  assert.deepEqual(mod.render(), { kind: "div" });
});

test("the macOS Dock badge counts blocked top-level agents and clears when none remain", async () => {
  const h = harness({ platform: "macos" });
  h.live.agents = [
    h.agent("t1", "blocked"),
    h.agent("t2", "blocked"),
    h.agent("child", "blocked"),
  ];
  h.live.terminals = [{ address: "child", parent: "t1" }];
  const mod = h.start();
  await settle();
  assert.deepEqual(h.badges, ["2"]);

  h.live.agents = [
    h.agent("t1", "blocked"),
    h.agent("t2", "working"),
    h.agent("child", "blocked"),
  ];
  await h.tick();
  assert.deepEqual(h.badges, ["2", "1"]);

  h.live.agents = [
    h.agent("t1", "working"),
    h.agent("t2", "working"),
    h.agent("child", "blocked"),
  ];
  await h.tick();
  assert.deepEqual(h.badges, ["2", "1", null]);
  await h.tick();
  assert.deepEqual(h.badges, ["2", "1", null]);
  assert.equal(typeof mod.check, "function");
});

test("on macOS HerdrAlerts.app posts it, with the tab on its own line, and osascript stands in until it's built", async () => {
  const screens = { t1: "  Do you want to make this edit to login.js?\n  ❯ 1. Yes\n" };
  const h = harness({ platform: "macos", screens });
  h.live.agents = [h.agent("t1", "working")];
  h.start();
  h.live.agents = [h.agent("t1", "blocked")];
  await h.tick();
  const [bin, flag, script, , app, title, tab, message, target] = h.ran[0];
  assert.equal(bin, "sh");
  assert.equal(flag, "-c");
  assert.equal(app, "/app/mods/better-alerts/bin/HerdrAlerts.app");
  assert.deepEqual([title, tab, message, JSON.parse(target)],
    ["Claude Code / lantern-app - NEEDS YOU", "Fix the login form", "Do you want to make this edit to login.js?", { terminal: "t1" }]);
  assert.match(script, /herdr=\$\(command -v herdr-app \|\| true\)/);
  assert.match(script, /\[ -d "\$1" \] && exec open -g -n "\$1" --args post "\$2" "\$3" "\$4" "\$5" "\$herdr"/);
  assert.match(script, /exec osascript .*display notification \(item 3 of argv\) with title \(item 1 of argv\) subtitle \(item 2 of argv\).* "\$2" "\$3" "\$4"$/m);
  assert.doesNotMatch(script, /setsid/);
});

test("the body says the tab, then what the agent asked or how its reply began, safe for markup", async () => {
  const screens = {
    t1: "⏺ Bash(npm test)\n  ⎿ 42 passing\n\n⏺ All 42 tests pass. The form now checks that a < b & c.\n\n✻ Worked for 12s\n───\n❯ \n───\n  ⏵⏵ auto mode on (shift+tab to cycle)\n",
  };
  const h = harness({ screens });
  h.live.agents = [h.agent("t1", "working"), h.agent("t2", "working", { tab_name: "lantern-app" })];
  h.start();
  h.live.agents = [h.agent("t1", "done"), h.agent("t2", "blocked", { tab_name: "lantern-app" })];
  h.live.active = false;
  await h.tick();
  assert.deepEqual(h.posted().map((p) => p.body), [
    "Fix the login form · All 42 tests pass. The form now checks that a &lt; b &amp; c.",
    "",
  ]);
  assert.equal(JSON.stringify(h.read), JSON.stringify([["read", "t1", "--lines", "80"], ["read", "t2", "--lines", "80"]]));
});

test("the title says whose, in which space, and its status; the tab says more than the space or nothing", () => {
  const { context: c, agent } = harness();
  assert.equal(c.title(agent("a", "done")), "Claude Code / lantern-app - DONE");
  assert.equal(c.title(agent("a", "blocked", { space_name: "" })), "Claude Code - NEEDS YOU");
  assert.equal(c.tab(agent("a", "done")), "Fix the login form");
  assert.equal(c.tab(agent("a", "done", { tab_name: "lantern-app" })), "");
  assert.equal(c.tab(agent("a", "done", { tab_name: "2" })), "");
  assert.equal(c.tab(agent("a", "done", { tab_name: "" })), "");
});

test("the question is the lowest line ending in ?, without box sides or markers", () => {
  const { context: c } = harness();
  const screen = "Is this old?\n╭──────╮\n│ Do you want to proceed?   │\n│ ❯ 1. Yes │\n╰──────╯\n  ? for shortcuts\n";
  assert.equal(c.question(screen), "Do you want to proceed?");
  assert.equal(c.question("\x1b[1mAllow command?\x1b[0m"), "Allow command?");
  assert.equal(c.question("no question here\n"), null);
});

test("a finished reply is read from its start, under the person's prompt, past the chrome below it", () => {
  const { context: c } = harness();
  // Claude Code: a long reply opened with ⏺, after a tool call, cut at a word.
  const claude = [
    "❯ fix the login form", "", "⏺ Read(login.js)", "  ⎿ Read 40 lines", "",
    "⏺ The login form now checks the email before it sends, and shows what's wrong under the field.",
    "  I added three tests for it, and all 42 pass. Nothing else changed in the app or its styles.",
    "", "✻ Sautéed for 1m 16s · done 2:42 AM", "", "※ recap: you asked …", "",
    "⏺ Compacted while idle · turn off with \"idleCompaction\": false", "",
    "─────", "❯ ", "─────", "  ⏵⏵ auto mode on (shift+tab to cycle)",
  ].join("\n");
  const said = c.result(claude);
  assert.ok(said.startsWith("The login form now checks the email before it sends"), said);
  assert.ok(said.endsWith("…") && said.length <= 140, said);
  // Codex: its reply is the last bullet, above its › prompt.
  assert.equal(c.result("› plan the maps\n\n• Ran ls\n\n• Offline maps are planned in PLAN.md.\n\n› \n"), "Offline maps are planned in PLAN.md.");
  // No markers: the last paragraph.
  assert.equal(c.result("old line\n\nDone. Two files\nchanged.\n$ \n"), "Done. Two files changed.");
  assert.equal(c.result("───\n❯ \n"), null);
  assert.equal(c.result(""), null);
});

test("a screen that can't be read leaves the message out", async () => {
  const h = harness({ platform: "macos" });
  h.live.agents = [h.agent("t1", "working")];
  h.start();
  h.live.agents = [h.agent("t1", "blocked")];
  await h.tick();
  assert.equal(h.ran[0][7], "");
  assert.equal(h.ran[0][6], "Fix the login form");
});

test("a notification that can't be handed over is reported once, not on every alert", async () => {
  const h = harness({ exec: async () => { throw new Error("exec: sh not found"); } });
  h.live.agents = [h.agent("t1", "working"), h.agent("t2", "working")];
  h.start();
  h.live.agents = [h.agent("t1", "blocked"), h.agent("t2", "blocked")];
  await h.tick();
  await settle();
  assert.deepEqual(h.warned, ["better-alerts: couldn't post a notification: Error: exec: sh not found"]);
});

test("the mod ships its manifest, schema and settings, and docks nowhere", async () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "mod.json"), "utf8"));
  assert.equal(manifest.place, "none");
  assert.equal(manifest.title, "Better Alerts");
  assert.equal(manifest.version, "1.2.0");
  assert.equal(manifest.$schema, "./mod.schema.json");
  const schema = JSON.parse(fs.readFileSync(path.join(root, "mod.schema.json"), "utf8"));
  assert.deepEqual(Object.keys(schema.properties.settings.properties.alerts.properties), ["blocked", "done"]);
});
