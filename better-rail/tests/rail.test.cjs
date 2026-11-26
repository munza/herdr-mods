// Better Rail's model: layout lookup, active panel, and the layout's buttons.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const load = () =>
  import(`data:text/javascript,${encodeURIComponent(fs.readFileSync(path.join(root, "mods/better-rail/model.js"), "utf8"))}`);

const tree = {
  id: "root",
  children: [
    { id: "panel", hidden: false, children: [{ id: "stack", active: "files", children: [{ id: "files" }, { id: "changes" }] }] },
    { id: "rail", children: [{ id: "rail-list" }] },
  ],
};

test("find reaches a node by id", async () => {
  const { find } = await load();
  assert.equal(find(tree, "root"), tree);
  assert.equal(find(tree, "files").id, "files");
  assert.equal(find(tree, "missing"), null);
});

test("a panel action is active only when its container is shown and its child is selected", async () => {
  const { isActive } = await load();
  const action = { type: "panel", container: "panel", stack: "stack", target: "files" };
  assert.equal(isActive(tree, action), true);
  assert.equal(isActive(tree, { ...action, target: "changes" }), false);
  tree.children[0].hidden = true;
  assert.equal(isActive(tree, action), false);
  tree.children[0].hidden = false;
  assert.equal(isActive(tree, { type: "command", name: "app.palette" }), false);
});

test("order moves named buttons first and keeps the rest in layout order", async () => {
  const { orderButtons } = await load();
  const buttons = ["files", "changes", "editor", "prs", "issues"].map((id) => ({ id }));
  assert.deepEqual(orderButtons(buttons, ["editor", "issues"]).map((b) => b.id), ["editor", "issues", "files", "changes", "prs"]);
  assert.deepEqual(orderButtons(buttons, []).map((b) => b.id), buttons.map((b) => b.id));
  assert.deepEqual(orderButtons(buttons, ["missing", "editor", "editor"]).map((b) => b.id), ["editor", "files", "changes", "prs", "issues"]);
});

test("buttons keep only entries a button can render", async () => {
  const { buttonsOf } = await load();
  const buttons = buttonsOf({
    buttons: [
      { id: "files", action: { type: "panel" } },
      { id: "files", action: { type: "panel" } },
      { id: "missing-action" },
      { action: { type: "command" } },
      null,
    ],
  });
  assert.deepEqual(buttons.map((b) => b.id), ["files"]);
  assert.deepEqual(buttonsOf({}), []);
});

test("a when condition hides a button whose node is missing or hidden", async () => {
  const { buttonsOf } = await load();
  const root = { id: "root", children: [{ id: "shown" }, { id: "hidden", hidden: true }] };
  const buttons = buttonsOf(
    {
      buttons: [
        { id: "a", action: { type: "panel" }, when: { node: "shown" } },
        { id: "b", action: { type: "panel" }, when: { node: "hidden" } },
        { id: "c", action: { type: "panel" }, when: { node: "missing" } },
        { id: "d", action: { type: "panel" } },
      ],
    },
    root,
  );
  assert.deepEqual(buttons.map((b) => b.id), ["a", "d"]);
});
