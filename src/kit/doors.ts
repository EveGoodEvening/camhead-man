// owner: WP2
// 门（ARCH §10.2）：collider 直接交给 ctx.collider.dynamic(key, door.collider, '!<开门 flag>')（ARCH §4.8）；handle 是门把手小盒子，玻璃门的交互 hit 只用它。
//
// 约定：at = 门洞底边中点；门的正面（有把手、人站在门外看它的那一面）朝 yaw 方向，即局部 -z。
// hinge：从正面看合页在左边还是右边（默认 left）。setOpen(t) 让门扇往里（局部 +z）转 t × 95°；铁院门是两扇对开。
// collider 用 wall 形状（两端点是世界 XZ 的门框两侧），不依赖 rotYDeg 的角度约定。

import * as THREE from 'three';
import type { V3 } from '../core/types';
import type { DynamicShape } from '../core/collision';
import { DEG2RAD } from '../core/math';
import { MATERIALS } from '../fx/materials';
import { blotch, grain, paintTexture, shade } from './canvas';
import { kitMat, mergeByMaterial } from './geom';
import { rng, range } from './rng';
import { FONT_STACK } from './text';

export interface DoorSpec { w: number; h: number; style: 'iron_gate' | 'security' | 'wood' | 'glass_shop' | 'unit' | 'darkroom'; at: V3; yaw: number; hinge?: 'left' | 'right' }
export interface DoorRig { group: THREE.Group; leaf: THREE.Object3D; handle: THREE.Object3D; setOpen(t01: number): void; collider: DynamicShape }

