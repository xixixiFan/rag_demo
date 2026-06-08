// nodes/make_draft.js
import { chatClient } from "../../config/chatClient.js";

export async function draftNode(state, config) {
    console.log(`\n [Node: Draft] 正在根据问题和检索到的技术片段生成回答草稿...`);

    const hasWebSearch = state.hasWebSearch ?? false;
    const contextStr = state.retrievedContexts && state.retrievedContexts.length > 0
        ? state.retrievedContexts.map((c, i) => `[切片 ${i + 1}]: ${c}`).join('\n')
        : "（知识库未召回相关线索，请基于常识或标准技术公式进行严谨回答）";

    // 如果有外网搜索结果，调整 systemPrompt 让大模型知道可以信任外网内容
    let systemPrompt = `你是一个大模型核心技术与 RAG 架构设计规范专家。请严格基于【参考资料】中的客观事实回答【用户提问】。
绝不允许胡编乱造、凭空捏造知识库里没有的技术细节，拒绝任何形式的幻觉。`;

    if (hasWebSearch) {
        systemPrompt += `\n\n【重要】本次检索包含来自外网权威搜索引擎（如 Tavily）的实时搜索结果，这些内容标记为"【补充资料（来自外网权威检索）】"。
外网搜索结果是可靠、实时、权威的，你可以放心引用这些信息来回答用户问题。
你的任务是整合本地知识库和外网搜索的结果，给用户一个完整、准确、专业的回答。

【注意】外网搜索结果可能包含网页导航栏、页脚、侧边栏等无关噪音（如"热门推荐"、"活动广场"、"下载工具"等），请只提取与用户问题相关的技术内容，忽略这些页面结构噪音。`;
    }

    let userContent = `【用户提问】: ${state.query}\n\n【参考资料】:\n${contextStr}`;

    // 如果这是重试流的第 N 次（N>0），还要把上一次的草稿和裁判官的反馈一起传给大模型，要求它在修改时对齐批改意见
    if (state.retryCount > 0 && state.reviewFeedback) {
        console.log(`   └─  警告：检测到上一版回答被驳回！正在对齐批改意见...`);
        systemPrompt += `\n\n注意：你的上一版回答被驳回了。请对照【裁判官修改意见】和【参考资料】，对上一版进行定向深度修改。`;
        userContent += `\n\n【上一版的错误回答】:\n${state.currentDraft}\n\n【修改意见】:\n${state.reviewFeedback}`;
    }

    try {
        // 从 config 获取 trace，传递给 chatClient 用于 Langfuse Generation 追踪
        const trace = config?.configurable?.langfuseTrace;

        const responseText = await chatClient.create([
            { role: "system", content: systemPrompt },
            { role: "user", content: userContent }
        ], {
            temperature: 0.3,
            trace,
            name: 'make_draft'
        });

        return {
            currentDraft: responseText,
            agentHistory: [...(state.agentHistory || []), "make_draft"]
        };

    } catch (err) {
        console.error("  大模型故障，降级返回旧内容:", err.message);
        const agentHistory = [...(state.agentHistory || []), "make_draft_error"];
        return {
            currentDraft: state.currentDraft || "大模型熔断故障。",
            agentHistory
        };
    }
}
