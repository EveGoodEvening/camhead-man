// owner: integrator
// （M1a 写好并冻结）
// AREAS 注册表（ARCH §11.1）：启动时静态导入全部 AreaDef（只是数据与函数，build 此时不执行）。

import type { AreaDef } from '../core/area';
import r1 from './r1';
import r2 from './r2';
import r2_502 from './r2_502';
import r3 from './r3';
import r4 from './r4';
import dev from './dev';

export const AREAS: readonly AreaDef[] = [r1, r2, r2_502, r3, r4, dev];
