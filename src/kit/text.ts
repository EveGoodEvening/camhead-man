// owner: WP2
// 文字贴图（ARCH §10.1；GDD §3.14 字体策略）：makeTextTexture()、makeTextPlane()、CJK 字形检测。

import * as THREE from 'three';
import {
  CJK_FONT_STACK, HAND_FONT_STACK, SERIF_FONT_STACK, agePaper, blotch, canvasToTexture, createCanvas, drawHandLine, waterStain,
} from './canvas';
import { rng, range } from './rng';

/** ARCH §1.2 的系统 CJK 字体栈 */
export const FONT_STACK = CJK_FONT_STACK;

let cjkCache: boolean | null = null;

/**
 * measureText 比较“伙”与非字符 U+FFFF（'￿'，会画成豆腐块）的宽度与像素。
 * 两者宽度相同且像素完全一样 → 没有 CJK 字形（都画成了豆腐块）。每次调用都重新检测（Game.boot 在 fonts.ready 之后调用），
 * 结果缓存给 makeTextTexture 用。
 */
export function detectCjk(): boolean {
  if (typeof document === 'undefined') return false;
  const size = 32;
  const draw = (ch: string): { w: number; px: Uint8ClampedArray } => {
    const { g } = createCanvas(size * 2, size * 2);
    g.font = `${size}px ${FONT_STACK}`;
    g.textBaseline = 'top';
    g.fillStyle = '#000';
    g.fillText(ch, 4, 4);
    return { w: g.measureText(ch).width, px: g.getImageData(0, 0, size * 2, size * 2).data };
  };
  const a = draw('伙'), b = draw('￿');
  let same = Math.abs(a.w - b.w) < 0.5;
  if (same) {
    for (let i = 3; i < a.px.length; i += 4) {
      if (a.px[i] !== b.px[i]) {
        same = false;
        break;
      }
    }
  }
  let inked = false;
  for (let i = 3; i < a.px.length; i += 4) if ((a.px[i] ?? 0) > 0) inked = true;
  cjkCache = !same && inked;
  return cjkCache;
}

function cjkAvailable(): boolean {
  return cjkCache ?? detectCjk();
}

const CJK_RE = /[⺀-鿿豈-﫿＀-￯　-〿]/u;

export interface TextTexOpts {
  /** 多行 */
  text: string | readonly string[];
  /** 默认 1024 × 自动（2 的幂） */
  width?: 512 | 1024 | 2048; height?: number;
  font?: { family?: 'sans' | 'serif' | 'hand'; size: number; weight?: number | 'bold' };
  /** null = 透明 */
  color?: string; bg?: string | null;
  /** vertical：竖排（对联、招牌） */
  align?: 'left' | 'center' | 'right'; vertical?: boolean;
  padding?: number; lineHeight?: number;
  stroke?: { color: string; width: number };
  /** 霓虹 */
  glow?: { color: string; blur: number };
  /** 水平镜像绘制（镜中字预制） */
  mirror?: boolean;
  /** 褪色、水渍 */
  aged?: { fade: number; stains: number; seed: number };
  /** 霓虹坏字（“馆”不亮）：这些字画成暗管 */
  brokenChars?: readonly number[];
}

function pow2ceil(v: number): number {
  let p = 16;
  while (p < v) p *= 2;
  return p;
}

function familyStack(f: 'sans' | 'serif' | 'hand' | undefined): string {
  return f === 'serif' ? SERIF_FONT_STACK : f === 'hand' ? HAND_FONT_STACK : FONT_STACK;
}

interface Layout {
  lines: string[];
  size: number;
  lineH: number;
  pad: number;
  W: number;
  H: number;
}

