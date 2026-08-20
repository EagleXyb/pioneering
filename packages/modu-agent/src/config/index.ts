// 对应 Python: config/__init__.py
// config 模块统一导出
export {
  RuntimeConfig,
  getConfig,
  resetConfig,
  overrideConfig,
  DEFAULT_CONFIG,
} from './runtime-config.js'
export {
  PerceptionInputSchema,
  PerceptionOutputSchema,
  MemoryQuerySchema,
  MemoryUpdateSchema,
  ToolCallSchema,
  ToolResultSchema,
  LLMCallSchema,
  LLMResultSchema,
  FeedbackSignalSchema,
  ValueError,
  VALID_CONTEXT_WINDOWS,
  isValidContextWindow,
} from './schemas.js'
// P1: Markdown 文档配置加载与提示聚合
export {
  findConventionalMarkdownDocs,
  loadMarkdownDocs,
  parseMarkdownDoc,
  parseFrontmatter,
  docToDomainAdapter,
  loadDomainAdaptersFromMarkdown,
  getPackageRoot,
  type MarkdownDoc,
  type MarkdownMeta,
  type MarkdownInjectTarget,
} from './markdown-loader.js'
export { MarkdownPromptAggregator } from './markdown-prompt-aggregator.js'
// P2: MEMORY.md 持久化 / 知识库索引 / 插件 manifest / 配置溯源快照
export {
  serializeMemoryToMarkdown,
  parseMemoryFromMarkdown,
  writeMemoryToMarkdownFile,
  readMemoryFromMarkdownFile,
  type MemoryEntry,
  type MemoryMarkdownDoc,
} from './memory-md-persistence.js'
export {
  KnowledgeIndex,
  type KnowledgeEntry,
  type KnowledgeIndexFile,
} from './knowledge-index.js'
export {
  validateManifest,
  parseManifest,
  loadManifestFromFile,
  type PluginManifest,
  type ManifestValidation,
} from './plugin-manifest.js'
export {
  buildConfigSnapshot,
  buildDebugConfigHandler,
  maskSensitiveValues,
  type ConfigSnapshot,
} from './snapshot.js'