const texCache = new Map<string, THREE.CanvasTexture>();
function doorTexture(style: 'security' | 'wood' | 'darkroom' | 'unit'): THREE.CanvasTexture {
  const hit = texCache.get(style);
  if (hit) return hit;
  const t = paintTexture(256, 512, (g, w, h) => {
    const r = rng(style.length * 97);
    const base = style === 'security' ? '#5A2A22' : style === 'wood' ? '#3E5E4A' : style === 'unit' ? '#2F4F3E' : '#161616';
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    if (style === 'security') {
      // 防盗门的压花凸板
      for (const [y0, y1] of [[0.06, 0.46], [0.54, 0.94]] as const) {
        g.fillStyle = shade(base, 1.18);
        g.fillRect(w * 0.12, h * y0, w * 0.76, h * (y1 - y0));
        g.strokeStyle = shade(base, 0.6);
        g.lineWidth = 4;
        g.strokeRect(w * 0.12, h * y0, w * 0.76, h * (y1 - y0));
        g.strokeStyle = shade(base, 1.4);
        g.lineWidth = 2;
        g.strokeRect(w * 0.16, h * y0 + 8, w * 0.68, h * (y1 - y0) - 16);
      }
      // 猫眼、门牌钉孔、旧福字残角
      g.fillStyle = '#b8b0a0';
      g.beginPath();
      g.arc(w / 2, h * 0.3, 5, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(200,30,30,0.7)';
      g.save();
      g.translate(w / 2, h * 0.62);
      g.rotate(Math.PI / 4);
      g.fillRect(-26, -26, 52, 52);
      g.restore();
      g.fillStyle = 'rgba(20,10,5,0.8)';
      g.font = `bold 40px ${FONT_STACK}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('福', w / 2, h * 0.62);
    } else if (style === 'wood' || style === 'darkroom') {
      // 木门：四块凹板、竖木纹、掉漆
      g.strokeStyle = 'rgba(0,0,0,0.12)';
      for (let x = 0; x < w; x += 3) {
        g.beginPath();
        g.moveTo(x + range(r, -1, 1), 0);
        g.lineTo(x + range(r, -2, 2), h);
        g.stroke();
      }
      for (const [x0, y0, ww, hh] of [[0.12, 0.06, 0.34, 0.4], [0.54, 0.06, 0.34, 0.4], [0.12, 0.54, 0.34, 0.4], [0.54, 0.54, 0.34, 0.4]] as const) {
        g.strokeStyle = shade(base, 0.55);
        g.lineWidth = 5;
        g.strokeRect(w * x0, h * y0, w * ww, h * hh);
        g.strokeStyle = shade(base, 1.3);
        g.lineWidth = 2;
        g.strokeRect(w * x0 + 5, h * y0 + 5, w * ww - 10, h * hh - 10);
      }
      if (style === 'wood') for (let i = 0; i < 14; i++) blotch(g, r, r() * w, r() * h, range(r, 4, 16), '#8a6a4a', 0.55, 4);
      else {
        g.fillStyle = '#C8C0B0';
        g.font = `bold 36px ${FONT_STACK}`;
        g.textAlign = 'center';
        g.fillText('暗房', w / 2, h * 0.3);
      }
    } else {
      // 单元门下半截实心板
      g.fillStyle = shade(base, 0.8);
      g.fillRect(w * 0.08, h * 0.08, w * 0.84, h * 0.84);
      g.strokeStyle = shade(base, 1.3);
      g.lineWidth = 3;
      g.strokeRect(w * 0.08, h * 0.08, w * 0.84, h * 0.84);
    }
    // 锈与脏手印
    for (let i = 0; i < 10; i++) blotch(g, r, r() * w, range(r, 0.4, 1) * h, range(r, 3, 10), '#6b3a1a', 0.3, 3);
    grain(g, w, h, 0.18, style.length);
  });
  texCache.set(style, t);
  return t;
}

function boxAt(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}

/** 一扇门扇（局部：合页在 x=0，门扇往 dir 方向展开，底边 y=0，正面朝 -z）。 */
function leafPanel(style: DoorSpec['style'], lw: number, h: number, dir: 1 | -1): { panel: THREE.Group; handle: THREE.Mesh } {
  const panel = new THREE.Group();
  panel.name = 'leafPanel';
  const cx = (dir * lw) / 2;
  const handleMat = kitMat('door.handle', { color: '#B9B2A2', roughness: 0.3, metalness: 0.8 });
  let handle: THREE.Mesh;
  if (style === 'glass_shop') {
    const alu = kitMat('door.alu', { color: '#9AA0A6', roughness: 0.35, metalness: 0.7 });
    const glass = MATERIALS.glass();
    const frame = new THREE.Group();
    frame.add(boxAt(lw, 0.06, 0.05, alu, cx, h - 0.03, 0), boxAt(lw, 0.12, 0.05, alu, cx, 0.06, 0));
    frame.add(boxAt(0.06, h, 0.05, alu, dir * 0.03, h / 2, 0), boxAt(0.06, h, 0.05, alu, dir * (lw - 0.03), h / 2, 0));
    panel.add(mergeByMaterial(frame));
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(lw - 0.12, h - 0.18), glass);
    pane.position.set(cx, 0.12 + (h - 0.18) / 2, 0);
    pane.name = 'doorGlass';
    pane.userData.noOcclude = true;
    panel.add(pane);
    handle = boxAt(0.035, 0.32, 0.035, handleMat, dir * (lw - 0.12), 1.05, -0.06);
  } else if (style === 'iron_gate') {
    const iron = kitMat('door.iron', { color: '#1E2226', roughness: 0.55, metalness: 0.55 });
    const bars = new THREE.Group();
    bars.add(boxAt(lw, 0.06, 0.05, iron, cx, h - 0.1, 0), boxAt(lw, 0.06, 0.05, iron, cx, 0.12, 0), boxAt(lw, 0.05, 0.04, iron, cx, h * 0.55, 0));
    const n = Math.max(3, Math.round(lw / 0.13));
    for (let i = 0; i <= n; i++) {
      const x = dir * (0.03 + (i / n) * (lw - 0.06));
      bars.add(boxAt(0.025, h - 0.05, 0.025, iron, x, (h - 0.05) / 2 + 0.03, 0));
      // 尖头
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.1, 4), iron);
      tip.position.set(x, h, 0);
      bars.add(tip);
    }
    panel.add(mergeByMaterial(bars));
    handle = boxAt(0.05, 0.14, 0.05, handleMat, dir * (lw - 0.06), 1.1, -0.05);
  } else {
    const tex = doorTexture(style === 'unit' ? 'unit' : style === 'darkroom' ? 'darkroom' : style === 'security' ? 'security' : 'wood');
    const mat = kitMat(`door.${style}`, { color: 0xffffff, map: tex, roughness: style === 'security' ? 0.45 : 0.8, metalness: style === 'security' ? 0.4 : 0 });
    const t = style === 'security' ? 0.06 : 0.045;
    if (style === 'unit') {
      // 单元门：下半截实心板 + 上半截玻璃
      const solidH = h * 0.45;
      const solid = boxAt(lw, solidH, t, mat, cx, solidH / 2, 0);
      const glass = new THREE.Mesh(new THREE.PlaneGeometry(lw - 0.1, h - solidH - 0.1), MATERIALS.glass());
      glass.position.set(cx, solidH + (h - solidH) / 2, 0);
      glass.userData.noOcclude = true;
      const green = kitMat('door.unitFrame', { color: '#2F4F3E', roughness: 0.6, metalness: 0.4 });
      const fr = new THREE.Group();
      fr.add(boxAt(lw, 0.05, t, green, cx, h - 0.025, 0), boxAt(0.05, h - solidH, t, green, dir * 0.025, solidH + (h - solidH) / 2, 0), boxAt(0.05, h - solidH, t, green, dir * (lw - 0.025), solidH + (h - solidH) / 2, 0));
      panel.add(solid, glass, mergeByMaterial(fr));
    } else {
      panel.add(boxAt(lw, h, t, mat, cx, h / 2, 0));
    }
    handle = boxAt(0.12, 0.03, 0.04, handleMat, dir * (lw - 0.1), 1.0, -t / 2 - 0.02);
  }
  handle.name = 'doorHandle';
  panel.add(handle);
  return { panel, handle };
}

export function door(s: DoorSpec): DoorRig {
  const group = new THREE.Group();
  group.name = `door.${s.style}`;
  group.position.set(s.at[0], s.at[1], s.at[2]);
  group.rotation.y = -s.yaw * DEG2RAD;
  const { w, h } = s;
  // 门框（铁院门是两根砖柱）
  if (s.style === 'iron_gate') {
    const pillar = MATERIALS.concrete();
    const p = new THREE.Group();
    p.add(boxAt(0.45, h + 0.5, 0.45, pillar, -w / 2 - 0.23, (h + 0.5) / 2, 0), boxAt(0.45, h + 0.5, 0.45, pillar, w / 2 + 0.23, (h + 0.5) / 2, 0));
    p.add(boxAt(0.55, 0.1, 0.55, pillar, -w / 2 - 0.23, h + 0.55, 0), boxAt(0.55, 0.1, 0.55, pillar, w / 2 + 0.23, h + 0.55, 0));
    const pm = mergeByMaterial(p);
    pm.name = 'gatePillars';
    group.add(pm);
  } else if (s.style !== 'glass_shop') {
    const frameMat = s.style === 'security' || s.style === 'unit' ? kitMat('door.steelFrame', { color: '#3a3a3c', roughness: 0.5, metalness: 0.5 }) : MATERIALS.wood();
    const f = new THREE.Group();
    f.add(boxAt(0.08, h + 0.08, 0.14, frameMat, -w / 2 - 0.04, (h + 0.08) / 2, 0), boxAt(0.08, h + 0.08, 0.14, frameMat, w / 2 + 0.04, (h + 0.08) / 2, 0), boxAt(w + 0.16, 0.08, 0.14, frameMat, 0, h + 0.04, 0));
    const fm = mergeByMaterial(f);
    fm.name = 'doorFrame';
    group.add(fm);
  } else {
    const alu = kitMat('door.alu', { color: '#9AA0A6', roughness: 0.35, metalness: 0.7 });
    const f = new THREE.Group();
    f.add(boxAt(0.06, h + 0.06, 0.1, alu, -w / 2 - 0.03, (h + 0.06) / 2, 0), boxAt(0.06, h + 0.06, 0.1, alu, w / 2 + 0.03, (h + 0.06) / 2, 0), boxAt(w + 0.12, 0.06, 0.1, alu, 0, h + 0.03, 0));
    const fm = mergeByMaterial(f);
    fm.name = 'doorFrame';
    group.add(fm);
  }

  const leaf = new THREE.Group();
  leaf.name = 'doorLeaf';
  group.add(leaf);
  const pivots: { pivot: THREE.Group; sign: number }[] = [];
  let handle: THREE.Object3D;
  if (s.style === 'iron_gate') {
    // 两扇对开：左扇合页在 +x（从正面看的左），右扇在 -x
    for (const side of [1, -1] as const) {
      const pivot = new THREE.Group();
      pivot.position.set((side * w) / 2, 0, 0);
      const { panel } = leafPanel('iron_gate', w / 2 - 0.02, h, side === 1 ? -1 : 1);
      pivot.add(panel);
      leaf.add(pivot);
      pivots.push({ pivot, sign: side });
    }
    // 铁链与挂锁挂在两扇中间（R1：解开铁链前挡人；区域可以 getObjectByName('chain') 隐藏它）
    const chainMat = kitMat('door.chain', { color: '#5a5c60', roughness: 0.4, metalness: 0.8 });
    const chain = new THREE.Group();
    chain.name = 'chain';
    for (let i = 0; i < 8; i++) {
      const link = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.007, 4, 8), chainMat);
      link.position.set(-0.1 + (i % 4) * 0.065, 1.12 - Math.floor(i / 4) * 0.05, -0.04);
      link.rotation.y = i % 2 ? Math.PI / 2 : 0;
      chain.add(link);
    }
    const lock = boxAt(0.07, 0.09, 0.03, kitMat('door.padlock', { color: '#8C7A3A', roughness: 0.35, metalness: 0.8 }), 0.02, 1.0, -0.05);
    lock.name = 'padlock';
    chain.add(lock);
    group.add(chain);
    handle = lock;
  } else {
    const hingeLeft = (s.hinge ?? 'left') === 'left';
    const pivot = new THREE.Group();
    pivot.position.set(hingeLeft ? w / 2 : -w / 2, 0, 0);
    const { panel, handle: hd } = leafPanel(s.style, w, h, hingeLeft ? -1 : 1);
    pivot.add(panel);
    leaf.add(pivot);
    pivots.push({ pivot, sign: hingeLeft ? 1 : -1 });
    handle = hd;
  }

  const ry = -s.yaw * DEG2RAD;
  const rx = Math.cos(ry), rz = -Math.sin(ry); // 局部 +x 在世界里的方向
  const collider: DynamicShape = {
    wall: {
      a: [s.at[0] - rx * (w / 2), s.at[2] - rz * (w / 2)],
      b: [s.at[0] + rx * (w / 2), s.at[2] + rz * (w / 2)],
      y0: s.at[1], height: h, thickness: 0.15,
    },
  };
  return {
    group, leaf, handle, collider,
    setOpen(t01) {
      const t = Math.max(0, Math.min(1, t01));
      for (const p of pivots) p.pivot.rotation.y = p.sign * t * 95 * DEG2RAD;
    },
  };
}
