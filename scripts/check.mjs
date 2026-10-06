// owner: WP7
// 静态检查（ARCH §14.2）：跨区域 import、区域目录禁用 API、未注册的 id 字面量、owner 注释、TS 质量（any、@ts-ignore）、只用 three，
// 以及 lint()（带 when 的交互物有 blocked、同组角标一致、主体/hideWorld ref 可解析、文本常量不空；在构建好的游戏里逐区调用 __game.lint()）。
//
// 用法：
//   node scripts/check.mjs                 全部静态检查 + lint（需要先 npm run build；--dist=<dir> 或 CAMERA_DIST 指定构建目录）
//   node scripts/check.mjs --no-lint       只做静态检查（M1b：各 WP 还是占位、游戏起不来时用）
//   node scripts/check.mjs --stubs [--owner=WP7]   列出残留的 notImplemented( 调用，按拥有者与文件分组；有残留（或指定拥有者有残留）则退出码 1
//   node scripts/check.mjs --root=<dir>    扫描 <dir>/src 而不是仓库的 src（自测用；id 注册表仍取仓库的 src/data/ids.ts）
//   --json                                 把违规列表以 JSON 打印（给别的脚本用）
// 豁免：某一行确需违反规则时，在该行或上一行写 `// check-allow: <规则名>`（规则名见输出方括号），并在代码里写明原因。
// src/areas/dev/ 是引擎自测沙盒（各 WP 的测试夹具，不是区域内容）：“区域目录禁用 API”在那里只报警告。

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OWNER_TOKENS = ['WP1', 'WP2', 'WP3', 'WP4', 'WP5', 'WP6', 'WP7', 'R1-world', 'R1-finale', 'R2', 'R3', 'R4', 'integrator'];
const ID_NS = ['r1', 'r2', 'r3', 'r4', 'it', 'ph', 'pt', 'rd', 'rp', 'seg', 'spawn', 'exit', 'npc', 'spk', 'ghost', 'doc', 'name', 'pz', 'dlg'];
const ID_RE = new RegExp(`^(${ID_NS.join('|')})\\.[a-z0-9_.]+$`);
const ALLOWED_DIRS = ['core', 'game', 'ui', 'fx', 'rigs', 'kit', 'audio', 'data'];
const FORBIDDEN = [
  { rule: 'no-setTimeout', re: /\bsetTimeout\b/, msg: '区域里不用 setTimeout 驱动玩法（用 ctx.after）' },
  { rule: 'no-setInterval', re: /\bsetInterval\b/, msg: '区域里不用 setInterval（用 ctx.every）' },
  { rule: 'no-localStorage', re: /\blocalStorage\b/, msg: '区域不写 localStorage（存档只由引擎写）' },
  { rule: 'no-debug-api', re: /\b__game\b|\b__cam\b/, msg: '区域不碰调试 API' },
  { rule: 'no-raw-light', re: /\bnew\s+(?:THREE\s*\.\s*)?(?:PointLight|SpotLight|AmbientLight|HemisphereLight)\b/, msg: '灯走 designLight/lamp/ctx.light/ctx.hemi' },
  { rule: 'no-pointer-lock', re: /\brequestPointerLock\b/, msg: '区域不请求指针锁定' },
  { rule: 'no-audio-context', re: /\b(?:webkit)?AudioContext\b/, msg: '区域不建 AudioContext（声音走引擎）' },
];

// ==================================================================== 词法：去注释、取字符串字面量（不是完整的 TS 解析器，够本检查用）

