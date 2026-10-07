import * as React from 'react';
import { Loader2 } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * 加载指示小件：lucide Loader2 + CSS 旋转。
 * size 透传给图标的 className（如 h-4 w-4）。
 */
const Spinner = React.forwardRef<
  SVGSVGElement,
  React.ComponentPropsWithoutRef<typeof Loader2>
>(({ className, ...props }, ref) => (
  <Loader2
    ref={ref}
    className={cn('h-4 w-4 animate-spin', className)}
    {...props}
  />
));
Spinner.displayName = 'Spinner';

export { Spinner };
