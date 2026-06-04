// index.js
import { StateGraph, END, START, MemorySaver } from "@langchain/langgraph";
import { RAGGraphState } from "./state.js";

import { queryRewriteNode } from "./nodes/rewrite.js";
import { retrieveAndRankNode } from "./nodes/retrieve.js";
import { draftNode } from "./nodes/make_draft.js";
import { incrementRetryNode } from "./nodes/handle_retry.js";
import { evaluateNode } from "./nodes/review.js";
import { webSearchNode } from "./nodes/web_search.js";

import { supervisorNode } from "./nodes/supervisor.js";



const workflow = new StateGraph(RAGGraphState)
    // 1. 定义节点：改写、检索、草稿生成、评审打分、重试计数
    .addNode("supervisor", supervisorNode)
    .addNode("rewrite", queryRewriteNode)
    .addNode("retrieve", retrieveAndRankNode)
    .addNode("make_draft", draftNode)
    .addNode("check_quality", evaluateNode)
    .addNode("handle_retry", incrementRetryNode)
    .addNode("web_search", webSearchNode)

    // 2. 定义边：Supervisor 是中央调度者，其他节点都要把结果返回给 Supervisor，由 Supervisor 决定下一步派发给哪个节点继续处理
    .addEdge(START, "supervisor")
    .addEdge("rewrite", "supervisor")
    .addEdge("retrieve", "supervisor")
    .addEdge("make_draft", "supervisor")
    .addEdge("check_quality", "supervisor")
    .addEdge("handle_retry", "supervisor")
    .addEdge("web_search", "supervisor")

    // 3. 智能分流：在 check_quality 节点根据 evaluateNode 返回的 status 做纯路由
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

// 4. 挂载持久化检查点，并设置人类介入闸机
const memory = new MemorySaver();
const app = workflow.compile({
    checkpointer: memory,
});

const config = {
    configurable: {
        thread_id: "scau_auto_agent_run_perfect_v103"
    }
};


let step1State = await app.invoke(
    { query: "如何理解Choreography机制？" },
    config
);
let finalSnapshot = step1State;

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



// 使用 while 循环自动处理【闸机拦截】，模拟人类在后台不断点击"放行"
while (step1State.__interrupt__ && step1State.__interrupt__.length > 0) {
    console.log("\n [Gate] 闸机前精准拦截！自动化控制台进行审查...");
    console.log(`   ├─ 当前重试轮次：${step1State.retryCount || 0}`);
    console.log(`   └─ 当前大篮子里的最新草稿概要:\n"${step1State.currentDraft?.substring(0, 150)}..."`);
    console.log("========================================================================= ");

    console.log("\n 唤醒并放行传送带，让草稿厂继续博弈...");
    // 再次传入 null，跨过当前拦截的节点，继续向下狂奔
    step1State = await app.invoke(null, config);
    if (step1State && Object.keys(step1State).length > 0) {
        finalSnapshot = step1State; // 每次放行后都更新最终状态快照
    }
}

const finalStatus = finalSnapshot.taskStatus || "APPROVED";

console.log("\n===================  最终状态快照  ===================");
console.log(` [finalAnswer]     : ${finalSnapshot.currentDraft?.substring(0, 200) || "无"}...`);
console.log(` [reviewFeedback]  : ${finalSnapshot.reviewFeedback || "无"}`);
console.log(` [taskStatus]      : [${finalStatus}]`);
console.log(` [retryCount]      : ${finalSnapshot.retryCount || 0}`);
console.log(` [hasWebSearch]    : ${finalSnapshot.hasWebSearch || false}`);
console.log(` [contextPrecision]: ${((finalSnapshot.contextPrecision || 0) * 100).toFixed(1)}%`);
console.log("=====================================================");



