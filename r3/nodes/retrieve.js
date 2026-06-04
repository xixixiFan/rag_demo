// nodes/retrieve.js
import { queryFromDB } from "../../utils/chromaService.js";
import reranker from '../../utils/reranker.js';
import config from "../../config/index.js";

/**
 * @param {*} state
 * rewrite 节点返回 currentRewrites，包含改写或原本的 query 关键词数组
 */
export async function retrieveAndRankNode(state) {
   console.log(`\n [Retrieve Node] 正在进行检索...`);

   // 1. 从 state 里拿到 rewrite 节点产出的 currentRewrites
   // 根据 rewrite.js 返回格式：{ currentRewrites: [rewrittenKeyword] }
   const currentRewrites = state.currentRewrites;

   // 处理两种可能的格式：字符串数组 或 字符串
   let rewrites = [];
   if (Array.isArray(currentRewrites)) {
       // 如果是数组，取第一个元素（如果有多个改写词，可以都用于检索）
       if (typeof currentRewrites[0] === 'string') {
           rewrites = currentRewrites; // ['关键词 1', '关键词 2']
       } else if (Array.isArray(currentRewrites[0])) {
           rewrites = currentRewrites[0]; // [['关键词 1', '关键词 2']]
       }
   } else if (typeof currentRewrites === 'string') {
       rewrites = [currentRewrites]; // '关键词'
   }

   if (rewrites.length === 0) {
      console.warn(" 没有可用的 rewrite 关键词，检索节点无法执行！");
      return { retrievedContexts: [] };
   }

   console.log(`   └─ 使用改写关键词：[${rewrites.join(', ')}]`);

   // 2. 向量粗选：调取 ChromaDB 粗筛，获取 topK 个候选
   const topK = config?.rag?.topK || 5;
   const candidates = await queryFromDB(rewrites, topK);

   if (!candidates || candidates.length === 0) {
      console.warn(`   └─ ChromaDB 未检索到任何相关技术片段。`);
      return { retrievedContexts: [] };
   }

   // 3. 交叉精排：把粗选的候选切片拿去喂给 Reranker 模型进行逐条打分重排序
   console.log(`   └─ 正在对粗选的 ${candidates.length} 个候选切片进行 Reranker 交叉精排...`);
   const rerankedList = await reranker.rerank(state.query, candidates);

   // 4. 截取过滤：根据阈值过滤，并拿取最终的精排数量
   const threshold = config?.rag?.similarityThreshold || 0.55;
   const finalTopK = config?.rag?.rerankTopK || 3;
   const goldChunks = rerankedList
      .filter(item => item.score >= threshold)
      .slice(0, finalTopK)
      .map(item => item.docText);

   console.log(`   └─ 级联洗牌完成：粗筛 ${candidates.length} 条 → 过滤精排保留 ${goldChunks.length} 条`);

   return { retrievedContexts: goldChunks };
}
