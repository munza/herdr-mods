const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.join(__dirname, "../mods/better-config");
const model = import(`data:text/javascript,${encodeURIComponent(fs.readFileSync(path.join(root, "model.js"), "utf8"))}`);
const source = fs.readFileSync(path.join(root, "main.js"), "utf8")
  .replace(/^import[\s\S]*?;\n/gm, "")
  .replace("export default class BetterConfig", "globalThis.BetterConfig = class BetterConfig");

async function setup(optIn, failures = 0) {
  const events = [];
  const context = {
    ...await model, View: class {},
    writeTextFile: async () => {
      if (failures-- > 0) throw new Error("write conflict");
      events.push("saved");
    },
    run: command => events.push(command),
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  const view = new context.BetterConfig();
  const schema = { properties: { settings: { properties: { enabled: { type: "boolean", default: false } } } } };
  if (optIn !== undefined) schema["x-notify-on-save"] = optIn;
  const manifest = { settings: { enabled: true } };
  const mod = { name: "example", path: "/example/mod.json", raw: JSON.stringify(manifest), manifest, schema, fields: context.fieldsOf(schema, manifest.settings), lost: { enabled: true } };
  view.mods = [mod]; view.notes = {}; view.unticked = new Set();
  view.keep = async () => events.push("kept");
  view.load = async () => false;
  let pending;
  const cx = { spawn: fn => { pending = fn(cx); }, notify() {} };
  return { events, view, mod, invoke: async fn => { fn(cx); await pending; } };
}

test("an opted-in save notifies its own mod after the write", async () => {
  const { view, events, invoke } = await setup(true);
  await invoke(cx => view.change("example", [["enabled", false]], cx));
  assert.deepEqual(events, ["saved", "example.settings-changed", "kept"]);
});

test("missing, false and non-boolean opt-ins do not notify", async () => {
  for (const optIn of [undefined, false, "true", 1]) {
    const { view, events, invoke } = await setup(optIn);
    await invoke(cx => view.change("example", [["enabled", false]], cx));
    assert.deepEqual(events, ["saved", "kept"]);
  }
});

test("failed writes never notify; a successful retry notifies once", async () => {
  for (const failures of [Infinity, 1]) {
    const { view, events, invoke } = await setup(true, failures);
    await invoke(cx => view.change("example", [["enabled", false]], cx));
    assert.deepEqual(events, failures === Infinity ? [] : ["saved", "example.settings-changed", "kept"]);
  }
});

test("reset and restore notify through the same save path", async () => {
  const { view, mod, events, invoke } = await setup(true);
  await invoke(cx => view.reset(mod, mod.fields[0], cx));
  assert.equal(mod.manifest.settings, undefined);
  await invoke(cx => view.restore(mod, cx));
  assert.equal(mod.manifest.settings.enabled, true);
  assert.deepEqual(events, ["saved", "example.settings-changed", "kept", "saved", "example.settings-changed", "kept"]);
});
