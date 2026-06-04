// nodes/webSearch.js
import fetchWebSearch from "../../utils/fetchWebSearch.js";

export async function webSearchNode(state) {
    console.log(`\n [Node: Web Search] 本地知识库脱靶！正在启动外网搜索引擎进行动态兜底...`);
    const query = state.currentRewrites?.[0] || state.query;

    // 调用搜索引擎 API (如 Tavily)
    const webContext = await fetchWebSearch(query);
    const localContexts = state.retrievedContexts || [];
    const formattedWebContext = `【补充资料（来自外网权威检索）】:\n${webContext}`;

    console.log(`   └─ 合并上下文：本地 ${localContexts.length} 条 + 外网 1 条 = ${localContexts.length + 1} 条`);
    console.log(`   └─ 外网内容预览：${webContext.substring(0, 200)}...`);

    const agentHistory = [...(state.agentHistory || []), "web_search"];
    return {
        retrievedContexts: [...localContexts, formattedWebContext],
        hasWebSearch: true,
        currentDraft: null,
        reviewStatus: null,
        reviewFeedback: null,
        issueType: null,
        retryTarget: null,
        reviewConfidence: null,
        taskStatus: "RUNNING",
        agentHistory: [...(state.agentHistory || []), "web_search"]
    };
}