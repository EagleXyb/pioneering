- **Step 2: 实现最小化组件**
  - 感知层：集成基础NLP库（如分词、实体识别），支持文本输入。
  - 推理层：封装1个LLM（如Qwen）作为默认实现，配置基础提示词模板。
  - 记忆层：部署向量数据库（如ChromaDB）用于长期记忆，Redis用于短期会话。
  - 行动层：注册2个工具插件（如`SearchTool`、`CalculatorTool`）。\
    *关键验证点：替换LLM为GPT-4o后，任务流程仍完整执行。*





最小化组件设计的核心目标是**通过严格遵循Step 1定义的标准化接口，实现各层功能的独立封装与即插即用**。关键在于：**所有组件必须仅依赖抽象接口而非具体实现，确保LLM替换（如Qwen→GPT-4o）时无需修改业务逻辑，仅需调整配置文件**。以下是分层实现的详细设计说明。

---

## 一、感知层设计
### 1. 功能定位
- **仅处理基础文本预处理**，避免过度工程化。  
- **不实现复杂NLP模型**（如意图分类），将高级语义理解交给推理层LLM，符合最小化原则。

### 2. 核心实现
#### ## 1. 输入标准化处理器
```python
class TextPreprocessor:
    def __init__(self, config: Dict):
        self.language = config.get("language", "zh")
        self.max_length = config.get("max_length", 2048)
    
    def process(self, raw_input: bytes) -> Dict:
        """将原始输入转为结构化事件
        :param raw_input: 用户原始文本（需先解码为UTF-8）
        :return: 符合感知层Schema的字典
        """
        text = raw_input.decode("utf-8")[:self.max_length]
        return {
            "input_type": "text",
            "raw_content": text,
            "language": self.language,
            "sensitivity_level": self._detect_sensitivity(text)
        }
    
    def _detect_sensitivity(self, text: str) -> int:
        """敏感词快速过滤（正则匹配，非AI模型）
        :return: 0-5敏感等级（0=无敏感，5=高危）
        """
        HIGH_RISK_PATTERNS = [r"密码", r"身份证", r"银行卡"]
        for pattern in HIGH_RISK_PATTERNS:
            if re.search(pattern, text):
                return 5
        return 0
```
- **关键约束**：  
  - **仅执行轻量级规则处理**（如截断、敏感词过滤），**避免引入NLP模型**以降低依赖复杂度。  
  - 输出严格遵循Step 1定义的`感知层Schema`，确保下游组件可直接消费。

---

## 二、推理层设计
### 1. LLM封装实现
#### ## 1. Qwen作为默认LLM的适配器
```python
from qwen import QwenClient  # 假设Qwen官方SDK
from interfaces import ILLMProvider  # Step 1定义的抽象接口

class QwenLLM(ILLMProvider):
    def __init__(self, api_key: str, model: str = "qwen-max"):
        self.client = QwenClient(api_key=api_key, model=model)
    
    def generate_response(
        self,
        prompt: str,
        context: Dict,
        temperature: float = 0.7,
        max_tokens: int = 512
    ) -> str:
        # 严格按抽象接口要求实现
        return self.client.chat(
            messages=[{"role": "user", "content": prompt}],
            temperature=temperature,
            max_tokens=max_tokens
        )
    
    def stream_response(
        self,
        prompt: str,
        context: Dict
    ) -> Generator[str, None, None]:
        for chunk in self.client.chat_stream(messages=[{"role": "user", "content": prompt}]):
            yield chunk["content"]
```
- **关键设计**：  
  - **仅封装Qwen SDK的调用逻辑**，**不包含任何业务规则**（如提示词工程）。  
  - **参数校验委托给SDK**，框架层仅做透传，避免重复校验。

#### ## 2. 提示词模板管理
- **基础模板结构**（`prompts/base.yaml`）：
  ```yaml
  system_prompt: |
    你是一个AI助手，必须按以下规则响应：
    1. 仅使用工具完成任务，**禁止编造工具未返回的数据**
    2. 每次调用工具后必须等待结果，再决定下一步
    3. 错误时明确返回错误码（如TOOL_001）
  
  tool_description: |
    可用工具：
    - {search_tool}：搜索实时信息，参数：query（字符串）
    - {calculator_tool}：计算数学表达式，参数：expression（字符串）
  ```
- **动态注入机制**：  
  运行时将`tool_description`中的占位符替换为注册工具的实际描述，**确保LLM始终看到最新工具列表**。

---

## 三、记忆层设计
### 1. 短期记忆（Redis实现）
#### ## 1. 会话级上下文管理
```python
class RedisShortTermMemory(IMemoryStrategy):
    def __init__(self, redis_url: str, ttl: int = 3600):
        self.client = redis.Redis.from_url(redis_url)
        self.ttl = ttl  # 会话过期时间
    
    def query(
        self,
        user_id: str,
        context_window: str,
        required_fields: List[str]
    ) -> Dict[str, Any]:
        # 从Redis读取会话历史（按user_id+session_id）
        session_key = f"session:{user_id}"
        history = self.client.lrange(session_key, -5, -1)  # 仅保留最近5轮
        
        # 按required_fields过滤字段（避免冗余数据）
        filtered = []
        for msg in history:
            filtered.append({k: v for k, v in msg.items() if k in required_fields})
        return {"history": filtered}
    
    def update(
        self,
        user_id: str,
        new_data: Dict[str, Any],
        metadata: Dict[str, Any]
    ) -> bool:
        session_key = f"session:{user_id}"
        self.client.rpush(session_key, json.dumps(new_data))
        self.client.expire(session_key, self.ttl)
        return True
```
- **关键约束**：  
  - **仅存储原始对话片段**，**不执行摘要或向量化**（避免LLM幻觉）。  
  - **严格按`required_fields`过滤数据**，确保传递给LLM的信息**最小化且相关**。

