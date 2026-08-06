/**
 * 节点类型注册表。
 *
 * 与节点组件分文件，是为了让组件文件只导出组件：混着导出常量会让
 * React Fast Refresh 失效，改一行样式就整页重挂载，画布上的选中态与视口全丢。
 */
import { ImageNode, TextNode, VideoNode } from '@/components/canvas/CanvasNodes'

export const nodeTypes = {
  image: ImageNode,
  video: VideoNode,
  text: TextNode,
}
