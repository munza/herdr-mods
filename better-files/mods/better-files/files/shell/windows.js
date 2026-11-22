// Windows: PowerShell 5.1 for everything, with the `& { … } '<arg>'` scriptblock
// wrapper (required on 5.1 because bare trailing -Command args are appended to the
// command text). Each command keeps the wire contract its POSIX twin has.
import { BUSY } from "./posix.js";

export const psQuote = (s) => "'" + String(s).replace(/['‘’‚‛]/g, "$&$&") + "'";

const powershell = (script, args = []) => ({
  program: "powershell.exe",
  args: ["-NoProfile", "-NoLogo", "-Command", `& { ${script} } ${args.map(psQuote).join(" ")}`],
});

function listingPs(perFolder) {
  return `[Console]::OutputEncoding=[Text.Encoding]::UTF8; $p=$args[0]; if (-not (Test-Path -LiteralPath $p -PathType Container)) { [Console]::Error.WriteLine('Cannot list this folder.'); exit 1 }; Get-ChildItem -LiteralPath $p -Force -ErrorAction Stop | Where-Object { $_.Name -ne '.git' } | Select-Object -First ${perFolder + 1} | ForEach-Object { $dir=($_.PSIsContainer -and (-not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -or -not $_.LinkType -or ($_.Target -and [IO.Directory]::Exists(([IO.Path]::Combine([IO.Path]::GetDirectoryName($_.FullName), $_.Target[0])))))); $k=if ($dir) {'d'} else {'f'}; [Console]::Out.Write($k + [char]0 + $_.Name + [char]0) }`;
}

// The cleanup sweep's contract (see CLEANUP_LISTING in posix.js): a missing cache folder is an
// empty success; a path that exists but can't be listed is an error.
const CLEANUP_LISTING_PS = `[Console]::OutputEncoding=[Text.Encoding]::UTF8; $p=$args[0]; $skip=[int]$args[1]; if (-not (Test-Path -LiteralPath $p -PathType Container)) { if (Test-Path -LiteralPath $p) { [Console]::Error.WriteLine('The cache folder is not a folder.'); exit 1 }; exit 0 }; Get-ChildItem -LiteralPath $p -Force -ErrorAction Stop | Sort-Object Name | Select-Object -Skip $skip -First 501 | ForEach-Object { $k=if ($_.PSIsContainer) {'d'} else {'f'}; [Console]::Out.Write($k+[char]0+$_.Name+[char]0) }`;

// The file index for search: every file under root, depth-limited, skipping heavy folders and
// links, NUL-separated, and a lone '!' once it passes the byte cap.
const INDEX_PS = `[Console]::OutputEncoding=[Text.Encoding]::UTF8
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

// The image-copy contract (see COPY_IMAGE in posix.js): the name is a SHA-256 prefix and the
// size, and the copy it replaces is matched by file name, since this shell's separators may differ.
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

const RM_PS = `$failed=$false;foreach($p in $args){try{if(Test-Path -LiteralPath $p -ErrorAction Stop){Remove-Item -LiteralPath $p -Force -ErrorAction Stop}}catch{$failed=$true;[Console]::Error.WriteLine($_)}};if($failed){exit 1};exit 0`;

// PowerShell 5.1 joins -ArgumentList unquoted, so the path is quoted here. Trailing
// backslashes are doubled so a folder like C:\ doesn't end in \" (an escaped quote).
const OPEN_IN_EDITOR_PS = `$a=$args[1] -replace '(\\\\+)$','$1$1'; Start-Process -FilePath $args[0] -ArgumentList ([char]34 + $a + [char]34)`;

// explorer.exe exits 1 even when it works, so 1 counts as success; a missing path or
// explorer itself failing to start still exits non-zero.
const REVEAL_PS = `$p=$args[0].Replace('/', [char]92); if (-not (Test-Path -LiteralPath $p)) { [Console]::Error.WriteLine('It is no longer there.'); exit 1 }; explorer.exe "/select,$p"; if ($? -or $LASTEXITCODE -eq 1) { exit 0 }; exit 1`;

// --- Editor detection ---
// One PowerShell process probes App Paths (HKLM→HKCU), PATH, and well-known dirs for
// every candidate; first hit wins. Emits name\0exePath\0 pairs (UTF-8, NUL convention).
// Always exits 0.

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

export const windows = {
  fileManager: "Explorer",
  listing: (path, perFolder) => powershell(listingPs(perFolder), [path]),
  cleanupListing: (path, offset) => powershell(CLEANUP_LISTING_PS, [path, offset]),
  index: (root, depth, bytes) => powershell(INDEX_PS, [root, depth, bytes]),
  copyImage: (src, cacheDir, start, ext, old, retain = false) => powershell(COPY_IMAGE_PS, [src, cacheDir, start, ext, old, ...(retain ? ["retain"] : [])]),
  removeCopies: (paths) => powershell(RM_PS, paths),
  openInEditor: (editor, path) => powershell(OPEN_IN_EDITOR_PS, [editor.exe, path]),
  openWithDefault: (path) => powershell(`Invoke-Item -LiteralPath $args[0]`, [path]),
  reveal: (path) => powershell(REVEAL_PS, [path]),
  detectEditors: (editors) => ({ kind: "single", ...detectEditorsPs(editors) }),
};
