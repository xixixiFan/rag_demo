# RAG Supervisor 开发知识点记录

**日期**: 2026-06-04  
**项目**: r4_supervisor (LangGraph 多 Agent RAG 系统)

---

## 一、LangGraph streamMode 详解

### 1.1 streamMode 可选值

| streamMode | 返回格式 | 用途 |
|------------|---------|------|
| `'values'` | `{ 所有 state 字段 }` | 返回每个节点执行后的**完整状态快照** |
| `'updates'` | `{ 节点名：{ 该节点输出 } }` | 返回每个节点的**增量更新**（推荐） |
| `'debug'` | `{ event, timestamp, step, node, output }` | 返回**调试事件**（包含生命周期信息） |
| `'messages'` | `[role, content]` | 返回 LangChain **消息对象**（用于聊天） |
| `'custom'` | 自定义事件 | 节点手动触发的事件（需用 `writer.write()`） |
| `'events'` | `{ event, name, data }` | 返回所有事件的详细流 |

### 1.2 推荐用法

```javascript
// 前端实时显示节点进度 → 使用 'updates'
const streamResult = await graphApp.stream(
    { query },
    {
        ...config,
        streamMode: 'updates'  // 只返回当前节点的输出
    }
);

for await (const chunk of streamResult) {
    // chunk 格式：{ 节点名称：{ 该节点的输出字段 } }
    // 例如：{ rewrite: { queryRewrite: "..." } }
    const nodeName = Object.keys(chunk)[0];
    const nodeUpdate = chunk[nodeName];
}
```

### 1.3 组合模式

可以传入数组，同时获取多种格式：

```javascript
streamMode: ['updates', 'debug']
// 返回：[{updates: {...}}, {debug: {...}}]
```

---

## 二、SSE 流式推送最佳实践

### 2.1 后端响应头设置

```javascript
reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
});

// 立即刷新响应头，确保前端收到连接
if (typeof reply.raw.flushHeaders === 'function') {
    reply.raw.flushHeaders();
}
```

### 2.2 数据格式

```javascript
// 必须严格遵守 SSE 协议格式：data: JSON 字符串\n\n
reply.raw.write(`data: ${JSON.stringify(chunkData)}\n\n`);

// 刷新缓冲区，确保立即发送
if (typeof reply.raw.flush === 'function') {
    reply.raw.flush();
}
```

### 2.3 关闭流

```javascript
// 最终一定要关闭流，否则前端连接会一直挂起
reply.raw.end();
```

---

## 三、Supervisor 节点过滤

### 3.1 问题现象

后端推送包含 `supervisor` 节点，但它是**路由决策节点**，不产生业务数据：

```javascript
// supervisor 返回的数据
{
    nextAgent: 'rewrite',
    taskStatus: 'RUNNING',
    agentHistory: [...],
    decisionLog: [...]
}
```

**前端收不到有效数据**：
- `retryCount`: undefined
- `reviewStatus`: undefined
- `currentDraft`: null

### 3.2 解决方案

```javascript
for await (const chunk of streamResult) {
    const nodeName = Object.keys(chunk)[0];
    
    // 跳过 supervisor 节点，它只是路由决策，不是实际工作节点
    if (nodeName === 'supervisor') continue;
    
    // 处理实际工作节点
    console.log(`[SSE] 推送节点：${nodeName}`);
}
```

### 3.3 节点分类

| 节点类型 | 节点名称 | 是否推送前端 |
|---------|---------|-------------|
| 路由节点 | `supervisor` | ❌ 跳过 |
| 工作节点 | `rewrite`, `retrieve`, `make_draft`, `check_quality`, `handle_retry`, `web_search` | ✅ 推送 |

---

## 四、Fastify 日志中文乱码问题

### 4.1 问题

```javascript
// ❌ Fastify 内置日志输出中文会乱码
fastify.log.info(`收到请求：query=${query}...`);
// 输出：{"level":30,"msg":"鏀跺埌璇锋眰锛..."}
```

### 4.2 解决方案

```javascript
// ✅ 关闭 Fastify 内置日志
const fastify = Fastify({ logger: false });

// ✅ 改用 console.log
console.log(`\n📩 收到请求：query=${query}..., threadId=${threadId}`);
```

---

## 五、外网搜索结果噪音处理

### 5.1 问题

搜索引擎 API（如 Tavily）返回的网页内容包含**导航栏、页脚、侧边栏**等噪音：

```
### 活动广场
#### 任务中心
#### 训练营
#### 下载工具
```

### 5.2 解决方案：Prompt 层过滤

在 `draftNode` 的 systemPrompt 中添加说明：

```javascript
if (hasWebSearch) {
    systemPrompt += `\n\n【注意】外网搜索结果可能包含网页导航栏、页脚、侧边栏等无关噪音
（如"热门推荐"、"活动广场"、"下载工具"等），请只提取与用户问题相关的技术内容，
忽略这些页面结构噪音。`;
}
```

