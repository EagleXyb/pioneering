/**
 * 技能管理 API（Skill 子系统）
 *
 * 读：GET /skills —— 已注册技能（skills.active 白名单）+ 目录发现但未激活的技能
 * 写（L3，需管理员）：
 *   POST /skills/:name/activate    启用（写白名单 + 热注册）
 *   POST /skills/:name/deactivate  停用（反注册 + 回收工具）
 *   POST /skills/reload            重新扫描目录并对齐白名单
 */
import { get, post } from './client';

export interface SkillBrief {
  name: string;
  description: string;
  version: string;
  tags: string[];
  /** 技能内含工具数量 */
  toolCount: number;
  /** 是否已注册激活（后端 skills.active 白名单命中） */
  active: boolean;
  /** 该技能当前占用的工具名（仅已激活技能有值） */
  toolNames?: string[];
}

export interface SkillsResponse {
  skills: SkillBrief[];
  total: number;
  /** 技能子系统总开关（skills.enabled）；false 时管理动作会 409 */
  enabled?: boolean;
  /** 当前生效的白名单 */
  active?: string[];
}

/** 获取可用技能列表（已注册 + 目录发现） */
export function getSkills(): Promise<SkillsResponse> {
  return get<SkillsResponse>('/skills');
}

export interface SkillWriteResult {
  ok: boolean;
  name?: string;
  active?: string[];
  diff?: { added: string[]; removed: string[]; missing: string[] };
  registered?: string[];
  revisionBumped?: boolean;
}

/** 启用技能（管理员） */
export function activateSkill(name: string): Promise<SkillWriteResult> {
  return post<SkillWriteResult>(`/skills/${encodeURIComponent(name)}/activate`, {});
}

/** 停用技能（管理员） */
export function deactivateSkill(name: string): Promise<SkillWriteResult> {
  return post<SkillWriteResult>(`/skills/${encodeURIComponent(name)}/deactivate`, {});
}

/** 重新扫描目录并对齐白名单（管理员） */
export function reloadSkills(): Promise<SkillWriteResult> {
  return post<SkillWriteResult>('/skills/reload', {});
}
