/**
 * 技能管理 API（Skill 子系统，只读）
 *
 * 技能列表来自后端 GET /skills：已注册技能（skills.active 白名单）
 * + skills.auto_discover_dirs 目录发现但未激活的技能，合并去重。
 */
import { get } from './client';

export interface SkillBrief {
  name: string;
  description: string;
  version: string;
  tags: string[];
  /** 技能内含工具数量 */
  toolCount: number;
  /** 是否已注册激活（后端 skills.active 白名单命中） */
  active: boolean;
}

export interface SkillsResponse {
  skills: SkillBrief[];
  total: number;
}

/** 获取可用技能列表（已注册 + 目录发现） */
export function getSkills(): Promise<SkillsResponse> {
  return get<SkillsResponse>('/skills');
}