/** 按选项算出画布尺寸与字号（横排：超宽时缩小字号；竖排：列从右往左）。 */
function layout(g: CanvasRenderingContext2D, o: TextTexOpts, fontOf: (s: number) => string, aspect?: number): Layout {
  const lines = (typeof o.text === 'string' ? o.text.split('\n') : [...o.text]).map(s => s);
  let size = o.font?.size ?? 96;
  const lh = o.lineHeight ?? 1.25;
  const pad0 = o.padding;
  if (o.vertical) {
    const maxChars = Math.max(1, ...lines.map(l => [...l].length));
    const needW = () => lines.length * size * lh + 2 * (pad0 ?? size * 0.3);
    const needH = () => maxChars * size * 1.05 + 2 * (pad0 ?? size * 0.3);
    let H = o.height ?? (aspect ? 0 : pow2ceil(needH()));
    let W = o.width ?? 0;
    if (!W) W = aspect && H ? Math.round(H * aspect) : pow2ceil(needW());
    if (!H) H = Math.round(W / (aspect ?? 1));
    // 放不下就缩字
    const k = Math.min(1, (H - 2 * (pad0 ?? size * 0.3)) / (maxChars * size * 1.05), (W - 2 * (pad0 ?? size * 0.3)) / (lines.length * size * lh));
    if (k < 1) size *= k;
    return { lines, size, lineH: size * lh, pad: pad0 ?? size * 0.3, W, H };
  }
  const W = o.width ?? 1024;
  const pad = pad0 ?? size * 0.25;
  g.font = fontOf(size);
  const widest = Math.max(1, ...lines.map(l => g.measureText(l).width));
  if (widest > W - pad * 2) size *= (W - pad * 2) / widest;
  const need = lines.length * size * lh + pad * 2;
  let H = o.height ?? (aspect ? Math.round(W / aspect) : pow2ceil(need));
  if (need > H) {
    size *= H / need;
    H = Math.max(H, 16);
  }
  return { lines, size, lineH: size * lh, pad: pad0 ?? size * 0.25, W, H };
}

/** CJK 不可用时的“字”：每个字画一个抽象的笔画块，看得出是字，但读不出（关键线索改由 UI 覆盖层显示）。 */
function fallbackGlyph(g: CanvasRenderingContext2D, x: number, y: number, s: number, seed: number): void {
  const r = rng(seed);
  g.save();
  g.lineWidth = Math.max(1, s * 0.08);
  g.strokeStyle = g.fillStyle;
  g.beginPath();
  for (let i = 0; i < 4; i++) {
    const horizontal = r() < 0.5;
    const a = range(r, 0.15, 0.85) * s;
    if (horizontal) {
      g.moveTo(x + s * 0.12, y + a);
      g.lineTo(x + s * 0.88, y + a);
    } else {
      g.moveTo(x + a, y + s * 0.12);
      g.lineTo(x + a, y + s * 0.88);
    }
  }
  g.stroke();
  g.restore();
}

