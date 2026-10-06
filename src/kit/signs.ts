// owner: WP2
// 招牌（ARCH §10.2）：霓虹、手绘、灯箱、牌匾、横幅、竖排。
// 招牌正面朝 +z（与 makeTextPlane 一致），group 原点在招牌中心；区域自己摆位置与朝向。
// 发光的招牌（neon、lightbox）用各自私有的 emissive 材质：setOn 开关；flicker(amount) 设频闪幅度，
// 在每次绘制前随机抖亮度（纯视觉，ARCH §1.5 允许 Math.random；reduceFlash 时由区域传 0）。

import * as THREE from 'three';
import { PALETTE } from '../data/palette';
import { TEMP_C } from '../data/render';
import { MATERIALS } from '../fx/materials';
import { kitMat, newMat } from './geom';
import { makeTextTexture } from './text';

export interface SignSpec { text: string; style: 'neon' | 'painted' | 'lightbox' | 'plaque' | 'banner' | 'vertical'; w: number; h: number; color?: string; bg?: string; brokenChars?: number[] }
export interface SignRig { group: THREE.Group; setOn(on: boolean): void; flicker(amount: number): void }

function aspectWidth(w: number, h: number): 512 | 1024 | 2048 {
  return w / h > 3 ? 2048 : 1024;
}

