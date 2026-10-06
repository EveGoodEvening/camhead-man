// owner: WP4
// 条件表达式（ARCH §6.2）：FlagExpr 字符串解析器 + 注册表校验。
//
// expr    := or
// or      := and ('||' and)*
// and     := unary ('&&' unary)*
// unary   := '!' unary | primary
// primary := '(' expr ')' | 'true' | 'false'
//          | FLAG_ID [cmp NUMBER]
//          | 'has(' ITEM_ID ')' | 'used(' ITEM_ID ')' | 'photo(' PHOTO_ID ')' | 'seen(' KEY ')'
//          | 'temp(' TEMP_KEY ')' [cmp NUMBER]
//          | 'shichen' ('=='|'!=') ('zi'|'chou'|'yin'|'mao')
//          | 'lens' ('=='|'!=') ('normal'|'ir') | 'vf' | 'ants' cmp NUMBER
// cmp     := '==' | '!=' | '>=' | '<=' | '>' | '<'
//
// 编译结果是闭包，每次调用时现算（角标、聚焦、activate 都是现算的，ARCH §6.2）。
// 字符串按原文缓存：同一条件在每帧的聚焦/角标里反复出现，不必每次重新解析。
// 相对 ARCH 的补充：temp(key) 后面也允许 cmp NUMBER（数值型临时状态，如楼层）；lens 也允许 '!='。

import type { StateView } from './state';
import { F, IT, PH, isEmptyPhotoId } from '../data/ids';
import type { FlagId, ItemId, PhotoId } from '../data/ids';
import type { Shichen } from '../core/types';
import { DEV_CHECKS } from '../core/log';

export type Cond = string | ((s: StateView) => boolean);

type Pred = (s: StateView) => boolean;
type Cmp = '==' | '!=' | '>=' | '<=' | '>' | '<';

const FLAG_SET: ReadonlySet<string> = new Set<string>(Object.values(F));
const ITEM_SET: ReadonlySet<string> = new Set<string>(Object.values(IT));
const PHOTO_SET: ReadonlySet<string> = new Set<string>(Object.values(PH));
const SHICHEN_SET: ReadonlySet<string> = new Set<string>(['zi', 'chou', 'yin', 'mao']);
const CALLS: ReadonlySet<string> = new Set(['has', 'used', 'photo', 'seen', 'temp']);

const TRUE: Pred = () => true;
const FALSE: Pred = () => false;

/** 解析错误（语法）与注册表错误（未登记 id）。 */
export class CondError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'CondError';
  }
}

type Tok =
  | { k: 'op'; v: '&&' | '||' | '!' | '(' | ')' }
  | { k: 'cmp'; v: Cmp }
  | { k: 'num'; v: number }
  | { k: 'id'; v: string }
  /** has(…)/used(…)/photo(…)/seen(…)/temp(…)：参数原样保留（seen 的 KEY 可以含点、冒号） */
  | { k: 'call'; fn: string; arg: string };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i]!;
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
    const two = src.slice(i, i + 2);
    if (two === '&&' || two === '||') { out.push({ k: 'op', v: two }); i += 2; continue; }
    if (two === '==' || two === '!=' || two === '>=' || two === '<=') { out.push({ k: 'cmp', v: two }); i += 2; continue; }
    if (c === '>' || c === '<') { out.push({ k: 'cmp', v: c }); i++; continue; }
    if (c === '!' || c === '(' || c === ')') { out.push({ k: 'op', v: c }); i++; continue; }
    if (/[0-9]/.test(c) || (c === '-' && /[0-9]/.test(src[i + 1] ?? ''))) {
      let j = i + 1;
      while (j < n && /[0-9.]/.test(src[j]!)) j++;
      out.push({ k: 'num', v: Number(src.slice(i, j)) });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_.]/.test(src[j]!)) j++;
      const word = src.slice(i, j);
      // 函数调用：名字后（可有空白）紧跟 '('，参数读到 ')' 为止
      let k = j;
      while (k < n && src[k] === ' ') k++;
      if (CALLS.has(word) && src[k] === '(') {
        const close = src.indexOf(')', k + 1);
        if (close < 0) throw new CondError(`缺少 ')'：${word}(`);
        out.push({ k: 'call', fn: word, arg: src.slice(k + 1, close).trim() });
        i = close + 1;
        continue;
      }
      out.push({ k: 'id', v: word });
      i = j;
      continue;
    }
    throw new CondError(`无法识别的字符 '${c}'（位置 ${i}）`);
  }
  return out;
}

