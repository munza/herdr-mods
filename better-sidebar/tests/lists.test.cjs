// The lists view: spaces and agents in one block, under tabs or one above the other.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const runtime = path.join(__dirname, "../mods/better-sidebar");

function element() {
  const node = { nodes: [], handlers: {}, background: undefined };
  const proxy = new Proxy(node, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === "child") return (c) => (target.nodes.push(c), proxy);
      if (key === "children") return (c) => (target.nodes.push(...c), proxy);
      if (key === "when") return (c, build) => (c && build(proxy), proxy);
      return (...args) => {
        if (key === "id") target.id = args[0];
        if (key === "bg") target.background = args[0];
        if (key === "on_click") target.handlers.click = args[0];
        return proxy;
      };
    },
  });
  return proxy;
}

async function harness({ settings = {}, tab = null, panes = [], sharedValues = {} } = {}) {
  const pending = [];
  const stored = { "lists.tab": tab };
  const live = { order: [] };
  const tabOf = (id) => ({ id, name: id });
  const spaces = [
    { id: "shop", name: "shop", folder: "/shop", tabs: [tabOf("a"), tabOf("b"), tabOf("d")] },
    { id: "docs", name: "docs", folder: "/docs", tabs: [tabOf("c")] },
  ];
  const agent = (address, space, tab, status) => ({
    address,
    space,
    space_name: space,
    tab,
    tab_name: { a: "1", b: "2", c: "1" }[tab],
    program: { name: "Claude Code" },
    status,
    pane: `p-${address}`,
    seq: 1,
  });
  const agents = [agent("t1", "shop", "a", "idle"), agent("t2", "docs", "c", "done"), agent("t3", "shop", "b", "blocked")];
  live.agents = agents;
  const cx = { notify() {}, stop_propagation() {}, timer: { every() {} }, focus_handle: () => ({}), spawn: (fn) => pending.push(fn(cx)) };
  const context = {
    Date, JSON, Map, Set, Math, console,
    View: class {},
    div: element, svg: (p) => element().child(`svg:${p}`), image: (p) => element().child(`image:${p}`), v_flex: element, h_flex: element,
    Popover: { new: (id) => element().id(id) },
    ScrollHandle: { new: () => ({ scroll_to_item() {} }) },
    spaces: () => spaces,
    agents: () => agents,
    terminals: () => [],
    panes: () => panes,
    focused: () => null,
    machines: () => [],
    theme: () => new Proxy({}, { get: (_t, k) => String(k) }),
    layout: () => ({ id: "sidebar", size: { px: 268 } }),
    window: () => ({ active: true, platform: "macos" }),
    props: () => ({ view: "lists" }),
    shared: (k) => sharedValues[k],
    setShared() {},
    setAgentOrder: (list) => (live.order = [...list]),
    run() {},
    openOverlay() {},
    hc: async () => ({ code: 0, stdout: '{"machines":[]}' }),
    checking: () => false,
    watchFolder: async () => { throw Error("No watcher in tests"); },
    exec: async () => ({ code: 1, stdout: "" }),
    appHome: () => "/app",
    readTextFile: async () => JSON.stringify({ settings }),
    localStorage: { getItem: (k) => stored[k] ?? null, setItem: (k, v) => (stored[k] = v) },
  };
  vm.createContext(context);
  // Each file in its own scope, as a module is; its exports become globals for the next.
  for (const file of ["settings.js", "defaults.js", "git/pr-status.js", "git/checkouts.js", "views/find-node.js", "views/ui.js", "views/spaces.js", "views/agents.js", "views/lists.js"]) {
    const source = fs.readFileSync(path.join(runtime, file), "utf8").replace(/^import\s+[\s\S]*?;\n/gm, "");
    const names = [...source.matchAll(/^export (?:async )?(?:class|function|const) (\w+)/gm)].map((m) => m[1]);
    vm.runInContext(`Object.assign(globalThis, (() => { ${source.replaceAll("export ", "")}\nreturn { ${names.join(", ")} }; })());`, context);
  }
  const mod = new context.Lists();
  mod.init({}, cx);
  while (pending.length) await Promise.all(pending.splice(0));
  return { mod, live, stored, cx, context };
}

const find = (node, id) => (node?.id === id ? node : node?.nodes?.map((n) => find(n, id)).find(Boolean));
const ids = (node, out = []) => (node?.id && out.push(node.id), (node?.nodes ?? []).forEach((n) => ids(n, out)), out);
const text = (node) => (typeof node === "string" ? node : (node?.nodes ?? []).map(text).join(" "));

