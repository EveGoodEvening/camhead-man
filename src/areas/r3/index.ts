// owner: R3
// R3 老街·长明照相馆（GDD §4.4、§5 P6–P8、H 旧照五、§11 步骤 27–37）。原点在照相馆门口；街道 x -22~22，z 0~10；
// 铺面 z<0；照相馆前厅 z 0~-5、影棚 -5~-11、暗房 x -3~0 / z -11~-14。
// 灯（GDD §4.4，本区实时光 6 盏 + 半球光 = 7 ≤ 8，数量从进区域起不变）：钠灯 ×2、霓虹 1、前厅钨丝灯 1、影棚钨丝灯 1（唯一投影光）、暗房 1（白/红两用）。

import { defineArea } from '../../core/area';
import { EXIT, PH, SPAWN } from '../../data/ids';
import { QUALITY } from '../../data/render';
import { paintTexture } from '../../kit/canvas';
import { rain } from '../../kit/rain';
import { AMBIENCE } from './audio';
import { CUTSCENES } from './cutscenes';
import { DIALOGUES } from './dialogue';
import { EXIT_WEST, SPAWN_WEST, groundAt } from './layout';
import { HEMI, enterLogic, exitLogic, onFlagLogic, setupLogic, updateLogic } from './logic';
import { PHOTO_DECOYS, PHOTO_TARGETS, READ_TARGETS } from './photo';
import { PUZZLES } from './puzzles';
import { REPLAY_POINTS, SEGMENTS } from './replay';
import { SHOTS } from './shots';
import { TEXT } from './text';
import { buildDarkroom } from './build/darkroom';
import { buildShop } from './build/shop';
import { buildStreet } from './build/street';
import { buildStudio } from './build/studio';
import { artCoveredFace, artTrueForm, photoAtlas } from './build/textures';
import { Batch } from './build/util';

export default defineArea({
  id: 'r3',
  name: TEXT.areaName,
  spawns: {
    // 离出口触发体边缘 1.05m ≥ 0.8（GDD §13.2）
    [SPAWN.R3_WEST]: { pos: SPAWN_WEST, yaw: 90 },
  },
  exits: [
    { id: EXIT.R3_TO_R1, to: SPAWN.R1_FROM_R3, box: { center: EXIT_WEST, size: [1.5, 2.5, 1.5] } },
  ],
  post: 'r3',
  // ARCH §8.3：R3 的环境贴图取霓虹暖红 #FF8A6A；霓虹街 1.0–1.4
  environment: { tint: '#FF8A6A', intensity: 1.0 },
  ambience: AMBIENCE,
  groundY: groundAt,
  photoTargets: PHOTO_TARGETS,
  photoDecoys: PHOTO_DECOYS,
  readTargets: READ_TARGETS,
  replayPoints: REPLAY_POINTS,
  segments: SEGMENTS,
  dialogues: DIALOGUES,
  cutscenes: CUTSCENES,
  docs: TEXT.docs,
  puzzles: PUZZLES,
  photoArt: { [PH.COVERED_FACE]: artCoveredFace, [PH.TRUE_FORM]: artTrueForm },
  shots: SHOTS,
  build(ctx) {
    // 雾 #1A1016、密度 0.035（GDD §4.4）；街面半球光压得很低（暗部靠环境贴图与夜空）；镜头进了照相馆换成钨丝暖色（logic.ts HEMI）
    ctx.fog('#1A1016', 0.035);
    ctx.background('#1A1016');
    const hemi = ctx.hemi(HEMI.street.sky, HEMI.street.ground, HEMI.street.design);
    const street = buildStreet(ctx);
    const B = new Batch('r3:shop');
    const atlas = ctx.track(paintTexture(512, 512, photoAtlas));
    atlas.anisotropy = 4;
    const shop = buildShop(ctx, B, atlas);
    const studio = buildStudio(ctx, B, atlas);
    const dark = buildDarkroom(ctx, B);
    for (const m of B.flush(ctx)) {
      m.castShadow = true;
      m.receiveShadow = true;
    }
    const r = rain({ count: QUALITY[ctx.quality].rain, box: { w: 36, h: 16, d: 36 } });
    ctx.add(r.mesh);
    setupLogic(ctx, { street, shop, studio, dark, rain: r, hemi });
  },
  onEnter(ctx) {
    enterLogic(ctx);
  },
  update(ctx, dt) {
    updateLogic(ctx, dt);
  },
  onFlag(ctx) {
    onFlagLogic(ctx);
  },
  onExit(ctx) {
    exitLogic(ctx);
  },
});
