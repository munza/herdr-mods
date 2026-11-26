// Better Rail: a right-edge icon rail for panel and mod actions. It follows the
// Better Tabs `toolbar` setting: "rail" shows this column and hides the tab-bar
// toolbar; "tab" hides the column. Mod settings moves here from Better Sidebar.
import { View, div, svg } from "gpui-kit";
import { v_flex } from "gpui-base";
import { layout, props, run, setShared, shared, theme } from "herdr";
import { buttonsOf, isActive, orderButtons } from "./model.js";
import { loadSettings } from "./settings.js";

const PLACEMENT_KEY = "better-tabs.toolbar";
const RAIL_ID = "rail";
const DEFAULT_SETTINGS = { order: [] };

export default class BetterRail extends View {
  init(_props, cx) {
    this.placement = null;
    this.order = [];
    cx.spawn(async (later) => {
      const { settings, problems } = await loadSettings("better-rail", DEFAULT_SETTINGS);
      this.order = settings.order;
      setShared("better-rail.order", this.order);
      for (const problem of problems) console.warn(`better-rail mod.json settings: ${problem}`);
      later.notify();
    });
    cx.timer.after(10, (next) => this.syncPlacement(next));
    cx.timer.every(300, (next) => this.syncPlacement(next));
  }

  syncPlacement(cx) {
    const placement = shared(PLACEMENT_KEY) === "tab" ? "tab" : "rail";
    if (placement === this.placement) return;
    this.placement = placement;
    run(placement === "rail" ? "layout.show" : "layout.hide", { id: RAIL_ID });
    setShared("better-rail.active", placement === "rail");
    cx.notify();
  }

  act(action) {
    if (action.type === "panel") {
      if (isActive(layout(), action)) {
        run("layout.hide", { id: action.container });
        return;
      }
      run("layout.select", { stack: action.stack, child: action.target });
      run("layout.show", { id: action.container });
      return;
    }
    if (action.type === "command") run(action.name, action.args ?? {});
  }

  button(id, label, icon, active, onClick, t) {
    return div()
      .id(id)
      .size(32)
      .flex_none()
      .flex()
      .items_center()
      .justify_center()
      .rounded(7)
      .bg(active ? t.selected : t.chrome)
      .text_color(active ? t.foreground : t.muted)
      .tooltip(label)
      .accessibility_label(label)
      .cursor_pointer()
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click(onClick)
      .child(svg(icon).size(18));
  }

  render() {
    const t = theme();
    if (props()?.part === "config") {
      return v_flex()
        .id("better-rail-config")
        .size_full()
        .items_center()
        .justify_center()
        .bg(t.chrome)
        .child(
          this.button(
            "rail-mod-settings",
            "Mod settings",
            "mods/better-rail/icons/sliders.svg",
            false,
            () => run("mod.open", { name: "better-config" }),
            t,
          ),
        );
    }
    if (this.placement !== "rail") return div();
    const root = layout();
    const list = v_flex().id("better-rail-list").size_full().items_center().py(8).gap(4).overflow_y_scrollbar();
    const savedOrder = shared("better-rail.order");
    const order = Array.isArray(savedOrder) ? savedOrder : this.order;
    for (const b of orderButtons(buttonsOf(props(), root), order)) {
      list.child(
        this.button(
          `rail-${b.id}`,
          b.label ?? b.id,
          b.icon,
          isActive(root, b.action),
          () => this.act(b.action),
          t,
        ),
      );
    }
    return v_flex()
      .id("better-rail")
      .size_full()
      .bg(t.chrome)
      .border_l(1)
      .border_color(t.border)
      .child(list);
  }
}
