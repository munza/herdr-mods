// Platform seam: verifies that pick* functions return the correct program/args
// for each platform, and that the macOS path is byte-for-byte unchanged.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../mods/better-files');
// shell.js and the platform files it picks from, as one module: a data: URL can't
// resolve relative imports, so they're taken out and the files joined.
const SHELL_FILES = ['files/shell/posix.js', 'files/shell/macos.js', 'files/shell/windows.js', 'files/shell/linux.js', 'files/shell.js'];
const load = () =>
  import(`data:text/javascript,${encodeURIComponent(SHELL_FILES.map((f) => fs.readFileSync(path.join(root, f), 'utf8')).join('\n').replace(/^import\s+[\s\S]*?;$/gm, '').replace(/^export \{[^}]*\};$/gm, ''))}`);

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

// --- pickFetchImage ---
// Contract: a picture's web address and its copy's path without an extension; prints the copy's path.

test('pickFetchImage keeps the POSIX curl script and bounds PowerShell downloads', async () => {
  const { pickFetchImage } = await load();
  const url = 'https://img.shields.io/badge/A-blue';
  const posix = pickFetchImage(url, '/app/mods/better-files/.cache/web-123', 'macos');
  assert.equal(posix.program, 'sh');
  assert.deepEqual(posix.args.slice(2), ['fetch-image', url, '/app/mods/better-files/.cache/web-123']);
  assert.equal(posix.args[1], `for c in "$2".*; do case "$c" in *.part) continue;; esac; [ -f "$c" ] && [ -n "$(find "$c" -mmin -1440)" ] && { printf %s "$c"; exit 0; }; done
mkdir -p -- "$(dirname -- "$2")" && t="$2.part" || exit 1
type=$(curl -fsSL --max-time 20 --max-filesize 5000000 -o "$t" -w '%{content_type}' -- "$1") || exit 1
case "$type" in *svg*) e=svg;; *png*) e=png;; *jpeg*|*jpg*) e=jpg;; *gif*) e=gif;; *webp*) e=webp;; *) exit 1;; esac
mv -f -- "$t" "$2.$e" && printf %s "$2.$e"`);
  const win = pickFetchImage(url, 'C:\\app\\.cache\\web-123', 'windows');
  assert.equal(win.program, 'powershell.exe');
  assert.deepEqual(win.args.slice(0, 3), ['-NoProfile', '-NoLogo', '-Command']);
  assert.ok(win.args[3].includes('[Uri]::UnescapeDataString($args[0])'));
  assert.ok(win.args[3].endsWith(`'${encodeURIComponent(url)}' '${encodeURIComponent('C:\\app\\.cache\\web-123')}'`));
  assert.ok(!win.args[3].includes(url), 'web addresses are passed percent-encoded, never as code');
  assert.ok(win.args[3].includes("http','https"));
  assert.ok(win.args[3].includes('AddDays(-1)'));
  assert.ok(win.args[3].includes('--max-time 20 --max-filesize 5000000'));
  assert.ok(win.args[3].includes("--proto '=http,https' --proto-redir '=http,https'"));
  const quoted = pickFetchImage("https://example.com/it's", 'C:\\x', 'windows');
  assert.ok(quoted.args[3].includes("'https%3A%2F%2Fexample.com%2Fit%27s'"));
});

