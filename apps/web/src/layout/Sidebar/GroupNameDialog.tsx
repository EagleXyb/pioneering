/**
 * GroupNameDialog —— 分组名称对话框（新建 / 重命名共用）
 *
 * 侧边栏「分组」区右侧的 + 按钮打开「新建分组」，
 * 分组标题的 ⋯ 菜单打开「重命名分组」；两者共用本对话框。
 */
import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  submitText?: string;
  /** 初始名称（重命名时传入） */
  initialValue?: string;
  /** 提交：返回错误文案表示失败（对话框保持打开） */
  onSubmit: (name: string) => string | null;
}

export function GroupNameDialog({
  open,
  onOpenChange,
  title,
  description,
  submitText = '创建',
  initialValue = '',
  onSubmit,
}: Props) {
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);

  // 每次打开时重置为初始值（新建为空、重命名为原名）
  useEffect(() => {
    if (open) {
      setValue(initialValue);
      setError(null);
    }
  }, [open, initialValue]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const err = onSubmit(value);
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[400px] max-w-[calc(100vw-2rem)]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {description ?? '给分组起个名字，之后可把会话移动到分组中。'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="如 项目 A"
            aria-label="分组名称"
            autoComplete="off"
            autoFocus
          />
          {error && (
            <p className="mt-2 text-[12px] text-destructive" role="alert">
              {error}
            </p>
          )}

          <DialogFooter className="mt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              取消
            </Button>
            <Button type="submit">{submitText}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
