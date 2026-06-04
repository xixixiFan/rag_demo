# Supervisor Agent 架构文档

## 1. 当前图结构

```
                              ┌─────────────┐
                              │  START      │
                              └──────┬──────┘
                                     │
                                     ▼
                         ┌───────────────────┐
                         │   supervisor      │◄───────────────────────────────┐
                         │  (中央调度器)      │                                │
                         └─────────┬─────────┘                                │
                                   │                                          │
           ┌───────────────────────┼───────────────────────┐                  │
           │                       │                       │                  │
           ▼                       ▼                       ▼                  │
    ┌─────────────┐         ┌─────────────┐         ┌─────────────┐          │
    │   rewrite   │         │  retrieve   │         │  make_draft │          │
    │  (query 改写)│         │ (向量检索)   │         │  (草稿生成)  │          │
    └──────┬──────┘         └──────┬──────┘         └──────┬──────┘          │
           │                       │                       │                  │
           │                       │                       ▼                  │
           │                       │               ┌─────────────┐          │
           │                       │               │ check_quality│          │
           │                       │               │  (质量评估)  │          │
           │                       │               └──────┬──────┘          │
           │                       │                      │                 │
           │                       │                      │                 │
           ▼                       ▼                      ▼                 │
    ┌─────────────────────────────────────────────────────────┐             │
    │                    supervisor (返回决策)                  │             │
    └─────────────────────────────────────────────────────────┘             │
                                   │                                        │
           ┌───────────────────────┼───────────────────────┐                │
           │                       │                       │                │
           ▼                       ▼                       ▼                │
    ┌─────────────┐         ┌─────────────┐         ┌─────────────┐        │
    │ web_search  │         │handle_retry │         │    END      │        │
    │ (外网搜索)   │         │ (重试计数)   │         │   (结束)    │        │
    └─────────────┘         └──────┬──────┘         └─────────────┘        │
                                   │                                       │
                                   └───────────────────────────────────────┘
```

### 架构特点

- **中心化调度**：所有节点执行后都要返回给 `supervisor`，由 `supervisor` 决定下一个节点
- **条件边路由**：`supervisor` 通过返回 `nextAgent` 字段来决定下一个执行的节点
- **无直接连接**：节点之间没有直接边连接，全部通过 `supervisor` 中转

---

## 2. 每个 Agent 的职责

| 节点名 | 文件名 | 职责 | 返回字段 |
|--------|--------|------|----------|
| **supervisor** | `supervisor.js` | 中央调度器，根据当前 state 状态决定下一个执行哪个节点 | `nextAgent`, `taskStatus`, `finalAnswer`, `failureReason` |
| **rewrite** | `rewrite.js` | 对用户 query 进行关键词改写和优化 | `currentRewrites`, `agentHistory` |
| **retrieve** | `retrieve.js` | 根据改写后的关键词进行向量检索和 Reranker 精排 | `retrievedContexts`, `hasLocalAnswer`, `agentHistory` |
| **make_draft** | `make_draft.js` | 根据 query 和检索到的上下文生成回答草稿 | `currentDraft`, `agentHistory` |
| **check_quality** | `review.js` | 调用 evaluator 进行质量评估，决定流程走向 | `reviewStatus`, `reviewFeedback`, `contextPrecision`, `retryTarget`, `agentHistory` |
| **web_search** | `web_search.js` | 当本地知识库脱靶时，调用外网搜索引擎兜底 | `retrievedContexts`, `hasWebSearch`, `agentHistory` |
| **handle_retry** | `handle_retry.js` | 增加重试计数器，清除草稿和评审状态以便重新生成 | `retryCount`, `currentDraft: null`, `reviewStatus: null`, `agentHistory` |

---

## 3. State 字段分类

### 3.1 输入类字段（由用户或上游节点提供）

| 字段 | 类型 | 说明 |
|------|------|------|
| `query` | string | 用户原始问题 |
| `currentRewrites` | array | 改写后的关键词数组 |
| `retrievedContexts` | array | 检索到的上下文切片 |
| `currentDraft` | string | 生成的回答草稿 |

### 3.2 状态控制字段（用于流程控制）

| 字段 | 类型 | 说明 |
|------|------|------|
| `retryCount` | number | 当前重试次数（默认 0，最大 2 次） |
| `reviewStatus` | string | 评审状态：`APPROVED` \| `REJECT` \| `SEARCH_WEB` \| `MELT` |
| `reviewFeedback` | string | 评审反馈意见 |
| `hasWebSearch` | boolean | 是否已执行过外网搜索 |
| `contextPrecision` | number | 上下文精确率 (0.0-1.0) |
| `nextAgent` | string | supervisor 决定的下一个节点 |
| `taskStatus` | string | 任务状态：`RUNNING` \| `APPROVED` \| `FAILED` \| `NEED_RETRY` |