test('Windows fetch script downloads a loopback badge once without sh', { skip: process.platform !== 'win32' }, async () => {
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
    assert.equal((await fetch()).stdout, stdout, 'a copy under a day old is reused');
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
  { name: 'Zed', bundle: 'dev.zed.Zed', exe: 'Zed.exe', bins: ['zeditor', 'zed'] },
  { name: 'VS Code', bundle: 'com.microsoft.VSCode', exe: 'Code.exe', bins: ['code', 'code-oss'] },
  { name: 'Cursor', bundle: 'com.todesktop.230313mzl4w4u92', exe: 'Cursor.exe', bins: ['cursor'] },
  { name: 'Windsurf', bundle: 'com.exafunction.windsurf', exe: 'Windsurf.exe', bins: ['windsurf'] },
  { name: 'Sublime Text', bundle: 'com.sublimetext.4', exe: 'sublime_text.exe', bins: ['subl'] },
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

// --- Linux ---
// The Linux scripts run for real, against stand-ins on a PATH of their own, so these
// pass on macOS too. The xdg-open fallback needs setsid and is skipped without it.

const os = require('node:os');
const { spawnSync } = require('node:child_process');

// A PATH holding only the given stand-ins, each logging its arguments to `log`.
function stubs(programs, links = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-linux-'));
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  for (const [name, body] of Object.entries(programs)) {
    fs.writeFileSync(path.join(bin, name), `#!/bin/sh\nprintf '%s %s\\n' "\${0##*/}" "$*" >> "$LOG"\n${body}\n`, { mode: 0o755 });
  }
  for (const [name, target] of Object.entries(links)) fs.symlinkSync(target, path.join(bin, name));
  const log = path.join(dir, 'log');
  const run = (pick) => {
    assert.equal(pick.program, 'sh');
    return spawnSync('/bin/sh', pick.args, { encoding: 'utf8', env: { PATH: bin, LOG: log } });
  };
  const logged = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '');
  return { dir, bin, run, logged };
}

const pairs = (stdout) => {
  const fields = stdout.split('\0');
  const out = [];
  for (let i = 0; i + 1 < fields.length; i += 2) out.push([fields[i], fields[i + 1]]);
  return out;
};

test('pickDetectEditors linux looks each editor up on PATH, first command found wins', async () => {
  const { pickDetectEditors } = await load();
  const r = pickDetectEditors(EDITORS, [], 'linux');
  assert.equal(r.kind, 'single');
  assert.equal(r.program, 'sh');
  assert.deepEqual(r.args.slice(2), [
    'editors',
    'Zed', 'zeditor zed',
    'VS Code', 'code code-oss',
    'Cursor', 'cursor',
    'Windsurf', 'windsurf',
    'Sublime Text', 'subl',
  ]);
  const s = stubs({ zed: 'exit 0', 'code-oss': 'exit 0', subl: 'exit 0' });
  const found = s.run(r);
  assert.equal(found.status, 0);
  assert.deepEqual(pairs(found.stdout), [
    ['Zed', path.join(s.bin, 'zed')],
    ['VS Code', path.join(s.bin, 'code-oss')],
    ['Sublime Text', path.join(s.bin, 'subl')],
  ]);
  const both = stubs({ zeditor: 'exit 0', zed: 'exit 0' });
  assert.deepEqual(pairs(both.run(r).stdout), [['Zed', path.join(both.bin, 'zeditor')]]);
  assert.deepEqual(pairs(stubs({}).run(r).stdout), [], 'none installed finds none, and still exits 0');
});

test('pickDetectEditors linux adds extra editors with bins, and only plain command names', async () => {
  const { pickDetectEditors } = await load();
  const extra = [
    { name: 'Helix', bins: ['hx'] },
    { name: 'Emacs', bundle: 'org.gnu.Emacs' },
    { name: 'Odd', bins: ['x; touch pwned', '$(id)', '../hx', '-v'] },
  ];
  const r = pickDetectEditors(EDITORS, extra, 'linux');
  assert.deepEqual(r.args.slice(-2), ['Helix', 'hx']);
  assert.ok(!r.args.includes('Emacs') && !r.args.includes('Odd') && !r.args.includes('Nova'));
});

test('pickOpenInEditor linux runs the program found, with the path as one argument', async () => {
  const { pickOpenInEditor } = await load();
  const r = pickOpenInEditor({ name: 'Zed', exe: '/usr/bin/zeditor' }, '/repo/a b.js', 'linux');
  assert.deepEqual(r, { program: '/usr/bin/zeditor', args: ['/repo/a b.js'] });
});

test('pickOpenWithDefault linux hands the file to gio open', async () => {
  const { pickOpenWithDefault } = await load();
  const s = stubs({ gio: 'exit 0', 'xdg-open': 'exit 0' });
  const file = path.join(s.dir, 'a b.txt');
  fs.writeFileSync(file, '');
  const r = s.run(pickOpenWithDefault(file, 'linux'));
  assert.equal(r.status, 0);
  assert.equal(s.logged(), `gio open ${file}\n`);
});

test('pickOpenWithDefault linux says so when the file is gone, or nothing can open it', async () => {
  const { pickOpenWithDefault } = await load();
  const s = stubs({ gio: 'exit 0' });
  const gone = s.run(pickOpenWithDefault(path.join(s.dir, 'gone.txt'), 'linux'));
  assert.equal(gone.status, 1);
  assert.equal(gone.stderr.trim(), 'It is no longer there.');
  assert.equal(s.logged(), '');
  const bare = stubs({});
  const none = bare.run(pickOpenWithDefault(bare.dir, 'linux'));
  assert.equal(none.status, 1);
  assert.match(none.stderr, /Neither gio nor xdg-open is installed/);
});

const setsid = spawnSync('/bin/sh', ['-c', 'command -v setsid'], { encoding: 'utf8' }).stdout.trim();

test('pickOpenWithDefault linux without gio starts xdg-open in its own session', { skip: !setsid && 'needs setsid' }, async () => {
  const { pickOpenWithDefault } = await load();
  const s = stubs({ 'xdg-open': 'exit 0' }, { setsid });
  const r = s.run(pickOpenWithDefault(s.dir, 'linux'));
  assert.equal(r.status, 0);
  for (let i = 0; i < 100 && !s.logged(); i++) await new Promise((done) => setTimeout(done, 20));
  assert.equal(s.logged(), `xdg-open ${s.dir}\n`);
});

test('pickReveal linux asks the file manager to show the item, by its URI', async () => {
  const { pickReveal } = await load();
  const s = stubs({ 'dbus-send': 'exit 0', gio: 'exit 0' });
  const folder = path.join(s.dir, 'a b,c');
  fs.mkdirSync(folder);
  const file = path.join(folder, 'ü.txt');
  fs.writeFileSync(file, '');
  const r = s.run(pickReveal(file, 'linux'));
  assert.equal(r.status, 0);
  const uri = 'file://' + file.split('/').map(encodeURIComponent).join('/');
  assert.ok(uri.endsWith('/a%20b%2Cc/%C3%BC.txt'), 'a comma would split dbus-send\'s array');
  assert.equal(s.logged(), `dbus-send --session --print-reply --dest=org.freedesktop.FileManager1 --type=method_call /org/freedesktop/FileManager1 org.freedesktop.FileManager1.ShowItems array:string:${uri} string:\n`);
});

test('pickReveal linux opens the folder when no file manager answers, and says when it is gone', async () => {
  const { pickReveal } = await load();
  const s = stubs({ 'dbus-send': 'exit 1', gio: 'exit 0' });
  const file = path.join(s.dir, 'a.txt');
  fs.writeFileSync(file, '');
  assert.equal(s.run(pickReveal(file, 'linux')).status, 0);
  assert.match(s.logged(), new RegExp(`^dbus-send .*\\ngio open ${s.dir}\\n$`));
  const gone = s.run(pickReveal(path.join(s.dir, 'gone.txt'), 'linux'));
  assert.equal(gone.status, 1);
  assert.equal(gone.stderr.trim(), 'It is no longer there.');
});

test('fileUri percent-encodes each part of the path', async () => {
  const { fileUri } = await load();
  assert.equal(fileUri('/home/me/a b,c/#1?.md'), 'file:///home/me/a%20b%2Cc/%231%3F.md');
  assert.equal(fileUri('/'), 'file:///');
});

test('labels name the file manager on Linux', async () => {
  const { revealLabel, openFolderLabel, revealError } = await load();
  assert.equal(revealLabel('linux'), 'Show in file manager');
  assert.equal(openFolderLabel('linux'), 'Open in file manager');
  assert.equal(revealError('linux'), 'show it in the file manager');
  assert.equal(openFolderLabel('macos'), 'Open in Finder');
  assert.equal(openFolderLabel('windows'), 'Open in Explorer');
});

// --- A file manager of the person's own ---

test('pickOwnFileManager runs its command with the path after it, on any platform', async () => {
  const { pickOwnFileManager } = await load();
  assert.deepEqual(pickOwnFileManager({ name: 'Yazi', command: ['open-files', '--here'] }, '/repo/a b.md'), { program: 'open-files', args: ['--here', '/repo/a b.md'] });
  assert.deepEqual(pickOwnFileManager({ name: '', command: ['nautilus'] }, '/repo'), { program: 'nautilus', args: ['/repo'] });
});

test('labels name the file manager of your own, or call it the file manager', async () => {
  const { revealLabel, openFolderLabel, revealError } = await load();
  for (const platform of ['macos', 'windows', 'linux']) {
    assert.equal(revealLabel(platform, { name: 'Yazi' }), 'Show in Yazi');
    assert.equal(openFolderLabel(platform, { name: 'Yazi' }), 'Open in Yazi');
    assert.equal(revealError(platform, { name: 'Yazi' }), 'show it in Yazi');
    assert.equal(revealLabel(platform, { name: '' }), 'Show in file manager');
    assert.equal(revealError(platform, { name: '' }), 'show it in the file manager');
  }
  assert.equal(revealLabel('macos', null), 'Show in Finder');
});