function drawTextInto(g: CanvasRenderingContext2D, o: TextTexOpts, L: Layout, fallback: boolean): void {
  const { W, H } = L;
  const weight = o.font?.weight ?? 'normal';
  const stack = familyStack(o.font?.family);
  const fontOf = (s: number) => `${weight} ${Math.round(s)}px ${stack}`;
  if (o.bg) {
    g.fillStyle = o.bg;
    g.fillRect(0, 0, W, H);
  } else g.clearRect(0, 0, W, H);
  if (o.aged && o.bg) agePaper(g, W, H, Math.min(1, o.aged.fade + 0.2), o.aged.seed, o.aged.stains);

  g.save();
  if (o.mirror) {
    g.translate(W, 0);
    g.scale(-1, 1);
  }
  const color = o.color ?? '#1a1a1a';
  const broken = new Set(o.brokenChars ?? []);
  const hand = o.font?.family === 'hand';
  const r = rng(o.aged?.seed ?? 7);
  const perChar = hand || broken.size > 0 || o.vertical || fallback;
  g.textBaseline = 'middle';

  // 每个字的中心点（横排按对齐方式、竖排从右往左）
  type Glyph = { ch: string; x: number; y: number; idx: number };
  const glyphs: Glyph[] = [];
  const lineStarts: { line: string; x: number; y: number }[] = [];
  let idx = 0;
  g.font = fontOf(L.size);
  if (o.vertical) {
    const cols = L.lines.length;
    const blockW = cols * L.lineH;
    const x0 = W / 2 + blockW / 2 - L.lineH / 2;
    L.lines.forEach((line, c) => {
      const chars = [...line];
      const colH = chars.length * L.size * 1.05;
      const y0 = (H - colH) / 2 + L.size * 0.525;
      chars.forEach((ch, k) => glyphs.push({ ch, x: x0 - c * L.lineH, y: y0 + k * L.size * 1.05, idx: idx++ }));
    });
  } else {
    const blockH = L.lines.length * L.lineH;
    const y0 = (H - blockH) / 2 + L.lineH / 2;
    L.lines.forEach((line, row) => {
      const w = g.measureText(line).width;
      const align = o.align ?? 'center';
      const x = align === 'left' ? L.pad : align === 'right' ? W - L.pad - w : (W - w) / 2;
      const y = y0 + row * L.lineH;
      lineStarts.push({ line, x, y });
      let cx = x;
      for (const ch of line) {
        const cw = g.measureText(ch).width;
        glyphs.push({ ch, x: cx + cw / 2, y, idx: idx++ });
        cx += cw;
      }
    });
  }

  const drawGlyph = (gl: Glyph, fill: string, withGlow: boolean) => {
    g.save();
    g.fillStyle = fill;
    if (withGlow && o.glow) {
      g.shadowColor = o.glow.color;
      g.shadowBlur = o.glow.blur;
    }
    if (fallback && CJK_RE.test(gl.ch)) {
      fallbackGlyph(g, gl.x - L.size / 2, gl.y - L.size / 2, L.size, gl.ch.codePointAt(0) ?? 0);
    } else if (hand) {
      g.textAlign = 'left';
      g.textBaseline = 'middle';
      drawHandLine(g, r, gl.ch, gl.x - L.size / 2, gl.y, L.size, fill, { smear: 0.15 });
    } else {
      g.textAlign = 'center';
      if (o.stroke) {
        g.lineWidth = o.stroke.width;
        g.strokeStyle = o.stroke.color;
        g.lineJoin = 'round';
        g.strokeText(gl.ch, gl.x, gl.y);
      }
      g.fillText(gl.ch, gl.x, gl.y);
    }
    g.restore();
  };

  g.font = fontOf(L.size);
  if (perChar) {
    for (const gl of glyphs) {
      if (broken.has(gl.idx)) {
        // 坏掉的霓虹管：暗红的空管子，没有光晕
        drawGlyph(gl, 'rgba(70,20,20,0.9)', false);
        g.save();
        g.strokeStyle = 'rgba(150,60,60,0.35)';
        g.lineWidth = Math.max(1, L.size * 0.02);
        g.font = fontOf(L.size);
        g.textAlign = 'center';
        g.strokeText(gl.ch, gl.x, gl.y);
        g.restore();
      } else {
        if (o.glow) drawGlyph(gl, color, true);
        drawGlyph(gl, color, !!o.glow);
      }
    }
  } else {
    g.textAlign = 'left';
    for (const ls of lineStarts) {
      if (o.glow) {
        g.save();
        g.shadowColor = o.glow.color;
        g.shadowBlur = o.glow.blur;
        g.fillStyle = color;
        g.fillText(ls.line, ls.x, ls.y);
        g.fillText(ls.line, ls.x, ls.y);
        g.restore();
      }
      if (o.stroke) {
        g.lineWidth = o.stroke.width;
        g.strokeStyle = o.stroke.color;
        g.lineJoin = 'round';
        g.strokeText(ls.line, ls.x, ls.y);
      }
      g.fillStyle = color;
      g.fillText(ls.line, ls.x, ls.y);
    }
  }
  g.restore();

  if (o.aged) {
    // 褪色：整体减淡 + 一块块被“洗掉”的地方
    g.save();
    g.globalCompositeOperation = 'destination-out';
    const k = Math.max(0, Math.min(1, o.aged.fade));
    g.fillStyle = `rgba(0,0,0,${k * 0.45})`;
    if (!o.bg) g.fillRect(0, 0, W, H);
    for (let i = 0; i < 6 + k * 20; i++) blotch(g, r, r() * W, r() * H, range(r, 0.04, 0.14) * Math.min(W, H), '#000', k * 0.5, 5);
    g.restore();
    if (o.bg) {
      // 有底色时“洗掉”会露出透明，改为用底色盖回去
      g.save();
      g.globalCompositeOperation = 'destination-over';
      g.fillStyle = o.bg;
      g.fillRect(0, 0, W, H);
      g.restore();
    }
    for (let i = 0; i < o.aged.stains; i++) waterStain(g, r, r() * W, r() * H, range(r, 0.08, 0.2) * Math.min(W, H));
  }
}

