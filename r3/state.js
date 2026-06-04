// state.js
import { Annotation } from "@langchain/langgraph";

export const RAGGraphState = Annotation.Root({
    query: Annotation(),               // 原始问题
    currentRewrites: Annotation(),     // 改写后的关键词数组
    retrievedContexts: Annotation(),   // 检索并精排后的切片文本数组
    currentDraft: Annotation(),        // 生成的回答草稿
    retryCount: Annotation({           // 重试计数器
        reducer: (x, y) => y,
        default: () => 0
    }),
    reviewStatus: Annotation(),        // 裁判官判定状态
    reviewFeedback: Annotation(),      // 裁判官的反馈
    hasWebSearch: Annotation({         // 是否已执行过外网搜索
        reducer: (x, y) => y,
        default: () => false
    }),
    contextPrecision: Annotation({     // 上下文精确率 (用于日志)
        reducer: (x, y) => y,
        default: () => 0
    })
});