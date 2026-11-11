// Picks a file's or folder's icon from Better Icons, the way VS Code's Material Icon Theme does.
// Shared between this repo's mods: each keeps an identical copy, because a mod can't import from
// another's folder. The icons themselves are read by path, so only Better Icons holds them.
import { appHome, readTextFile } from "herdr";

const PACK = "mods/better-icons";

// The table, or null when Better Icons isn't installed, so the caller keeps its own icons.
export async function loadFileIcons() {
  try {
    const text = await readTextFile(`${appHome()}/${PACK}/icons.json`);
    const table = text ? JSON.parse(text) : null;
    return table?.fileNames && table?.folderNames ? table : null;
  } catch {
    return null;
  }
}

// relative: the path from the folder on show, so a rule such as .github/workflows can match.
// A rule for a path beats a name, a name beats an extension, and the longest extension wins.
export function fileIcon(table, relative, { dir = false, open = false, light = false } = {}) {
  if (!table) return null;
  const parts = relative.toLowerCase().split("/").filter(Boolean);
  const name = parts.at(-1) ?? "";
  const find = (kind, key) => (light && table.light?.[kind]?.[key]) || table[kind]?.[key];
  const names = dir ? "folderNames" : "fileNames";
  let icon;
  for (let i = 0; i < parts.length - 1 && !icon; i++) icon = find(names, parts.slice(i).join("/"));
  icon ??= find(names, name);
  for (let dot = name.indexOf("."); !dir && !icon && dot !== -1; dot = name.indexOf(".", dot + 1))
    icon = find("fileExtensions", name.slice(dot + 1));
  icon ??= dir ? table.folder : table.file;
  if (dir && open) icon = table.open?.[icon] ?? icon;
  return `${PACK}/icons/${icon}.svg`;
}