function makeTextTextureInner(o: TextTexOpts, aspect?: number): THREE.CanvasTexture {
  const joined = typeof o.text === 'string' ? o.text : o.text.join('\n');
  const fallback = CJK_RE.test(joined) && !cjkAvailable();
  const weight = o.font?.weight ?? 'normal';
  const stack = familyStack(o.font?.family);
  const probe = createCanvas(4, 4).g;
  const L = layout(probe, o, s => `${weight} ${Math.round(s)}px ${stack}`, aspect);
  const { canvas, g } = createCanvas(L.W, L.H);
  drawTextInto(g, o, L, fallback);
  const tex = canvasToTexture(canvas, { anisotropy: 4 });
  tex.userData.text = joined;
  if (fallback) tex.userData.fallback = true;
  return tex;
}

/** colorSpace = SRGB；CJK 不可用时画图案并返回 userData.fallback = true */
export function makeTextTexture(o: TextTexOpts): THREE.CanvasTexture {
  return makeTextTextureInner(o);
}

/**
 * 文字平面（法线 +z）。h 缺省时按贴图宽高比；给了 h 且没给 height 时画布按 w:h 生成，不拉伸。
 * bg 为 null（默认）时是透明贴花：transparent、depthWrite:false、polygonOffset（贴在墙上不闪），不设 alphaTest
 * （红外替换按 ARCH §6.8.2 自动给 0.5 的 alphaTest 继承字形轮廓）。
 */
export function makeTextPlane(o: TextTexOpts & { w: number; h?: number; material?: 'basic' | 'standard' | 'emissive' }): THREE.Mesh {
  const aspect = o.h && !o.height ? o.w / o.h : undefined;
  const tex = makeTextTextureInner(o, aspect);
  const img = tex.image as HTMLCanvasElement;
  const h = o.h ?? o.w * (img.height / img.width);
  const transparent = !o.bg;
  let mat: THREE.Material;
  if (o.material === 'basic') {
    mat = new THREE.MeshBasicMaterial({ map: tex, transparent });
  } else if (o.material === 'emissive') {
    mat = new THREE.MeshStandardMaterial({
      map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 1.2, color: 0x000000, roughness: 0.9, transparent,
    });
    mat.userData.tempC = 60;
  } else {
    mat = new THREE.MeshStandardMaterial({ map: tex, transparent, roughness: 0.92, metalness: 0 });
  }
  if (transparent) {
    mat.depthWrite = false;
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = -2;
    mat.polygonOffsetUnits = -2;
  }
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(o.w, h), mat);
  mesh.name = 'text';
  // 透明底的文字贴花不挡准星、拍照与读字（M1d；透明网格本来也按不挡处理，这里显式写上）
  if (transparent) mesh.userData.noOcclude = true;
  mesh.userData.text = tex.userData.text;
  if (tex.userData.fallback) mesh.userData.fallback = true;
  return mesh;
}
