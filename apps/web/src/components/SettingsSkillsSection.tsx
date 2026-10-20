/**
 * 设置 → 技能（L3 管理面）
 *
 * 职责：列出平台技能（已启用 / 已发现未启用），提供启用 / 停用 / 重新扫描。
 *
 * 权限：写接口要求管理员（后端 ADMIN_USER_IDS）。非管理员点击会收到 403，
 * 这里以 toast 呈现后端 message，不做前端角色判断（避免与后端授权漂移）。
 *
 * 与输入框 SkillPicker 的关系：Picker 负责「本轮用哪个」，本面板负责
 * 「平台有哪些可用」——即 6.0.5 里的 C 型（应用平台）管理面。
 */
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { RefreshCw } from 'lucide-react';

import {
  activateSkill,
  deactivateSkill,
  getSkills,
  reloadSkills,
  type SkillBrief,
} from '../api/skills';
import { Spinner } from './ui/spinner';
import './SettingsSkillsSection.css';

function errorMessage(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e) {
    const m = (e as { message: unknown }).message;
    if (typeof m === 'string' && m.trim()) return m;
  }
  return '未知错误';
}

export function SettingsSkillsSection() {
  const [skills, setSkills] = useState<SkillBrief[]>([]);
  const [enabled, setEnabled] = useState<boolean>(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [reloading, setReloading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getSkills();
      setSkills(Array.isArray(res.skills) ? res.skills : []);
      setEnabled(res.enabled !== false);
    } catch (e: unknown) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleToggle = async (skill: SkillBrief) => {
    setBusy(skill.name);
    try {
      if (skill.active) {
        await deactivateSkill(skill.name);
        toast.success(`已停用 ${skill.name}`);
      } else {
        await activateSkill(skill.name);
        toast.success(`已启用 ${skill.name}`);
      }
      await load();
    } catch (e: unknown) {
      toast.error(`操作失败：${errorMessage(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const handleReload = async () => {
    setReloading(true);
    try {
      await reloadSkills();
      toast.success('已重新扫描技能目录');
      await load();
    } catch (e: unknown) {
      toast.error(`重新扫描失败：${errorMessage(e)}`);
    } finally {
      setReloading(false);
    }
  };

  return (
    <section className="settings-group">
      <h3 className="settings-group-title">平台技能</h3>

      <div className="settings-skills-desc">
        启用的技能会出现在输入框「技能」菜单中；停用后立即从新会话的工具集移除（无需重启）。
        仅管理员可修改。
      </div>

      {enabled === false && (
        <div className="settings-skills-notice" role="status">
          技能子系统未启用：请在服务端配置 <code>skills.enabled=true</code> 后重启。
        </div>
      )}

      <div className="settings-group-card">
        {loading && (
          <div className="settings-skills-state">
            <Spinner className="h-4 w-4" />
            加载中…
          </div>
        )}

        {!loading && error && (
          <div className="settings-skills-state">
            <span>{error}</span>
            <button type="button" className="settings-skills-link" onClick={() => void load()}>
              重试
            </button>
          </div>
        )}

        {!loading && !error && skills.length === 0 && (
          <div className="settings-skills-state">
            暂无技能。将技能目录放入 <code>skills.auto_discover_dirs</code> 后点击「重新扫描」。
          </div>
        )}

        {!loading &&
          !error &&
          skills.map((s) => (
            <div className="settings-skill-row" key={s.name}>
              <div className="settings-skill-main">
                <div className="settings-skill-name">
                  {s.name}
                  <span className="settings-skill-version">v{s.version}</span>
                  <span
                    className={`settings-skill-badge${
                      s.active ? ' is-on' : ''
                    }`}
                  >
                    {s.active ? '已启用' : '未启用'}
                  </span>
                </div>
                {s.description && (
                  <div className="settings-skill-desc">{s.description}</div>
                )}
                <div className="settings-skill-meta">
                  {s.toolCount} 个工具
                  {s.toolNames && s.toolNames.length > 0
                    ? ` · ${s.toolNames.join(', ')}`
                    : ''}
                </div>
              </div>
              <button
                type="button"
                className={`settings-skill-action${s.active ? ' is-danger' : ''}`}
                onClick={() => void handleToggle(s)}
                disabled={busy === s.name || enabled === false}
                aria-label={`${s.active ? '停用' : '启用'}技能 ${s.name}`}
              >
                {busy === s.name ? <Spinner className="h-3.5 w-3.5" /> : s.active ? '停用' : '启用'}
              </button>
            </div>
          ))}
      </div>

      <div className="settings-skills-footer">
        <button
          type="button"
          className="settings-skills-reload"
          onClick={() => void handleReload()}
          disabled={reloading || enabled === false}
        >
          {reloading ? <Spinner className="h-3.5 w-3.5" /> : <RefreshCw size={14} />}
          重新扫描目录
        </button>
      </div>
    </section>
  );
}
