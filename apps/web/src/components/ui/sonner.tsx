import { Toaster as Sonner, type ToasterProps } from 'sonner';

import { useTheme } from '@/store/themeContext';

/**
 * 全局 Toast —— shadcn 官方推荐的 sonner。
 * 挂载一次于 main.tsx，业务代码直接 `import { toast } from 'sonner'` 调用：
 * toast.info/success/error/loading。
 * 主题跟随 web 的 resolvedTheme（light/dark），不受 system 模式下 data-theme
 * 缺省影响。
 */
function Toaster(props: ToasterProps) {
  const { resolvedTheme } = useTheme();
  return (
    <Sonner
      theme={resolvedTheme}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            'group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg',
          description: 'group-[.toast]:text-muted-foreground',
          actionButton:
            'group-[.toast]:bg-primary group-[.toast]:text-primary-foreground',
          cancelButton:
            'group-[.toast]:bg-muted group-[.toast]:text-muted-foreground',
        },
      }}
      {...props}
    />
  );
}

export { Toaster };