### 2. 长期记忆（ChromaDB实现）
#### ## 1. 知识片段存储规范
- **向量元数据强制字段**：  
  ```python
  {
    "user_id": "str",      # 必须与短期记忆一致
    "source_type": "str",   # 文档来源（如"faq"）
    "created_at": "int"     # 时间戳（用于时效性过滤）
  }
  ```
- **检索逻辑**：  
  仅当用户明确提及历史信息（如"上周聊过的消息"）时触发检索，**避免无条件注入长期记忆干扰LLM**。

---

## 四、行动层设计
### 1. 工具插件实现
#### ## 1. SearchTool（基于SSE协议）
```python
class SearchTool(ITool):
    def name(self) -> str:
        return "search_engine"
    
    def description(self) -> str:
        return "通过搜索引擎获取实时信息，适用于天气、新闻等时效性查询"
    
    def parameters_schema(self) -> Dict:
        return {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "搜索关键词"},
                "max_results": {"type": "integer", "default": 3}
            },
            "required": ["query"]
        }
    
    def invoke(
        self,
        params: Dict[str, Any],
        context: Dict[str, Any]
    ) -> Dict[str, Any]:
        # 1. 参数校验（框架层已执行，此处仅业务校验）
        if len(params["query"]) < 2:
            return {"status": "error", "error_code": "TOOL_001", "message": "查询词过短"}
        
        # 2. 调用搜索引擎API
        results = self._call_search_api(params["query"], params["max_results"])
        
        # 3. 结构化返回（仅保留required_fields声明的字段）
        return {
            "status": "success",
            "data": [
                {"title": r["title"], "url": r["url"]} 
                for r in results
            ]
        }
```
- **关键设计**：  
  - **错误码标准化**：`TOOL_001`（参数无效）、`TOOL_002`（服务超时），**确保LLM能解析错误原因**。  
  - **返回数据严格过滤**：仅输出`required_fields`声明的字段，**避免LLM依赖未声明的冗余信息**。

#### ## 2. CalculatorTool（安全沙箱）
```python
class CalculatorTool(ITool):
    def parameters_schema(self) -> Dict:
        return {
            "type": "object",
            "properties": {
                "expression": {
                    "type": "string",
                    "description": "数学表达式（仅支持+-*/和括号）",
                    "pattern": r"^[0-9+\-*/\s()]+$"  # 严格正则过滤
                }
            },
            "required": ["expression"]
        }
    
    def invoke(self, params: Dict, context: Dict) -> Dict:
        # 安全校验：禁止危险字符（如import、os）
        if not re.match(self.parameters_schema()["properties"]["expression"]["pattern"], params["expression"]):
            return {"status": "error", "error_code": "TOOL_001", "message": "非法表达式"}
        
        # 使用ast.literal_eval替代eval，防止代码注入
        try:
            result = eval(params["expression"], {"__builtins__": None}, {})
            return {"status": "success", "data": {"result": result}}
        except Exception as e:
            return {"status": "error", "error_code": "TOOL_002", "message": str(e)}
```
- **关键安全措施**：  
  - **正则硬性限制表达式范围**，**而非依赖LLM参数校验**。  
  - **禁用`eval`的全局命名空间**，防止任意代码执行。

---

## 五、关键验证点实现
### 1. LLM替换验证流程
1. **配置切换**（`config.yaml`）：
   ```yaml
   llm_provider:
     type: "openai"  # 从"qwen"切换为"openai"
     api_key: "${OPENAI_API_KEY}"
     model: "gpt-4o"
   ```
2. **框架层适配器**：
   ```python
   # factory.py
   def create_llm(config: Dict) -> ILLMProvider:
       if config["type"] == "qwen":
           return QwenLLM(api_key=config["api_key"], model=config["model"])
       elif config["type"] == "openai":
           return OpenAILLM(api_key=config["api_key"], model=config["model"])
   ```
3. **验证用例**：  
   - 用户输入："计算3.14*2的平方，再搜索'AI最新进展'"  
   - **预期行为**：  
     - 先调用`CalculatorTool`计算`pow(3.14*2, 2)`  
     - 将结果作为参数传递给`SearchTool`  
     - **全程不因LLM切换中断**，仅需调整提示词中的工具描述格式。

### 2. 验证通过的关键条件
- **所有组件仅通过抽象接口交互**，无硬编码LLM调用逻辑。  
- **工具返回数据结构保持一致**（如`status`/`error_code`字段），确保LLM能统一处理结果。  
- **提示词模板动态注入工具描述**，适配不同LLM的格式要求（如GPT-4o需JSON Schema，Qwen需自然语言描述）。

---

通过上述设计，系统在**仅修改配置文件**的情况下即可完成LLM替换，且任务流程保持完整。核心价值在于：**将业务逻辑与基础设施解耦，使组件替换成本趋近于零**。实际部署时，需通过单元测试验证各层接口的兼容性（如Mock LLM测试工具调用链），避免因隐式依赖导致故障。