function compare(a: number, op: Cmp, b: number): boolean {
  switch (op) {
    case '==': return a === b;
    case '!=': return a !== b;
    case '>=': return a >= b;
    case '<=': return a <= b;
    case '>': return a > b;
    case '<': return a < b;
  }
}

/** 数值化临时状态：true → 1、false → 0。 */
const tempNum = (v: boolean | number): number => (typeof v === 'number' ? v : v ? 1 : 0);

class Parser {
  private i = 0;
  /** 注册表问题（未登记 id）：dev 下整体抛错，生产里照常编译（flag() 对未知 id 返回 false） */
  readonly unknown: string[] = [];

  constructor(private readonly toks: Tok[]) {}

  parse(): Pred {
    const p = this.or();
    if (this.i < this.toks.length) throw new CondError(`多余的内容：${JSON.stringify(this.toks[this.i])}`);
    return p;
  }

  private peek(): Tok | undefined {
    return this.toks[this.i];
  }
  private isOp(v: string): boolean {
    const t = this.peek();
    return t !== undefined && t.k === 'op' && t.v === v;
  }

  private or(): Pred {
    const parts = [this.and()];
    while (this.isOp('||')) {
      this.i++;
      parts.push(this.and());
    }
    if (parts.length === 1) return parts[0]!;
    return s => parts.some(p => p(s));
  }

  private and(): Pred {
    const parts = [this.unary()];
    while (this.isOp('&&')) {
      this.i++;
      parts.push(this.unary());
    }
    if (parts.length === 1) return parts[0]!;
    return s => parts.every(p => p(s));
  }

  private unary(): Pred {
    if (this.isOp('!')) {
      this.i++;
      const inner = this.unary();
      return s => !inner(s);
    }
    return this.primary();
  }

  private optCmp(): { op: Cmp; n: number } | null {
    const t = this.peek();
    if (!t || t.k !== 'cmp') return null;
    this.i++;
    const num = this.peek();
    if (!num || num.k !== 'num') throw new CondError(`比较符 '${t.v}' 后面要跟数字`);
    this.i++;
    return { op: t.v, n: num.v };
  }

  private needCmp(what: string): { op: Cmp; n: number } {
    const c = this.optCmp();
    if (!c) throw new CondError(`'${what}' 后面要跟比较符与数字`);
    return c;
  }

  private primary(): Pred {
    const t = this.peek();
    if (!t) throw new CondError('表达式意外结束');
    if (t.k === 'op' && t.v === '(') {
      this.i++;
      const inner = this.or();
      if (!this.isOp(')')) throw new CondError("缺少 ')'");
      this.i++;
      return inner;
    }
    if (t.k === 'call') {
      this.i++;
      return this.call(t.fn, t.arg);
    }
    if (t.k !== 'id') throw new CondError(`此处应为条件，得到 ${JSON.stringify(t)}`);
    this.i++;
    const w = t.v;
    if (w === 'true') return TRUE;
    if (w === 'false') return FALSE;
    if (w === 'vf') return s => s.vf;
    if (w === 'ants') {
      const { op, n } = this.needCmp('ants');
      return s => compare(s.antCount(), op, n);
    }
    if (w === 'shichen' || w === 'lens') {
      const c = this.peek();
      if (!c || c.k !== 'cmp' || (c.v !== '==' && c.v !== '!=')) throw new CondError(`'${w}' 后面要跟 == 或 !=`);
      this.i++;
      const v = this.peek();
      if (!v || v.k !== 'id') throw new CondError(`'${w} ${c.v}' 后面缺值`);
      this.i++;
      const eq = c.v === '==';
      if (w === 'shichen') {
        if (!SHICHEN_SET.has(v.v)) throw new CondError(`未知时辰 '${v.v}'`);
        const want = v.v as Shichen;
        return s => (s.shichen === want) === eq;
      }
      if (v.v !== 'normal' && v.v !== 'ir') throw new CondError(`未知镜头 '${v.v}'`);
      const want = v.v;
      return s => (s.lens === want) === eq;
    }
    // FLAG_ID [cmp NUMBER]
    if (!FLAG_SET.has(w)) this.unknown.push(`flag '${w}'`);
    const id = w as FlagId;
    const c = this.optCmp();
    if (c) return s => compare(s.num(id), c.op, c.n);
    return s => s.flag(id);
  }

