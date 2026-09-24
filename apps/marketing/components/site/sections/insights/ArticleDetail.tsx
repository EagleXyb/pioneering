import Link from 'next/link'
import { FEATURED_ARTICLE } from '@/data/site/insights'

// ============================================================
// ArticleDetail — 文章详情（同页 #article）：
// 8/4 栏（正文 + 粘性 TOC），含两处 inline-agent 与作者卡
// ============================================================

export function ArticleDetail() {
  const a = FEATURED_ARTICLE
  return (
    <section id="article" className="sec-md">
      <div className="wrap">
        <hr className="hr mb-8" />
        <div className="grid">
          <div className="col-8">
            <article className="article">
              <div className="tag mb-3">{a.tag}</div>
              <h1 className="h2 mb-3">{a.title}</h1>
              <div className="meta mb-6">{a.meta}</div>
              <p>
                有十年决策经验的人，大脑会形成一套高效的模式识别。这本来是优势——
                它让你在信息不完备时也能快速行动。但同一套机制有一个副作用：
                它会同时压缩你的怀疑空间。
              </p>
              <p>
                你会发现自己越来越少问“我可能错在哪”，越来越多地说“这种情况我见过”。
                这两句话之间的距离，就是经验开始反噬你的地方。
              </p>
              <div className="inline-agent">
                <div className="t">↳ 工具化延伸</div>
                <div className="q">这个检查方法已经在智能体里做成了自动追问。要不要拿你最近的一个决定试一遍？</div>
                <Link href="/agent#try" className="btn btn-primary btn-sm">
                  检查我的一个决定 →
                </Link>
              </div>
              <h3>三个可识别的信号</h3>
              <p>
                第一，你开始用「一直如此」作为理由。第二，你发现自己很少主动去找反对证据。
                第三，你对新信息的第一反应是解释它为什么不重要。
              </p>
              <h3>一个立即能用的动作</h3>
              <p>
                在下一次重要判断前，写下这句话并回答它：
                <span className="ink font-medium">“如果这个决定是错的，最可能是因为什么？”</span>
                这个动作的用处不在于预测，而在于强制打开被经验关上的那扇门。
              </p>
              <div className="inline-agent">
                <div className="t">↳ 场景入口</div>
                <div className="q">把这个方法用在你现在正纠结的那件事上。</div>
                <Link href="/agent#try" className="btn btn-ghost btn-sm">
                  用在我的问题上 →
                </Link>
              </div>
              <hr className="hr mt-6 mb-6" />
              <div className="card" style={{ background: 'var(--paper)' }}>
                <div className="flex items-c gap-3">
                  <div
                    className="avatar"
                    style={{ background: 'var(--celadon-l)', color: 'var(--celadon)', border: 'none' }}
                  >
                    {a.author.initial}
                  </div>
                  <div>
                    <div className="h4">{a.author.name}</div>
                    <div className="small">{a.author.role}</div>
                  </div>
                </div>
                <p className="body mt-3" style={{ fontSize: 15 }}>
                  {a.author.note}
                </p>
                <div className="btn-row mt-3">
                  <a href="#" className="btn btn-ink btn-sm">
                    订阅 newsletter
                  </a>
                  <Link href="/insights" className="btn btn-ghost btn-sm">
                    相关阅读 3 篇
                  </Link>
                </div>
              </div>
            </article>
          </div>
          <div className="col-4">
            <div className="toc">
              <div className="h4 mb-3">本文目录</div>
              {a.toc.map((t) => (
                <a key={t} href="#article">
                  {t}
                </a>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
