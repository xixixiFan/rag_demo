# Langfuse 可观测性集成计划

**创建日期**: 2026-06-04  
**目标**: 为 RAG Supervisor 添加全链路可观测性，实现对话 Trace 可视化、Token 统计、工具调用耗时分析

---

## 一、背景与目标

### 1.1 当前状态

```
用户提问 → [黑盒] → 回答
         ↓
    只有 console.log
```

**问题**：
- 无法追踪每次对话的完整链路
- 不知道每个节点花费了多少时间
- 无法统计 Token 消耗
- 调试问题时需要翻日志

### 1.2 目标状态

```
用户提问 → Langfuse Trace
         ↓
├─ Generation (LLM 调用)
│  ├─ Token 数
│  └─ 耗时
├─ Span (节点执行)
│  ├─ rewrite: 120ms
│  ├─ retrieve: 350ms
│  ├─ make_draft: 2.1s
│  └─ check_quality: 1.8s
└─ Tool Call (工具调用)
   └─ Tavily 搜索：450ms
```

---

## 二、技术方案

### 2.1 Langfuse 简介

**Langfuse** 是一个开源的 LLM 可观测性平台，支持：
- Trace 追踪（树状图）
- Generation 记录（Prompt + Completion + Token）
- Span 记录（操作分段）
- Score 评分
- Tool Call 追踪

**部署方式**：
- 云服务：https://cloud.langfuse.com
- 自托管：Docker / Kubernetes

### 2.2 集成方式对比

| 方式 | 优点 | 缺点 | 推荐度 |
|------|------|------|--------|
| **Langfuse Node.js SDK** | 官方支持，功能完整 | 需要手动埋点 | ⭐⭐⭐⭐⭐ |
| **Langfuse LangChain 集成** | 自动追踪 LangChain 调用 | 可能遗漏自定义逻辑 | ⭐⭐⭐⭐ |
| **OpenTelemetry + Langfuse** | 标准化协议 | 配置复杂 | ⭐⭐⭐ |

**本计划采用**: **Langfuse Node.js SDK 手动埋点**

### 2.3 Trace 传递方案对比

| 方案 | 优点 | 缺点 | 结果 |
|------|------|------|------|
| **state.langfuseTrace** | 直观，符合 LangGraph 数据流 | 复杂对象被 LangGraph 过滤，始终为 null | ❌ 放弃 |
| **config.configurable.langfuseTrace** | 绕过 state 序列化限制，保持 state 纯净 | 需要修改所有节点调用签名 | ✅ 采用 |

### 2.4 代码组织方案对比

| 方案 | 优点 | 缺点 | 结果 |
|------|------|------|------|
| **节点内埋点** | 简单直接 | 违反单一职责，每个节点都要重复追踪代码 | ❌ 放弃 |
| **SSE 流中记录** | 集中管理 | 耦合度高，server.js 臃肿 | ❌ 放弃 |
| **traceNode 包装器 (AOP)** | 业务逻辑纯净，自动追踪，可复用 | 需要额外的包装层 | ✅ 采用 |

---

## 三、实现步骤

### Phase 1: 环境准备 (预计 30 分钟)

#### 1.1 注册 Langfuse 账号

```bash
# 访问 https://cloud.langfuse.com 注册
# 获取以下凭证：
LANGFUSE_PUBLIC_KEY=pk-lf-xxx
LANGFUSE_SECRET_KEY=sk-lf-xxx
LANGFUSE_BASE_URL=https://cloud.langfuse.com  # 自托管需修改
```

#### 1.2 安装 SDK

```bash
cd r4_supervisor
npm install langfuse
```

#### 1.3 配置环境变量

```bash
# .env
LANGFUSE_PUBLIC_KEY=pk-lf-xxx
LANGFUSE_SECRET_KEY=sk-lf-xxx
LANGFUSE_BASE_URL=https://cloud.langfuse.com
```

---

### Phase 2: 基础集成 (预计 2 小时)

