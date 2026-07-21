import { X, ArrowLeft, Copy, Download } from 'lucide-react';
import { useArtifactStore } from '@/store/artifactStore';
import { ArtifactRender } from './ArtifactRender';

/**
 * Artifact 预览面板
 *
 * 设计参考：
 *   - docs/lib/components/chat/Artifacts.svelte（OpenWebUI 的预览面板）
 *   - docs/lib/components/chat/ChatControls.svelte（容器模式）
 *
 * 职责：
 *   - 订阅 artifactStore.activeArtifact，渲染对应内容
 *   - 顶部工具栏：跳转到源消息 / 复制 / 下载 / 关闭
 *   - 跳转到源消息通过 highlightMessage(messageId) 触发反向联动
 *   - 由 useScrollToMessage Hook 在 TaskMessageList 中消费高亮信号
 *
 * 不维护本地状态：所有状态都在 artifactStore，组件本身是纯渲染层。
 */

export function ArtifactPanel() {
  const activeArtifact = useArtifactStore((s) => s.activeArtifact);
  const closeArtifact = useArtifactStore((s) => s.closeArtifact);
  const highlightMessage = useArtifactStore((s) => s.highlightMessage);

  if (!activeArtifact) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(activeArtifact.content);
    } catch {
      // 剪贴板权限被拒绝时静默失败，避免抛错打断用户
    }
  };

  const handleDownload = () => {
    const ext = activeArtifact.type === 'html' ? 'html'
      : activeArtifact.type === 'svg' ? 'svg'
      : activeArtifact.language || 'txt';
    const mime = activeArtifact.type === 'html' ? 'text/html'
      : activeArtifact.type === 'svg' ? 'image/svg+xml'
      : 'text/plain';
    const blob = new Blob([activeArtifact.content], { type: `${mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `artifact-${activeArtifact.messageId.slice(0, 8)}.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // 下一帧释放，避免 download 还没开始就被 revoke
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const handleJumpToSource = () => {
    highlightMessage(activeArtifact.messageId);
  };

  return (
    <div className="artifact-panel">
      <div className="artifact-panel-header">
        <div className="artifact-panel-header-left">
          <button
            type="button"
            className="artifact-panel-btn"
            onClick={handleJumpToSource}
            aria-label="跳转到源消息"
            title="跳转到源消息"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <span className="artifact-panel-title">
            {activeArtifact.type === 'html' ? 'HTML 预览'
              : activeArtifact.type === 'svg' ? 'SVG 预览'
              : `代码预览${activeArtifact.language ? ` · ${activeArtifact.language}` : ''}`}
          </span>
        </div>
        <div className="artifact-panel-header-right">
          <button
            type="button"
            className="artifact-panel-btn"
            onClick={handleCopy}
            aria-label="复制内容"
            title="复制内容"
          >
            <Copy className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="artifact-panel-btn"
            onClick={handleDownload}
            aria-label="下载"
            title="下载"
          >
            <Download className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="artifact-panel-btn"
            onClick={closeArtifact}
            aria-label="关闭预览"
            title="关闭预览"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="artifact-panel-body">
        <ArtifactRender artifact={activeArtifact} />
      </div>
    </div>
  );
}
