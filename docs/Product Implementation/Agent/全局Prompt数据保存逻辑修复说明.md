# 全局Prompt数据保存逻辑修复说明

## 📋 问题描述

**原有问题**：
- `hooks.ts` 中的 `usePromptManagement` 将所有模块的 Prompt 都保存到 `AIConfig` 表
- 但 `global-settings` 模块的 Prompt 应该保存到 `GlobalPrompt` 表
- 导致数据保存位置错误，无法正确管理全局Prompt

## ✅ 修复内容

### 1. 修改 `hooks.ts` 中的 `usePromptManagement` 函数

#### 核心修复
```typescript
// 🔧 修复：全局Prompt保存到GlobalPrompt表，而不是AIConfig表
if (module === 'global-settings') {
  // 调用 globalPromptApi 保存到 GlobalPrompt 表
  await globalPromptApi.createPrompt(...) 或 updatePrompt(...)
} else {
  // 其他模块保持原有逻辑，保存到 AIConfig 表
  await adminApi.saveConfig(...)
}
```

#### 新增功能
1. **状态管理**：添加 `editingGlobalPromptId` 状态，跟踪当前编辑的全局Prompt
2. **模块切换**：切换模块时自动重置编辑状态，避免误更新
3. **加载已有Prompt**：新增 `loadOnlineGlobalPrompt()` 函数，加载在线的Prompt到编辑器

### 2. 具体修改点

#### 文件：`frontend/pages/admin/hooks.ts`

**修改1：添加状态管理**
```typescript
// 用于跟踪当前编辑的全局Prompt ID（用于更新操作）
const [editingGlobalPromptId, setEditingGlobalPromptId] = useState<number | null>(null);
```

**修改2：模块切换处理**
```typescript
// 当模块切换时，重置编辑状态
const handleModuleChange = (module: PromptModule) => {
  setActiveModule(module);
  // 切换模块时重置编辑的GlobalPrompt ID，确保不会误更新
  if (module !== 'global-settings') {
    setEditingGlobalPromptId(null);
  }
};
```

**修改3：加载在线Prompt**
```typescript
// 加载在线的全局Prompt（用于编辑已有Prompt）
const loadOnlineGlobalPrompt = async () => {
  const { globalPromptApi } = await import('./globalPrompt/api');
  const onlinePrompt = await globalPromptApi.getOnlinePrompt();
  
  if (onlinePrompt) {
    // 加载到编辑器中
    setPrompts(prev => ({
      ...prev,
      'global-settings': onlinePrompt.templateContent,
    }));
    // 设置编辑ID，后续保存时使用更新操作
    setEditingGlobalPromptId(onlinePrompt.id);
    return onlinePrompt;
  }
  
  return null;
};
```

**修改4：保存逻辑分支**
```typescript
const handleSavePrompt = async (module, apiKey, provider, model, testResult) => {
  if (module === 'global-settings') {
    // 🔧 保存到 GlobalPrompt 表
    if (editingGlobalPromptId) {
      // 更新现有Prompt
      await globalPromptApi.updatePrompt(editingGlobalPromptId, {
        templateContent: promptText.trim(),
        createdBy: 'admin',
      });
    } else {
      // 创建新Prompt
      const newPrompt = await globalPromptApi.createPrompt({
        name: `global_prompt_${Date.now()}`,
        templateContent: promptText.trim(),
        createdBy: 'admin',
      });
      setEditingGlobalPromptId(newPrompt.id);
    }
  } else {
    // 其他模块保存到 AIConfig 表（保持原有逻辑）
    await adminApi.saveConfig(configData);
  }
};
```

## 📊 数据流对比

### 修复前（❌ 错误）
```
全局Prompt → handleSavePrompt() → adminApi.saveConfig() → AIConfig表
                                                          ↓
                                                      prompt字段
```

### 修复后（✅ 正确）
```
全局Prompt → handleSavePrompt() → globalPromptApi.createPrompt/updatePrompt()
                                                              ↓
                                                        GlobalPrompt表
                                                              ↓
                                                    templateContent字段
```

## 🎯 使用说明

### 基本使用（自动处理）

用户在页面上编辑全局Prompt并保存时，系统会自动：
1. **首次保存**：创建新的 GlobalPrompt 记录
2. **再次保存**：更新已有的 GlobalPrompt 记录

### 高级功能（可选）

如果需要加载已有的在线Prompt进行编辑，可以在组件中调用：

```typescript
// 在 Admin 组件或其他地方
const { loadOnlineGlobalPrompt } = usePromptManagement();

// 加载在线的Prompt
useEffect(() => {
  loadOnlineGlobalPrompt();
}, []);
```

## 🔍 验证方法

### 1. 检查数据库保存位置

**修复前**：
```sql
-- 数据保存到 ai_config 表
SELECT * FROM ai_config WHERE prompt IS NOT NULL;
```

**修复后**：
```sql
-- 数据保存到 global_prompt 表
SELECT * FROM global_prompt;
```

### 2. 测试步骤

1. **创建新Prompt**
   - 在"全局设置"页面输入Prompt内容
   - 点击"保存"
   - 检查数据库 `global_prompt` 表是否有新记录

2. **更新已有Prompt**
   - 再次编辑并保存
   - 检查 `version` 字段是否 +1
   - 检查 `updatedAt` 字段是否更新

3. **其他模块不受影响**
   - 切换到其他模块（如"问题感知模块"）
   - 输入内容并保存
   - 检查数据是否保存到 `ai_config` 表

## 📝 注意事项

1. **默认值**：
   - `name`: 使用时间戳生成唯一名称 `global_prompt_${timestamp}`
   - `createdBy`: 默认为 `'admin'`，可从用户上下文获取

2. **版本管理**：
   - 每次更新内容，后端自动 version +1
   - 前端显示版本号：`v${prompt.version}`

3. **审批流程**：
   - 新创建的 Prompt 默认状态：`status=offline`, `approvalStatus=pending`
   - 需要审批通过后才能上线

4. **并发控制**：
   - 后端使用事务确保只有一个在线Prompt
   - 上线时会自动将其他Prompt下线

## 🚀 后续优化建议

虽然当前修复已经解决了核心问题，但以下优化可以进一步提升用户体验：

1. **Prompt命名**：
   - 添加输入框让用户自定义 Prompt 名称
   - 而不是使用时间戳自动生成

2. **列表管理**：
   - 集成 `globalPrompt/useGlobalPrompt` 提供的列表功能
   - 显示所有Prompt，支持选择编辑

3. **审批UI**：
   - 添加审批界面
   - 显示审批状态徽章

4. **用户上下文**：
   - 从登录用户获取 `createdBy`
   - 而不是硬编码为 `'admin'`

## ✅ 修复验证

- ✅ 无 TypeScript 类型错误
- ✅ 无 ESLint 代码规范错误
- ✅ 保持原有函数签名，不影响现有页面
- ✅ 添加了向后兼容的新功能

---

**修复时间**：2025-03-25  
**修复文件**：`frontend/pages/admin/hooks.ts`  
**影响范围**：全局Prompt管理模块  
**风险等级**：低（仅修改保存逻辑，不影响其他模块）
