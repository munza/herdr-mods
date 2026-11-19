// Platform seam for every shell-out in this mod.
// macOS paths are byte-for-byte unchanged from the original; Windows paths use
// PowerShell 5.1 with the `& { … } '<arg>'` scriptblock wrapper (required on 5.1
// because bare trailing -Command args are appended to the command text). Linux
// shares macOS's POSIX listing, copies and cleanup, and has its own opening,
// revealing and editor lookup, since `open` and Spotlight are macOS's.

export const psQuote = (s) => "'" + String(s).replace(/'/g, "''") + "'";

const isWin = (platform) => platform === "windows";
const isLinux = (platform) => platform === "linux";

// --- Directory listing ---
// Wire contract (both platforms): NUL-delimited kind/name pairs, .git skipped,
// UTF-8, at most perFolder + 1 entries (one past the cap, so overflow is visible). Missing folder → non-zero exit + stderr.

function listingSh(perFolder) {
  return `n=0; for p in "$1"/* "$1"/.[!.]* "$1"/..?*; do [ -e "$p" ] || [ -L "$p" ] || continue; name=\${p##*/}; [ "$name" = .git ] && continue; if [ -d "$p" ]; then kind=d; else kind=f; fi; printf "%s\\0%s\\0" "$kind" "$name"; n=$((n+1)); [ "$n" -gt ${perFolder} ] && break; done; test -d "$1"`;
}

function listingPs(perFolder) {
  return `[Console]::OutputEncoding=[Text.Encoding]::UTF8; $p=$args[0]; if (-not (Test-Path -LiteralPath $p -PathType Container)) { [Console]::Error.WriteLine('Cannot list this folder.'); exit 1 }; Get-ChildItem -LiteralPath $p -Force | Where-Object { $_.Name -ne '.git' } | Select-Object -First ${perFolder + 1} | ForEach-Object { $k=if ($_.PSIsContainer) {'d'} else {'f'}; [Console]::Out.Write($k + [char]0 + $_.Name + [char]0) }`;
}

export function pickListing(path, perFolder, platform) {
  if (isWin(platform)) {
    return {
      program: "powershell.exe",
      args: ["-NoProfile", "-NoLogo", "-Command", `& { ${listingPs(perFolder)} } ${psQuote(path)}`],
    };
  }
  return {
    program: "sh",
    args: ["-c", listingSh(perFolder), "files", path],
  };
}

// --- Image copy (viewer + markdown) ---
// Copies go in a hidden folder: saving any other file in a mod's folder makes Herdr reload
// the mod, which threw the tree away on every picture opened. Herdr doesn't see a hidden file
// change either, and keeps what it loaded under a name, so a name is never given to other
// bytes: it's the picture's checksum and size, and a changed picture gets a new one.
// $1 the file, $2 the cache folder, $3 the name's start, $4 its extension, $5 the copy this one
// replaces, removed once the new one is in. With no $5, as when a tab starts again after a
// reload, every other copy under the same start goes instead, so none outlives what tracked
// it. Prints the copy's name. No file name reaches the script itself, and only the cache's
// own copies are ever removed. A picture that changes while it's copied exits BUSY, and a
// copy that fails or is BUSY leaves nothing half-made behind; it's copied on the next check.
export const BUSY = 75;
export const COPY_IMAGE = `sum=$(cksum < "$1") || exit 1
name="$3-\${sum%% *}-\${sum##* }.$4"; copy="$2/$name"
if [ ! -e "$copy" ]; then
  trap 'rm -f -- "$copy.part"' EXIT
  mkdir -p -- "$2" && cp -- "$1" "$copy.part" || exit 1
  [ "$(cksum < "$copy.part")" = "$sum" ] || exit ${BUSY}
  mv -f -- "$copy.part" "$copy" || exit 1
fi
if [ -n "$5" ]; then set -- "$5"; else set -- "$2/$3"-[0-9]*; fi
for old in "$@"; do [ "$old" = "$copy" ] || [ ! -e "$old" ] || rm -f -- "$old"; done
printf %s "$name"`;

// The same contract in PowerShell 5.1: the name is a SHA-256 prefix and the size, and the
// copy it replaces is matched by file name, since this shell's separators may differ.
const COPY_IMAGE_PS = `$src,$dir,$start,$ext,$old=$args; try {
if (-not (Test-Path -LiteralPath $src -PathType Leaf)) { exit 1 }
$sum=(Get-FileHash -LiteralPath $src -Algorithm SHA256 -ErrorAction Stop).Hash.Substring(0,16).ToLower()
$name="$start-$sum-$((Get-Item -LiteralPath $src).Length).$ext"; $copy=Join-Path $dir $name
if (-not (Test-Path -LiteralPath $copy)) {
  $part="$copy.part"
  try {
    New-Item -ItemType Directory -Force -Path $dir -ErrorAction Stop | Out-Null
    Copy-Item -LiteralPath $src -Destination $part -Force -ErrorAction Stop
    if ((Get-FileHash -LiteralPath $part -Algorithm SHA256 -ErrorAction Stop).Hash.Substring(0,16).ToLower() -ne $sum) { exit ${BUSY} }
    Move-Item -LiteralPath $part -Destination $copy -Force -ErrorAction Stop
  } finally { Remove-Item -LiteralPath $part -Force -ErrorAction SilentlyContinue }
}
$pattern='^' + [regex]::Escape($start) + '-[0-9a-f]{16}-[0-9]+\\.'
$olds=if ($old) { @($old) } else { @(Get-ChildItem -LiteralPath $dir -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -match $pattern } | ForEach-Object { $_.FullName }) }
foreach ($o in $olds) { if ((Split-Path -Leaf $o) -ne $name -and (Test-Path -LiteralPath $o)) { Remove-Item -LiteralPath $o -Force -ErrorAction SilentlyContinue } }
[Console]::Out.Write($name); exit 0
} catch { exit 1 }`;

export function pickCopyImage(src, cacheDir, start, ext, old, platform) {
  if (isWin(platform)) {
    return {
      program: "powershell.exe",
      args: ["-NoProfile", "-NoLogo", "-Command", `& { ${COPY_IMAGE_PS} } ${[src, cacheDir, start, ext, old].map(psQuote).join(" ")}`],
    };
  }
  return { program: "sh", args: ["-c", COPY_IMAGE, "copy-image", src, cacheDir, start, ext, old] };
}

// --- Cache cleanup on tab close ---
// Wire contract (both): always exit 0; missing paths are harmless.

const RM_PS = `try{foreach($p in $args){Remove-Item -LiteralPath $p -Force -ErrorAction SilentlyContinue}}catch{};exit 0`;

export function pickRm(paths, platform) {
  if (isWin(platform)) {
    return {
      program: "powershell.exe",
      args: ["-NoProfile", "-NoLogo", "-Command", `& { ${RM_PS} } ${paths.map(psQuote).join(" ")}`],
    };
  }
  return { program: "rm", args: ["-f", "--", ...paths] };
}

// --- External actions: open in editor, open with default app, reveal ---

// PowerShell 5.1 joins -ArgumentList unquoted, so the path is quoted here. Trailing
// backslashes are doubled so a folder like C:\ doesn't end in \" (an escaped quote).
const OPEN_IN_EDITOR_PS = `$a=$args[1] -replace '(\\\\+)$','$1$1'; Start-Process -FilePath $args[0] -ArgumentList ([char]34 + $a + [char]34)`;

export function pickOpenInEditor(editor, path, platform) {
  if (isWin(platform)) {
    return {
      program: "powershell.exe",
      args: ["-NoProfile", "-NoLogo", "-Command", `& { ${OPEN_IN_EDITOR_PS} } ${psQuote(editor.exe)} ${psQuote(path)}`],
    };
  }
  if (isLinux(platform)) return { program: editor.exe, args: [path] };
  return { program: "open", args: ["-b", editor.bundle, path] };
}

// Linux: a file goes to the app the desktop's MIME associations name. `gio open`
// launches it and returns; xdg-open on a desktop it doesn't know (Hyprland, Sway…)
// runs the app in the foreground until it closes, past exec's timeout, so it's
// started in a session of its own instead, and then can't report a failure.
const OPEN_SH = `[ -e "$1" ] || { echo 'It is no longer there.' >&2; exit 1; }
if command -v gio >/dev/null 2>&1; then exec gio open "$1"; fi
command -v xdg-open >/dev/null 2>&1 || { echo 'Neither gio nor xdg-open is installed.' >&2; exit 1; }
setsid -f xdg-open "$1" >/dev/null 2>&1`;

export function pickOpenWithDefault(path, platform) {
  if (isWin(platform)) {
    return {
      program: "powershell.exe",
      args: ["-NoProfile", "-NoLogo", "-Command", `& { Invoke-Item -LiteralPath $args[0] } ${psQuote(path)}`],
    };
  }
  if (isLinux(platform)) return { program: "sh", args: ["-c", OPEN_SH, "open", path] };
  return { program: "open", args: [path] };
}

// explorer.exe exits 1 even when it works, so 1 counts as success; a missing path or
// explorer itself failing to start still exits non-zero.
const REVEAL_PS = `$p=$args[0].Replace('/', [char]92); if (-not (Test-Path -LiteralPath $p)) { [Console]::Error.WriteLine('It is no longer there.'); exit 1 }; explorer.exe "/select,$p"; if ($? -or $LASTEXITCODE -eq 1) { exit 0 }; exit 1`;

export function pickReveal(path, platform) {
  if (isWin(platform)) {
    return {
      program: "powershell.exe",
      args: ["-NoProfile", "-NoLogo", "-Command", `& { ${REVEAL_PS} } ${psQuote(path)}`],
    };
  }
  if (isLinux(platform)) {
    return { program: "sh", args: ["-c", REVEAL_SH, "reveal", path, fileUri(path), containingFolder(path)] };
  }
  return { program: "open", args: ["-R", path] };
}

// Linux: the freedesktop FileManager1 interface selects the item in its folder
// (Nautilus, Dolphin, Nemo, Caja, Thunar and others answer it). Without a file
// manager that does, its folder opens instead. $1 the path, $2 its file:// URI,
// $3 its folder. dbus-send splits an array at commas, so the URI encodes them.
const REVEAL_SH = `[ -e "$1" ] || { echo 'It is no longer there.' >&2; exit 1; }
dbus-send --session --print-reply --dest=org.freedesktop.FileManager1 --type=method_call /org/freedesktop/FileManager1 org.freedesktop.FileManager1.ShowItems "array:string:$2" string: >/dev/null 2>&1 && exit 0
set -- "$3"
${OPEN_SH}`;

export const fileUri = (path) => "file://" + String(path).split("/").map(encodeURIComponent).join("/");
const containingFolder = (path) => String(path).replace(/\/+$/, "").replace(/\/[^/]*$/, "") || "/";

// --- A file manager of the person's own (settings.fileManager) ---
// Its command, then the file or folder: for Show in, the item; for the folder menu, the folder. On any platform.
export function pickOwnFileManager(own, path) {
  return { program: own.command[0], args: [...own.command.slice(1), path] };
}

// `own`: the person's file manager, named or not; else the platform's.
const fileManagerName = (platform, own) =>
  own ? own.name || "file manager" : isWin(platform) ? "Explorer" : isLinux(platform) ? "file manager" : "Finder";
export const revealLabel = (platform, own) => `Show in ${fileManagerName(platform, own)}`;
export const openFolderLabel = (platform, own) => `Open in ${fileManagerName(platform, own)}`;
export const revealError = (platform, own) => {
  const name = fileManagerName(platform, own);
  return `show it in ${name === "file manager" ? "the file manager" : name}`;
};

// --- Editor detection ---
// macOS: one mdfind per bundle ID (unchanged).
// Linux: one sh process looks up each editor's commands on PATH; first hit wins.
// Windows: one PowerShell process probes App Paths (HKLM→HKCU), PATH, and
// well-known dirs for every candidate; first hit wins. Emits name\0exePath\0
// pairs (UTF-8, NUL convention). Always exits 0.

// Each entry is `ENVVAR|path under it`; the base is looked up at run time, so an unset
// variable (ProgramFiles(x86) on 32-bit Windows) skips that entry instead of failing.
const KNOWN_WINDOWS_DIRS = {
  "Zed.exe": ["LOCALAPPDATA|Programs\\Zed\\Zed.exe"],
  "Code.exe": ["LOCALAPPDATA|Programs\\Microsoft VS Code\\Code.exe", "ProgramFiles|Microsoft VS Code\\Code.exe"],
  "Cursor.exe": ["LOCALAPPDATA|Programs\\cursor\\Cursor.exe"],
  "Windsurf.exe": ["LOCALAPPDATA|Programs\\Windsurf\\Windsurf.exe"],
  "sublime_text.exe": ["ProgramFiles|Sublime Text\\sublime_text.exe", "ProgramFiles(x86)|Sublime Text\\sublime_text.exe"],
};

function detectEditorsPs(allEditors) {
  const candidates = allEditors
    .filter((e) => e.exe && e.name)
    .map((e) => `@(${psQuote(e.name)},${psQuote(e.exe)},@(${(KNOWN_WINDOWS_DIRS[e.exe] ?? []).map(psQuote).join(",")}))`)
    .join(",");
  const script =
    `[Console]::OutputEncoding=[Text.Encoding]::UTF8; ` +
    `$cands=@(${candidates}); ` +
    `foreach($c in $cands){ ` +
    `$exe=$c[1]; $found=$null; ` +
    `$lm=Get-ItemProperty -Path "HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\$exe" -ErrorAction SilentlyContinue; ` +
    `if($lm -and $lm.'(default)'){$found=[string]$lm.'(default)'}; ` +
    `if(-not $found){ $cu=Get-ItemProperty -Path "HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\$exe" -ErrorAction SilentlyContinue; if($cu -and $cu.'(default)'){$found=[string]$cu.'(default)'} }; ` +
    `if(-not $found){ $pd=@($env:PATH -split ';' | ForEach-Object { if($_ -and (Test-Path -LiteralPath (Join-Path $_ $exe))){ Join-Path $_ $exe } } | Select-Object -First 1); if($pd){ $found=$pd } }; ` +
    `if(-not $found){ foreach($d in $c[2]){ $e,$rel=$d -split '\\|',2; $base=[Environment]::GetEnvironmentVariable($e); if($base){ $p=Join-Path $base $rel; if(Test-Path -LiteralPath $p){ $found=$p; break } } } }; ` +
    `if($found){ $found=[Environment]::ExpandEnvironmentVariables($found.Trim().Trim([char]34)); [Console]::Out.Write($c[0] + [char]0 + $found + [char]0) } ` +
    `}; exit 0`;
  return { program: "powershell.exe", args: ["-NoProfile", "-NoLogo", "-Command", script] };
}

// Emits name\0path\0 pairs, like the Windows probe. Arguments are name, then the
// editor's commands separated by spaces; only an absolute path counts as found, so a
// shell function or alias of the same name doesn't. Always exits 0.
const DETECT_EDITORS_SH = `while [ $# -ge 2 ]; do
  for b in $2; do p=$(command -v "$b" 2>/dev/null) && case $p in /*) printf '%s\\0%s\\0' "$1" "$p"; break;; esac; done
  shift 2
done
exit 0`;

const EDITOR_COMMAND = /^[A-Za-z0-9_][A-Za-z0-9._+-]*$/;

export function pickDetectEditors(baseEditors, extra, platform) {
  if (isWin(platform)) {
    return { kind: "single", ...detectEditorsPs([...baseEditors, ...extra]) };
  }
  if (isLinux(platform)) {
    const pairs = [...baseEditors, ...extra].flatMap((e) => {
      const bins = (Array.isArray(e?.bins) ? e.bins : []).filter((b) => typeof b === "string" && EDITOR_COMMAND.test(b));
      return e?.name && bins.length ? [String(e.name), bins.join(" ")] : [];
    });
    return { kind: "single", program: "sh", args: ["-c", DETECT_EDITORS_SH, "editors", ...pairs] };
  }
  return {
    kind: "perEditor",
    probes: [...baseEditors, ...extra].map((e) => ({
      editor: e,
      program: "mdfind",
      args: [`kMDItemCFBundleIdentifier == '${String(e.bundle).replace(/'/g, "")}'`],
    })),
  };
}