#### 2.1 创建 Langfuse 客户端

```javascript
// utils/langfuse.js
import { Langfuse } from 'langfuse';
import config from '../config/index.js';

const langfuse = new Langfuse({
    publicKey: config.langfuse.publicKey,
    secretKey: config.langfuse.secretKey,
    baseUrl: config.langfuse.baseUrl,
    requestTimeout: 10000
});

// 优雅关闭
process.on('exit', () => {
    langfuse.shutdownAsync();
});

export default langfuse;
```

#### 2.2 在 server.js 中创建 Trace

```javascript
// server.js
import langfuse from './utils/langfuse.js';

fastify.post('/api/agent/chat', async (request, reply) => {
    const { query, threadId } = request.body;

    // 创建 Trace
    const trace = langfuse.trace({
        id: `trace-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        sessionId: threadId,
        userId: 'anonymous',
        input: { query },
        tags: ['rag', 'supervisor']
    });

    try {
        // ...流式处理...
        
        trace.update({ output: { completed: true } });
    } catch (error) {
        trace.update({ 
            output: { error: error.message },
            level: 'ERROR'
        });
    }
});
```

---

### Phase 3: 节点级 Span 追踪 (已完成 - AOP 方案)

**最终实现方案**：采用 AOP（面向切面编程）设计，使用 `traceNode` 包装器自动记录节点 Span。

---

#### 遇到的问题与解决方案

**问题 1: LangGraph 状态传递限制**

最初尝试通过 `state.langfuseTrace` 传递 trace 对象，但发现 LangGraph 只会传递 `Annotation` 定义的字段。即使定义了：

```javascript
langfuseTrace: Annotation({
    reducer: (x, y) => y,
    default: () => null
})
```

实际运行时 `state.langfuseTrace` 始终为 `null`。这是因为 LangGraph 的状态管理机只会序列化业务数据，不会传递复杂对象（如 Langfuse Trace 实例）。

**尝试的解决方法**：
1. 直接在 state 中添加字段 → 失败，复杂对象被过滤
2. 在 SSE 流处理中通过 `trace.span()` 记录 → 可行，但耦合度高，违反单一职责原则

**最终解决方案**：使用 LangGraph 的 `config.configurable` 机制传递 trace

```javascript
// server.js - 通过 config 传递 trace
const streamResult = await graphApp.stream(
    { query },
    {
        ...config,
        streamMode: 'updates',
        configurable: {
            ...config.configurable,
            langfuseTrace: trace  // ✅ trace 放在 configurable 中，不经过 state
        }
    }
);
```

---

**问题 2: 追踪代码侵入性**

如果直接在节点函数中写入追踪逻辑：

```javascript
// ❌ 不好的设计 - 节点函数内部混入追踪逻辑
export async function queryRewriteNode(state) {
    const trace = state.langfuseTrace;  // 耦合
    const span = trace.span(...);       // 业务逻辑被污染
    // ... 业务代码
}
```

这违反了单一职责原则，节点函数应该只关注业务逻辑。

**最终解决方案**：AOP 风格的 `traceNode` 包装器

```javascript
// utils/traceNode.js
export function traceNode(nodeFn, nodeName) {
    return async (state, config) => {
        const trace = config?.configurable?.langfuseTrace;
        
        if (!trace) {
            return await nodeFn(state);  // 降级处理
        }
        
        const span = trace.span({
            name: nodeName,
            input: sanitizeInput(nodeName, state)
        });
        
        const startTime = Date.now();
        try {
            const result = await nodeFn(state);
            const duration = Date.now() - startTime;
            
            span.update({
                output: sanitizeOutput(nodeName, result),
                metadata: { duration, status: 'success' }
            });
            
            return result;
        } catch (error) {
            span.update({
                output: { error: error.message },
                metadata: { duration, status: 'error' },
                level: 'ERROR'
            });
            throw error;
        }
    };
}
```

节点函数保持纯净：

```javascript
// nodes/rewrite.js - 无感知，专注业务
export async function queryRewriteNode(state) {
    const rawQuery = state.query;
    const rewrittenKeyword = await rewriteQuery(rawQuery, []);
    return { 
        currentRewrites: [rewrittenKeyword],
        agentHistory: [...state.agentHistory, "rewrite"]
    };
}
```

server.js 中统一包装：

```javascript
// server.js
import { traceNode } from "../utils/traceNode.js";