const REGEX_PREV = new Set(['', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^']);
const REGEX_KW = new Set(['return', 'typeof', 'case', 'in', 'of', 'new', 'delete', 'void', 'throw', 'else', 'do', 'await', 'yield']);

/**
 * 扫描源码：code = 注释与字符串都换成空白（保留换行，用于禁用 API 与 notImplemented 统计）；
 * noComments = 只去注释（用于 import 解析）；strings = 不含 ${} 的字符串字面量 { value, line }。
 */
export function scanSource(src) {
  const n = src.length;
  const code = [];
  const nc = [];
  const strings = [];
  let i = 0;
  let line = 1;
  let depth = 0;
  const tStack = [];          // 模板字符串里 ${ 的嵌套：{ depth, tpl }
  let lastSig = '';
  let word = '';
  let lastWord = '';
  const put = (ch, keepNc = true) => {
    code.push(ch === '\n' ? '\n' : ' ');
    nc.push(keepNc ? ch : ch === '\n' ? '\n' : ' ');
    if (ch === '\n') line++;
  };
  const readTemplate = tpl => {
    // 从 i 读到 ` 或 ${
    while (i < n) {
      const c = src[i];
      if (c === '\\') { tpl.raw += src.slice(i, i + 2); put(c); if (i + 1 < n) put(src[i + 1]); i += 2; continue; }
      if (c === '`') {
        put(c);
        i++;
        if (!tpl.expr) strings.push({ value: tpl.raw, line: tpl.line, quote: '`' });
        lastSig = ')';
        return;
      }
      if (c === '$' && src[i + 1] === '{') {
        tpl.expr = true;
        put(c);
        put('{');
        i += 2;
        depth++;
        tStack.push({ depth, tpl });
        lastSig = '{';
        return;
      }
      tpl.raw += c;
      put(c);
      i++;
    }
  };
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') { put(src[i], false); i++; }
      continue;
    }
    if (c === '/' && d === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end < 0 ? n : end + 2;
      while (i < stop) { put(src[i], false); i++; }
      continue;
    }
    if (c === '\'' || c === '"') {
      const startLine = line;
      let raw = '';
      put(c);
      i++;
      while (i < n && src[i] !== c && src[i] !== '\n') {
        if (src[i] === '\\') {
          const e = src[i + 1];
          raw += e === 'n' ? '\n' : e === 't' ? '\t' : e;
          put(src[i]);
          put(e);
          i += 2;
          continue;
        }
        raw += src[i];
        put(src[i]);
        i++;
      }
      if (i < n) { put(src[i]); i++; }
      // 字符串的内容在 code 里换成空白（nc 里保留，import 解析要用）
      strings.push({ value: raw, line: startLine, quote: c });
      lastSig = ')';
      word = '';
      continue;
    }
    if (c === '`') {
      const tpl = { raw: '', line, expr: false };
      put(c);
      i++;
      readTemplate(tpl);
      word = '';
      continue;
    }
    if (c === '/' && d !== '/' && d !== '*' && (REGEX_PREV.has(lastSig) || (lastSig === 'a' && REGEX_KW.has(word || lastWord)))) {
      // 正则字面量：读到不在 [...] 里的未转义 /
      put(c, true);
      i++;
      let inClass = false;
      while (i < n && src[i] !== '\n') {
        const ch = src[i];
        if (ch === '\\') { put(ch); put(src[i + 1]); i += 2; continue; }
        if (ch === '[') inClass = true;
        else if (ch === ']') inClass = false;
        else if (ch === '/' && !inClass) break;
        put(ch);
        i++;
      }
      if (i < n && src[i] === '/') { put('/'); i++; }
      while (i < n && /[a-z]/.test(src[i])) { put(src[i]); i++; }
      lastSig = ')';
      word = '';
      continue;
    }
    if (c === '{') depth++;
    if (c === '}') {
      const top = tStack[tStack.length - 1];
      if (top && top.depth === depth) {
        tStack.pop();
        depth--;
        put(c);
        i++;
        readTemplate(top.tpl);
        continue;
      }
      depth--;
    }
    code.push(c);
    nc.push(c);
    if (c === '\n') line++;
    if (/[A-Za-z0-9_$]/.test(c)) {
      word += c;
    } else {
      if (word) lastWord = word;
      word = '';
    }
    if (!/\s/.test(c)) {
      lastSig = /[A-Za-z0-9_$]/.test(c) ? 'a' : c;
      if (/[A-Za-z0-9_$]/.test(c)) lastWord = '';
    }
    i++;
  }
  return { code: code.join(''), noComments: nc.join(''), strings };
}

