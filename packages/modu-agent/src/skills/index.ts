// 对应 Python: skills/__init__.py
// Skills 子系统（P1/P2）。
//
// 包含：
//   - adapter.ts: SkillAdapter（Skill→工具名/提示片段降解）、SkillToolWrapper（执行隔离）
//   - loader.ts: SkillLoader（目录/配置动态发现与注册）
//   - prompt-aggregator.ts: SkillPromptAggregator（合并多 Skill 提示片段）
export { SkillAdapter, SkillToolWrapper } from './adapter.js'
export { SkillLoader } from './loader.js'
export { SkillPromptAggregator } from './prompt-aggregator.js'
export type { SkillAggregateOptions } from './prompt-aggregator.js'
// P0（选择→执行）：请求侧技能选择 → 提示范围 / 工具白名单 / 目录条目
export {
  EMPTY_SKILL_SELECTION,
  collectSkillToolNames,
  pruneSkillTools,
  resolveSkillSelection,
  summarizeSkillDescription,
  type SkillCatalogEntry,
  type SkillSelectionOptions,
  type SkillSelectionResult,
} from './selection.js'
// P0（0.6）：示例技能对外导出，供宿主 / 目录技能（skills/math/skill.js）引用
export { MathSkill } from './math-skill.js'
// P1-c（L2）：按需加载技能正文的内置工具
export {
  LoadSkillTool,
  DEFAULT_SKILL_LOAD_MAX_CHARS,
  type LoadSkillToolOptions,
} from './load-skill-tool.js'
// L3-1.2：技能集合版本号（宿主纳入图缓存键，实现「启停即时生效」）
export {
  bumpSkillsRevision,
  getSkillsRevision,
  resetSkillsRevision,
} from './revision.js'
// L3-2：声明式技能（纯提示型，无代码）
export {
  DeclarativeSkill,
  readPromptFile,
  resolvePromptFile,
  type DeclarativeSkillInput,
} from './declarative-skill.js'
// L3-2：内容寻址 / 快照 / 版本指针
export {
  computeSkillContentHash,
  ensureSnapshot,
  findSnapshot,
  getSkillMeta,
  listSkillFiles,
  listSkillMeta,
  readVersionState,
  recordVersion,
  resetSkillMetaForTest,
  cleanupSnapshots,
  setDefaultVersion,
  setSkillMeta,
  snapshotDirFor,
  versionStatePath,
  writeVersionState,
  type CleanupSnapshotsOptions,
  type SkillMeta,
  type SkillVersionEntry,
  type SkillVersionRecord,
  type SkillVersionState,
} from './versioning.js'
// P2-2: Few-shot 动态示例选择
export {
  DynamicFewShotSelector,
  InMemoryExampleStore,
  estimateTokensCjk,
  tokenizeForMatch,
  formatExample,
  formatExamplesAsPrompt,
  mmrSelect,
  type FewShotExample,
  type FewShotTurn,
  type ExampleStore,
} from './few-shot-selector.js'
// P0（FS-2 / FS-3）：共享示例库与反馈入池
export {
  getSharedFewShotStore,
  setSharedFewShotStore,
  resetFewShotStore,
  isFewShotStoreSeeded,
  recordFewShotExample,
  buildCandidateFromRun,
} from './few-shot-store.js'
// P0（FS-2）：内置种子示例
export { FEW_SHOT_SEEDS, getFewShotSeeds } from './few-shot-seeds.js'