const queryRewriteNode = traceNode(rawRewrite, 'rewrite');
const retrieveAndRankNode = traceNode(rawRetrieve, 'retrieve');
const draftNode = traceNode(rawDraft, 'make_draft');
const check_quality = traceNode(rawEvaluate, 'check_quality');
const handle_retry = traceNode(rawRetry, 'handle_retry');
const webSearchNode = traceNode(rawWebSearch, 'web_search');
```

---

#### 数据清理

为避免上传敏感或过大数据，实现了 `sanitizeInput` 和 `sanitizeOutput` 函数：

```javascript
// utils/traceNode.js
function sanitizeInput(nodeName, state) {
    const base = {
        query: state.query?.substring(0, 100),  // 只传前 100 字符
        retryCount: state.retryCount || 0
    };
    
    if (nodeName === 'retrieve') {
        return {
            ...base,
            currentRewrites: state.currentRewrites?.slice(0, 3)
        };
    }
    // ... 其他节点
}

function sanitizeOutput(nodeName, result) {
    if (nodeName === 'retrieve') {
        return {
            retrievedContextsCount: result.retrievedContexts?.length || 0,
            agentHistory: result.agentHistory
            // ✅ 不传具体内容，太大
        };
    }
    // ... 其他节点
}
```

---

#### 最终效果

**Langfuse Dashboard 结构**：
```
Trace: trace-1780887220928-1t0vmk
├── Span: rewrite (894ms)
│   ├── input: { query: "...", retryCount: 0 }
│   └── output: { currentRewrites: [...], agentHistory: [...] }
├── Span: retrieve (785ms)
│   ├── input: { query: "...", currentRewrites: [...] }
│   └── output: { retrievedContextsCount: 3, agentHistory: [...] }
├── Span: make_draft (1149ms)
│   └── ...
├── Span: check_quality (1474ms)
│   └── ...
└── Span: web_search (5732ms)
    └── ...
```

**验证截图**：2026-06-08 实际运行显示所有 5 个节点均成功记录，包含 input、output、duration、status。

---

#### 核心文件

- `utils/traceNode.js` - AOP 包装器（新增）
- `utils/langfuse.js` - Langfuse 客户端（Phase 2 已创建）
- `r4_supervisor/server.js` - 集成包装器，通过 config 传递 trace
- `r4_supervisor/state.js` - 移除 `langfuseTrace` 字段（纯净业务状态）

---

### Phase 4: LLM Token 追踪 (已完成)

**实现思路**：
1. 所有 LLM 调用统一通过 `chatClient.create()`，消除重复代码
2. `chatClient` 内部自动创建 Langfuse Generation，记录 token 信息
3. 通过 `config.configurable.langfuseTrace` 传递 trace，与 traceNode 设计一致

---

#### 4.1 改造 chatClient (核心)

```javascript
// config/chatClient.js
import langfuse from '../utils/langfuse.js';

