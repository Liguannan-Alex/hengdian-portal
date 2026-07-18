import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Clapperboard, Database, Rocket, ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { tools, CATEGORIES, SCENES } from '@/data/tools'

/** 后续迭代方向（PRD 第 7 节，本期 MVP 不做） */
const ROADMAP = [
  '接入真实后端与横店影视统一身份认证，替换本地模拟账号',
  '工具点评与剧组评分，沉淀真实使用心得',
  '按剧组角色推荐工具包（编剧包 / 宣发包等）',
  '工具更新监控与官网链接失效检测',
  '管理后台：工具条目的增删改与运营维护',
]

/**
 * 关于页：门户定位、面向中小剧组的说明、数据来源声明、账号体系说明与后续规划
 */
export default function About() {
  useEffect(() => {
    document.title = '关于 · 横店影视 AIGC 门户'
  }, [])

  return (
    <div className="mx-auto max-w-4xl px-4 py-12">
      {/* 页头 */}
      <header>
        <p className="flex items-center gap-2 text-sm font-medium text-gold">
          <Clapperboard className="h-4 w-4" />
          关于本门户
        </p>
        <h1 className="mt-3 text-3xl font-bold leading-snug">
          把散落的 AI 工具，
          <br className="sm:hidden" />
          按剧组工作流重新组织
        </h1>
        <p className="mt-4 max-w-2xl leading-relaxed text-muted-foreground">
          横店影视 AIGC 门户是面向横店中小剧组的一站式 AI 工具导航与应用门户。
          我们不按技术分类堆砌链接，而是按「剧本 → 美术 → 拍摄 → 后期 → 宣发」的影视生产流程组织工具，
          让制片人、导演、编剧与宣发专员找得到、看得懂、用得上。
        </p>
      </header>

      {/* 定位对比 */}
      <section className="mt-10">
        <h2 className="text-xl font-semibold">和通用导航站有什么不同</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base text-muted-foreground">通用导航站</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm leading-relaxed text-muted-foreground">
              <p>· 按技术分类：写作 / 图像 / 视频</p>
              <p>· 只有链接，没有使用场景说明</p>
              <p>· 无状态浏览，看完就走</p>
            </CardContent>
          </Card>
          <Card className="border-gold/40">
            <CardHeader>
              <CardTitle className="text-base text-gold">本门户</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm leading-relaxed">
              <p>· 按剧组工作流分类：剧本 → 美术 → 拍摄 → 后期 → 宣发</p>
              <p>· 链接 + 简介 + 适用环节标签，快速判断是否值得试</p>
              <p>· 登录后可收藏，沉淀为「本剧组的工具箱」</p>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* 数据来源 */}
      <section className="mt-10">
        <h2 className="flex items-center gap-2 text-xl font-semibold">
          <Database className="h-5 w-5 text-gold" />
          数据来源
        </h2>
        <p className="mt-4 leading-relaxed text-muted-foreground">
          本站工具数据整理自 <span className="font-medium text-foreground">ai-bot.cn</span>，共收录{' '}
          <span className="font-semibold text-foreground">{tools.length}</span> 个 AI 工具，覆盖{' '}
          {CATEGORIES.length} 大一级分类（视频 / 图片 / 文字创作），并在此基础上按影视生产流程派生出{' '}
          {SCENES.length} 大剧组场景标签。每个工具卡片均可直达官网（新窗口打开）。
        </p>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          声明：本站仅作工具导航与演示，不存储工具本体内容；各工具的商标、账号与权益归原厂商所有，
          使用前请以其官网条款为准。
        </p>
      </section>

      {/* 账号体系 */}
      <section className="mt-10">
        <h2 className="flex items-center gap-2 text-xl font-semibold">
          <ShieldAlert className="h-5 w-5 text-gold" />
          账号体系（本地演示版）
        </h2>
        <p className="mt-4 leading-relaxed text-muted-foreground">
          本期 MVP 的注册 / 登录为纯前端模拟：账号与密码保存在你自己浏览器的 localStorage 中，
          密码仅做简单哈希处理，收藏夹按账号隔离、同样只存在本机。未登录也可浏览全部工具，
          登录后即可收藏并在这里之外的「我的收藏」页查看。
        </p>
        <p className="mt-3 rounded-lg border border-crimson/30 bg-crimson/5 px-4 py-3 text-sm leading-relaxed text-crimson">
          请勿使用你在其他网站的真实密码。正式版本将接入后端服务与横店影视统一身份认证。
        </p>
      </section>

      {/* 后续规划 */}
      <section className="mt-10">
        <h2 className="flex items-center gap-2 text-xl font-semibold">
          <Rocket className="h-5 w-5 text-gold" />
          后续规划
        </h2>
        <ul className="mt-4 space-y-2.5">
          {ROADMAP.map((item) => (
            <li key={item} className="flex items-start gap-2.5 text-sm leading-relaxed text-muted-foreground">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-gold" />
              {item}
            </li>
          ))}
        </ul>
      </section>

      {/* 底部引导 */}
      <div className="mt-12 flex flex-wrap items-center gap-3 border-t border-border pt-8">
        <Button asChild>
          <Link to="/tools">进入工具库</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link to="/favorites">我的收藏</Link>
        </Button>
      </div>
    </div>
  )
}
