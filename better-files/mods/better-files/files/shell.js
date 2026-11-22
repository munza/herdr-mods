// Platform seam for every shell-out in this mod. Each platform's commands live in
// files/shell/<platform>.js as one object with the same methods (listing, cleanupListing,
// copyImage, removeCopies, openInEditor, openWithDefault, reveal, detectEditors, fileManager);
// this file only picks the object. To support a platform, add its file and its entry below.
// Herdr only says what this computer runs, so anything else gets macOS's commands.
import { BUSY, COPY_IMAGE } from "./shell/posix.js";
import { macos } from "./shell/macos.js";
import { windows, psQuote } from "./shell/windows.js";

export { BUSY, COPY_IMAGE, psQuote };

const PLATFORMS = { macos, windows };
const shellFor = (platform) => PLATFORMS[platform] ?? macos;

export const pickListing = (path, perFolder, platform) => shellFor(platform).listing(path, perFolder);
export const pickCleanupListing = (path, offset, platform) => shellFor(platform).cleanupListing(path, offset);
export const pickCopyImage = (src, cacheDir, start, ext, old, platform, retain = false) => shellFor(platform).copyImage(src, cacheDir, start, ext, old, retain);
export const pickRm = (paths, platform) => shellFor(platform).removeCopies(paths);
export const pickOpenInEditor = (editor, path, platform) => shellFor(platform).openInEditor(editor, path);
export const pickOpenWithDefault = (path, platform) => shellFor(platform).openWithDefault(path);
export const pickReveal = (path, platform) => shellFor(platform).reveal(path);
// Only Windows builds its file index with one command; other platforms walk the tree with listings.
export const pickIndex = (root, depth, bytes) => windows.index(root, depth, bytes);
export const pickDetectEditors = (baseEditors, extra, platform) => shellFor(platform).detectEditors([...baseEditors, ...extra]);

export const revealLabel = (platform) => `Show in ${shellFor(platform).fileManager}`;
export const openFolderLabel = (platform) => `Open in ${shellFor(platform).fileManager}`;
export const revealError = (platform) => `show it in ${shellFor(platform).fileManager}`;