class ChatClient {
    async create(messages, options = {}) {
        const { trace, name = 'deepseek_chat', ...apiOptions } = options;

        // 创建 Langfuse Generation（如果有 trace）
        const generation = trace ? langfuse.generation({
            name,
            input: messages,
            model: apiOptions.model || config.ai.deepseek.chatModel,
            modelParameters: { temperature: apiOptions.temperature ?? 0.1 }
        }) : null;

        try {
            const response = await this.client.post("/chat/completions", { ... });
            const message = response.data.choices[0].message;
            const usage = response.data.usage;

            // 记录 Token 使用到 Langfuse
            if (generation && usage) {
                generation.update({
                    output: message,
                    usage: {
                        promptTokens: usage.prompt_tokens,
                        completionTokens: usage.completion_tokens,
                        totalTokens: usage.total_tokens
                    },
                    metadata: {
                        model: apiOptions.model || apiConfig.chatModel,
                        temperature: apiOptions.temperature ?? 0.1
                    }
                });
            }

            return message.content.trim();
        } catch (err) {
            // 记录错误到 Langfuse
            if (generation) {
                generation.update({
                    output: { error: err.message },
                    level: 'ERROR'
                });
            }
            throw err;
        }
    }
}
```

---

#### 4.2 重构 LLM 调用点

**rewriteQuery** (utils/query_rewrite.js):
```javascript
export async function rewriteQuery(query, chatHistory = [], config = {}) {
    const trace = config?.configurable?.langfuseTrace;

    const message = await chatClient.create([
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent }
    ], {
        temperature: 0.3,
        max_tokens: 100,
        trace,
        name: 'rewrite_query'
    });

    return message.content?.trim() || message;
}
```

**evaluator** (utils/evaluator.js):
```javascript
async evaluate(query, contexts, response, hasWebSearch = false, config = {}) {
    const trace = config?.configurable?.langfuseTrace;

    const message = await chatClient.create([
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent }
    ], {
        temperature: 0.1,
        response_format: { type: "json_object" },
        trace,
        name: 'evaluate_quality'
    });

    return JSON.parse(message.content);
}
```

---

#### 4.3 修改节点函数传递 config

**traceNode 包装器** - 现在传递 config 给节点函数：
```javascript
// utils/traceNode.js
export function traceNode(nodeFn, nodeName) {
    return async (state, config) => {
        const trace = config?.configurable?.langfuseTrace;
        // ...
        // 调用原始节点函数（传入 state 和 config）
        const result = await nodeFn(state, config);
        // ...
    };
}
```

**make_draft** - 传递 trace 给 chatClient：
```javascript
// r4_supervisor/nodes/make_draft.js
export async function draftNode(state, config) {
    const trace = config?.configurable?.langfuseTrace;

    const responseText = await chatClient.create([
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent }
    ], {
        temperature: 0.3,
        trace,
        name: 'make_draft'
    });

    return { currentDraft: responseText, ... };
}
```

**rewrite** - 传递 config 给 rewriteQuery：
```javascript
// r4_supervisor/nodes/rewrite.js
export async function queryRewriteNode(state, config) {
    const rewrittenKeyword = await rewriteQuery(rawQuery, [], config);
    return { currentRewrites: [rewrittenKeyword], ... };
}
```

**review** - 传递 config 给 evaluator：
```javascript
// r4_supervisor/nodes/review.js
export async function evaluateNode(state, config) {
    const evalResult = await evaluator.evaluate(
        query, retrievedContexts, currentDraft, hasWebSearch, config
    );
    // ...
}
```

---

#### 4.4 Langfuse Generation 结构

```
Trace: trace-xxx
├── Generation: rewrite_query
│   ├── Input: [system prompt, user query]
│   ├── Output: "改写后的关键词"
│   ├── Model: deepseek-chat
│   └── Usage: prompt=50, completion=20, total=70
├── Generation: make_draft
│   ├── Input: [system prompt, user query, contexts]
│   ├── Output: "回答草稿"
│   └── Usage: prompt=500, completion=300, total=800
└── Generation: evaluate_quality
    ├── Input: [system prompt, query, contexts, response]
    ├── Output: {"faithfulness": 0.9, "context_precision": 0.8, ...}
    └── Usage: prompt=400, completion=50, total=450
