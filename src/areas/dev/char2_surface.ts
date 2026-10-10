// owner: WP2
// char2 WP-S：材质、魂影参数、动作（char2.surface_*） 的开发沙盒自测。只有这个 WP 改这个文件（PLAN §5.7）。
// 在这里 registerSelftest('char2.surface_<snake>', game => …)：scripts/selftest/char2.mjs 自动跑全部 'char2.*'。
// 需要沙盒里的固定布置时给下面的 part 加 build(ctx)（同 wp2.ts）；写法与示例见 test-artifacts/work/char2/WP0_GUIDE.md。

import type { AreaPart } from '../../core/area';

const part: AreaPart = {};
export default part;