  private call(fn: string, arg: string): Pred {
    if (arg === '') throw new CondError(`${fn}() 缺参数`);
    switch (fn) {
      case 'has': {
        if (!ITEM_SET.has(arg)) this.unknown.push(`物品 '${arg}'`);
        const id = arg as ItemId;
        return s => s.has(id);
      }
      case 'used': {
        if (!ITEM_SET.has(arg)) this.unknown.push(`物品 '${arg}'`);
        const id = arg as ItemId;
        return s => s.used(id);
      }
      case 'photo': {
        if (!PHOTO_SET.has(arg) && !isEmptyPhotoId(arg)) this.unknown.push(`照片 '${arg}'`);
        const id = arg as PhotoId;
        return s => s.hasPhoto(id);
      }
      case 'seen':
        return s => s.seen(arg);
      case 'temp': {
        // 区域临时状态键不带点（ARCH §0.3），这样不会被当成游戏 id
        if (arg.includes('.')) throw new CondError(`temp(${arg})：临时状态键不能带点`);
        const c = this.optCmp();
        if (c) return s => compare(tempNum(s.temp(arg)), c.op, c.n);
        return s => tempNum(s.temp(arg)) > 0;
      }
    }
    throw new CondError(`未知函数 ${fn}()`);
  }
}

const cache = new Map<string, Pred>();

/** 解析一条 FlagExpr 字符串（不缓存、不吞错）：语法错误或未登记 id 抛 CondError。供自测与 lint 使用。 */
export function parseCond(src: string): Pred {
  const p = new Parser(tokenize(src));
  const pred = p.parse();
  if (p.unknown.length) throw new CondError(`未登记的 id：${p.unknown.join('、')}`);
  return pred;
}

/** 未定义 = 恒真；字符串在注册时编译并校验 id（未登记的 id 在 dev 下抛错，错误信息带 where）。 */
export function compileCond(c: Cond | undefined, where: string): (s: StateView) => boolean {
  if (c === undefined) return TRUE;
  if (typeof c === 'function') return c;
  const hit = cache.get(c);
  if (hit) return hit;
  let pred: Pred;
  try {
    const p = new Parser(tokenize(c));
    pred = p.parse();
    if (p.unknown.length) {
      const msg = `条件 '${c}'（${where}）引用了未登记的 id：${p.unknown.join('、')}`;
      if (DEV_CHECKS) throw new CondError(msg);
      console.error(`[expr] ${msg}`);
    }
  } catch (err) {
    const msg = err instanceof CondError && err.message.startsWith('条件 ') ? err.message : `条件 '${c}'（${where}）：${err instanceof Error ? err.message : String(err)}`;
    if (DEV_CHECKS) throw new CondError(msg);
    // 生产构建里不让一条写错的条件拖垮整个区域：记错误，按“假”处理
    console.error(`[expr] ${msg}`);
    return FALSE;
  }
  cache.set(c, pred);
  return pred;
}