test("Spaces shows each space's tabs beneath it, as their agents where they have any, and next-agent keys follow that order", async () => {
  const { mod, live } = await harness();
  const drawn = ids(mod.render()).filter((id) => /^(space-(shop|docs)|ag-t\d|tab-\w)$/.test(id));
  assert.deepEqual(drawn, ["space-shop", "ag-t1", "ag-t3", "tab-d", "space-docs", "ag-t2"]);
  // Its tab's title, then its program, quietly.
  assert.match(text(find(mod.render(), "ag-t1")), /^\s*1\s+Claude Code/);
  assert.deepEqual(live.order, ["t1", "t3", "t2"]);
});

for (const tab of ["spaces", "agents"]) {
  for (const agent_name of ["tab", "title"]) {
    test(`${tab} shows the pane name until cleared in ${agent_name} mode`, async () => {
      const { mod, live } = await harness({ tab, settings: { agent_name } });
      const first = live.agents[0];
      Object.assign(first, { tab_name: "Build", title: "Compiling" });
      const second = { ...first, address: "t4", pane: "p-t4", title: "Checking", pane_name: "[tests]" };
      live.agents.push(second);

      const row = (tree, id) => text(find(tree, id)).trim().split(/\s+/)[0];
      const tree = mod.render();
      assert.equal(row(tree, "ag-t1"), agent_name === "tab" ? "Build" : "Compiling");
      assert.equal(row(tree, "ag-t4"), "[tests]");
      second.pane_name = null;
      assert.equal(row(mod.render(), "ag-t4"), agent_name === "tab" ? "Build" : "Checking");
    });
  }
}

test("Spaces shows a named shell beside a named agent, in pane order, and focuses each exact pane", async () => {
  const shell = { pane: "p-shell", terminal: "shell", tab: "a", name: "a", program: { name: "fish" }, focused: true };
  const agent = { pane: "p-t1", terminal: "t1", tab: "a", name: "b" };
  const other = { pane: "p-other", terminal: "other", tab: "c", name: "elsewhere", focused: true };
  const panes = [shell, agent, other];
  const { mod, live, context, cx } = await harness({ panes });
  live.agents[0].pane_name = agent.name;
  context.spaces()[0].active = true;
  context.focused = () => ({ space: "shop", tab: "a", pane: shell.pane });
  const calls = [];
  context.run = (command, { pane }) => calls.push([command, pane]);

  const split = (tree) => ids(tree).filter((id) => ["pane-p-shell", "ag-t1", "tab-a"].includes(id));
  let tree = mod.render();
  assert.deepEqual(split(tree), ["pane-p-shell", "ag-t1"]);
  assert.match(text(find(tree, "pane-p-shell")), /^\s*a\s+fish/);
  assert.match(text(find(tree, "ag-t1")), /^\s*b\s+Claude Code/);
  assert.equal(find(tree, "pane-p-shell").background, "selected");
  assert.equal(find(tree, "pane-p-other").background, undefined);
  assert.equal(find(tree, "space-shop").background, undefined);
  assert.deepEqual(live.order, ["t1", "t3", "t2"]);

  find(tree, "pane-p-shell").handlers.click();
  find(tree, "ag-t1").handlers.click();
  find(tree, "pane-p-other").handlers.click();
  assert.deepEqual(calls, [["pane.focus", shell.pane], ["pane.focus", agent.pane], ["pane.focus", other.pane]]);

  // A tab remembers its pane, but only the actual window focus lights up.
  panes.splice(0, 2, agent, shell);
  live.agents[0].focused = true;
  context.focused = () => ({ space: "shop", tab: "a", pane: agent.pane, agent: agent.terminal });
  tree = mod.render();
  assert.deepEqual(split(tree), ["ag-t1", "pane-p-shell"]);
  assert.equal(find(tree, "ag-t1").background, "selected");
  assert.equal(find(tree, "pane-p-shell").background, undefined);

  mod.pick("agents", cx);
  tree = mod.render();
  assert.equal(find(tree, "pane-p-shell"), undefined);
  assert.equal(find(tree, "pane-p-other"), undefined);
  assert.match(text(find(tree, "lists-tab-agents")), /Agents 3/);
});

