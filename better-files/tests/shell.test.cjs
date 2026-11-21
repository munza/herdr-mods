// Platform seam: verifies that pick* functions return the correct program/args
// for each platform, and that the macOS path is byte-for-byte unchanged.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../mods/better-files');
const load = () =>
  import(`data:text/javascript,${encodeURIComponent(fs.readFileSync(path.join(root, 'files/shell.js'), 'utf8'))}`);

// --- psQuote ---

test('psQuote wraps in single quotes and doubles embedded single quotes', async () => {
  const { psQuote } = await load();
  assert.equal(psQuote('C:\\Users\\Julio'), "'C:\\Users\\Julio'");
  assert.equal(psQuote("it's"), "'it''s'");
  assert.equal(psQuote("a‘b’c‚d‛e"), "'a‘‘b’’c‚‚d‛‛e'");
  assert.equal(psQuote('no quotes'), "'no quotes'");
});

// --- pickListing ---

const GOLDEN_LIST_SH = 'n=0; for p in "$1"/* "$1"/.[!.]* "$1"/..?*; do [ -e "$p" ] || [ -L "$p" ] || continue; name=${p##*/}; [ "$name" = .git ] && continue; if [ -d "$p" ]; then kind=d; else kind=f; fi; printf "%s\\0%s\\0" "$kind" "$name"; n=$((n+1)); [ "$n" -gt 500 ] && break; done; test -d "$1"';

test('pickListing macOS is byte-for-byte the original sh call', async () => {
  const { pickListing } = await load();
  const r = pickListing('/some/folder', 500, 'macos');
  assert.equal(r.program, 'sh');
  assert.deepEqual(r.args, ['-c', GOLDEN_LIST_SH, 'files', '/some/folder']);
});

test('pickListing windows uses powershell.exe with & { } wrapper and 500 cap', async () => {
  const { pickListing, psQuote } = await load();
  const r = pickListing('C:\\Users\\Julio\\docs', 500, 'windows');
  assert.equal(r.program, 'powershell.exe');
  assert.deepEqual(r.args.slice(0, 3), ['-NoProfile', '-NoLogo', '-Command']);
  const script = r.args[3];
  // scriptblock wrapper
  assert.ok(script.startsWith('& { '));
  assert.ok(script.endsWith(psQuote('C:\\Users\\Julio\\docs')));
  // cap: one past perFolder, like the sh listing
  assert.ok(script.includes('Select-Object -First 501'));
  // .git filter
  assert.ok(script.includes("-ne '.git'"));
  // UTF-8 output
  assert.ok(script.includes('[Console]::OutputEncoding=[Text.Encoding]::UTF8'));
  // NUL-delimited output
  assert.ok(script.includes('[char]0'));
  // missing folder → exit 1 + stderr
  assert.ok(script.includes('Cannot list this folder.'));
  assert.ok(script.includes('exit 1'));
  assert.ok(script.includes('[IO.FileAttributes]::ReparsePoint'));
  assert.ok(script.includes('[IO.Directory]::Exists'));
  assert.ok(script.includes('-ErrorAction Stop'));
});

test('pickListing windows respects perFolder parameter', async () => {
  const { pickListing } = await load();
  const r = pickListing('/x', 250, 'windows');
  assert.ok(r.args[3].includes('Select-Object -First 251'));
});

test('pickListing windows quotes path with embedded single quote', async () => {
  const { pickListing } = await load();
  const r = pickListing("C:\\it's", 500, 'windows');
  assert.ok(r.args[3].endsWith("'C:\\it''s'"));
});

test('Windows filter reports root errors and skips unreadable descendants', async () => {
  const { pickIndex } = await load();
  const call = pickIndex('C:\\repo', 12, 4000000);
  assert.equal(call.program, 'powershell.exe');
  assert.ok(call.args[3].includes("catch { if ($level -eq 0) { throw }; continue }"));
});

// --- pickCleanupListing ---
// Contract: like the tree listing, but a missing cache folder is an empty, successful listing,
// so the sweep can finish; a path that exists but cannot be listed is still an error.

const GOLDEN_CLEANUP_SH = 'n=0; for p in "$1"/* "$1"/.[!.]* "$1"/..?*; do [ -e "$p" ] || [ -L "$p" ] || continue; n=$((n+1)); [ "$n" -le "$2" ] && continue; [ "$n" -gt $(($2+501)) ] && break; if [ -d "$p" ]; then k=d; else k=f; fi; printf "%s\\0%s\\0" "$k" "${p##*/}"; done; [ -d "$1" ] || [ ! -e "$1" ]';

