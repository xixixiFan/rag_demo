import { Annotation, StateGraph, END, START, MemorySaver } from "@langchain/langgraph";
/**
 * MockRAGState的字段设计：
- query: 存储用户的原始问题，类型是字符串。
- currentDraft: 存储当前节点生成的草稿回答，类型是字符串。
- retryCount: 存储当前的重试次数，类型是数字。每当草稿被评为不及格时，这个字段会增加。
- criticScore: 存储质检员打的分数，类型是数字。这个分数决定了是否需要重试。

 * Annotation表示这个字段是一个可被节点读写的状态变量，StateGraph则是整个状态图的定义,GraphNode是图中的一个节点，RouterNode是一个特殊的节点，用来根据状态值决定下一步流向哪里。
   Annotation.Root表示这是状态图的根节点，里面定义了我们需要的状态字段和它们的初始值或更新规则。
 */
const MockRAGState = Annotation.Root({
    query: Annotation(),
    currentDraft: Annotation(),
    retryCount: Annotation({
        // 这个reducer的作用是：每次有新的值传入时，都会把它和当前状态中的retryCount进行累加，最终更新retryCount的值。这样我们就可以在状态图中轻松地实现重试次数的自动累加了。
        reducer: (x, y) => y,
        default: () => 0
    }),
    criticScore: Annotation()
});

// 节点 A：草稿加工厂
async function draftNode(state) {
    console.log(`\n🤖 [Node: Draft] 收到篮子！当前重试次数: ${state.retryCount}`);
    console.log(`   └─ 用户问题是: "${state.query}"`);

    // 模拟大模型加工：每次重试，生成的草稿都会变好一点
    let mockDraft = `这是针对 [${state.query}] 的第 ${state.retryCount + 1} 版草稿回答。`;

    // 往篮子里更新草稿
    return {
        currentDraft: mockDraft,
        // retryCount: state.retryCount + 1
    };
}

// 节点 B：质量质检员
async function evaluateNode(state) {
    console.log(`\n⚖️ [Node: Evaluate] 正在对草稿进行打分...`);
    const currentCount = state.retryCount || 0;
    // 模拟裁判官：第一轮打 60 分（不及格），第二轮打 75 分（不及格），第三轮打 90 分（及格）
    let mockScore = 60;
    if (state.retryCount === 1) mockScore = 75;
    if (state.retryCount === 2) mockScore = 90;

    console.log(`   └─ 质检评分: ${mockScore} 分`);

    // 往篮子里更新分数
    return {
        criticScore: mockScore
    };
}

// 🟩 新增一个极其纯粹的节点：专门负责给被打回的篮子盖戳计数的“打回处理厂”
async function incrementRetryNode(state) {
    console.log(`\n🔄 [Node: Remake] 🛠️ 质检确认不及格！正式将重试计数 + 1...`);
    return { 
        retryCount: (state.retryCount || 0) + 1 
    };
}

// 焊线阶段调整：
const workflow = new StateGraph(MockRAGState)
    .addNode("make_draft", draftNode)
    .addNode("check_quality", evaluateNode)
    .addNode("handle_retry", incrementRetryNode) 

    .addEdge(START, "make_draft")
    .addEdge("make_draft", "check_quality")
    // 2. 让 handle_retry 执行完后，雷打不动地直接滑回 make_draft
    .addEdge("handle_retry", "make_draft") 

    // 3. 部署交警
    .addConditionalEdges(
        "check_quality",
        (state) => {
            console.log(`\n🚦 [Router: 交警] 正在检查质检分数: ${state.criticScore} 分...`);
            if (state.criticScore >= 80) return "approved";
            if ((state.retryCount || 0) >= 2) return "melt"; // 熔断
            return "reject";
        },
        {
            approved: END,
            melt: END,
            reject: "handle_retry"
        }
    );

// 这里我们用一个内存储存器来记录状态变迁的历史，方便我们事后审计和分析
const memory = new MemorySaver();
// 编译图状态机
const app = workflow.compile({
    checkpointer: memory,
    interruptBefore: ["check_quality"]
});

// ====== 执行验证流动 ======
const config = { configurable: { thread_id: "user_session_12345" } };

console.log("🚀 【步骤 1】图状态机第一次启动，丢入用户提问...");
const step1State = await app.invoke({ query: "如何拒绝低质量片段？" }, config);
console.log(`\n🛑 闸机自动拦截！当前草稿: "${step1State.currentDraft}"`);
console.log("=========================================================");

console.log("\n⏳ 【步骤 2】人类确认放行，恢复断点进度...");
// 恢复后会：进evaluate(60分) -> 交警判reject -> 进handle_retry(计数变1) -> 自发进draftNode(生成第2版) -> 第二轮准备进evaluate前再次被拦截！
const step2State = await app.invoke(null, config);
console.log(`\n🛑 闸机第二次自动拦截！当前草稿: "${step2State.currentDraft}"`);
console.log("=========================================================");

console.log("\n⏳ 【步骤 3】人类第二次放行，恢复断点进度...");
// 恢复后会：进evaluate(75分) -> 交警判reject -> 进handle_retry(计数变2) -> 自发进draftNode(生成第3版) -> 第三轮准备进evaluate前第三次被拦截！
const step3State = await app.invoke(null, config);
console.log(`\n🛑 闸机第三次自动拦截！当前草稿: "${step3State.currentDraft}"`);
console.log("=========================================================");

console.log("\n⏳ 【步骤 4】人类第三次放行，最终冲线...");
// 恢复后会：进evaluate(90分) -> 交警判approved -> 走向 END 完结
const finalState = await app.invoke(null, config);

console.log("\n=================================");
console.log("🎉 整个图流水线彻底完结！最终残留状态：");
console.log(JSON.stringify(finalState, null, 2));