test("a named pane switches from terminal to agent and back without a duplicate", async () => {
  const pane = { pane: "p-shell", terminal: "shell", tab: "a", name: "a", program: { name: "Codex", agent: true } };
  const { mod, live } = await harness({ panes: [pane, { pane: "p-t1", terminal: "t1", tab: "a" }] });
  const split = () => ids(mod.render()).filter((id) => ["pane-p-shell", "ag-shell", "ag-t1", "tab-a"].includes(id));
  assert.deepEqual(split(), ["pane-p-shell", "ag-t1"]);
  const agent = { ...live.agents[0], address: pane.terminal, pane: pane.pane, pane_name: pane.name };
  live.agents.unshift(agent);
  assert.deepEqual(split(), ["ag-shell", "ag-t1"]);
  live.agents.shift();
  assert.deepEqual(split(), ["pane-p-shell", "ag-t1"]);
  pane.name = null;
  assert.deepEqual(split(), ["ag-t1"]);
});

test("a named pinned or kept sub-agent keeps its agent row without adding a terminal row", async () => {
  const pinned = { pane: "p-t1", terminal: "t1", tab: "a", name: "pinned" };
  const child = { pane: "p-child", terminal: "child", tab: "a", name: "child" };
  const quiet = { pane: "p-quiet", terminal: "quiet", tab: "a", name: "quiet child" };
  const shell = { pane: "p-shell", terminal: "shell", tab: "a", name: "shell" };
  const { mod, live, context } = await harness({ panes: [pinned, child, quiet, shell] });
  Object.assign(live.agents[0], { pinned: true, pane_name: pinned.name });
  live.agents.push({ ...live.agents[0], address: child.terminal, pane: child.pane, pane_name: child.name, pinned: false });
  context.terminals = () => [child, quiet].map(({ terminal }) => ({ address: terminal, parent: pinned.terminal, state: "live" }));
  context.spaces()[0].active = true;
  context.focused = () => ({ space: "shop", tab: quiet.tab, pane: quiet.pane });
  const tree = mod.render();
  const drawn = ids(tree).filter((id) => /^(ag-t1|ag-child|sub-child|sub-quiet|pane-p-|tab-a)/.test(id));
  assert.deepEqual(drawn, ["ag-t1", "sub-child", "sub-quiet", "pane-p-shell"]);
  const quietRow = find(tree, "sub-quiet");
  assert.match(text(quietRow), /quiet child/);
  assert.equal(quietRow.background, "raised");
  assert.equal(find(tree, "space-shop").background, undefined);
  const calls = [];
  context.run = (command, { pane }) => calls.push([command, pane]);
  quietRow.handlers.click();
  assert.deepEqual(calls, [["pane.focus", quiet.pane]]);
});

test("a kept sub-agent in a separate tab keeps that tab's fallback entry", async () => {
  const pane = { pane: "p-child", terminal: "child", tab: "d", name: "child" };
  const { mod, live, context } = await harness({ panes: [pane] });
  live.agents.push({ ...live.agents[0], address: pane.terminal, pane: pane.pane, tab: pane.tab, pane_name: pane.name });
  context.terminals = () => [{ address: pane.terminal, parent: "t1", state: "live" }];
  const drawn = ids(mod.render()).filter((id) => ["ag-child", "sub-child", "pane-p-child", "tab-d"].includes(id));
  assert.deepEqual(drawn, ["sub-child", "tab-d"]);
});

test("an unsettled shell-only tab keeps a tab row for its unnamed panes", async () => {
  const shell = { pane: "p-shell", terminal: "shell", tab: "d", name: "named" };
  const plain = { pane: "p-plain", terminal: "plain", tab: "d", name: null };
  const panes = [shell, plain];
  const { mod, context } = await harness({ panes });
  const tab = context.spaces()[0].tabs.find(({ id }) => id === "d");
  context.focused = () => ({ tab: tab.id, pane: shell.pane });
  const drawn = (tree) => ids(tree).filter((id) => ["pane-p-shell", "tab-d"].includes(id));
  let tree = mod.render();
  assert.deepEqual(drawn(tree), ["pane-p-shell", "tab-d"]);
  assert.equal(find(tree, "pane-p-shell").background, "selected");
  assert.equal(find(tree, "tab-d").background, undefined);
  context.focused = () => ({ tab: tab.id, pane: plain.pane });
  tree = mod.render();
  assert.equal(find(tree, "tab-d").background, "selected");
  const calls = [];
  context.run = (command, { id }) => calls.push([command, id]);
  find(tree, "tab-d").handlers.click();
  assert.deepEqual(calls, [["space.select", "shop"], ["tab.select", "d"]]);

  panes.pop();
  assert.deepEqual(drawn(mod.render()), ["pane-p-shell"]);
  shell.name = null;
  assert.deepEqual(drawn(mod.render()), ["tab-d"]);
  shell.name = "named";
  tab.settled = true;
  assert.deepEqual(drawn(mod.render()), []);
});