test('pickCleanupListing macOS lists an absent cache folder as an empty success', async () => {
  const { pickCleanupListing } = await load();
  const r = pickCleanupListing('/app/.cache', 32, 'macos');
  assert.equal(r.program, 'sh');
  assert.deepEqual(r.args, ['-c', GOLDEN_CLEANUP_SH, 'cleanup-list', '/app/.cache', '32']);
  assert.ok(r.args[1].includes('[ -d "$1" ] || [ ! -e "$1" ]'), 'an absent folder exits 0, a non-folder still exits 1');
});

test('pickCleanupListing windows lists an absent cache folder as an empty success', async () => {
  const { pickCleanupListing, psQuote } = await load();
  const r = pickCleanupListing('C:\\app\\.cache', 0, 'windows');
  assert.equal(r.program, 'powershell.exe');
  const script = r.args[3];
  assert.ok(script.includes('if (-not (Test-Path -LiteralPath $p -PathType Container))'));
  assert.ok(script.includes('Select-Object -Skip $skip -First 501'));
  assert.ok(script.endsWith(`${psQuote('C:\\app\\.cache')} ${psQuote('0')}`));
});

// --- pickCopyImage ---
// Contract: src, cache folder, name start, extension, the copy it replaces; prints the copy's name.

test('pickCopyImage macOS is the sh copy-image call the viewer always made', async () => {
  const { pickCopyImage, COPY_IMAGE } = await load();
  const r = pickCopyImage('/src/img.png', '/app/.cache', 'v', 'png', '/app/.cache/v-1-2.png', 'macos');
  assert.equal(r.program, 'sh');
  assert.deepEqual(r.args, ['-c', COPY_IMAGE, 'copy-image', '/src/img.png', '/app/.cache', 'v', 'png', '/app/.cache/v-1-2.png']);
  assert.ok(COPY_IMAGE.startsWith('sum=$(cksum < "$1") || exit 1'));
});

test('pickCopyImage macOS with no old copy still passes an empty string', async () => {
  const { pickCopyImage, COPY_IMAGE } = await load();
  const r = pickCopyImage('/src/img.png', '/app/.cache', 'v-m1', 'png', '', 'macos');
  assert.deepEqual(r.args, ['-c', COPY_IMAGE, 'copy-image', '/src/img.png', '/app/.cache', 'v-m1', 'png', '']);
});

test('pickCopyImage windows passes the same five arguments to a PowerShell port', async () => {
  const { pickCopyImage, psQuote, BUSY } = await load();
  const r = pickCopyImage('C:\\pics\\a b.png', 'C:/app/.cache', 'v', 'png', '', 'windows');
  assert.equal(r.program, 'powershell.exe');
  assert.deepEqual(r.args.slice(0, 3), ['-NoProfile', '-NoLogo', '-Command']);
  const script = r.args[3];
  assert.ok(script.startsWith('& { $src,$dir,$start,$ext,$old=$args;'));
  assert.ok(script.endsWith(['C:\\pics\\a b.png', 'C:/app/.cache', 'v', 'png', ''].map(psQuote).join(' ')));
  assert.ok(script.includes(`{ exit ${BUSY} }`), 'a picture changing mid-copy exits BUSY');
  // the replaced copy is matched by file name, not by a path whose separators may differ
  assert.ok(script.includes('(Split-Path -Leaf $o) -ne $name'));
});

// --- pickRm ---

test('pickRm macOS is byte-for-byte rm -f --', async () => {
  const { pickRm } = await load();
  const r = pickRm(['/a/b', '/c/d'], 'macos');
  assert.equal(r.program, 'rm');
  assert.deepEqual(r.args, ['-f', '--', '/a/b', '/c/d']);
});

