import { Annotation } from "@langchain/langgraph";

export const RAGGraphState = Annotation.Root({
    // 1) 输入
    query: Annotation(),

    // 2) 中间产物
    currentRewrites: Annotation(),
    retrievedContexts: Annotation(),
    currentDraft: Annotation(),

    // 3) 评审协议
    reviewStatus: Annotation(),
    reviewFeedback: Annotation(),
    contextPrecision: Annotation({
        reducer: (x, y) => y,
        default: () => 0
    }),
    issueType: Annotation(),
    retryTarget: Annotation(),
    reviewConfidence: Annotation(),

    // 4) 流程控制
    retryCount: Annotation({
        reducer: (x, y) => y,
        default: () => 0
    }),
    hasWebSearch: Annotation({
        reducer: (x, y) => y,
        default: () => false
    }),
    nextAgent: Annotation(),
    taskStatus: Annotation({
        reducer: (x, y) => y,
        default: () => "RUNNING"
    }),

    // 5) 调试与收口
    agentHistory: Annotation({
        reducer: (x, y) => y,
        default: () => []
    }),
    decisionLog: Annotation({
        reducer: (x, y) => y,
        default: () => []
    }),
    finalAnswer: Annotation(),
    failureReason: Annotation()
});
