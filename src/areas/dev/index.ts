// owner: integrator
// （M1a 写好并冻结；M1c 加上整合代理的 m1c 夹具与 look-dev 样板角落 lookdev.ts；M1d 加上 m1d 回归自测；M4 第 2 轮加上 m4 回归自测）
// 开发沙盒（ARCH §0.3）：合并 WP7 的底座与各 WP 的测试布置。只在 ?debug=1&area=dev 下可达。

import { defineArea, mergeAreaParts } from '../../core/area';
import { DEV_BASE } from './base';
import wp1 from './wp1';
import wp2 from './wp2';
import wp3 from './wp3';
import wp4 from './wp4';
import wp5 from './wp5';
import wp6 from './wp6';
import wp7 from './wp7';
import m1c from './m1c';
import m1d from './m1d';
import m4 from './m4';
import lookdev from './lookdev';

export default defineArea(mergeAreaParts(DEV_BASE, [wp1, wp2, wp3, wp4, wp5, wp6, wp7, m1c, m1d, m4, lookdev]));
