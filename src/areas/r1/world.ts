// owner: R1-world
// R1-world 的入口（ARCH §2.11、§11.6）：export default { …AreaPart }，由冻结的 r1/index.ts 与 R1-finale 合并。
// 与 R1-finale 的约定（ARCH §15.4，id 与坐标不变）：
//   ref：r1.desk（桌子体积的拾取代理）、r1.crt（CRT 屏幕网格）、r1.vcr（录像机）、r1.crt_jack（“视频入1”插孔，插头沿本地 −y 插入）、
//        r1.bracket（门楣空支架，name 'mount' 是云台底座）、r1.mirror（圆镜镜面），另有 r1.anthill（蚁穴网格，给 R1-finale 的交互物当 hit）；
//   ctx.console({ screen, viewPose, channels })（tunnelBaked/tunnelInner 归 R1-finale）；交互物 r1.crt；npc.tudi（R1-finale 可 addTalk）。
//   R1 的 8 盏实时灯由这里用满（docs/requests/r1-world.md #3）。

import type { AreaPart } from '../../core/area';
import { F } from '../../data/ids';
import { PALETTE } from '../../data/palette';
import { QUALITY } from '../../data/render';
import { MATERIALS } from '../../fx/materials';
import { rain } from '../../kit/rain';
import { skyDome } from '../../kit/nature';
import { R1, R1_ENV_REFS } from './layout';
import { DOCS, JOURNAL_PAGES } from './text';
import { DIALOGUES } from './dialogue';
import { PUZZLES } from './puzzles';
import { PHOTO_TARGETS, READ_TARGETS, emptyCaption } from './photo';
import { REPLAY_POINTS, SEGMENTS } from './replay';
import { CUTSCENES } from './cutscene';
import { SHOTS } from './shots';
import { r1Ambience } from './audio';
import { DecalAtlas, Statics } from './build/common';
import { buildBooth } from './build/booth';
import { buildYard } from './build/yard';
import { buildBuildings } from './build/buildings';
import { buildLights } from './build/lights';
import type { World } from './logic';
import { SKY_NIGHT, keepRainOutOfBooth, makeLanternOnly, onFlagChange, registerLogic, syncFrame, syncInitial } from './logic';

let W: World | null = null;

const world: AreaPart = {
  ambience: r1Ambience,
  // 环境贴图取本区主光色：钠灯橙（强度 1.0，look-dev 基准）；卯时换成黎明粉（ARCH §8.3）
  environment: s => ({ tint: s.flag(F.R1_SOUL_RETURNED) ? PALETTE.DAWN : PALETTE.SODIUM, intensity: 1.0 }),
  photoTargets: PHOTO_TARGETS,
  readTargets: READ_TARGETS,
  replayPoints: REPLAY_POINTS,
  segments: SEGMENTS,
  dialogues: DIALOGUES,
  cutscenes: CUTSCENES,
  docs: DOCS,
  journalPages: JOURNAL_PAGES,
  puzzles: PUZZLES,
  emptyCaption,
  shots: SHOTS,

  build(ctx) {
    ctx.fog(PALETTE.FOG_R1, 0.045);
    ctx.background(PALETTE.NIGHT);
    // 夜空：低云被城市的钠灯光从下面照亮（比 look-dev 默认略亮一点，楼在雾里是比天暗的剪影；颜色与 logic.ts 的 SKY_NIGHT 同源）
    const sky = ctx.add(skyDome({ clouds: 0.85, zenith: SKY_NIGHT.zenith, glow: SKY_NIGHT.glow, horizon: SKY_NIGHT.horizon }));
    const st = new Statics('r1w.static');
    const decals = new DecalAtlas(ctx);
    // 地面：院子与院外全铺湿沥青（人行道另铺方砖）；碰撞地面盖满可走范围
    const S = R1.sidewalk;
    st.floor(-27, -24.5, 27, S.z0 + 0.3, 0, MATERIALS.asphaltWet());
    ctx.collider.floor(-40, -30, 40, 45, 0);
    // 院外东西两头：人行道北边是别人家的墙根，不让走进去
    ctx.collider.wall([-20, 24.12], [S.x0 - 1.4, 24.12], 0, 2.5, 0.24);
    ctx.collider.wall([20, 24.12], [S.x1 + 1.4, 24.12], 0, 2.5, 0.24);
    const booth = buildBooth(ctx, st, decals);
    const yard = buildYard(ctx, st, decals);
    const bld = buildBuildings(ctx, st, decals);
    const lights = buildLights(ctx, st, yard.stringLightAnchors);
    st.flush(ctx);
    decals.finish(ctx);
    const r = rain({ count: QUALITY[ctx.quality].rain, box: { w: 36, h: 16, d: 36 } });
    ctx.add(r.mesh, { occlude: false });
    keepRainOutOfBooth(r);
    const lanternOnly = makeLanternOnly(ctx);
    ctx.add(lanternOnly.root, { occlude: false });
    // 终章接管天色用的 ref（ARCH §11.6、layout.ts 的 R1_ENV_REFS）
    ctx.ref(R1_ENV_REFS.hemi, lights.hemi);
    ctx.ref(R1_ENV_REFS.sky, sky);
    ctx.ref(R1_ENV_REFS.rain, r.mesh);
    W = {
      ctx, rain: r, sky, lights, booth, yard, far: bld.far, street: bld.street, windowMats: st.windowMaterials, hemiBase: lights.hemi.intensity,
      lanternOnly, gateOpen: 0, burnT: -1, dawn: 0, lastSky: '', treeOn: false,
    };
    registerLogic(ctx, W);
    syncInitial(W);
  },
  update(_ctx, dt) {
    if (W) syncFrame(W, dt);
  },
  onFlag(_ctx, e) {
    if (W) onFlagChange(W, e.id);
  },
  onExit() {
    W = null;
  },
};

export default world;
