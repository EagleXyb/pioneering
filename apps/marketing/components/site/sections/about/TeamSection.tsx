import { ABOUT_TEAM } from '@/data/site/about'
import { Reveal } from '@/components/site/ui/Reveal'

// 团队（3 张卡），白底
export function TeamSection() {
  return (
    <section id="team" className="sec-md" style={{ background: 'var(--white)' }}>
      <div className="wrap">
        <div className="eyebrow">{ABOUT_TEAM.eyebrow}</div>
        <h2 className="h3 mb-3">{ABOUT_TEAM.title}</h2>
        <p className="lead mb-8">{ABOUT_TEAM.lead}</p>
        <div className="grid">
          {ABOUT_TEAM.members.map((m) => (
            <Reveal key={m.name} className="col-4">
              <div className="card card-hover">
                <div className="flex items-c gap-3 mb-3">
                  <div
                    className="avatar"
                    style={{ background: 'var(--celadon-l)', color: 'var(--celadon)', border: 'none' }}
                  >
                    {m.initial}
                  </div>
                  <div>
                    <div className="h4">{m.name}</div>
                    <div className="small">{m.role}</div>
                  </div>
                </div>
                <p className="body" style={{ fontSize: 15 }}>
                  {m.quote}
                </p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}
