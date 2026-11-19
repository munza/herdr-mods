// Platform seam: verifies that pick* functions return the correct program/args
// for each platform, and that the macOS path is byte-for-byte unchanged.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.join(__dirname, '../mods/better-files');
const load = () =>
  import(`data:text/javascript,${encodeURIComponent(fs.readFileSync(path.join(root, 'files/shell.js'), 'utf8'))}`);

// --- psQuote ---

test('psQuote wraps in single quotes and doubles embedded single quotes', async () => {
  const { psQuote } = await load();
  assert.equal(psQuote('C:\\Users\\Julio'), "'C:\\Users\\Julio'");
  assert.equal(psQuote("it's"), "'it''s'");
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

test('pickIndex windows uses bounded PowerShell traversal and preserves quoted roots', async () => {
  const { pickIndex } = await load();
  const r = pickIndex("C:\\it's", 12, 4000000, 'windows');
  assert.equal(r.program, 'powershell.exe');
  assert.ok(r.args[3].includes('$maxDepth=[int]$args[1]'));
  assert.ok(r.args[3].includes('$maxBytes=[int]$args[2]'));
  assert.ok(r.args[3].includes("[IO.FileAttributes]::ReparsePoint"));
  assert.ok(r.args[3].includes("'C:\\it''s'"));
  assert.ok(r.args[3].includes("'node_modules'"));
  assert.equal(pickIndex('/tmp', 12, 4000000, 'macos'), null);
});

test('pickIndex Windows PowerShell finds nested files and prunes excluded folders', { skip: process.platform !== 'win32' }, async () => {
  const { pickIndex } = await load();
  const temp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), "filter Box's "));
  try {
    for (const dir of ['nested/deeper', 'node_modules', '.git']) fs.mkdirSync(path.join(temp, dir), { recursive: true });
    for (const file of ['nested/deeper/needle-é.txt', 'node_modules/ignored.txt', '.git/ignored.txt']) fs.writeFileSync(path.join(temp, file), 'fixture');
    const { program, args } = pickIndex(temp, 10, 4_000_000, 'windows');
    const result = execFileSync(program, args, { encoding: 'utf8' }).split('\0').filter(Boolean);
    assert.deepEqual(result, ['nested/deeper/needle-é.txt']);
    const capped = pickIndex(temp, 10, 1, 'windows');
    assert.equal(execFileSync(capped.program, capped.args, { encoding: 'utf8' }), '.\0');
    const exact = pickIndex(temp, 10, Buffer.byteLength('nested/deeper/needle-é.txt\0'), 'windows');
    assert.equal(execFileSync(exact.program, exact.args, { encoding: 'utf8' }), 'nested/deeper/needle-é.txt\0');
    const missing = pickIndex(path.join(temp, 'missing'), 10, 1, 'windows');
    assert.throws(() => execFileSync(missing.program, missing.args, { stdio: 'pipe' }), { status: 1 });
  } finally {
    // Remove the fixture even if traversal fails.
    fs.rmSync(temp, { recursive: true, force: true });
  }
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

test('pickFetchImage preserves the POSIX curl path and bounds PowerShell downloads', async () => {
  const { pickFetchImage } = await load();
  const url = 'https://img.shields.io/badge/A-blue';
  const base = '/app/mods/better-files/.cache/web-123';
  const posix = pickFetchImage(url, base, 'macos');
  assert.equal(posix.program, 'sh');
  assert.match(posix.args[1], /curl -fsSL --max-time 20 --max-filesize 5000000/);
  const win = pickFetchImage(url, 'C:\\app\\.cache\\web-123', 'windows');
  assert.equal(win.program, 'powershell.exe');
  assert.deepEqual(win.args.slice(0, 3), ['-NoProfile', '-NoLogo', '-Command']);
  assert.ok(win.args[3].includes('[Uri]::UnescapeDataString($args[0])'));
  assert.ok(win.args[3].endsWith(`'${encodeURIComponent(url)}' '${encodeURIComponent('C:\\app\\.cache\\web-123')}'`));
  assert.ok(!win.args[3].includes(url), 'untrusted URLs are passed as percent-encoded data');
  assert.ok(win.args[3].includes("http','https"));
  assert.ok(win.args[3].includes('AddDays(-1)'));
  assert.ok(win.args[3].includes('--max-time 20 --max-filesize 5000000'));
  assert.ok(win.args[3].includes("--proto '=http,https' --proto-redir '=http,https'"));
  assert.ok(!win.args[3].includes('HttpWebRequest'));
  assert.equal(posix.args[1], `for c in "$2".*; do case "$c" in *.part) continue;; esac; [ -f "$c" ] && [ -n "$(find "$c" -mmin -1440)" ] && { printf %s "$c"; exit 0; }; done
mkdir -p -- "$(dirname -- "$2")" && t="$2.part" || exit 1
type=$(curl -fsSL --max-time 20 --max-filesize 5000000 -o "$t" -w '%{content_type}' -- "$1") || exit 1
case "$type" in *svg*) e=svg;; *png*) e=png;; *jpeg*|*jpg*) e=jpg;; *gif*) e=gif;; *webp*) e=webp;; *) exit 1;; esac
mv -f -- "$t" "$2.$e" && printf %s "$2.$e"`);
});

test('Windows fetch script downloads a loopback badge without sh', { skip: process.platform !== 'win32' }, async () => {
  const { pickFetchImage } = await load();
  const http = require('node:http');
  const os = require('node:os');
  const execFile = require('node:util').promisify(require('node:child_process').execFile);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "better-files ‘badge’'s "));
  let requests = 0;
  const server = http.createServer((_req, res) => {
    requests++;
    res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
    res.end('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  });
  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}/badge/it's-‘quoted’`;
    const base = `${dir.replaceAll('\\', '/')}/web-test`;
    const { program, args } = pickFetchImage(url, base, 'windows');
    const fetch = () => execFile(program, args, { encoding: 'utf8', timeout: 30000 });
    const { stdout } = await fetch();
    assert.equal(stdout, `${base}.svg`);
    assert.equal(fs.readFileSync(stdout, 'utf8'), '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    assert.equal((await fetch()).stdout, stdout);
    assert.equal(requests, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --- pickRm ---

test('pickRm macOS is byte-for-byte rm -f --', async () => {
  const { pickRm } = await load();
  const r = pickRm(['/a/b', '/c/d'], 'macos');
  assert.equal(r.program, 'rm');
  assert.deepEqual(r.args, ['-f', '--', '/a/b', '/c/d']);
});

test('pickRm windows uses & { } wrapper and always exit 0', async () => {
  const { pickRm, psQuote } = await load();
  const r = pickRm(['/a/b', '/c/d'], 'windows');
  assert.equal(r.program, 'powershell.exe');
  assert.deepEqual(r.args.slice(0, 3), ['-NoProfile', '-NoLogo', '-Command']);
  const script = r.args[3];
  assert.ok(script.startsWith('& { '));
  assert.ok(script.includes('Remove-Item -LiteralPath'));
  assert.ok(script.includes('exit 0'));
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
