import { pipeline } from '@huggingface/transformers';
import ragDocuments from '../rag_demo/rag_documents.js';

import vectorService from '../utils/Vector_service.js';
import reranker from '../utils/reranker.js'
import evaluator from '../utils/evaluator.js'

import calculateSimilarity from '../utils/calculateSimilarity.js'
import toolsDefinitions from '../tools/searchKnowledge.js';
import { setupKnowledgeBase } from './init_db.js'
import { queryFromDB } from '../utils/chromaService.js';
import { rewriteQuery } from '../utils/query_rewrite.js'
import { recursiveCharacterSplitter } from '../utils/Splitter/recursiveCharacterSplitter.js'
import axios from 'axios';
import readline from 'readline';
import config from '../config/index.js';

// 创建终端输入输出流接口
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

// 获取 API 配置
const apiConfig = config.ai.deepseek;

let chatMessagesHistory = [
    { role: "system", content: "你是一个严谨的生产级大模型架构专家。请严格基于参考资料回答用户的问题。如果无法从资料中推导，请直接说不知道。" }
];

// 系统启动时，先把所有大文档循环切碎，生成一个扁平化的切片数组
let processedDocuments = [];
for (const doc of ragDocuments) {
    const chunks = recursiveCharacterSplitter(doc, 200, 20);
    processedDocuments.push(...chunks);
}
console.log(`原始文档 ${ragDocuments.length} 篇，智能切片后得到 ${processedDocuments.length} 个语义块。`);

// ========== RAG 检索 ==========
async function retrieveBestDoc(query, k = 3) {
    const relevantHistory = chatMessagesHistory.filter(m => m.role !== 'system');

    // 1. 拿到改写后的词
    const optimizedQuery = await rewriteQuery(query, relevantHistory);
    // 2. 拿着词去粗筛
    console.log(`\n【ChromaDB 实际检索使用的查询词】: "${optimizedQuery}"`);
    const coarseResults = await queryFromDB(optimizedQuery, 10);
    // 阶段一：ChromaDB 向量粗筛（扩大召回池）
    // 为了防止改写词跑偏或者向量模型不够细腻，我们将召回数量直接放宽到 10 条
    if (!coarseResults || coarseResults.length === 0) {
        console.log("  警告：向量库返回空数据！没有匹配到任何切片。");
        return { mergedResult: "", pureTexts: [] };
    }
    // 阶段二：本地 Reranker 交叉编码器深度精排
    // 我们将【原始问题 query】和【10条粗筛结果】一起送进精排模型进行打分
    const fineRankedResults = await reranker.rerank(optimizedQuery, coarseResults);
    // 设定精排置信度阈值（根据 MiniLM 模型特性，通常 0.15~0.3 是个很好的清洗线）
    const SCORE_THRESHOLD = 0.25;
    // 先清洗，后截取
    const filteredResults = fineRankedResults.filter(item => item.score >= SCORE_THRESHOLD);
    if (filteredResults.length === 0) {
        console.log(`\n [警告] 所有候选切片精排得分均低于 ${SCORE_THRESHOLD}，判定全为噪声，拒绝喂给大模型！`);
        // 触发 Corrective 思想：这里可以返回空，让外层大模型触发重写或认怂，防止越界幻觉
        return { mergedResult: "", pureTexts: [] };
    }

    // 此时再取 Top-K，拿到的就是名副其实的"高质量黄金切片"
    const topK = filteredResults.slice(0, k);
    console.log(`\n🔍 [漏斗级联检索 调试视窗] 精排洗牌完成（取 Top-${k} 送给大模型）：`);

    const mergedResult = topK
        .map((item, index) => `[相关资料 #${index + 1} (置信度: ${(item.score * 100).toFixed(1)}%)]: ${item.docText}`)
        .join("\n");

    return {
        mergedResult,
        pureTexts: topK.map(item => item.docText)
    };
}


async function generateAnswerByLLM(query) {
    let currentPrompt = query;
    chatMessagesHistory.push({ role: "user", content: currentPrompt });

    let currentTurnContexts = [];

    while (true) {
        try {
            const response = await axios.post(
                `${apiConfig.baseURL}/chat/completions`,
                {
                    model: apiConfig.chatModel,
                    messages: chatMessagesHistory,
                    tools: toolsDefinitions,
                    tool_choice: "auto"
                },
                {
                    headers: {
                        "Authorization": `Bearer ${apiConfig.apiKey}`,
                        "Content-Type": "application/json"
                    }
                }
            );
            const message = response.data.choices[0].message;

            if (message.tool_calls && message.tool_calls.length > 0) {
                chatMessagesHistory.push(message);
                const toolPromises = message.tool_calls.map(async (toolCall) => {
                    const toolName = toolCall.function.name;
                    const args = JSON.parse(toolCall.function.arguments);
                    console.log(` AI 决定调用工具: ${toolName}`);
                    if (toolName === "search_knowledge_base") {
                        const { mergedResult, pureTexts } = await retrieveBestDoc(args.query, 3);
                        if (pureTexts && pureTexts.length > 0) {
                            currentTurnContexts.push(...pureTexts);
                        }
                        return {
                            role: "tool",
                            tool_call_id: toolCall.id,
                            name: toolName,
                            content: mergedResult
                        };
                    }
                    return null;
                })
                const results = await Promise.all(toolPromises);
                chatMessagesHistory.push(...results);
                console.log("正在将查到的参考资料二次提交给大模型，生成最终解答...");
                continue;
            }
            else {
                const reply = message.content;
                const uniqueContexts = Array.from(new Set(currentTurnContexts));
                await evaluator.evaluate(query, uniqueContexts, reply);
                console.log(`\n AI:\n${reply}`);
                chatMessagesHistory.push({ role: "assistant", content: reply });
                break;
            }

        } catch (err) {
            console.error("请求失败:", err.response?.data || err.message);
            break;
        }
    }
}

async function startConversation() {
    console.log("ds驱动的多轮 RAG 机器人已就绪！输入 'exit' 退出对话。\n");
    const askQuestion = () => {
        rl.question('👤 ：', async (userInput) => {
            if (userInput.trim().toLowerCase() === 'exit') {
                rl.close();
                return;
            }

            if (userInput.trim() === '') {
                askQuestion();
                return;
            }

            // 调用你之前写好的具备记忆追加的 chatTurn 函数
            await generateAnswerByLLM(userInput);
            askQuestion();
        });
    }
    askQuestion();
}

/**
 * RAG 检索主逻辑
 */
async function main() {
    // await setupKnowledgeBase();
    await startConversation();
}
main();
