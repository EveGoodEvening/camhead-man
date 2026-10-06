// owner: R3
// 照相馆的红霓虹“长明照相馆”（GDD §4.4：#FF3B3B，闪烁；“馆”字不亮了）。
// kit 的 sign('neon') 是整块发光的实心字，Bloom 一糊“照”“相”就粘成一团；这里自己画“空心字”灯管：
//   底层 dead：五个字的玻璃管（不发光、吃场景灯，霓虹点光把它照成暗红），“馆”字只有这一层；
//   上层 lit：亮着的四个字——白芯 + 红管 + 一圈窄光晕（HDR MeshBasic，灯芯烧白、管子保持红色）。
// setOn(false)（r3.saw_true_form 后）只把 lit 层藏起来；flicker(a) 每帧随机压暗 lit 层（减少闪光时 a = 0）。
// 红外：lit 层 60℃（alpha 轮廓），dead 层 18℃。

import * as THREE from 'three';
import type { AreaContext } from '../../../core/area';
import { TEMP_C } from '../../../data/render';
import { paintTexture } from '../../../kit/canvas';
import { FONT_STACK } from '../../../kit/text';

export interface NeonRig {
  group: THREE.Group;
  setOn(on: boolean): void;
  flicker(amount: number): void;
}

/** 亮着时 lit 层的 HDR 倍数（MeshBasic 的 color 是线性值；曝光 1.5 下灯芯 > 3 烧白，管子是饱和红）。 */
const LIT_GAIN = 2.6;

function drawTubes(g: CanvasRenderingContext2D, w: number, h: number, chars: readonly string[], which: (i: number) => boolean, mode: 'lit' | 'dead'): void {
  g.clearRect(0, 0, w, h);
  const n = chars.length;
  const cell = w / n;
  const size = Math.round(Math.min(cell * 0.86, h * 0.84));
  g.font = `bold ${size}px ${FONT_STACK}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.lineCap = 'round';
  const s = size / 230;
  chars.forEach((ch, i) => {
    if (!which(i)) return;
    const x = cell * (i + 0.5), y = h * 0.53;
    if (mode === 'lit') {
      // 光晕（窄）→ 红管 → 白芯
      g.shadowColor = 'rgba(255,40,40,0.95)';
      g.shadowBlur = 16 * s;
      g.strokeStyle = 'rgba(255,58,58,0.55)';
      g.lineWidth = 13 * s;
      g.strokeText(ch, x, y);
      g.shadowBlur = 5 * s;
      g.strokeStyle = '#ff3b3b';
      g.lineWidth = 8 * s;
      g.strokeText(ch, x, y);
      g.shadowBlur = 0;
      g.strokeStyle = '#fff1ec';
      g.lineWidth = 3 * s;
      g.strokeText(ch, x, y);
    } else {
      // 不亮的玻璃管：灰白的旧管子（吃霓虹点光，照成暗粉），一道细高光
      g.shadowBlur = 0;
      g.strokeStyle = '#8f7f7a';
      g.lineWidth = 8 * s;
      g.strokeText(ch, x, y);
      g.strokeStyle = 'rgba(245,225,215,0.8)';
      g.lineWidth = 2 * s;
      g.strokeText(ch, x - 1.5 * s, y - 1.5 * s);
    }
  });
}

export function buildNeon(ctx: AreaContext, text: string, w: number, h: number, broken: readonly number[]): NeonRig {
  const chars = [...text];
  const TW = 1536, TH = Math.round((TW * h) / w / 8) * 8;
  const group = new THREE.Group();
  group.name = 'r3.neonSign';
  // 底层：全部五个字的玻璃管（“馆”字只剩这一层）
  const deadTex = ctx.track(paintTexture(TW, TH, (g, cw, ch) => drawTubes(g, cw, ch, chars, () => true, 'dead')));
  deadTex.anisotropy = 4;
  const deadMat = new THREE.MeshStandardMaterial({ map: deadTex, transparent: true, depthWrite: false, roughness: 0.35, metalness: 0 });
  deadMat.name = 'r3.neonDead';
  const dead = new THREE.Mesh(new THREE.PlaneGeometry(w, h), deadMat);
  dead.name = 'r3.neonDead';
  dead.position.z = 0.005;
  dead.userData.noOcclude = true;
  group.add(dead);
  // 上层：亮着的字
  const litTex = ctx.track(paintTexture(TW, TH, (g, cw, ch) => drawTubes(g, cw, ch, chars, i => !broken.includes(i), 'lit')));
  litTex.anisotropy = 4;
  const litMat = new THREE.MeshBasicMaterial({ map: litTex, transparent: true, depthWrite: false });
  litMat.color.setScalar(LIT_GAIN);
  litMat.name = 'r3.neonLit';
  const lit = new THREE.Mesh(new THREE.PlaneGeometry(w, h), litMat);
  lit.name = 'r3.neonLit';
  lit.position.z = 0.012;
  lit.renderOrder = 2;
  lit.userData.noOcclude = true;
  lit.userData.tempC = TEMP_C.lamp;
  group.add(lit);
  let flickerAmt = 0;
  lit.onBeforeRender = () => {
    const k = flickerAmt > 0 && Math.random() < 0.1 ? 1 - flickerAmt * (0.4 + Math.random() * 0.6) : 1;
    litMat.color.setScalar(LIT_GAIN * k);
  };
  return {
    group,
    setOn(on) {
      lit.visible = on;
    },
    flicker(a) {
      flickerAmt = Math.max(0, Math.min(1, a));
      if (flickerAmt === 0) litMat.color.setScalar(LIT_GAIN);
    },
  };
}
