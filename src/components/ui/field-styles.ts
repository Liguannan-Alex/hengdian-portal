/**
 * 原生 select / textarea 的共用样式。
 *
 * shadcn 的 Input 只覆盖 <input>，而工作流表单由定义文件驱动，需要按字段类型
 * 渲染下拉框与多行文本。抽成常量而不是复制类名，避免几处控件慢慢长歪。
 */
export const fieldClass =
  'w-full rounded-md border border-input bg-input/30 px-3 py-2 text-sm shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50'
