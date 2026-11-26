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
