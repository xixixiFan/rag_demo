export async function incrementRetryNode(state) {
    const newCount = (state.retryCount || 0) + 1;
    console.log(`\n[Node: Remake] 质检未通过，记录第 ${newCount} 次重试。`);

    const agentHistory = [...(state.agentHistory || []), "handle_retry"];
    return {
        retryCount: newCount,
        currentDraft: null,
        reviewStatus: null,
        reviewFeedback: null,
        issueType: null,
        retryTarget: null,
        reviewConfidence: null,
        taskStatus: "RUNNING",
        agentHistory: [...(state.agentHistory || []), "handle_retry"]
    };

}