### 3.3 输出类字段（流程结束时产生）

| 字段 | 类型 | 说明 |
|------|------|------|
| `finalAnswer` | string | 最终回答 |
| `failureReason` | string | 失败原因 |

### 3.4 审计类字段（用于调试和追踪）

| 字段 | 类型 | 说明 |
|------|------|------|
| `agentHistory` | array | 记录所有执行过的节点历史 |
| `decisionLog` | array | supervisor 的决策日志 |

### 3.5 辅助决策字段（check_quality 返回）

| 字段 | 类型 | 说明 |
|------|------|------|
| `retryTarget` | string | 重试目标节点：`make_draft` \| `retrieve` \| `rewrite` \| `web_search` |
| `issueType` | string | 问题类型：`HALLUCINATION` \| `LOW_CONTEXT` \| `WEAK_EXPRESSION` |
| `reviewConfidence` | number | 评审置信度 (0.0-1.0) |

---

## 4. Supervisor 如何决策

### 决策流程图

```
┌─────────────────────────────────────────────────────────────────┐
│                        supervisorNode                            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
              ┌───────────────────────────────────┐
              │ 1. 检查是否有 currentRewrites？    │
              │    无 → 派发给 rewrite             │
              └───────────────────────────────────┘
                              │ 有
                              ▼
              ┌───────────────────────────────────┐
              │ 2. 检查是否有 retrievedContexts？  │
              │    无 → 派发给 retrieve            │
              └───────────────────────────────────┘
                              │ 有
                              ▼
              ┌───────────────────────────────────┐
              │ 3. 检查是否有 currentDraft？       │
              │    无 → 派发给 make_draft          │
              └───────────────────────────────────┘
                              │ 有
                              ▼
              ┌───────────────────────────────────┐
              │ 4. 检查是否有 reviewStatus？       │
              │    无 → 派发给 check_quality       │
              └───────────────────────────────────┘
                              │ 有
                              ▼
              ┌─────────────────────────────────────────────┐
              │ 5. 根据 reviewStatus 决定：                  │
              │    - SEARCH_WEB → 派发给 web_search         │
              │    - APPROVED   → nextAgent = "end"         │
              │    - REJECT + retryCount < 2 → 派发给对应目标│
              │    - REJECT + retryCount >= 2 → FAILED      │
              │    - MELT       → FAILED                    │
              └─────────────────────────────────────────────┘
```

### 决策代码逻辑（伪代码）

```javascript
function supervisorNode(state) {
    // 1. 检查必要数据是否存在
    if (!state.currentRewrites) {
        return { nextAgent: "rewrite", taskStatus: "RUNNING" };
    }
    if (!state.retrievedContexts) {
        return { nextAgent: "retrieve", taskStatus: "RUNNING" };
    }
    if (!state.currentDraft) {
        return { nextAgent: "make_draft", taskStatus: "RUNNING" };
    }
    if (!state.reviewStatus) {
        return { nextAgent: "check_quality", taskStatus: "RUNNING" };
    }

    // 2. 根据 reviewStatus 决策
    switch (state.reviewStatus) {
        case "SEARCH_WEB":
            return { nextAgent: "web_search", taskStatus: "RUNNING" };

        case "APPROVED":
            return {
                nextAgent: "end",
                taskStatus: "APPROVED",
                finalAnswer: state.currentDraft
            };

        case "REJECT":
            if (state.retryCount < 2) {
                // 根据 retryTarget 决定重试哪个节点
                return {
                    nextAgent: state.retryTarget || "make_draft",
                    taskStatus: "NEED_RETRY"
                };
            } else {
                // 达到重试上限，失败
                return {
                    nextAgent: "end",
                    taskStatus: "FAILED",
                    failureReason: "retry_limit_exceeded"
                };
            }

        case "MELT":
            return {
                nextAgent: "end",
                taskStatus: "FAILED",
                failureReason: "system_melt"
            };

        default:
            return {
                nextAgent: "end",
                taskStatus: "FAILED",
                failureReason: "unknown_status"
            };
    }
}
```

---

## 5. 当前支持的路径

### 5.1 成功路径（APPROVED）

```
用户 query
   → rewrite (改写关键词)
   → retrieve (本地检索)
   → make_draft (生成草稿)
   → check_quality (评审通过)
   → supervisor (返回 APPROVED)
   → END

输出：finalAnswer = currentDraft
taskStatus = "APPROVED"
```

**条件**：
- 忠实度 (Faithfulness) >= 0.75
- 上下文精确率 (Context Precision) >= 0.3

