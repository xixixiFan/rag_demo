import evaluator from "../../utils/evaluator.js";

// 测试开关：强制返回 REJECT 来测试失败路径
const USE_MOCK_EVALUATOR = false;

export async function evaluateNode(state, config) {
    console.log(`\n [Node: Evaluate] 正在质检当前回答草稿...`);

    const { query, retrievedContexts, currentDraft, hasWebSearch, retryCount } = state;

    // 测试模式：强制返回 REJECT，测试失败路径
    if (USE_MOCK_EVALUATOR) {
        console.log(`   └─ [TEST MODE] 强制返回 REJECT，测试失败路径`);
        const agentHistory = [...(state.agentHistory || []), "evaluate"];
        return {
            reviewStatus: "REJECT",
            reviewFeedback: "[TEST] 强制测试打回重试",
            contextPrecision: 0,
            issueType: "HALLUCINATION",
            reviewConfidence: 1,
            agentHistory
        };
    }

    // 1. 调用 evaluator 获取评分（evaluator 只负责评分，不决定流程）
    const evalResult = await evaluator.evaluate(query, retrievedContexts, currentDraft, hasWebSearch, config);

    const { faithfulness, context_precision, reason, feedback } = evalResult;

    // 2. evaluateNode 负责根据评分 + state 状态，决定返回什么 status
    let reviewStatus;
    let issueType;
    let reviewConfidence;

    // 判断 1：上下文精确率过低 → 知识库脱靶，需要外网搜索（仅当未搜索过且未达熔断）
    const isContextMiss = context_precision < 0.3;
    const shouldSearchWeb = isContextMiss && !hasWebSearch && retryCount < 1;


    if (shouldSearchWeb) {
        reviewStatus = "SEARCH_WEB";
        issueType = "LOW_CONTEXT";
        reviewConfidence = 0.95;
        console.log(`   └─ 上下文精确率 ${(context_precision * 100).toFixed(1)}% < 30%，判定为知识库脱靶，触发外网搜索`);
    }
    // 判断 2：已达到熔断上限 → 强制结束
    else if (retryCount >= 2) {
        reviewStatus = "MELT";
        issueType = "HALLUCINATION";
        reviewConfidence = 0.9;
        console.log(`   └─ 已达到最大重试次数 ${retryCount}，系统熔断`);
    }
    // 判断 3：忠实度和精确率都达标 → 通过
    else if (faithfulness >= 0.75 && context_precision >= 0.3) {
        reviewStatus = "APPROVED";
        issueType = "NONE";
        reviewConfidence = 0.98;
        console.log(`   └─ 忠实度 ${(faithfulness * 100).toFixed(1)}% >= 75%，上下文精确率 ${(context_precision * 100).toFixed(1)}% >= 30%，判定通过`);
    }
    // 判断 4：其他情况 → 打回重试
    else if (faithfulness < 0.75 && context_precision >= 0.3) {
        reviewStatus = "REJECT";
        issueType = "HALLUCINATION";
        reviewConfidence = 0.85;
        console.log(`   └─ 忠实度 ${(faithfulness * 100).toFixed(1)}% < 75%，但上下文精确率 ${(context_precision * 100).toFixed(1)}% >= 30%，判定为内容幻觉，打回重试`);
    }
    else if (faithfulness < 0.75 && context_precision < 0.3) {
        reviewStatus = "REJECT";
        issueType = "LOW_CONTEXT";
        reviewConfidence = 0.8;
        console.log(`   └─ 忠实度 ${(faithfulness * 100).toFixed(1)}% < 75%，上下文精确率 ${(context_precision * 100).toFixed(1)}% < 30%，判定为内容幻觉且知识库脱靶，打回重试${hasWebSearch ? "（直接打回草稿）" : "（先触发外网搜索）"}`);
    }
    else {
        reviewStatus = "REJECT";
        issueType = "WEAK_EXPRESSION";
        reviewConfidence = 0.75;
        console.log(`   └─ 其他情况，判定为表达不佳，打回重试`);
    }



    // 3. 返回给 state，供路由使用
    const agentHistory = [...(state.agentHistory || []), "evaluate"];
    return {
        reviewStatus,
        reviewFeedback: feedback,
        contextPrecision: context_precision,
        issueType,
        reviewConfidence,
        agentHistory
    };

}
