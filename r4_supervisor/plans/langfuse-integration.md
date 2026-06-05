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

### Phase 3: 节点级 Span 追踪 (已完成)

**实现方式调整**：由于 LangGraph.js 的节点在编译时绑定，无法在运行时动态注入 trace 引用，因此改为在 SSE 流处理中记录节点 Span。

#### 3.1 创建输出清理函数 ✅

```javascript
// utils/traceNode.js
export function sanitizeOutput(nodeName, result) {
    if (nodeName === 'rewrite') {
        return {
            currentRewrites: result.currentRewrites,
            agentHistory: result.agentHistory
        };
    }
    if (nodeName === 'retrieve') {
        return {
            retrievedContextsCount: result.retrievedContexts?.length || 0,
            agentHistory: result.agentHistory
        };
    }
    // ... 其他节点
}
```

#### 3.2 在 server.js 中记录节点 Span ✅

```javascript
// server.js - SSE 流处理中
for await (const chunk of streamResult) {
    const nodeName = Object.keys(chunk)[0];
    const nodeUpdate = chunk[nodeName];
    
    // 直接使用 trace.span()，去掉 executionSpan 中间层
    trace.span({
        name: nodeName,
        input: {
            query: nodeUpdate.currentRewrites?.[0] || query,
            retryCount: nodeUpdate.retryCount
        },
        output: sanitizeOutput(nodeName, nodeUpdate),
        metadata: { duration: nodeDuration }
    });
}
```

**Langfuse 结构**：
```
Trace: trace-xxx
├── Span: rewrite (42ms)
├── Span: retrieve (350ms)
├── Span: make_draft (2100ms)
└── Span: check_quality (1800ms)
```

---

### Phase 4: LLM Token 追踪 (预计 2 小时)

#### 4.1 修改 chatClient

```javascript
// config/chatClient.js
import langfuse from '../utils/langfuse.js';

export class ChatClient {
    async create(messages, options = {}) {
        const generation = langfuse.generation({
            name: 'deepseek_chat',
            input: messages,
            model: 'deepseek-chat',
            modelParameters: { temperature: options.temperature || 0.3 }
        });

        try {
            const response = await axios.post(...);
            
            // 记录 Token 使用
            generation.update({
                output: response.data.choices[0].message.content,
                usage: {
                    promptTokens: response.data.usage.prompt_tokens,
                    completionTokens: response.data.usage.completion_tokens,
                    totalTokens: response.data.usage.total_tokens
                }
            });

            return response.data.choices[0].message.content;
        } catch (error) {
            generation.update({
                output: { error: error.message },
                level: 'ERROR'
            });
            throw error;
        }
    }
}
```

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

### 6.2 性能影响

- Langfuse SDK 是**异步批量上报**，对性能影响很小
- 但需要确保 `shutdownAsync()` 在进程退出时调用

### 6.3 成本控制

- Langfuse 云版免费额度：10,000 traces/月
- 超出后按 $0.01/trace 计费
- 可以考虑自托管

---

## 七、验收标准

- [ ] Langfuse Dashboard 能看到每条对话的 Trace
- [ ] 每个节点的耗时都能在 Span 中看到
- [ ] LLM 调用的 Token 数准确记录
- [ ] 外网搜索调用有独立的 Span
- [ ] 错误能正确标记为 `level: ERROR`
- [ ] 进程退出时 SDK 正常关闭

---

## 八、时间估算

| Phase | 内容 | 预计时间 | 状态 |
|-------|------|---------|------|
| 1 | 环境准备 | 30 分钟 | ✅ 完成 |
| 2 | 基础集成 | 2 小时 | ✅ 完成 |
| 3 | 节点级 Span | 3 小时 | ✅ 完成 |
| 4 | LLM Token 追踪 | 2 小时 | ⏳ 待做 |
| 5 | 工具调用追踪 | 1 小时 | ⏳ 待做 |
| 6 | 前端集成 | 2 小时 | ⏳ 待做 |
| **总计** | | **约 10.5 小时** | **已完成 5.5 小时** |

---

## 九、下一步

1. **确认是否使用 Langfuse**（还是其他方案如 Phoenix、Arize）
2. **注册账号获取凭证**
3. **开始 Phase 1 环境准备**
