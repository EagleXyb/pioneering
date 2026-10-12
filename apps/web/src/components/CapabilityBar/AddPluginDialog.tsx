/**
 * AddPluginDialog —— 「添加插件」表单对话框（插件菜单入口）
 *
 * 插件 = MCP server：填写传输方式与连接参数，提交后经 POST /mcp/servers
 * 写入运行时配置并默认立即连接（连接失败不阻断添加，以 warning 提示）。
 * 提交动作由调用方以 onSubmit 注入（PluginPicker 持有 useMcpPlugins 实例，
 * 保证与插件列表数据同源）。
 */
import { useState } from 'react';
import { toast } from 'sonner';
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
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Spinner } from '@/components/ui/spinner';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { AddMcpServerInput, McpTransport } from '@/api/mcp';
import type { AddPluginResult } from '@/hooks/useMcpPlugins';
import './AddPluginDialog.css';

const TRANSPORT_OPTIONS: ReadonlyArray<{ value: McpTransport; label: string }> =
  [
    { value: 'stdio', label: 'stdio（本地进程）' },
    { value: 'sse', label: 'sse（远程服务）' },
    { value: 'streamable_http', label: 'streamable_http（远程服务）' },
    { value: 'websocket', label: 'websocket（远程服务）' },
  ];

/** 插件名规则与后端 buildServerConfig 一致 */
const NAME_PATTERN = /^[A-Za-z0-9._-]+$/;

/** 命令行参数：每行一项（不做 shell 拆分，保留含空格的整项） */
function parseArgLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

/** 环境变量：每行 KEY=VALUE；解析失败返回 null（由调用方报错） */
function parseEnvLines(text: string): Record<string, string> | null {
  const env: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) return null;
    const key = trimmed.slice(0, eq).trim();
    if (!key) return null;
    env[key] = trimmed.slice(eq + 1);
  }
  return env;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 提交添加（来自 useMcpPlugins.addPlugin）；ok=false 时对话框保持打开并展示错误 */
  onSubmit: (input: AddMcpServerInput) => Promise<AddPluginResult>;
}

