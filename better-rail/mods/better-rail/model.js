// Better Rail's model: find a layout node, say whether a panel action is showing,
// and read the buttons a layout gives the rail.
export function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const hit = find(child, id);
    if (hit) return hit;
  }
  return null;
}

export function isActive(root, action) {
  if (action?.type !== "panel") return false;
  const panel = find(root, action.container);
  const stack = find(root, action.stack);
  return Boolean(panel) && !panel.hidden && stack?.active === action.target;
}

export function buttonsOf(props) {
  const list = Array.isArray(props?.buttons) ? props.buttons : [];
  return list.filter((button) => button && typeof button.id === "string" && button.action);
}

export function orderButtons(buttons, order) {
  const rank = new Map();
  for (const id of Array.isArray(order) ? order : []) {
    if (typeof id === "string" && !rank.has(id)) rank.set(id, rank.size);
  }
  return buttons
    .map((button, index) => ({ button, index }))
    .sort((a, b) => {
      const ai = rank.has(a.button.id) ? rank.get(a.button.id) : rank.size + a.index;
      const bi = rank.has(b.button.id) ? rank.get(b.button.id) : rank.size + b.index;
      return ai - bi;
    })
    .map((item) => item.button);
}
