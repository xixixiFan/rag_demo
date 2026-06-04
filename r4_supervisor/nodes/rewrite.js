// nodes/rewrite.js
import { rewriteQuery } from "../../utils/query_rewrite.js";

export async function queryRewriteNode(state) {
    console.log(`\n [Node: Rewrite] 正在针对向量库优化提问关键词...`);
    const rawQuery = state.query;

    // 调用你现有的大模型改写逻辑
    const rewrittenKeyword = await rewriteQuery(rawQuery, []);

    // 我们把结果包成数组形式放入卡槽
    const agentHistory = [...(state.agentHistory || []), "rewrite"];
    return { 
        currentRewrites: [rewrittenKeyword],
        agentHistory
    };
}