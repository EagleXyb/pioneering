import { useState } from 'react'
import { useAppStore } from './store/appStore'
import { useAtom } from 'jotai'
import { counterAtom } from './atoms/counterAtom'
import { Button } from './components/ui/button'
import { Card } from './components/ui/card'

function App() {
  const count = useAppStore((state) => state.count)
  const increment = useAppStore((state) => state.increment)
  const decrement = useAppStore((state) => state.decrement)

  const [jotaiCount, setJotaiCount] = useAtom(counterAtom)

  const [darkMode, setDarkMode] = useState(false)

  const toggleDarkMode = () => {
    setDarkMode(!darkMode)
    document.documentElement.classList.toggle('dark', !darkMode)
  }

  return (
    <div className="min-h-screen bg-background text-foreground p-8">
      <div className="max-w-4xl mx-auto space-y-8">
        <header className="text-center space-y-2">
          <h1 className="text-4xl font-bold">Pioneering Desktop AI Agent</h1>
          <p className="text-muted-foreground">
            Electron 42 + React 19 + TypeScript 5.7 + Tailwind CSS 4
          </p>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card className="p-6 border border-border rounded-lg">
            <h2 className="text-xl font-semibold mb-4">Zustand 5 State</h2>
            <div className="flex items-center gap-4">
              <Button variant="outline" onClick={decrement}>
                -
              </Button>
              <span className="text-3xl font-bold min-w-[60px] text-center">
                {count}
              </span>
              <Button variant="outline" onClick={increment}>
                +
              </Button>
            </div>
          </Card>

          <Card className="p-6 border border-border rounded-lg">
            <h2 className="text-xl font-semibold mb-4">Jotai 2 Atoms</h2>
            <div className="flex items-center gap-4">
              <Button
                variant="outline"
                onClick={() => setJotaiCount((c) => c - 1)}
              >
                -
              </Button>
              <span className="text-3xl font-bold min-w-[60px] text-center">
                {jotaiCount}
              </span>
              <Button
                variant="outline"
                onClick={() => setJotaiCount((c) => c + 1)}
              >
                +
              </Button>
            </div>
          </Card>
        </div>

        <Card className="p-6 border border-border rounded-lg">
          <h2 className="text-xl font-semibold mb-4">Theme Control</h2>
          <Button onClick={toggleDarkMode}>
            {darkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          </Button>
        </Card>

        <Card className="p-6 border border-border rounded-lg">
          <h2 className="text-xl font-semibold mb-4">Tech Stack</h2>
          <ul className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
            <li className="flex items-center gap-2">
              <span className="size-2 rounded-full bg-green-500"></span>
              Electron 42
            </li>
            <li className="flex items-center gap-2">
              <span className="size-2 rounded-full bg-green-500"></span>
              React 19
            </li>
            <li className="flex items-center gap-2">
              <span className="size-2 rounded-full bg-green-500"></span>
              TypeScript 5.7
            </li>
            <li className="flex items-center gap-2">
              <span className="size-2 rounded-full bg-green-500"></span>
              Vite 6
            </li>
            <li className="flex items-center gap-2">
              <span className="size-2 rounded-full bg-green-500"></span>
              Tailwind CSS 4
            </li>
            <li className="flex items-center gap-2">
              <span className="size-2 rounded-full bg-green-500"></span>
              Zustand 5
            </li>
            <li className="flex items-center gap-2">
              <span className="size-2 rounded-full bg-green-500"></span>
              Jotai 2
            </li>
            <li className="flex items-center gap-2">
              <span className="size-2 rounded-full bg-green-500"></span>
              shadcn/ui
            </li>
            <li className="flex items-center gap-2">
              <span className="size-2 rounded-full bg-green-500"></span>
              Radix UI
            </li>
          </ul>
        </Card>
      </div>
    </div>
  )
}

export default App
