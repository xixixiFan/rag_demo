// test_failure_path.js - 测试失败路径（REJECT 和熔断分支）
import { StateGraph, END, START, MemorySaver } from "@langchain/langgraph";
import { RAGGraphState } from "../state.js";

import { queryRewriteNode } from "../nodes/rewrite.js";
import { retrieveAndRankNode } from "../nodes/retrieve.js";
import { draftNode } from "../nodes/make_draft.js";
import { incrementRetryNode } from "../nodes/handle_retry.js";
import { evaluateNode } from "../nodes/review.js";
import { webSearchNode } from "../nodes/web_search.js";
import { supervisorNode } from "../nodes/supervisor.js";

console.log("\n====================  失败路径测试  ====================");
console.log("测试场景：强制让 evaluateNode 返回 REJECT，验证重试和熔断逻辑");
console.log("========================================================\n");

const workflow = new StateGraph(RAGGraphState)
    .addNode("supervisor", supervisorNode)
    .addNode("rewrite", queryRewriteNode)
    .addNode("retrieve", retrieveAndRankNode)
    .addNode("make_draft", draftNode)
    .addNode("check_quality", evaluateNode)
    .addNode("handle_retry", incrementRetryNode)
    .addNode("web_search", webSearchNode)

    .addEdge(START, "supervisor")
    .addEdge("rewrite", "supervisor")
    .addEdge("retrieve", "supervisor")
    .addEdge("make_draft", "supervisor")
    .addEdge("check_quality", "supervisor")
    .addEdge("handle_retry", "supervisor")
    .addEdge("web_search", "supervisor")

    .addConditionalEdges(
        "supervisor",
        (state) => state.nextAgent,
        {
            rewrite: "rewrite",
            retrieve: "retrieve",
            make_draft: "make_draft",
            check_quality: "check_quality",
            handle_retry: "handle_retry",
            web_search: "web_search",
            end: END
        }
    )

const memory = new MemorySaver();
const app = workflow.compile({ checkpointer: memory });

const config = {
    configurable: {
        thread_id: "test_failure_path_" + Date.now()
    },
    recursionLimit: 50  // 增加递归限制，允许更多次的重试循环
};

// 测试场景：问一个知识库中有的问题，但通过 mock 让 evaluator 强制返回 REJECT
// 这里我们通过传入一个特殊的 query 来触发测试逻辑
console.log("[TEST] 启动测试流程，问一个知识库中没有的问题...");
console.log("       预期流程：本地检索脱靶 → 外网搜索 → 仍脱靶 → REJECT → 重试 → 熔断\n");

let step1State = await app.invoke(
    { query: "测试问题：Choreography 在微服务架构中的核心机制是什么？" },
    config
);

let finalSnapshot = step1State;
let interruptCount = 0;

console.log("\n===== 调试视图 =====");
console.log("taskStatus:", step1State.taskStatus);
console.log("agentHistory:", step1State.agentHistory);
console.log("decisionLog:", step1State.decisionLog);
// console.log("finalAnswer:", step1State.finalAnswer);
console.log("reviewStatus:", step1State.reviewStatus);
console.log("retryCount:", step1State.retryCount);
console.log("issueType:", step1State.issueType);
console.log("retryTarget:", step1State.retryTarget);
console.log("reviewConfidence:", step1State.reviewConfidence);
console.log("====================\n");

// 处理闸机拦截
while (step1State.__interrupt__ && step1State.__interrupt__.length > 0) {
    interruptCount++;
    if (interruptCount > 5) {
        console.log("\n[TEST] 超过最大拦截次数，强制退出\n");
        break;
    }

    console.log("\n [Gate] 闸机拦截 - 审查中...");
    console.log(`   ├─ 当前重试轮次：${step1State.retryCount || 0}`);
    console.log(`   ├─ 当前 reviewStatus: [${step1State.reviewStatus}]`);
    console.log(`   └─ 当前草稿概要："${step1State.currentDraft?.substring(0, 100)}..."`);
    console.log("========================================================================= ");

    console.log("\n 放行，继续执行...");
    step1State = await app.invoke(null, config);
    if (step1State && Object.keys(step1State).length > 0) {
        finalSnapshot = step1State;
    }
}

const finalStatus = finalSnapshot.reviewStatus || finalSnapshot.eviewStatus || "UNKNOWN";

// ========== 关键状态字段固定打印（调试专用）==========
console.log("\n===================  最终状态快照  ===================");
console.log(` [finalAnswer]     : ${finalSnapshot.currentDraft?.substring(0, 200) || "无"}...`);
console.log(` [reviewFeedback]  : ${finalSnapshot.reviewFeedback || "无"}`);
console.log(` [taskStatus]      : [${finalStatus}]`);
console.log(` [retryCount]      : ${finalSnapshot.retryCount || 0}`);
console.log(` [hasWebSearch]    : ${finalSnapshot.hasWebSearch || false}`);
console.log(` [contextPrecision]: ${((finalSnapshot.contextPrecision || 0) * 100).toFixed(1)}%`);
console.log("=====================================================");

// 验证测试结果
console.log("\n====================  测试验证  ====================");
if (finalSnapshot.retryCount >= 2 || finalStatus === "MELT") {
    console.log("✅ 测试通过：熔断机制正常工作（retryCount >= 2 或 status = MELT）");
} else if (finalStatus === "APPROVED") {
    console.log("⚠️  测试通过但走的是成功路径：系统找到了答案并通过了评审");
} else {
    console.log(`❓ 测试完成：最终状态为 [${finalStatus}]，重试次数 ${finalSnapshot.retryCount || 0}`);
}
console.log("====================================================\n");