test("the Agents tab counts agents, and picking a tab keeps it", async () => {
  const { mod, stored, cx } = await harness();
  const root = mod.render();
  assert.match(text(find(root, "lists-tab-agents")), /Agents 3/);
  assert.equal(find(root, "lists-tab-unread"), undefined);
  find(root, "lists-tab-agents").handlers.click({}, cx);
  assert.equal(stored["lists.tab"], "agents");
});

test("the tab picked last comes back, and an old Unread one falls back to Spaces", async () => {
  assert.ok(find((await harness({ tab: "unread" })).mod.render(), "space-shop"));
  const { mod } = await harness({ tab: "agents" });
  const root = mod.render();
  assert.ok(find(root, "ag-list"));
  assert.equal(find(root, "space-shop"), undefined);
});

test("combined off puts spaces above agents, without tabs", async () => {
  const { mod } = await harness({ settings: { combined: false } });
  const root = mod.render();
  assert.equal(find(root, "lists-tab-spaces"), undefined);
  assert.ok(find(root, "space-shop"));
  assert.ok(find(root, "ag-list"));
  assert.equal(find(root, "space-agents-shop"), undefined);
});

test("in Spaces a pinned agent sits above every space", async () => {
  const { mod, live } = await harness();
  live.agents.find((a) => a.address === "t3").pinned = true;
  const drawn = ids(mod.render()).filter((id) => /^ag-t\d$/.test(id));
  assert.deepEqual(drawn, ["ag-t3", "ag-t1", "ag-t2"]);
  const order = ids(mod.render()).filter((id) => /^(space-(shop|docs)|ag-t\d)$/.test(id));
  assert.deepEqual(order, ["ag-t3", "space-shop", "ag-t1", "space-docs", "ag-t2"]);

});

test("a mod's tab shows its pane's own published icon before the mod's, in colour when it says so", async () => {
  const panes = [{ pane: "pd", tab: "d", mod: "better-files" }];
  const modIcons = { "better-files": "mods/better-files/icons/file.svg" };
  const { mod } = await harness({
    panes,
    sharedValues: { "mod-icons": modIcons, "pane-heads": { pd: { icon: "mods/better-icons/icons/javascript.svg", color: true } } },
  });
  const row = text(find(mod.render(), "tab-d"));
  assert.match(row, /image:mods\/better-icons\/icons\/javascript\.svg/);
  assert.doesNotMatch(row, /svg:mods\/better-files/);
  const { mod: plain } = await harness({
    panes,
    sharedValues: { "mod-icons": modIcons, "pane-heads": { pd: { icon: "mods/better-changes/icons/file.svg" } } },
  });
  assert.match(text(find(plain.render(), "tab-d")), /svg:mods\/better-changes\/icons\/file\.svg/);
  const { mod: other } = await harness({
    panes,
    sharedValues: { "mod-icons": modIcons, "pane-heads": { p9: { icon: "mods/better-icons/icons/javascript.svg", color: true } } },
  });
  assert.match(text(find(other.render(), "tab-d")), /svg:mods\/better-files\/icons\/file\.svg/);
});

test("a split mod tab shows the head any of its panes published", async () => {
  const { mod } = await harness({
    panes: [
      { pane: "pa", tab: "d", mod: "branch-pr" },
      { pane: "pd", tab: "d", mod: "better-files" },
    ],
    sharedValues: {
      "mod-icons": { "branch-pr": "mods/branch-pr/pull-request.svg" },
      "pane-heads": { pd: { icon: "mods/better-icons/icons/javascript.svg", color: true } },
    },
  });
  const row = text(find(mod.render(), "tab-d"));
  assert.match(row, /image:mods\/better-icons\/icons\/javascript\.svg/);
  assert.doesNotMatch(row, /pull-request/);
});

test("an Agents row reads its tab's title, then its space", async () => {
  const { mod } = await harness({ tab: "agents" });
  assert.match(text(find(mod.render(), "ag-t1")), /^\s*1\s+shop/);
});

