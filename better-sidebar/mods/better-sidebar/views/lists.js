// Spaces and agents in one block. Combined (the default): tabs for Spaces, with
// each space's tabs and agents under it, and Agents. With `combined: false` in the settings: the
// two lists one above the other, as two blocks of this mod would draw them.
import { v_flex, h_flex } from "gpui-base";
import { focused, theme, setAgentOrder } from "herdr";
import { Spaces } from "./spaces.js";
import { Agents } from "./agents.js";
import { TEXT, Badge, Rail } from "./ui.js";

const TABS = ["spaces", "agents"];

export class Lists {
  init(props, cx) {
    this.spaces = new Spaces();
    this.spaces.init(props, cx);
    this.agents = new Agents();
    this.agents.init(props, cx);
    const saved = localStorage.getItem("lists.tab");
    this.tab = TABS.includes(saved) ? saved : "spaces";
  }

  pick(tab, cx) {
    this.tab = tab;
    localStorage.setItem("lists.tab", tab);
    cx.notify();
  }

  render() {
    const t = theme();
    const collapsed = this.spaces.collapsed();
    const root = v_flex()
      .id("better-sidebar-lists")
      .size_full()
      .min_h(0)
      .bg(t.chrome)
      .text_size(TEXT.body)
      .on_size_change((size, cx) => this.spaces.resized(size, cx));
    this.spaces.under = null;
    this.spaces.quiet = null;
    this.spaces.above = null;
    // The rail has no room for tabs: both lists, as numbers.
    if (!this.spaces.settings.combined || collapsed)
      return root
        .child(
          v_flex()
            .flex_1()
            .min_h(0)
            .child(this.spaces.header(t, collapsed))
            .child(this.spaces.body(t, collapsed)),
        )
        .child(v_flex().flex_1().min_h(0).child(this.agents.render()));

    const view = this.agents.readView();
    root.child(this.tabBar(t, view));
    if (this.tab !== "spaces") return root.child(this.agents.render({ view, heading: false }));

    // Spaces, each with its tabs and agents beneath in tab order, so rows don't move as
    // their state changes; next-agent keys follow that order.
    const nested = { ...view, sort: { id: "grouped" }, byPriority: false, nested: true };
    const order = [];
    // The agents as they are listed: a kept sub-agent is under its parent, so
    // it is not drawn again under its space.
    const all = view.model;
    const pinned = view.groups.find((g) => g.id === "pinned");
    const pinList = pinned?.members.map((a) => a.address) ?? [];
    order.push(...pinList);
    const pins = new Set(pinList);
    const hasAgentTab = new Set(all.map((a) => a.tab));
    const agentsByTab = new Map();
    const focusedSpaces = new Set();
    for (const a of all) {
      if (a.focused) focusedSpaces.add(a.space);
      if (pins.has(a.address)) continue;
      let list = agentsByTab.get(a.tab);
      if (!list) agentsByTab.set(a.tab, (list = []));
      list.push(a);
    }
    this.spaces.above = () => (pinned ? this.agents.groupRows(pinned, 0, view, t) : []);
    const nest = (lines, row) => h_flex().children(lines.map((l) => Rail(l))).child(row.flex_1().min_w(0));
    // A space's agents hang from its line; a main space's worktrees come after them,
    // so its line carries on, and a worktree's own agents sit one step further in.
    // Every tab shows: a tab with agents as its agents, any other as itself.
    const shownTab = "shownTab" in view ? view.shownTab : focused()?.tab;
    this.spaces.under = ({ w, tree, kids }) => {
      const items = w.tabs.flatMap((tab) =>
        hasAgentTab.has(tab.id)
          ? (agentsByTab.get(tab.id) ?? []).map((a) => ({ a }))
          : tab.settled ? [] : [{ tab }],
      );
      for (const x of items) if (x.a) order.push(x.a.address);
      const before = tree ? [tree.startsWith("└") ? "" : "│"] : [];
      return items.flatMap((x, i) => {
        const last = i === items.length - 1 && !kids;
        const [row, ...subs] = x.a
          ? this.agents.agentWithSubs(x.a, i, nested, t)
          : [this.agents.tabRow(w, x.tab, x.tab.id === shownTab, t, view)];
        return [nest([...before, last ? "└" : "├"], row), ...subs.map((s) => nest([...before, last ? "" : "│"], s))];
      });
    };
    // One row lit: a space whose focused agent or tab shows beneath it leaves it to that row.
    this.spaces.quiet = (w) =>
      focusedSpaces.has(w.id) || w.tabs.some((tab) => tab.id === shownTab && !hasAgentTab.has(tab.id));
    const frame = this.spaces.createFrame({ sp: view.sp, ps: view.allPanes });
    const body = this.spaces.body(t, false, frame);
    setAgentOrder(order);
    return root.child(body);
  }

  // Tabs side by side from the left, the picked one filled.
  tabBar(t, view) {
    const tab = (id, label, count) =>
      h_flex()
        .id(`lists-tab-${id}`)
        .px(10)
        .h(24)
        .gap(5)
        .justify_center()
        .items_center()
        .rounded(6)
        .cursor_pointer()
        .text_size(TEXT.label)
        .font_medium()
        .text_color(this.tab === id ? t.foreground : t.dim)
        .when(this.tab === id, (el) => el.bg(t.selected))
        .when(this.tab !== id, (el) => el.hover((s) => s.bg(t.hover).text_color(t.foreground)))
        .on_click((_e, cx) => this.pick(id, cx))
        .child(label)
        // The count badge the group headers use.
        .when(count !== null, (el) => el.child(Badge(count)));
    return h_flex()
      .px(8)
      .pt(6)
      .pb(6)
      .mb(4)
      .border_b(1)
      .border_color(t.border)
      .flex_none()
      .gap(6)
      .items_center()
      .child(
        h_flex()
          .flex_1()
          .gap(2)
          .child(tab("spaces", "Spaces", null))
          .child(tab("agents", "Agents", view.count)),
      )
      .child(this.tab === "spaces" ? this.spaces.headerButtons() : this.agents.sortMenu());
  }
}
