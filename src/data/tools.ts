import { PenLine, Palette, Clapperboard, Scissors, Megaphone } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import toolsJson from './tools.json'

/** AI 工具（数据来源：ai-bot.cn，共 473 条） */
export interface Tool {
  id: number
  name: string
  desc: string
  /** 工具官网（新窗口打开） */
  url: string
  /** ai-bot.cn 详情页 */
  detailUrl: string
  /** 一级分类，取值见 CATEGORIES */
  category: string
  /** 影视场景标签，取值见 SCENES，一个工具可属多个场景 */
  scenes: string[]
}

export const tools: Tool[] = toolsJson as Tool[]

/** 一级分类（数据层实际值，勿改文案） */
export const CATEGORIES = ['视频AI工具', '图片AI工具', '文字创作AI工具'] as const
export type CategoryName = (typeof CATEGORIES)[number]

/** 影视场景（数据层实际值，勿改文案） */
export const SCENES = ['剧本创作', '概念美术', '视频生成', '后期制作', '宣发物料'] as const
export type SceneName = (typeof SCENES)[number]

/** 场景展示信息：lucide-react 图标组件 + 一句话说明 */
export interface SceneInfo {
  name: SceneName
  icon: LucideIcon
  tagline: string
}

export const SCENE_INFO: SceneInfo[] = [
  {
    name: '剧本创作',
    icon: PenLine,
    tagline: '大纲、剧本、台词与公文写作，让 AI 先做第一稿。',
  },
  {
    name: '概念美术',
    icon: Palette,
    tagline: '概念图、分镜、海报与服化道参考，快速定视觉方向。',
  },
  {
    name: '视频生成',
    icon: Clapperboard,
    tagline: '预演、特效镜头与数字人，低成本验证镜头创意。',
  },
  {
    name: '后期制作',
    icon: Scissors,
    tagline: '剪辑、字幕、抠像与修复，缩短后期周期。',
  },
  {
    name: '宣发物料',
    icon: Megaphone,
    tagline: '海报、短视频切片与宣发文案，一键产出物料。',
  },
]

/** 便捷查询：按 id 取工具 */
export const toolById = new Map<number, Tool>(tools.map((t) => [t.id, t]))
