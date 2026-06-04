// index.js
import { StateGraph, END, START, MemorySaver } from "@langchain/langgraph";
import { RAGGraphState } from "./state.js";

import { queryRewriteNode } from "./nodes/rewrite.js";
import { retrieveAndRankNode } from "./nodes/retrieve.js";
import { draftNode, incrementRetryNode } from "./nodes/draft.js";
import { check_quality } from "./nodes/evaluate.js";
import { webSearchNode } from "./nodes/webSearch.js";


const workflow = new StateGraph(RAGGraphState)
    // 1. 定义节点：改写、检索、草稿生成、评审打分、重试计数
    .addNode("rewrite", queryRewriteNode)
    .addNode("retrieve", retrieveAndRankNode)
    .addNode("make_draft", draftNode)
    .addNode("check_quality", check_quality)
    .addNode("handle_retry", incrementRetryNode)
    .addNode("web_search", webSearchNode)
    // 2. 定义边：顺序流转 + 智能分流（根据裁判官评审结果分流到放行、打回重试或系统熔断）
    .addEdge(START, "rewrite")
    .addEdge("rewrite", "retrieve")
    .addEdge("retrieve", "make_draft")
    .addEdge("make_draft", "check_quality")
    .addEdge("handle_retry", "make_draft") // 打回重试流：从 handle_retry 回到 make_draft 重新生成草稿
    .addEdge("web_search", "make_draft")   // 外网查完后，重新送回草稿厂做完美打磨
    // 3. 智能分流：在 check_quality 节点根据 evaluateNode 返回的 status 做纯路由
    .addConditionalEdges(
        "check_quality",
        (state) => {
            const currentStatus = state.reviewStatus;
            const contextPrecision = state.contextPrecision ?? 0;

            console.log(`\n[Router: 智能分流] 正在读取裁判结果... 状态：[${currentStatus}], 上下文精确率：[${(contextPrecision * 100).toFixed(1)}%]`);

            // 纯路由逻辑：只根据 status 做转发，不做业务判断
            switch (currentStatus) {
                case "SEARCH_WEB":
                    console.log(`   └─  判定为知识库脱靶，流向 [外网搜索兜底]`);
                    return "search";
                case "APPROVED":
                    console.log(`   └─ 裁判官判定通过，流向 [终点]`);
                    return "approved";
                case "MELT":
                    console.log(`   └─ 系统熔断，流向 [终点]`);
                    return "melt";
                case "REJECT":
                default:
                    console.log(`   └─ 质检未通过，流向 [打回计数器]`);
                    return "reject";
            }
        },
        {
            search: "web_search",
            approved: END,
            melt: END,
            reject: "handle_retry"
        }
    );

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
    { query: "如何理解滑动窗口算法中的左右双指针扩张与收缩机制？" },
    config
);

let finalSnapshot = step1State;

// 使用 while 循环自动处理【闸机拦截】，模拟人类在后台不断点击"放行"
while (step1State.__interrupt__ && step1State.__interrupt__.length > 0) {
    console.log("\n [Gate] 闸机前精准拦截！人类或自动化控制台进行审查...");
    console.log(`   ├─ 当前重试轮次：${step1State.retryCount || 0}`);
    console.log(`   └─ 当前大篮子里的最新草稿概要:\n"${step1State.currentDraft?.substring(0, 150)}..."`);
    console.log("========================================================================= ");

    console.log("\n 唤醒并放行传送带，让大模型裁判官/草稿厂继续博弈...");
    // 再次传入 null，跨过当前拦截的节点，继续向下狂奔
    step1State = await app.invoke(null, config);
    if (step1State && Object.keys(step1State).length > 0) {
        finalSnapshot = step1State; // 每次放行后都更新最终状态快照
    }
}

const finalStatus = finalSnapshot.reviewStatus || finalSnapshot.eviewStatus || "APPROVED";


console.log("\n===========================================================");
console.log(" [工业级 Self-RAG 智能体] 彻底冲出闸机，完美执行完结！");
console.log(` 最终重试总次数：${finalSnapshot.retryCount} 次`);
console.log(` 最终裁判结论  : [${finalSnapshot.reviewStatus}]`);
console.log(` 最终完美输出  :\n${finalSnapshot.currentDraft}`);
console.log("===========================================================");