export function AddPluginDialog({ open, onOpenChange, onSubmit }: Props) {
  const [name, setName] = useState('');
  const [transport, setTransport] = useState<McpTransport>('stdio');
  const [command, setCommand] = useState('');
  const [argsText, setArgsText] = useState('');
  const [cwd, setCwd] = useState('');
  const [envText, setEnvText] = useState('');
  const [url, setUrl] = useState('');
  const [autoStart, setAutoStart] = useState(true);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const isStdio = transport === 'stdio';

  const reset = () => {
    setName('');
    setTransport('stdio');
    setCommand('');
    setArgsText('');
    setCwd('');
    setEnvText('');
    setUrl('');
    setAutoStart(true);
    setBusy(false);
    setFormError(null);
  };

  const handleOpenChange = (next: boolean) => {
    if (busy) return; // 提交中不允许关闭，避免请求态悬空
    if (!next) reset();
    onOpenChange(next);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;

    const trimmedName = name.trim();
    if (!trimmedName) {
      setFormError('请填写插件名称');
      return;
    }
    if (!NAME_PATTERN.test(trimmedName)) {
      setFormError('插件名称只能包含字母、数字、点、下划线或连字符');
      return;
    }

    let input: AddMcpServerInput;
    if (isStdio) {
      if (!command.trim()) {
        setFormError('stdio 传输需要填写启动命令');
        return;
      }
      const env = parseEnvLines(envText);
      if (env === null) {
        setFormError('环境变量格式不正确，应为每行 KEY=VALUE');
        return;
      }
      const args = parseArgLines(argsText);
      input = {
        name: trimmedName,
        transport,
        autoStart,
        command: command.trim(),
        ...(args.length > 0 ? { args } : {}),
        ...(cwd.trim() ? { cwd: cwd.trim() } : {}),
        ...(Object.keys(env).length > 0 ? { env } : {}),
      };
    } else {
      if (!url.trim()) {
        setFormError('请填写服务地址（url）');
        return;
      }
      input = { name: trimmedName, transport, autoStart, url: url.trim() };
    }

    setFormError(null);
    setBusy(true);
    const res = await onSubmit(input);
    setBusy(false);
    if (!res.ok) {
      // 失败（重名 / 参数被后端拒绝 / 网络异常）：保留表单内容供修改重试
      setFormError(res.message);
      return;
    }
    if (res.connectFailed) toast.warning(res.message);
    else toast.success(res.message);
    reset();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="add-plugin-dialog w-[480px] max-w-[calc(100vw-2rem)]">
        <DialogHeader>
          <DialogTitle>添加插件</DialogTitle>
          <DialogDescription>
            接入 MCP Server 扩展 Agent 能力，添加后可在对话中调用其工具。
          </DialogDescription>
        </DialogHeader>

        <form className="add-plugin-form" onSubmit={handleSubmit}>
          <div className="add-plugin-field">
            <Label htmlFor="add-plugin-name">名称</Label>
            <Input
              id="add-plugin-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="如 github、filesystem"
              autoComplete="off"
              disabled={busy}
            />
          </div>

          <div className="add-plugin-field">
            <Label htmlFor="add-plugin-transport">传输方式</Label>
            <Select
              value={transport}
              onValueChange={(v) => setTransport(v as McpTransport)}
              disabled={busy}
            >
              <SelectTrigger id="add-plugin-transport" aria-label="传输方式">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TRANSPORT_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {isStdio ? (
            <>
              <div className="add-plugin-field">
                <Label htmlFor="add-plugin-command">启动命令</Label>
                <Input
                  id="add-plugin-command"
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  placeholder="如 npx、node、uvx"
                  autoComplete="off"
                  disabled={busy}
                />
              </div>
              <div className="add-plugin-field">
                <Label htmlFor="add-plugin-args">命令参数</Label>
                <Textarea
                  id="add-plugin-args"
                  value={argsText}
                  onChange={(e) => setArgsText(e.target.value)}
                  placeholder={'每行一个参数，如：\n-y\n@modelcontextprotocol/server-github'}
                  rows={2}
                  disabled={busy}
                />
              </div>
              <div className="add-plugin-field">
                <Label htmlFor="add-plugin-env">环境变量</Label>
                <Textarea
                  id="add-plugin-env"
                  value={envText}
                  onChange={(e) => setEnvText(e.target.value)}
                  placeholder={'每行 KEY=VALUE，如：\nGITHUB_TOKEN=xxx'}
                  rows={2}
                  disabled={busy}
                />
              </div>
              <div className="add-plugin-field">
                <Label htmlFor="add-plugin-cwd">工作目录（选填）</Label>
                <Input
                  id="add-plugin-cwd"
                  value={cwd}
                  onChange={(e) => setCwd(e.target.value)}
                  placeholder="如 /path/to/project"
                  autoComplete="off"
                  disabled={busy}
                />
              </div>
            </>
          ) : (
            <div className="add-plugin-field">
              <Label htmlFor="add-plugin-url">服务地址</Label>
              <Input
                id="add-plugin-url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="如 https://example.com/mcp"
                autoComplete="off"
                disabled={busy}
              />
            </div>
          )}

          <div className="add-plugin-switch-row">
            <div className="add-plugin-switch-row__text">
              <span className="add-plugin-switch-row__title">添加后立即连接</span>
              <span className="add-plugin-switch-row__desc">
                连接成功后工具将注册给 Agent 使用
              </span>
            </div>
            <Switch
              checked={autoStart}
              onCheckedChange={setAutoStart}
              disabled={busy}
              aria-label="添加后立即连接"
            />
          </div>

          {formError && (
            <p className="add-plugin-form__error" role="alert">
              {formError}
            </p>
          )}

          <p className="add-plugin-form__note">
            插件写入当前运行时配置并立即生效；服务重启后如需保留，请同步到
            modu-agent 的 config.yaml。
          </p>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => handleOpenChange(false)}
            >
              取消
            </Button>
            <Button type="submit" disabled={busy}>
              {busy && <Spinner className="h-4 w-4" />}
              添加
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