test('pickRm windows reports removal errors and ignores absent paths', async () => {
  const { pickRm, psQuote } = await load();
  const r = pickRm(['/a/b', '/c/d'], 'windows');
  assert.equal(r.program, 'powershell.exe');
  assert.deepEqual(r.args.slice(0, 3), ['-NoProfile', '-NoLogo', '-Command']);
  const script = r.args[3];
  assert.ok(script.startsWith('& { '));
  assert.ok(script.includes('Remove-Item -LiteralPath'));
  assert.ok(script.includes('exit 0'));
  assert.ok(script.includes('Test-Path -LiteralPath $p -ErrorAction Stop'));
  assert.ok(script.includes('Remove-Item -LiteralPath $p -Force -ErrorAction Stop'));
  assert.ok(script.includes('exit 1'));
  assert.ok(script.includes('foreach($p in $args){try{'));
  assert.ok(script.includes('catch{$failed=$true;[Console]::Error.WriteLine($_)}};if($failed){exit 1};exit 0'));
  assert.ok(script.endsWith(`${psQuote('/a/b')} ${psQuote('/c/d')}`));
});

// --- pickOpenInEditor ---

test('pickOpenInEditor macOS is byte-for-byte open -b', async () => {
  const { pickOpenInEditor } = await load();
  const editor = { name: 'Zed', bundle: 'dev.zed.Zed', exe: 'Zed.exe' };
  const r = pickOpenInEditor(editor, '/repo/file.js', 'macos');
  assert.equal(r.program, 'open');
  assert.deepEqual(r.args, ['-b', 'dev.zed.Zed', '/repo/file.js']);
});

test('pickOpenInEditor windows uses Start-Process with resolved exe path', async () => {
  const { pickOpenInEditor, psQuote } = await load();
  const editor = { name: 'VS Code', exe: 'C:\\Program Files\\Microsoft VS Code\\Code.exe' };
  const r = pickOpenInEditor(editor, 'C:\\Users\\me\\file.js', 'windows');
  assert.equal(r.program, 'powershell.exe');
  assert.deepEqual(r.args.slice(0, 3), ['-NoProfile', '-NoLogo', '-Command']);
  const script = r.args[3];
  assert.ok(script.includes('Start-Process -FilePath $args[0]'));
  // quoted, so PowerShell 5.1 doesn't split a path with spaces
  assert.ok(script.includes('-ArgumentList ([char]34 + $a + [char]34)'));
  // trailing backslashes doubled, so C:\\ doesn't end in an escaped quote
  assert.ok(script.includes("$a=$args[1] -replace '(\\\\+)$','$1$1'"));
  assert.ok(script.endsWith(`${psQuote(editor.exe)} ${psQuote('C:\\Users\\me\\file.js')}`));
});

// --- pickOpenWithDefault ---

test('pickOpenWithDefault macOS is byte-for-byte open', async () => {
  const { pickOpenWithDefault } = await load();
  const r = pickOpenWithDefault('/repo/file.txt', 'macos');
  assert.equal(r.program, 'open');
  assert.deepEqual(r.args, ['/repo/file.txt']);
});

test('pickOpenWithDefault windows uses Invoke-Item', async () => {
  const { pickOpenWithDefault, psQuote } = await load();
  const r = pickOpenWithDefault('C:\\Users\\me\\file.txt', 'windows');
  assert.equal(r.program, 'powershell.exe');
  const script = r.args[3];
  assert.ok(script.includes('Invoke-Item -LiteralPath $args[0]'));
  assert.ok(script.endsWith(psQuote('C:\\Users\\me\\file.txt')));
});

// --- pickReveal ---

test('pickReveal macOS is byte-for-byte open -R', async () => {
  const { pickReveal } = await load();
  const r = pickReveal('/repo/file.txt', 'macos');
  assert.equal(r.program, 'open');
  assert.deepEqual(r.args, ['-R', '/repo/file.txt']);
});

test('pickReveal windows uses explorer /select with path normalization', async () => {
  const { pickReveal, psQuote } = await load();
  const r = pickReveal('C:\\Users\\me\\file.txt', 'windows');
  assert.equal(r.program, 'powershell.exe');
  const script = r.args[3];
  assert.ok(script.includes("$p=$args[0].Replace('/', [char]92)"));
  assert.ok(script.includes('explorer.exe "/select,$p"'));
  // explorer.exe exits 1 even on success; anything else is still a failure
  assert.ok(script.includes('if ($? -or $LASTEXITCODE -eq 1) { exit 0 }; exit 1'));
  assert.ok(script.endsWith(psQuote('C:\\Users\\me\\file.txt')));
});

// --- revealLabel / revealError ---