### 5.3 其他方案对比

| 方案 | 优点 | 缺点 |
|------|------|------|
| Prompt 过滤 | 简单，不改代码 | 依赖模型理解能力 |
| 内容截断 | 确定性强 | 可能丢失有效信息 |
| 换 API 提供商 | 内容更干净 | 成本可能更高 |

---

## 六、Supervisor 路由设计原则

### 6.1 集中路由模式

```
review 节点 → 返回 reviewStatus
     ↓
supervisor → 根据 reviewStatus 硬编码路由逻辑
```

### 6.2 retryTarget 字段冗余

**错误设计**（委托路由）：
```javascript
// review.js
return {
    reviewStatus: 'SEARCH_WEB',
    retryTarget: 'web_search'  // ← 冗余
};

// supervisor.js
return { nextAgent: state.retryTarget };  // ← 被架空
```

**正确设计**（集中路由）：
```javascript
// review.js
return {
    reviewStatus: 'SEARCH_WEB'
    // 不返回 retryTarget
};

// supervisor.js
if (state.reviewStatus === 'SEARCH_WEB') {
    return { nextAgent: 'web_search' };  // ← supervisor 决定
}
```

### 6.3 路由决策表

| reviewStatus | 含义 | 下一跳 |
|-------------|------|--------|
| `APPROVED` | 答案通过质检 | END（结束） |
| `REJECT` | 答案需要修改 | `handle_retry` → `make_draft` |
| `SEARCH_WEB` | 本地知识库脱靶 | `web_search`（外网兜底） |
| `MELT` | 答案有幻觉/编造 | END（熔断保护） |

---

## 七、前端 SSE 解析注意事项

### 7.1 缓冲区处理

```typescript
let buffer = '';

while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const messages = buffer.split('\n\n');
    buffer = messages.pop() || '';  // 最后一个可能不完整

    for (const message of messages) {
        if (!message.startsWith('data: ')) continue;
        const jsonStr = message.replace('data: ', '').trim();
        // ...
    }
}
```

### 7.2 状态更新

```typescript
if (parsed.event === 'node_update') {
    currentStep.value = parsed.node  // 高亮当前节点
    if (parsed.meta) {
        if (parsed.meta.retryCount !== undefined) retryCount.value = parsed.meta.retryCount
        if (parsed.meta.reviewStatus !== undefined) reviewStatus.value = parsed.meta.reviewStatus
        if (parsed.meta.currentDraft) currentDraft.value = parsed.meta.currentDraft
    }
}
```

---

## 八、节点返回值规范

### 8.1 工作节点返回值

```javascript
// rewrite.js
return {
    currentRewrites: ["改写后的查询词"],
    agentHistory: [...(state.agentHistory || []), "rewrite"]
};

// retrieve.js
return {
    retrievedContexts: [...],
    agentHistory: [...(state.agentHistory || []), "retrieve"]
};

// make_draft.js
return {
    currentDraft: "回答草稿内容",
    agentHistory: [...(state.agentHistory || []), "make_draft"]
};

// review.js
return {
    reviewStatus: "APPROVED" | "REJECT" | "SEARCH_WEB" | "MELT",
    reviewFeedback: "修改意见",
    contextPrecision: 0.85,
    issueType: "HALLUCINATION",
    reviewConfidence: 0.95,
    agentHistory: [...(state.agentHistory || []), "evaluate"]
};
```

### 8.2 supervisor 返回值

```javascript
// supervisor.js
return {
    nextAgent: "rewrite" | "retrieve" | "make_draft" | "check_quality" | "handle_retry" | "web_search" | "end",
    taskStatus: "RUNNING",
    agentHistory: [...(state.agentHistory || []), "supervisor"],
    decisionLog: ["路由决策说明"]
};
```

---

## 九、调试技巧

### 9.1 后端日志

```javascript
console.log(`\n🧠 [Node: Rewrite] 正在针对向量库优化提问关键词...`);
console.log(`[SSE] 推送节点：${nodeName}`, nodeUpdate);
```

### 9.2 前端日志

```typescript
console.log('收到 SSE 消息:', parsed);
```

### 9.3 浏览器 Network 面板

1. 打开 F12 → Network → WS/EventStream
2. 查看 SSE 消息流
3. 确认 `data:` 格式正确

---

## 十、常见问题排查

| 问题 | 可能原因 | 解决方案 |
|------|---------|---------|
| 前端收不到数据 | streamMode 不对 | 改用 `'updates'` |
| 节点名称不匹配 | 后端推送了 supervisor | 添加 `if (nodeName === 'supervisor') continue` |
| 中文日志乱码 | Fastify 日志编码问题 | 改用 `console.log` |
| 外网内容噪音多 | 网页全文抓取 | Prompt 层过滤 |
| SSE 连接不关闭 | 忘记 `reply.raw.end()` | 添加 finally 块 |