```

---

#### 4.5 核心文件

- `config/chatClient.js` - 统一 LLM 调用入口，集成 Langfuse Generation
- `utils/query_rewrite.js` - 重构为使用 chatClient
- `utils/evaluator.js` - 重构为使用 chatClient
- `utils/traceNode.js` - 修改为传递 config 给节点函数
- `r4_supervisor/nodes/make_draft.js` - 传递 trace 给 chatClient
- `r4_supervisor/nodes/rewrite.js` - 传递 config 给 rewriteQuery
- `r4_supervisor/nodes/review.js` - 传递 config 给 evaluator

---

### Phase 5: 工具调用追踪 (预计 1 小时)

#### 5.1 追踪搜索引擎调用

```javascript
// utils/fetchWebSearch.js
import langfuse from './langfuse.js';

async function fetchWebSearch(query) {
    const span = langfuse.span({
        name: 'tavily_search',
        input: { query }
    });

    try {
        const startTime = Date.now();
        const response = await axios.post(...);
        const duration = Date.now() - startTime;

        span.update({
            output: { resultsCount: response.data.results.length },
            metadata: { duration }
        });

        return mergedWebContext;
    } catch (error) {
        span.update({
            output: { error: error.message },
            level: 'ERROR'
        });
        throw error;
    }
}
```

---

### Phase 6: 前端集成 (预计 2 小时)

#### 6.1 记录用户交互

```typescript
// frontend/src/hooks/useAgentChat.ts
async function startChat(options: UseAgentChatOptions) {
    // 记录用户输入
    langfuseClient.capture({
        event: 'agent_query',
        properties: {
            query: options.query,
            threadId: options.threadId
        }
    });

    // ...现有逻辑...
}
```

---

## 四、配置文件

### 4.1 config/index.js 新增

```javascript
export default {
    // ...现有配置...

    langfuse: {
        publicKey: process.env.LANGFUSE_PUBLIC_KEY,
        secretKey: process.env.LANGFUSE_SECRET_KEY,
        baseUrl: process.env.LANGFUSE_BASE_URL || 'https://cloud.langfuse.com'
    }
};
```

### 4.2 .env.example 新增

```bash
# Langfuse 可观测性
LANGFUSE_PUBLIC_KEY=pk-lf-xxx
LANGFUSE_SECRET_KEY=sk-lf-xxx
LANGFUSE_BASE_URL=https://cloud.langfuse.com
```

---

## 五、预期效果

### 5.1 Langfuse Dashboard 截图（预期）

```
Trace: vue_run_1780565418475
├── Generation: deepseek_chat (rewrite)
│   ├── Input: "如何理解滑动窗口算法..."
│   ├── Output: "滑动窗口算法 左右双指针..."
│   └── Token: 128 / 64 / 192
├── Span: retrieve_and_rank (210ms)
│   └── Output: 10 个候选切片
├── Generation: deepseek_chat (make_draft)
│   └── Token: 256 / 512 / 768
├── Span: check_quality (85ms)
│   └── Output: APPROVED
└── Score: quality = 0.95
```

### 5.2 查询功能

- 按 `sessionId` 搜索对话历史
- 按 `tags` 过滤（如 `rag`, `supervisor`）
- 查看 Token 消耗趋势
- 分析平均响应时间

---

## 六、风险与注意事项

### 6.1 敏感数据处理

- ❌ 不要上传完整 `retrievedContexts`（太大）
- ❌ 不要上传 API Key 等敏感信息
- ✅ 只上传 `query` 前 100 字符
- ✅ 只上传 `currentDraft` 前 500 字符
- ✅ 使用 `sanitizeInput`/`sanitizeOutput` 统一清理

### 6.2 性能影响

- Langfuse SDK 是**异步批量上报**，对性能影响很小
- `traceNode` 包装器只增加微秒级时间戳计算
- 确保 `shutdownAsync()` 在进程退出时调用

### 6.3 日志缓冲问题

使用 `dotenvx run` 启动时，stdout 可能被缓冲，导致 console.log 不实时显示。

**症状**：服务器运行正常，但看不到日志输出。

**解决方案**：
1. 使用 `LANGFUSE_DEBUG=true` 启用 SDK 调试日志
2. 或在 Langfuse Dashboard 直接查看（最可靠）
3. 或临时改用 `stderr` 输出：`console.error()`

### 6.4 成本控制

- Langfuse 云版免费额度：10,000 traces/月
- 超出后按 $0.01/trace 计费
- 可以考虑自托管（Docker / Kubernetes）

---

## 七、验收标准

- [x] Langfuse Dashboard 能看到每条对话的 Trace
- [x] 每个节点的耗时都能在 Span 中看到
- [x] LLM 调用的 Token 数准确记录
- [ ] 外网搜索调用有独立的 Span（Phase 5）
- [x] 错误能正确标记为 `level: ERROR`
- [x] 进程退出时 SDK 正常关闭

---

## 八、时间估算

| Phase | 内容 | 预计时间 | 状态 |
|-------|------|---------|------|
| 1 | 环境准备 | 30 分钟 | ✅ 完成 |
| 2 | 基础集成 | 2 小时 | ✅ 完成 |
| 3 | 节点级 Span | 3 小时 | ✅ 完成 |
| 4 | LLM Token 追踪 | 2 小时 | ✅ 完成 |
| 5 | 工具调用追踪 | 1 小时 | ⏳ 待做 |
| 6 | 前端集成 | 2 小时 | ⏳ 待做 |
| **总计** | | **约 10.5 小时** | **已完成 7.5 小时** |

---

## 十、技术决策记录 (ADR)

### ADR-001: 使用 config.configurable 传递 Langfuse Trace

**状态**: 已采纳  
**日期**: 2026-06-08

**背景**: 最初尝试通过 `state.langfuseTrace` 传递 trace 对象，但 LangGraph 只传递 Annotation 定义的字段，复杂对象被过滤。

**决策**: 使用 LangGraph 的 `config.configurable` 机制传递 trace 实例。

**后果**:
- ✅ state 保持纯净，只包含业务数据
- ✅ trace 对象不被序列化，直接传递引用
- ✅ 节点函数签名需支持 `(state, config)` 双参数

### ADR-002: AOP 风格的 traceNode 包装器

**状态**: 已采纳  
**日期**: 2026-06-08

**背景**: 直接在节点函数中写入追踪逻辑会违反单一职责原则，导致业务逻辑被污染。

**决策**: 创建 `traceNode` 高阶函数，自动包装所有节点函数，统一处理：
- Span 创建与更新
- 输入/输出清理
- 耗时计算
- 错误捕获

**后果**:
- ✅ 节点函数专注业务逻辑
- ✅ 追踪逻辑集中管理
- ✅ 新增节点时只需包装即可自动获得追踪能力
- ⚠️ 需要维护额外的工具文件

### ADR-003: 数据清理策略

**状态**: 已采纳  
**日期**: 2026-06-08

**背景**: Langfuse 按 trace 计费，上传过大数据会增加成本且无实际价值。

**决策**: 实现 `sanitizeInput` 和 `sanitizeOutput` 函数：
- `query` 只传前 100 字符
- `currentDraft` 只传前 500 字符
- `retrievedContexts` 只传数量，不传内容
- 保留 `agentHistory` 用于链路追踪

**后果**:
- ✅ 减少数据传输成本
- ✅ 避免敏感信息泄露
- ✅ Langfuse Dashboard 保持简洁

---

## 十一、下一步

1. **确认是否使用 Langfuse**（还是其他方案如 Phoenix、Arize）→ ✅ 已确认使用 Langfuse
2. **注册账号获取凭证** → ✅ 已完成
3. **开始 Phase 1 环境准备** → ✅ 已完成
4. **Phase 3: 节点级 Span 追踪** → ✅ 已完成（AOP 方案）
5. **Phase 4: LLM Token 追踪** → ✅ 已完成（统一 chatClient）
6. **Phase 5: 工具调用追踪** → ⏳ 待做（Tavily 搜索）
7. **Phase 6: 前端集成** → ⏳ 待做（用户交互事件）
