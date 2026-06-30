import { NAV_ITEMS } from '@/lib/constants'

export function Header() {
  return (
    <>
      <header className="w-full flex justify-between items-center h-[72px] px-12 max-sm:px-5 bg-bg">
        <div className="text-xl font-bold text-text-primary tracking-[3px]">
          AI TRENDS
        </div>
        <nav className="flex items-center gap-8 max-sm:gap-4">
          {NAV_ITEMS.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="text-sm text-text-muted no-underline transition-colors duration-200 hover:text-text-primary"
            >
              {item.label}
            </a>
          ))}
        </nav>
      </header>
      <div className="w-full h-px bg-divider" />
    </>
  )
}
