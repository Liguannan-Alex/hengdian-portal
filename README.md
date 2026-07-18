# 横店影视 AIGC 门户

v0.2 内部可用版。面向横店中小剧组与创作者，将 AI 工具按影视工作流重新组织，提供场景浏览、搜索筛选、官网直达和本地收藏。

> 当前版本是内部体验与需求验证用的纯前端站点，不是生产系统。本机档案只保存一个显示名称，不设置密码，也不构成身份认证；请勿录入项目秘密或个人敏感信息。

## 本地运行

```bash
npm install
npm run validate:data
npm run typecheck
npm test
npm run dev
```

生产构建：

```bash
npm run build
npm run preview
```

## v0.2 范围

- 首页：产品定位、六大场景入口、显式精选工具。
- 工具库：名称/简介搜索，按一级分类、场景和复核状态筛选。
- 我的收藏：建立本机档案后，在当前浏览器保存工具收藏；未建档时点击收藏，建档完成后会自动接续该操作。
- 关于页：数据来源、编辑复核边界和当前版本限制。
- 数据层：保留 473 条来源底表，叠加 50 条核心复核、2 条空入口待复核和 2 条重复排除记录。

不在本版本范围：真实后端、横店统一认证、跨设备同步、工具付费代购、自动可用性监测、内容上传或生产数据处理。

## 本机档案与收藏

- 本机档案只填写 2–20 个字符的显示名称，无密码体系，不代表真实人员身份。
- 当前数据键为 `hd_profile_v1` 和 `hd_favorites_v1`。
- 新键首次不存在时，系统只复制旧 `hd_session` 及对应 `hd_favs_<username>` 的可兼容数据；旧键不会被删除或覆盖。
- 主动关闭本机档案后会保留明确的空档案状态，避免旧数据在后续访问中被再次误迁移。
- `localStorage` 不可用或读写失败时，系统降级为当前页面内存存储并显示提示；刷新或关闭页面后，这部分临时数据可能丢失。
- 未建档时触发的收藏会记录为待完成操作；保存档案后，目标工具自动加入“我的收藏”并给出反馈。

## 六大场景与稳定 slug

中文名称是展示文案，URL 查询参数和持久化逻辑应优先使用稳定 slug。

| 中文场景 | slug |
|---|---|
| 剧本创作 | `scriptwriting` |
| 概念美术 | `concept-art` |
| 视频生成 | `video-generation` |
| 后期制作 | `post-production` |
| 宣发物料 | `promotion` |
| 综合效率 | `productivity` |

`parseSceneParam()` 同时兼容稳定 slug、中文场景名、URL 编码中文和 v0.1 常见短写。

## 数据结构

- `src/data/tools.json`：473 条来源底表。保持来源字段，不在此文件中混入推荐判断。
- `src/data/tool-editorial.json`：v0.2 编辑复核层，包含 50 条核心白名单、13 条精选白名单、2 条空入口待复核、2 条重复排除，以及推荐场景、理由、权重、日期和 canonical URL。
- `src/data/scene-rules.json`：未进入核心集的工具使用的保守关键词初筛规则和 16 个明显错标回归样例。
- `src/data/tools.ts`：将底表与编辑层合并为页面使用的 `effectiveTools`，并在不改动来源底表的前提下清理所有展示外链中的常见跟踪参数。
- `scripts/validate-tools.mjs`：校验 ID、分类、场景、核心集、精选白名单，并汇总空/非法/重复 URL 与已清理跟踪参数数量。

本轮编辑复核覆盖名称、官网域名、产品定位与影视工作流适配；它不等同于实时可用性监测、采购背书或合规审查。未进入核心集的工具仍可浏览，状态为 `unreviewed`，场景由名称与简介关键词做规则初筛。来源底表的旧 `scenes` 只用于追溯，不直接驱动页面筛选。

复核状态：

| 值 | 含义 |
|---|---|
| `verified` | 已完成本轮复核 |
| `needs-review` | 待复核 |
| `excluded` | 明确重复、错标或无可用入口，不进入有效集合 |
| `unreviewed` | 未进入本轮复核 |

精选不是由权重或热门度自动推断，必须显式进入 `featuredToolIds` 白名单，且状态必须为 `verified`。

## 数据 API

```ts
import {
  effectiveTools,
  featuredTools,
  SCENE_DEFINITIONS,
  parseSceneParam,
  VERIFICATION_STATUS_LABELS,
} from '@/data/tools'
```

主要导出：

- `effectiveTools: EffectiveTool[]`：页面唯一应使用的有效工具集合。
- `tools`：兼容 v0.1 的别名，指向 `effectiveTools`。
- `SCENE_DEFINITIONS` / `SCENES`：场景定义和中文场景列表。
- `parseSceneParam(value)`：把中文或 slug 参数归一为 `SceneSlug`。
- `inferSceneSlugs(tool)`：对未进入核心编辑层的工具执行保守场景初筛。
- `CORE_TOOL_IDS` / `FEATURED_TOOL_IDS`：显式核心和精选白名单。
- `coreTools` / `featuredTools` / `toolById`：常用派生集合。

`EffectiveTool` 在来源字段之外增加：`sceneSlugs`、`verificationStatus`、`verifiedAt`、`recommendationReason`、`sortWeight`、`featured` 和 `editorial`。

## 数据改动门槛

1. 来源抓取更新只改 `tools.json`，编辑判断只改 `tool-editorial.json`。
2. 新增场景必须同步 `SCENE_DEFINITIONS` 和验证脚本中的合法 slug。
3. 修改未复核工具的场景规则时，必须在 `scene-rules.json` 补充或通过对应回归样例。
4. 精选工具必须先进入 50 条核心白名单并完成本轮复核。
5. 核心 canonical URL 不得保留 `utm_*`、`ref`、`via` 等跟踪参数。
6. 所有页面外链统一经过 `sanitizeToolUrl()`；空入口必须显式标为 `needs-review` 并说明原因。
7. 提交前至少运行：

```bash
npm run validate:data
npm run typecheck
npm test
```

## 已知限制

- 来源底表是一次性快照，未自动检测官网失效、跳转变化或产品下线。
- 工具说明和推荐理由用于内部导航，不代表横店、数据来源站或项目组为厂商背书。
- 工具官网的价格、账号、生成内容、版权、数据出境与隐私政策由相应厂商负责，正式使用前仍需单独评估。
- 本机档案不是身份体系；清理浏览器数据会丢失档案和收藏，内存降级状态下刷新页面也可能丢失临时数据。
