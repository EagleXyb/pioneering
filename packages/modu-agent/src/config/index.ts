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
  CASCADE_LEVEL_ORDER,
  type MarkdownDoc,
  type MarkdownMeta,
  type MarkdownInjectTarget,
  type CascadeLevel,
} from './markdown-loader.js'
export {
  MarkdownPromptAggregator,
  estimateTokens,
  DEFAULT_MARKDOWN_BUDGET,
  type MarkdownBudget,
} from './markdown-prompt-aggregator.js'
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
// P0: YAML 加载与类型安全校验
export {
  loadConfigYaml,
  loadConfigYamlValidated,
  deepMergeConfig,
  findConfigYaml,
  parseYamlSubset,
  type TypeValidationResult,
} from './yaml-loader.js'
// 首次安装初始化：自动生成默认模板文件（AGENTS.md/SOUL.md/USER.md/MEMORY.md + config.yaml）
export {
  initDefaultConfigFiles,
  hasDefaultConfigFiles,
  getDefaultConfigRoot,
  DEFAULT_TEMPLATES,
  type DefaultTemplate,
  type InitDefaultsResult,
  type InitResultEntry,
} from './init-defaults.js'
// 环境变量统一治理（注册表 + 读取 + 脱敏 + 审计）
export {
  ENV_VAR_REGISTRY,
  SENSITIVE_KEY_RE,
  groupEnvVarsByCategory,
  readEnvVar,
  collectEnvSources,
  auditEnvVars,
  type EnvVarDescriptor,
  type EnvVarCategory,
} from './env.js'
// 配置能力注册表（配置键 → 能力 → 消费点清单）
export {
  CAPABILITY_REGISTRY,
  UNDECLARED_CONSUMED_KEYS,
  listCapabilities,
  listEnabledKeys,
  capabilityStatus,
  type CapabilityDescriptor,
} from './capability-registry.js'