---

### 5.2 外网搜索路径（SEARCH_WEB）

```
用户 query
   → rewrite
   → retrieve (本地检索脱靶)
   → make_draft
   → check_quality (context_precision < 0.3, 未搜索过)
   → supervisor (返回 SEARCH_WEB)
   → web_search (外网搜索)
   → make_draft (基于外网内容重新生成)
   → check_quality (评审通过)
   → supervisor (返回 APPROVED)
   → END

输出：finalAnswer = currentDraft
taskStatus = "APPROVED"
hasWebSearch = true
```

**触发条件**：
- `context_precision < 0.3`
- `hasWebSearch === false`
- `retryCount < 1`

---

### 5.3 打回重试路径（REJECT → 重试 → 通过/失败）

#### 5.3.1 重试后通过

```
用户 query
   → rewrite
   → retrieve
   → make_draft
   → check_quality (评审不通过，如忠实度过低)
   → supervisor (返回 REJECT, retryTarget=make_draft)
   → handle_retry (retryCount = 1, 清除草稿和评审状态)
   → make_draft (根据反馈重新生成)
   → check_quality (评审通过)
   → supervisor (返回 APPROVED)
   → END

输出：finalAnswer = currentDraft
taskStatus = "APPROVED"
retryCount = 1
```

#### 5.3.2 重试达到上限后失败

```
用户 query
   → rewrite
   → retrieve
   → make_draft
   → check_quality (评审不通过)
   → supervisor (返回 REJECT)
   → handle_retry (retryCount = 1)
   → make_draft
   → check_quality (仍不通过)
   → supervisor (返回 REJECT)
   → handle_retry (retryCount = 2)
   → make_draft
   → check_quality (仍不通过)
   → supervisor (retryCount >= 2，判定失败)
   → END

输出：
- finalAnswer = currentDraft (最后一版草稿)
- taskStatus = "FAILED"
- failureReason = "retry_limit_exceeded"
- retryCount = 2
```

---

### 5.4 路径决策表

| reviewStatus | retryCount | hasWebSearch | 下一个节点 | taskStatus |
|--------------|------------|--------------|-----------|------------|
| - | - | - | rewrite (无 currentRewrites) | RUNNING |
| - | - | - | retrieve (无 retrievedContexts) | RUNNING |
| - | - | - | make_draft (无 currentDraft) | RUNNING |
| - | - | - | check_quality (无 reviewStatus) | RUNNING |
| SEARCH_WEB | - | false | web_search | RUNNING |
| APPROVED | - | - | END | APPROVED |
| REJECT | 0 | - | handle_retry → make_draft | NEED_RETRY |
| REJECT | 1 | - | handle_retry → make_draft | NEED_RETRY |
| REJECT | >= 2 | - | END | FAILED |
| MELT | - | - | END | FAILED |

---

## 6. 附录：关键阈值

| 指标 | 阈值 | 说明 |
|------|------|------|
| 忠实度 (Faithfulness) | >= 0.75 | 答案基于上下文的程度 |
| 上下文精确率 (Context Precision) | >= 0.3 | 检索内容与问题的相关程度 |
| 最大重试次数 (maxRetryCount) | 2 | 超过此次数则熔断 |

---

## 7. 调试技巧

### 查看决策日志

```javascript
console.log("decisionLog:", state.decisionLog);
// 输出示例：
// [
//   '缺少 currentRewrites，派发给 rewrite',
//   '缺少 retrievedContexts，派发给 retrieve',
//   '缺少 currentDraft，派发给 make_draft',
//   '缺少 reviewStatus，派发给 check_quality',
//   'reviewStatus=REJECT，retryTarget=make_draft，派发给 handle_retry',
//   '流程失败结束，reviewStatus=REJECT, retryCount=2'
// ]
```

### 查看 Agent 执行历史

```javascript
console.log("agentHistory:", state.agentHistory);
// 输出示例：
// ['supervisor', 'rewrite', 'supervisor', 'retrieve', 'supervisor', 'make_draft', ...]
```

### 查看最终状态快照

```javascript
console.log(" [finalAnswer]     : ", finalSnapshot.currentDraft);
console.log(" [reviewFeedback]  : ", finalSnapshot.reviewFeedback);
console.log(" [taskStatus]      : ", finalSnapshot.taskStatus);
console.log(" [retryCount]      : ", finalSnapshot.retryCount);
console.log(" [hasWebSearch]    : ", finalSnapshot.hasWebSearch);
console.log(" [contextPrecision]: ", finalSnapshot.contextPrecision * 100 + "%");
```

---

**文档版本**: v1.0  
**最后更新**: 2025-06-03  
**维护者**: RAG Team