test("a mod's tab shows the icon the mod publishes, and a tab with neither keeps the gap", async () => {
  const { mod } = await harness({
    panes: [{ pane: "pd", tab: "d", mod: "better-files" }],
    sharedValues: { "mod-icons": { "better-files": "mods/better-files/icons/file.svg" } },
  });
  assert.match(text(find(mod.render(), "tab-d")), /svg:mods\/better-files\/icons\/file\.svg/);
  const { mod: bare } = await harness();
  assert.doesNotMatch(text(find(bare.render(), "tab-d")), /svg:/);
});

test("the Spaces tab offers the space sort beside New space, and Agents its own sort", async () => {
  const { mod } = await harness({ tab: "spaces" });
  const tree = mod.render();
  assert.ok(find(tree, "space-sort-menu"), "space sort on Spaces");
  assert.ok(find(tree, "space-new"));
  const { mod: agentsTab } = await harness({ tab: "agents" });
  const other = agentsTab.render();
  assert.equal(find(other, "space-sort-menu"), undefined);
  assert.ok(find(other, "ag-sort-menu"));
});

test("combined render reuses one spaces/panes snapshot and shared icon maps across plain tabs", async () => {
  const manySpaces = Array.from({ length: 10 }, (_, i) => ({
    id: `s${i}`,
    name: `space-${i}`,
    folder: `/repo-${i}`,
    tabs: [
      { id: `ag${i}`, name: `agent-${i}` },
      { id: `pl${i}`, name: `plain-${i}` },
    ],
  }));
  const manyAgents = Array.from({ length: 10 }, (_, i) => ({
    address: `a${i}`,
    space: `s${i}`,
    space_name: `space-${i}`,
    tab: `ag${i}`,
    tab_name: `agent-${i}`,
    program: { name: "Claude Code" },
    status: "idle",
    pane: `pa${i}`,
    seq: i,
  }));
  const manyPanes = Array.from({ length: 10 }, (_, i) => ({
    pane: `pp${i}`,
    tab: `pl${i}`,
    mod: "better-files",
  }));
  const sharedValues = {
    "mod-icons": { "better-files": "mods/better-files/icons/file.svg" },
    "pane-heads": { pp0: { icon: "mods/better-icons/icons/javascript.svg", color: true } },
  };
  const { mod, context } = await harness({ panes: manyPanes, sharedValues });
  context.spaces = () => manySpaces;
  context.agents = () => manyAgents;
  for (const s of manySpaces) mod.spaces.shown.add(s.id);
  const counts = { spaces: 0, panes: 0, agents: 0, terminals: 0, focused: 0, shared: 0 };
  for (const name of Object.keys(counts)) {
    const orig = context[name];
    context[name] = (...args) => {
      counts[name]++;
      return orig(...args);
    };
  }
  const tree = mod.render();
  assert.deepEqual(counts, { spaces: 1, panes: 1, agents: 1, terminals: 1, focused: 1, shared: 6 });
  assert.equal(mod.spaces.renderFrame, null);
  assert.match(text(find(tree, "tab-pl0")), /image:mods\/better-icons\/icons\/javascript\.svg/);
  assert.match(text(find(tree, "tab-pl1")), /svg:mods\/better-files\/icons\/file\.svg/);
});

test("combined render replaces a stale spaces renderFrame left by an interrupted pass", async () => {
  const { mod, context } = await harness({
    panes: [
      { pane: "p-t1", terminal: "t1", tab: "a", cwd: "/shop" },
      { pane: "p-d", terminal: "t4", tab: "d", cwd: "/shop", program: { name: "fish", shell: true } },
    ],
  });
  context.spaces = () => [
    {
      id: "shop",
      name: "shop",
      folder: "/shop",
      tabs: [
        { id: "a", name: "a" },
        { id: "d", name: "shop fish" },
      ],
    },
  ];
  mod.spaces.renderFrame = {
    sp: [{ id: "shop", name: "stale-shop", folder: "/shop", tabs: [{ id: "a", name: "a" }] }],
    ps: [{ pane: "p-t1", terminal: "t1", tab: "a", cwd: "/shop" }],
    ms: [],
    sort: { id: "manual" },
    colors: {},
    folderBySpace: new Map([["shop", "/shop"]]),
    branchBySpace: new Map(),
    checkoutKeyBySpace: new Map([["shop", '[null,"/shop"]']]),
    statusBySpace: new Map(),
  };
  const tree = mod.render();
  assert.equal(mod.spaces.renderFrame, null);
  assert.ok(find(tree, "tab-d"), "new plain terminal tab appears instead of stale renderFrame");
  assert.ok(!text(tree).includes("stale-shop"));
});