export function sign(s: SignSpec): SignRig {
  const group = new THREE.Group();
  group.name = `sign.${s.style}`;
  const vertical = s.style === 'vertical';
  let glowMat: THREE.MeshStandardMaterial | null = null;
  let baseGlow = 0;
  let on = true;
  let flickerAmt = 0;

  const board = (mat: THREE.Material, depth: number) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(s.w + 0.08, s.h + 0.08, depth), mat);
    b.position.z = -depth / 2;
    b.name = 'signBoard';
    group.add(b);
  };
  const face = (map: THREE.Texture, mat: THREE.MeshStandardMaterial, z = 0.004) => {
    mat.map = map;
    const p = new THREE.Mesh(new THREE.PlaneGeometry(s.w, s.h), mat);
    p.position.z = z;
    p.name = 'signFace';
    p.userData.text = s.text;
    group.add(p);
    return p;
  };
  const fontSize = vertical ? 220 : 200;

  switch (s.style) {
    case 'neon': {
      // 深色底板 + 发光的字（坏字画成暗管）
      board(kitMat('sign.neonBoard', { color: '#15161a', roughness: 0.6, metalness: 0.3 }), 0.08);
      const color = s.color ?? PALETTE.NEON;
      const tex = makeTextTexture({
        text: s.text, width: aspectWidth(s.w, s.h), height: Math.round(aspectWidth(s.w, s.h) * s.h / s.w), font: { size: fontSize, weight: 'bold' },
        color: '#FFF4F0', bg: null, glow: { color, blur: 28 }, stroke: { color, width: 10 }, brokenChars: s.brokenChars ?? [],
      });
      glowMat = newMat({ color: '#000000', emissive: color, emissiveIntensity: 2.4, emissiveMap: tex, transparent: true, depthWrite: false, roughness: 0.5, tempC: TEMP_C.lamp });
      baseGlow = 2.4;
      const f = face(tex, glowMat, 0.01);
      f.material = glowMat;
      glowMat.map = tex;
      glowMat.color.set('#ffffff');
      break;
    }
    case 'lightbox': {
      const bg = s.bg ?? '#F3EEDC';
      const tex = makeTextTexture({ text: s.text, width: aspectWidth(s.w, s.h), height: Math.round(aspectWidth(s.w, s.h) * s.h / s.w), font: { size: fontSize, weight: 'bold' }, color: s.color ?? '#B3202A', bg });
      board(kitMat('sign.lightboxFrame', { color: '#8C8F94', roughness: 0.4, metalness: 0.6 }), 0.2);
      glowMat = newMat({ color: '#ffffff', map: tex, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 1.1, roughness: 0.6, tempC: TEMP_C.lamp });
      baseGlow = 1.1;
      face(tex, glowMat, 0.004);
      break;
    }
    case 'plaque': {
      // 牌匾：黑漆底、金字、宋体、一圈木边
      const tex = makeTextTexture({ text: s.text, width: aspectWidth(s.w, s.h), height: Math.round(aspectWidth(s.w, s.h) * s.h / s.w), font: { family: 'serif', size: fontSize, weight: 'bold' }, color: s.color ?? '#D8B24A', bg: s.bg ?? '#1B1512', aged: { fade: 0.15, stains: 1, seed: s.text.length } });
      board(MATERIALS.wood(), 0.06);
      face(tex, newMat({ color: '#ffffff', roughness: 0.55, metalness: 0.1 }));
      break;
    }
    case 'banner': {
      // 红布横幅：两头绳子，布面略微下垂
      const tex = makeTextTexture({ text: s.text, width: aspectWidth(s.w, s.h), height: Math.round(aspectWidth(s.w, s.h) * s.h / s.w), font: { size: fontSize, weight: 'bold' }, color: s.color ?? '#F4E7C8', bg: s.bg ?? '#B01E23' });
      const geo = new THREE.PlaneGeometry(s.w, s.h, 12, 2);
      const p = geo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        const u = p.getX(i) / s.w + 0.5;
        p.setY(i, p.getY(i) - Math.sin(u * Math.PI) * s.h * 0.12);
        p.setZ(i, Math.sin(u * Math.PI * 3) * 0.02);
      }
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, newMat({ color: '#ffffff', map: tex, roughness: 0.95, side: THREE.DoubleSide }));
      m.name = 'signFace';
      m.userData.text = s.text;
      group.add(m);
      const rope = kitMat('sign.rope', { color: '#d8cfb8', roughness: 1 });
      for (const sx of [-1, 1]) {
        const r = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.4, 4), rope);
        r.rotation.z = sx * 1.2;
        r.position.set(sx * (s.w / 2 + 0.17), s.h / 2 - 0.05, 0);
        group.add(r);
      }
      break;
    }
    case 'vertical':
    case 'painted': {
      const bg = s.bg ?? (s.style === 'vertical' ? '#2B1A12' : '#D8CFB8');
      const tex = makeTextTexture({
        text: vertical ? [...s.text].join('') : s.text, vertical, width: vertical ? 512 : aspectWidth(s.w, s.h),
        height: vertical ? Math.round(512 * s.h / s.w) : Math.round(aspectWidth(s.w, s.h) * s.h / s.w),
        font: { family: s.style === 'vertical' ? 'serif' : 'sans', size: fontSize, weight: 'bold' }, color: s.color ?? (vertical ? '#D8B24A' : '#8A1C1C'), bg,
        aged: { fade: 0.25, stains: 2, seed: s.text.length * 7 },
      });
      board(MATERIALS.wood(), 0.04);
      face(tex, newMat({ color: '#ffffff', roughness: 0.85 }));
      break;
    }
  }

  const apply = () => {
    if (!glowMat) return;
    glowMat.emissiveIntensity = on ? baseGlow : 0;
    glowMat.userData.tempC = on ? TEMP_C.lamp : TEMP_C.ambient;
  };
  if (glowMat) {
    const gm = glowMat;
    const fm = group.getObjectByName('signFace');
    if (fm) {
      fm.onBeforeRender = () => {
        if (!on) return;
        gm.emissiveIntensity = flickerAmt > 0 ? baseGlow * (1 - flickerAmt * (Math.random() < 0.12 ? 0.85 : Math.random() * 0.25)) : baseGlow;
      };
    }
  }
  return {
    group,
    setOn(v) {
      on = v;
      apply();
    },
    flicker(a) {
      flickerAmt = Math.max(0, Math.min(1, a));
      if (flickerAmt === 0) apply();
    },
  };
}
