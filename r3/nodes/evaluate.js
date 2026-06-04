import evaluator from "../../utils/evaluator.js";

export async function check_quality(state) {
    console.log(`\n [Node: Check Quality] 正在质检当前回答草稿...`);

    const { query, retrievedContexts, currentDraft, hasWebSearch, retryCount } = state;

    // 1. 调用 evaluator 获取评分（evaluator 只负责评分，不决定流程）
    const evalResult = await evaluator.evaluate(query, retrievedContexts, currentDraft, hasWebSearch);

    const { faithfulness, context_precision, reason, feedback } = evalResult;

    // 2. check_quality 节点负责根据评分 + state 状态，决定返回什么 status
    let reviewStatus;

    // 判断 1：上下文精确率过低 → 知识库脱靶，需要外网搜索（仅当未搜索过且未达熔断）
    const isContextMiss = context_precision < 0.3;
    const shouldSearchWeb = isContextMiss && !hasWebSearch && retryCount < 1;

    if (shouldSearchWeb) {
        reviewStatus = "SEARCH_WEB";
        console.log(`   └─ 上下文精确率 ${(context_precision * 100).toFixed(1)}% < 30%，判定为知识库脱靶，触发外网搜索`);
    }
    // 判断 2：已达到熔断上限 → 强制结束
    else if (retryCount >= 2) {
        reviewStatus = "MELT";
        console.log(`   └─ 已达到最大重试次数 ${retryCount}，系统熔断`);
    }
    // 判断 3：忠实度和精确率都达标 → 通过
    else if (faithfulness >= 0.75 && context_precision >= 0.3) {
        reviewStatus = "APPROVED";
        console.log(`   └─ 忠实度 ${(faithfulness * 100).toFixed(1)}% >= 75%，上下文精确率 ${(context_precision * 100).toFixed(1)}% >= 30%，判定通过`);
    }
    // 判断 4：其他情况 → 打回重试
    else {
        reviewStatus = "REJECT";
        console.log(`   └─ 质量不达标，打回重试`);
    }

    // 3. 返回给 state，供路由使用
    return {
        reviewStatus,
        reviewFeedback: feedback,
        contextPrecision: context_precision
    };
}
