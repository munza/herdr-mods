// Platform seam for every shell-out in this mod.
// macOS paths are byte-for-byte unchanged from the original; Windows paths use
// PowerShell 5.1 with the `& { … } '<arg>'` scriptblock wrapper (required on 5.1
// because bare trailing -Command args are appended to the command text).

export const psQuote = (s) => "'" + String(s).replace(/['‘’‚‛]/g, "$&$&") + "'";

const isWin = (platform) => platform === "windows";

// --- Directory listing ---
// Wire contract (both platforms): NUL-delimited kind/name pairs, .git skipped,
// UTF-8, at most perFolder + 1 entries (one past the cap, so overflow is visible). Missing folder → non-zero exit + stderr.

function listingSh(perFolder) {
  return `n=0; for p in "$1"/* "$1"/.[!.]* "$1"/..?*; do [ -e "$p" ] || [ -L "$p" ] || continue; name=\${p##*/}; [ "$name" = .git ] && continue; if [ -d "$p" ]; then kind=d; else kind=f; fi; printf "%s\\0%s\\0" "$kind" "$name"; n=$((n+1)); [ "$n" -gt ${perFolder} ] && break; done; test -d "$1"`;
}

function listingPs(perFolder) {
  return `[Console]::OutputEncoding=[Text.Encoding]::UTF8; $p=$args[0]; if (-not (Test-Path -LiteralPath $p -PathType Container)) { [Console]::Error.WriteLine('Cannot list this folder.'); exit 1 }; Get-ChildItem -LiteralPath $p -Force -ErrorAction Stop | Where-Object { $_.Name -ne '.git' } | Select-Object -First ${perFolder + 1} | ForEach-Object { $dir=($_.PSIsContainer -and (-not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -or -not $_.LinkType -or ($_.Target -and [IO.Directory]::Exists(([IO.Path]::Combine([IO.Path]::GetDirectoryName($_.FullName), $_.Target[0])))))); $k=if ($dir) {'d'} else {'f'}; [Console]::Out.Write($k + [char]0 + $_.Name + [char]0) }`;
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

// The cleanup sweep's own contract, which differs from the tree listing above: a missing cache
// folder is an empty, successful listing, because the sweep must be able to finish; a path that
// exists but cannot be listed is still an error, so a real fault never clears the warning.
export function pickCleanupListing(path, offset, platform) {
  if (isWin(platform)) {
    const script = `[Console]::OutputEncoding=[Text.Encoding]::UTF8; $p=$args[0]; $skip=[int]$args[1]; if (-not (Test-Path -LiteralPath $p -PathType Container)) { if (Test-Path -LiteralPath $p) { [Console]::Error.WriteLine('The cache folder is not a folder.'); exit 1 }; exit 0 }; Get-ChildItem -LiteralPath $p -Force -ErrorAction Stop | Sort-Object Name | Select-Object -Skip $skip -First 501 | ForEach-Object { $k=if ($_.PSIsContainer) {'d'} else {'f'}; [Console]::Out.Write($k+[char]0+$_.Name+[char]0) }`;
    return { program: "powershell.exe", args: ["-NoProfile", "-NoLogo", "-Command", `& { ${script} } ${psQuote(path)} ${psQuote(offset)}`] };
  }
  const script = 'n=0; for p in "$1"/* "$1"/.[!.]* "$1"/..?*; do [ -e "$p" ] || [ -L "$p" ] || continue; n=$((n+1)); [ "$n" -le "$2" ] && continue; [ "$n" -gt $(($2+501)) ] && break; if [ -d "$p" ]; then k=d; else k=f; fi; printf "%s\\0%s\\0" "$k" "${p##*/}"; done; [ -d "$1" ] || [ ! -e "$1" ]';
  return { program: "sh", args: ["-c", script, "cleanup-list", path, String(offset)] };
}

export function pickIndex(root, depth, bytes) {
  const script = `[Console]::OutputEncoding=[Text.Encoding]::UTF8
$root=$args[0]; $maxDepth=[int]$args[1]; $maxBytes=[int]$args[2]
$skip=@('.git','node_modules','.venv','__pycache__','target','dist','.next')
$stack=New-Object 'System.Collections.Generic.Stack[object]'
$stack.Push(@($root,'',0)); $size=0
while ($stack.Count -gt 0) {
  $item=$stack.Pop(); $dir=$item[0]; $prefix=$item[1]; $level=[int]$item[2]
  try { $children=@(Get-ChildItem -LiteralPath $dir -Force -ErrorAction Stop) }
  catch { if ($level -eq 0) { throw }; continue }
  foreach ($entry in $children) {
    $rel=if ($prefix) { $prefix+'/'+$entry.Name } else { $entry.Name }
    if ($entry.PSIsContainer) {
      if ($level+1 -lt $maxDepth -and $entry.Name -notin $skip -and -not ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint)) { $stack.Push(@($entry.FullName,$rel,($level+1))) }
    } else {
      $length=[Text.Encoding]::UTF8.GetByteCount($rel)+1
      if ($size+$length -gt $maxBytes) { [Console]::Out.Write('!'); exit 0 }
      [Console]::Out.Write($rel+[char]0); $size += $length
    }
  }
}`;
  return { program: "powershell.exe", args: ["-NoProfile", "-NoLogo", "-Command", `& { ${script} } ${[root, depth, bytes].map(psQuote).join(" ")}`] };
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
if [ "$6" != retain ]; then
  if [ -n "$5" ]; then set -- "$5"; else set -- "$2/$3"-[0-9]*; fi
  for old in "$@"; do [ "$old" = "$copy" ] || [ ! -e "$old" ] || rm -f -- "$old"; done
fi
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
if ($args[5] -ne 'retain') {
  $pattern='^' + [regex]::Escape($start) + '-[0-9a-f]{16}-[0-9]+\\.'
  $olds=if ($old) { @($old) } else { @(Get-ChildItem -LiteralPath $dir -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -match $pattern } | ForEach-Object { $_.FullName }) }
  foreach ($o in $olds) { if ((Split-Path -Leaf $o) -ne $name -and (Test-Path -LiteralPath $o)) { Remove-Item -LiteralPath $o -Force -ErrorAction SilentlyContinue } }
}
[Console]::Out.Write($name); exit 0
} catch { exit 1 }`;

export function pickCopyImage(src, cacheDir, start, ext, old, platform, retain = false) {
  if (isWin(platform)) {
    return {
      program: "powershell.exe",
      args: ["-NoProfile", "-NoLogo", "-Command", `& { ${COPY_IMAGE_PS} } ${[src, cacheDir, start, ext, old, ...(retain ? ["retain"] : [])].map(psQuote).join(" ")}`],
    };
  }
  return { program: "sh", args: ["-c", COPY_IMAGE, "copy-image", src, cacheDir, start, ext, old, ...(retain ? ["retain"] : [])] };
}

// --- Cache cleanup on tab close ---
// Missing paths are harmless, but a failed removal must be reported for retry.

const RM_PS = `$failed=$false;foreach($p in $args){try{if(Test-Path -LiteralPath $p -ErrorAction Stop){Remove-Item -LiteralPath $p -Force -ErrorAction Stop}}catch{$failed=$true;[Console]::Error.WriteLine($_)}};if($failed){exit 1};exit 0`;

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
  return { program: "open", args: ["-b", editor.bundle, path] };
}

export function pickOpenWithDefault(path, platform) {
  if (isWin(platform)) {
    return {
      program: "powershell.exe",
      args: ["-NoProfile", "-NoLogo", "-Command", `& { Invoke-Item -LiteralPath $args[0] } ${psQuote(path)}`],
    };
  }
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
  return { program: "open", args: ["-R", path] };
}

export const revealLabel = (platform) => (isWin(platform) ? "Show in Explorer" : "Show in Finder");
export const openFolderLabel = (platform) => (isWin(platform) ? "Open in Explorer" : "Open in Finder");
export const revealError = (platform) => (isWin(platform) ? "show it in Explorer" : "show it in Finder");

// --- Editor detection ---
// macOS: one mdfind per bundle ID (unchanged).
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

export function pickDetectEditors(baseEditors, extra, platform) {
  if (isWin(platform)) {
    return { kind: "single", ...detectEditorsPs([...baseEditors, ...extra]) };
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
