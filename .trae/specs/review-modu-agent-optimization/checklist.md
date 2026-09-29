# Checklist

## 覆盖完整性
- [x] src/ 下 15 个模块目录全部被审查，报告附录 B 含完整文件清单（153 个文件逐一标注"发现/通过"）
- [x] 五个最大文件（nodes.ts 2685 行、agui-adapter.ts 1382 行、runner.ts 1283 行、factory.ts 899 行、registry.ts 769 行）均逐段深读并有专项结论

## 审查维度
- [x] 性能瓶颈：同步阻塞（asr-processor writeFileSync、file-ops *Sync、message-bus existsSync、每请求 _hashConfig）、重复计算（蒸馏每轮重跑、_truncateJson O(k²)、每轮重建 ChatOpenAI）、缓存缺失（runner single-flight、routeTable）均有结论（报告 P0-6、P1-11/13/24/26、P2-1/2/7/20/28）
- [x] 内存使用效率：无限增长集合（MemorySaver/versioned-store/evolution-signal/short-term-memory/metrics session label）、未释放资源（message-bus 定时器/订阅、mcp 无 onclose、runtime-config _emitter）均有结论（报告 P1-7~11/25、P2-22/44）
- [x] 算法复杂度：识别 O(n²) 热点（toolResultProcessor 全量 parse、_truncateJson O(k×n)、quality-monitor 双循环）并给出量级（P1-12/26、P2-51）
- [x] 安全性漏洞：http-request SSRF（部分防护，IPv6 映射绕过 P0-4）、sql-query 注入（不存在，参数化+黑名单+readonly）、code-executor 沙箱（词法黑名单可逃逸 P0-5）、file-ops 路径穿越（基本不存在，中间 symlink 残余 P2-35）、日志密钥泄漏（无系统性泄漏，3 处通道 P2-5/36/52）五项逐一给出结论（报告第六章）
- [x] 可读性/可维护性/可扩展性：命名反例清单（5.1）、超 80 行函数 20 个完整清单（5.2）、any 量化统计 114/777 处（附录 A）、硬编码分支（doc_writer 字符串特征匹配 P2-8、sensor-manager 1000ms P2-55、agui chunk 30 P2-46）均有量化统计

## 审查清单（用户指定六项）
- [x] 变量命名规范已检查并有结论（5.1，8 处反例）
- [x] 函数封装合理性已检查并有结论（5.2，20 个超 80 行函数清单含位置行数）
- [x] 异常处理机制已检查并有结论（5.3，1 处真实空 catch、关键 fail-open P1-1、~20 处降级型 catch 分类）
- [x] 注释完整性已检查并有结论（5.4，JSDoc 覆盖率高、TODO 17 条清单、6 处缺 JSDoc 公共面）
- [x] 重复代码消除已检查（5.5，9 组重复含 81 处 logger、path 校验双份、transport×3、resume payload×2、prompt 聚合三胞胎等）
- [x] 依赖管理优化已检查（5.6，package.json 13 项逐项使用率核实，3 项治理点）

## 报告质量
- [x] 每条发现包含五字段：问题描述、证据（文件:行号）、优化建议、实施步骤、预期效果（P0/P1 全块格式，P2 表格五列）
- [x] 关键优化点完成 P0/P1/P2 优先级排序，标注依赖关系与实施顺序（第七章路线图三批推进）
- [x] 报告输出至 `packages/docs/modu-agent代码优化审查报告.md`

## 基线回归
- [x] 审查期间 src/tests 零改动（git status 与审查前完全一致，仅新增报告文件）
- [x] 报告产出后 tsc 零错误（exit 0）
- [x] 报告产出后 vitest 结果与基线一致（898 通过 / 7 失败，失败均为 better-sqlite3 环境问题）
