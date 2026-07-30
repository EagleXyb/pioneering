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
// P2-2: Few-shot 动态示例选择
export {
  DynamicFewShotSelector,
  InMemoryExampleStore,
  formatExample,
  formatExamplesAsPrompt,
  mmrSelect,
  type FewShotExample,
  type ExampleStore,
} from './few-shot-selector.js'
