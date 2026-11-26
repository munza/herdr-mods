// Spaces and agents in one block. Combined (the default): tabs for Spaces, with
// each space's tabs and agents under it, and Agents. With `combined: false` in the settings: the
// two lists one above the other, as two blocks of this mod would draw them.
import { v_flex, h_flex } from "gpui-base";
import { theme, setAgentOrder } from "herdr";
import { Spaces } from "./spaces.js";
import { Agents } from "./agents.js";
import { TEXT, Badge, Rail } from "./ui.js";

const TABS = ["spaces", "agents"];

function tabItems(tab, panes, agents, hasAgent, isAgentPane) {
  if (!hasAgent && tab.settled) return [];
  const namedPanes = new Set(panes.filter((p) => p.terminal && p.name && !isAgentPane(p)));
  if (namedPanes.size === 0) return hasAgent ? agents.map((a) => ({ a })) : [{ tab }];

  const items = [];
  const waiting = new Map(agents.map((a) => [a.pane, a]));
  // On tabs without agents, one tab row represents any unnamed or mod panes.
  let fallback = !hasAgent;
  for (const pane of panes) {
    const a = waiting.get(pane.pane);
    if (a) {
      items.push({ a });
      waiting.delete(pane.pane);
    } else if (namedPanes.has(pane)) {
      items.push({ pane });
    } else if (fallback) {
      items.push({ tab });
      fallback = false;
    }
  }
  // Agent rows still work when their pane information is missing.
  for (const a of waiting.values()) items.push({ a });
  return items;
}

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
    const pinned = view.groups.find((g) => g.id === "pinned");
    const pinList = pinned?.members.map((a) => a.address) ?? [];
    order.push(...pinList);
    const pins = new Set(pinList);
    // A kept sub-agent can appear under a parent in another tab. Its own tab keeps its entry.
    const agentTabs = new Set(view.model.map((a) => a.tab));
    const agentPanes = new Set(view.allAgents.map((a) => a.pane));
    const agentTerminals = new Set(view.allAgents.map((a) => a.address));
    const isAgentPane = (p) =>
      agentPanes.has(p.pane) || agentTerminals.has(p.terminal) || view.namedSubPanes.has(p.terminal);
    const agentsByTab = new Map();
    const focusedSpaces = new Set();
    for (const a of view.model) {
      if (a.focused) focusedSpaces.add(a.space);
      if (pins.has(a.address)) continue;
      let list = agentsByTab.get(a.tab);
      if (!list) agentsByTab.set(a.tab, (list = []));
      list.push(a);
    }
    this.spaces.above = () => (pinned ? this.agents.groupRows(pinned, 0, view, t) : []);
    const nest = (lines, row) => h_flex().children(lines.map((l) => Rail(l))).child(row.flex_1().min_w(0));
    const itemsBySpace = new Map();
    for (const w of view.sp) {
      const items = (w.tabs ?? []).flatMap((tab) => {
        const rows = tabItems(
          tab,
          view.panesByTab.get(tab.id) ?? [],
          agentsByTab.get(tab.id) ?? [],
          agentTabs.has(tab.id),
          isAgentPane,
        );
        if (tab.id === view.shownTab && !view.shownSubPane) {
          const chosen = rows.find((x) => x.pane && x.pane.pane === view.shownPane) ?? rows.find((x) => x.tab);
          if (chosen) chosen.lit = true;
        }
        return rows;
      });
      itemsBySpace.set(w.id, items);
    }
    // The main space's line carries on to its worktrees, whose rows sit one step further in.
    this.spaces.under = ({ w, tree, kids }) => {
      const items = itemsBySpace.get(w.id);
      for (const x of items) if (x.a) order.push(x.a.address);
      const before = tree ? [tree.startsWith("└") ? "" : "│"] : [];
      return items.flatMap((x, i) => {
        const last = i === items.length - 1 && !kids;
        const [row, ...subs] = x.a
          ? this.agents.agentWithSubs(x.a, i, nested, t)
          : [x.pane ? this.agents.paneRow(x.pane, x.lit, t) : this.agents.tabRow(w, x.tab, x.lit, t, view)];
        return [nest([...before, last ? "└" : "├"], row), ...subs.map((s) => nest([...before, last ? "" : "│"], s))];
      });
    };
    // A focused child row takes the highlight from its space.
    this.spaces.quiet = (w) =>
      focusedSpaces.has(w.id) ||
      itemsBySpace.get(w.id).some((x) => x.lit) ||
      (view.shownSubPane && w.tabs?.some((tab) => tab.id === view.shownSubPane.tab));
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
