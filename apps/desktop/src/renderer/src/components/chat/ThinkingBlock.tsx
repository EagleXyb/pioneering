import { useState } from 'react'
import { ChevronRight, Loader2 } from 'lucide-react'
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent
} from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'

interface ThinkingBlockProps {
  content: string
  defaultOpen?: boolean
}

export function ThinkingBlock({ content, defaultOpen = false }: ThinkingBlockProps): JSX.Element {
  const [isOpen, setIsOpen] = useState(defaultOpen)

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className="rounded-xl border border-border bg-muted/30 overflow-hidden">
        <CollapsibleTrigger className="flex items-center gap-2 w-full px-3 py-2 hover:bg-muted/50 transition-colors">
          <Loader2 className="size-3.5 text-primary animate-spin shrink-0" />
          <span className="text-xs font-medium text-muted-foreground flex-1 text-left">
            思考过程
          </span>
          <ChevronRight
            className={cn('size-3 text-muted-foreground transition-transform', isOpen && 'rotate-90')}
          />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="px-3 pb-2 text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap">
            {content}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}