test('revealLabel is platform-dependent', async () => {
  const { revealLabel } = await load();
  assert.equal(revealLabel('macos'), 'Show in Finder');
  assert.equal(revealLabel('windows'), 'Show in Explorer');
});

test('revealError is platform-dependent', async () => {
  const { revealError } = await load();
  assert.equal(revealError('macos'), 'show it in Finder');
  assert.equal(revealError('windows'), 'show it in Explorer');
});

// --- pickDetectEditors ---

const EDITORS = [
  { name: 'Zed', bundle: 'dev.zed.Zed', exe: 'Zed.exe' },
  { name: 'VS Code', bundle: 'com.microsoft.VSCode', exe: 'Code.exe' },
  { name: 'Cursor', bundle: 'com.todesktop.230313mzl4w4u92', exe: 'Cursor.exe' },
  { name: 'Windsurf', bundle: 'com.exafunction.windsurf', exe: 'Windsurf.exe' },
  { name: 'Sublime Text', bundle: 'com.sublimetext.4', exe: 'sublime_text.exe' },
  { name: 'Nova', bundle: 'com.panic.Nova' },
];

test('pickDetectEditors macOS returns perEditor with all editors including Nova', async () => {
  const { pickDetectEditors } = await load();
  const r = pickDetectEditors(EDITORS, [], 'macos');
  assert.equal(r.kind, 'perEditor');
  assert.equal(r.probes.length, 6);
  assert.ok(r.probes.some(p => p.editor.name === 'Nova'));
  // Byte-for-byte pin: mdfind command unchanged from pre-port
  const zed = r.probes.find(p => p.editor.name === 'Zed');
  assert.equal(zed.program, 'mdfind');
  assert.deepEqual(zed.args, ["kMDItemCFBundleIdentifier == 'dev.zed.Zed'"]);
});

test('pickDetectEditors windows returns single with PS script, excludes Nova', async () => {
  const { pickDetectEditors } = await load();
  const r = pickDetectEditors(EDITORS, [], 'windows');
  assert.equal(r.kind, 'single');
  assert.equal(r.program, 'powershell.exe');
  assert.deepEqual(r.args.slice(0, 3), ['-NoProfile', '-NoLogo', '-Command']);
  const script = r.args[3];
  // All 5 Windows editors present
  assert.ok(script.includes("'Zed'"));
  assert.ok(script.includes("'Zed.exe'"));
  assert.ok(script.includes("'VS Code'"));
  assert.ok(script.includes("'Code.exe'"));
  assert.ok(script.includes("'Cursor'"));
  assert.ok(script.includes("'Cursor.exe'"));
  assert.ok(script.includes("'Windsurf'"));
  assert.ok(script.includes("'Windsurf.exe'"));
  assert.ok(script.includes("'Sublime Text'"));
  assert.ok(script.includes("'sublime_text.exe'"));
  // Nova excluded
  assert.ok(!script.includes('Nova'));
  // Three detection sources present, in order
  const hkLM = script.indexOf('HKLM:');
  const hkCU = script.indexOf('HKCU:');
  const pathScan = script.indexOf('$env:PATH');
  const knownDirs = script.indexOf('foreach($d in $c[2])');
  assert.ok(hkLM > -1 && hkCU > -1 && pathScan > -1 && knownDirs > -1);
  assert.ok(hkLM < hkCU && hkCU < pathScan && pathScan < knownDirs);
  // Always exits 0
  assert.ok(script.trimEnd().endsWith('exit 0'));
  // NUL-delimited output
  assert.ok(script.includes('[char]0'));
});

test('pickDetectEditors windows includes extra editors with no known dirs', async () => {
  const { pickDetectEditors } = await load();
  const extra = [{ name: 'Emacs', exe: 'emacs.exe' }];
  const r = pickDetectEditors(EDITORS, extra, 'windows');
  const script = r.args[3];
  assert.ok(script.includes("'Emacs'"));
  assert.ok(script.includes("'emacs.exe'"));
});

test('pickDetectEditors windows passes through extra editors on macOS too', async () => {
  const { pickDetectEditors } = await load();
  const extra = [{ name: 'Emacs', bundle: 'org.gnu.Emacs' }];
  const r = pickDetectEditors(EDITORS, extra, 'macos');
  assert.equal(r.probes.length, 7);
  assert.ok(r.probes.some(p => p.editor.name === 'Emacs'));
});