/** 解析 import/export-from/动态 import：{ spec, typeOnly, line }。 */
export function parseImports(noComments) {
  const out = [];
  const lineOf = idx => noComments.slice(0, idx).split('\n').length;
  const stat = /(^|[;\n}])\s*(import|export)\s+(type\s+)?([^;'"`]*?)\s*from\s*(['"])([^'"]+)\5/g;
  for (let m; (m = stat.exec(noComments));) {
    const clause = m[4];
    let typeOnly = !!m[3];
    if (!typeOnly) {
      const braces = /\{([^}]*)\}/.exec(clause);
      const rest = clause.replace(/\{[^}]*\}/, '').replace(/,/g, '').trim();
      if (braces && !rest) {
        const specs = braces[1].split(',').map(s => s.trim()).filter(Boolean);
        typeOnly = specs.length > 0 && specs.every(s => s.startsWith('type '));
      }
    }
    out.push({ spec: m[6], typeOnly, line: lineOf(m.index + m[0].search(/\b(import|export)\b/)) });
  }
  const side = /(^|[;\n}])\s*import\s*(['"])([^'"]+)\2/g;
  for (let m; (m = side.exec(noComments));) out.push({ spec: m[3], typeOnly: false, line: lineOf(m.index + m[0].search(/\bimport\b/)) });
  const dyn = /\bimport\s*\(\s*(['"])([^'"]+)\1\s*\)/g;
  for (let m; (m = dyn.exec(noComments));) out.push({ spec: m[2], typeOnly: false, line: lineOf(m.index), dynamic: true });
  return out;
}

// ==================================================================== 文件与区域

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.ts$/.test(e.name) && !/\.d\.ts$/.test(e.name)) out.push(p);
  }
  return out;
}

/** src 相对路径所在的区域：r1（不含 finale）、r1/finale、r2、r2_502、r3、r4、dev；不在区域目录里返回 null（含 src/areas/index.ts）。 */
function areaOf(rel) {
  const m = /^areas\/([^/]+)(?:\/(.*))?$/.exec(rel);
  if (!m) return null;
  const top = m[1].replace(/\.ts$/, '');
  if (top === 'index') return null;
  const rest = m[2] ?? '';
  if (top === 'r1' && (rest === 'finale' || rest.startsWith('finale/'))) return 'r1/finale';
  return top;
}

/** dlg.<areaId>.x 的 areaId 对应的目录区域。 */
const dlgAreaOf = a => (a === 'r1/finale' ? 'r1' : a);

// ==================================================================== 检查

async function loadIds() {
  const ids = await import(pathToFileURL(path.join(REPO, 'src/data/ids.ts')).href);
  const known = new Set([...ids.ALL_IDS, ...ids.DEV_IDS]);
  return { known, all: ids.ALL_IDS, dev: ids.DEV_IDS };
}

function allowedOn(lines, lineNo, rule) {
  const re = new RegExp(`check-allow:[^\\n]*\\b${rule}\\b`);
  return re.test(lines[lineNo - 1] ?? '') || re.test(lines[lineNo - 2] ?? '');
}

/** 静态检查整棵 src：返回 { violations, warnings, stubs }。 */
export async function checkTree(srcRoot) {
  const { known } = await loadIds();
  const knownList = [...known];
  const violations = [];
  const warnings = [];
  const stubs = [];
  const files = walk(srcRoot).sort();
  for (const file of files) {
    const rel = path.relative(srcRoot, file).split(path.sep).join('/');
    const src = fs.readFileSync(file, 'utf8');
    const lines = src.split('\n');
    const { code, noComments, strings } = scanSource(src);
    const codeLines = code.split('\n');
    // 豁免注释只在引擎文件与 dev 沙盒里生效；正式区域目录（r1…r4、r2_502）不得自我豁免，需求走 docs/requests/（ARCH §14.2，M1c）
    const areaHere = areaOf(rel);
    const allowOk = areaHere === null || areaHere === 'dev';
    const add = (list, rule, line, msg) => {
      if (allowOk && allowedOn(lines, line, rule)) return;
      list.push({ rule, file: `src/${rel}`, line, msg });
    };
    // owner 注释（ARCH §2.13）
    const owner = /^\/\/ owner: (\S+)\s*$/.exec(lines[0] ?? '');
    const token = owner && OWNER_TOKENS.includes(owner[1]) ? owner[1] : null;
    if (!token) add(violations, 'owner-header', 1, `第一行必须恰好是 “// owner: <${OWNER_TOKENS.join('|')}>”，实际 ${JSON.stringify(lines[0] ?? '')}`);
    // notImplemented 残留
    codeLines.forEach((l, i) => {
      const hits = l.match(/\bnotImplemented\s*\(/g);
      if (!hits) return;
      if (/\bfunction\s+notImplemented\s*\(/.test(l)) return;
      for (let k = 0; k < hits.length; k++) stubs.push({ owner: token ?? '?', file: `src/${rel}`, line: i + 1 });
    });
    // TS 质量（ARCH §14.1 第 2 条）
    codeLines.forEach((l, i) => {
      if (/(:\s*any\b|\bas\s+any\b|<any>|\bany\[\]|<any,|,\s*any>)/.test(l)) add(violations, 'no-any', i + 1, '不使用 any（用 unknown + 断言并注释原因）');
    });
    lines.forEach((l, i) => {
      if (/@ts-ignore|@ts-nocheck/.test(l)) add(violations, 'no-ts-ignore', i + 1, '不使用 @ts-ignore/@ts-nocheck');
    });
    // import 规则
    const area = areaOf(rel);
    for (const imp of parseImports(noComments)) {
      if (!imp.spec.startsWith('.')) {
        if (imp.spec !== 'three' && !imp.spec.startsWith('three/addons/') && !imp.typeOnly) add(violations, 'only-three', imp.line, `只用 three（含 addons），不引入 ${imp.spec}（ARCH §1.1）`);
        continue;
      }
      const target = path.relative(srcRoot, path.resolve(path.dirname(file), imp.spec)).split(path.sep).join('/');
      if (area === null) continue;
      const tArea = areaOf(target);
      const tTop = target.split('/')[0];
      if (target.startsWith('..')) {
        add(violations, 'import-outside-src', imp.line, `import 到 src 之外：${imp.spec}`);
        continue;
      }
      if (tArea !== null) {
        if (tArea === area) continue;
        // r1 的特例：index.ts 可以同时 import world 与 finale；finale 可以 import r1/layout.ts
        if (rel === 'areas/r1/index.ts' && (tArea === 'r1' || tArea === 'r1/finale')) continue;
        if (area === 'r1/finale' && /^areas\/r1\/layout(\.ts)?$/.test(target)) continue;
        add(violations, 'cross-area-import', imp.line, `区域 ${area} 不得 import 区域 ${tArea}（${imp.spec}）`);
        continue;
      }
      if (target === 'areas/index' || target === 'areas/index.ts') {
        add(violations, 'cross-area-import', imp.line, `区域 ${area} 不得 import 区域注册表 ${imp.spec}`);
        continue;
      }
      if (/^core\/game(\.ts)?$/.test(target) && !imp.typeOnly) {
        add(violations, 'area-imports-game', imp.line, '区域模块不得在运行时 import core/game.ts（只能 import type，ARCH §4.4）');
        continue;
      }
      if (area !== 'dev') {
        // M1d：截图机位的类型可以 import type 自 debug/shots（ARCH §2.11 推荐区域写独立的 shots.ts；也可从 core/area 取再导出的 ShotDef）
        if (tTop === 'debug') {
          if (!(imp.typeOnly && /^debug\/shots(\.ts)?$/.test(target))) add(violations, 'area-imports-debug', imp.line, `区域不得 import src/debug（${imp.spec}；截图机位类型用 import type { ShotDef } from core/area）`);
        }
        else if (tTop === 'ui' && !imp.typeOnly) add(violations, 'area-imports-ui', imp.line, `区域对 src/ui 只能 import type（${imp.spec}）`);
        else if (!ALLOWED_DIRS.includes(tTop) && tTop !== 'debug') add(violations, 'area-import-dir', imp.line, `区域只能 import ${ALLOWED_DIRS.join('/')} 与自己的目录（${imp.spec}）`);
      }
    }
    // 区域目录禁用 API（dev 沙盒只报警告）
    if (area !== null) {
      codeLines.forEach((l, i) => {
        for (const f of FORBIDDEN) {
          if (f.re.test(l)) add(area === 'dev' ? warnings : violations, f.rule, i + 1, f.msg);
        }
      });
    }
    // id 字面量（ARCH §14.2）；src/data/ids.ts 自身豁免
    if (rel !== 'data/ids.ts') {
      for (const s of strings) {
        if (!ID_RE.test(s.value)) continue;
        const ns = s.value.slice(0, s.value.indexOf('.'));
        if (ns === 'dlg') {
          if (area === null) continue;
          const parts = s.value.split('.');
          if (parts.length < 3 || !parts[2]) continue;
          if (parts[1] !== dlgAreaOf(area)) add(violations, 'dlg-area', s.line, `对话 id ${s.value} 的区域段应为 ${dlgAreaOf(area)}`);
          continue;
        }
        if (s.value.startsWith('ph.empty_')) continue;
        if (known.has(s.value)) continue;
        if (/[._]$/.test(s.value) && knownList.some(k => k.startsWith(s.value))) continue;
        add(violations, 'unknown-id', s.line, `未登记的 id 字面量 '${s.value}'（不在 ALL_IDS ∪ DEV_IDS，GDD §13）`);
      }
    }
  }
  return { violations, warnings, stubs, files: files.length };
}

// ==================================================================== lint（在构建好的游戏里逐区调用 __game.lint()）

async function runLint(dist) {
  const { launch, DEV_QUERY } = await import(pathToFileURL(path.join(REPO, 'scripts/lib/harness.mjs')).href);
  const issues = new Set();
  const failures = [];
  let h;
  try {
    h = await launch({ query: DEV_QUERY, dist, label: 'check-lint' });
  } catch (err) {
    return { issues: [], failures: [`lint：游戏起不来（${err.message.split('\n')[0]}）`] };
  }
  try {
    for (const area of ['dev', 'r1', 'r2', 'r2_502', 'r3', 'r4']) {
      if (area !== 'dev') {
        const r = await h.call.try('setState', { area });
        if (!r.ok) {
          failures.push(`lint：进入 ${area} 失败 → ${r.reason}`);
          continue;
        }
      }
      const r = await h.call.try('lint');
      if (!r.ok) {
        failures.push(`lint：${area} 的 lint() → ${r.reason}`);
        continue;
      }
      for (const s of r.result.issues) issues.add(s);
    }
    for (const e of h.errors) failures.push(`lint：页面错误 [${e.kind}] ${e.text.split('\n')[0]}`);
  } finally {
    await h.close();
  }
  return { issues: [...issues], failures };
}

// ==================================================================== CLI

async function main() {
  const args = Object.fromEntries(process.argv.slice(2).map(a => {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    return m ? [m[1], m[2] ?? true] : [a, true];
  }));
  const root = args.root ? path.resolve(String(args.root)) : REPO;
  const srcRoot = path.join(root, 'src');
  const res = await checkTree(srcRoot);

  if (args.stubs) {
    const owner = typeof args.owner === 'string' ? args.owner : null;
    const byOwner = new Map();
    for (const s of res.stubs) {
      if (!byOwner.has(s.owner)) byOwner.set(s.owner, new Map());
      const files = byOwner.get(s.owner);
      files.set(s.file, (files.get(s.file) ?? 0) + 1);
    }
    let total = 0;
    for (const tok of [...OWNER_TOKENS, '?']) {
      const files = byOwner.get(tok);
      const n = files ? [...files.values()].reduce((a, b) => a + b, 0) : 0;
      total += n;
      if (owner && tok !== owner) continue;
      console.log(`${tok.padEnd(10)} ${String(n).padStart(4)}`);
      if (files) for (const [f, k] of [...files].sort()) console.log(`    ${String(k).padStart(4)}  ${f}`);
    }
    const mine = owner ? [...(byOwner.get(owner)?.values() ?? [])].reduce((a, b) => a + b, 0) : total;
    console.log(`notImplemented( 残留：${owner ? `${owner} ${mine}，` : ''}全树 ${total}`);
    process.exit(mine > 0 ? 1 : 0);
  }

  const violations = [...res.violations];
  let lintIssues = [];
  if (!args['no-lint']) {
    const dist = typeof args.dist === 'string' ? path.resolve(args.dist) : undefined;
    const lint = await runLint(dist);
    lintIssues = lint.issues;
    for (const f of lint.failures) violations.push({ rule: 'lint-run', file: '-', line: 0, msg: f });
    for (const s of lint.issues) violations.push({ rule: 'lint', file: '-', line: 0, msg: s });
  }
  if (args.json) {
    console.log(JSON.stringify({ violations, warnings: res.warnings, lint: lintIssues, files: res.files }, null, 2));
  } else {
    for (const w of res.warnings) console.log(`warning [${w.rule}] ${w.file}:${w.line} ${w.msg}`);
    for (const v of violations) console.log(`violation [${v.rule}] ${v.file}:${v.line} ${v.msg}`);
    const counts = {};
    for (const v of violations) counts[v.rule] = (counts[v.rule] ?? 0) + 1;
    console.log(`\ncheck: ${res.files} 个文件，${violations.length} 条违规${violations.length ? `（${Object.entries(counts).map(([k, n]) => `${k} ${n}`).join('，')}）` : ''}，${res.warnings.length} 条警告${args['no-lint'] ? '（未跑 lint）' : ''}`);
  }
  process.exit(violations.length ? 1 : 0);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch(err => {
    console.error(err);
    process.exit(2);
  });
}
