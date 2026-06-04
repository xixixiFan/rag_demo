import { pipeline } from '@huggingface/transformers';
import ragDocuments from '../rag_demo/rag_documents.js';

import vectorService from '../utils/Vector_service.js';
import reranker from '../utils/reranker.js'
import evaluator from '../utils/evaluator.js'
import RedisMemoryManager from './utils/MemoryManager.js'

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

// ========== RAG 检索 ==========
async function retrieveBestDoc(query, chatHistory, k = 3) {
    const relevantHistory = chatHistory ? chatHistory.filter(m => m.role !== 'system') : [];

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

// 模拟多用户环境，定义一个当前会话 ID
const SESSION_ID = "user_12345";
const MEMORY_STRATEGY = "summary"; // 可选 'window' 或 'summary'

async function generateAnswerByLLM(query) {
    let currentTurnContexts = [];
    let chatMessagesHistory;
    let recentCount = 0;

    // 1. 从 Redis 读取历史（拉出来的历史是经过我们瘦身清洗的、最干净的 QA 链）
    if (MEMORY_STRATEGY === "window") {
        chatMessagesHistory = await RedisMemoryManager.getWindowMemory(SESSION_ID);
    } else {
        const summaryData = await RedisMemoryManager.getSummaryMemory(SESSION_ID, query);
        chatMessagesHistory = summaryData.fullMessagesForLLM;
        recentCount = summaryData.recentMessagesCount;
    }

    // 2. 构造当前用户输入的 User Message
    const userMsg = { role: "user", content: query };

    // 运行时数组压入 User 消息
    chatMessagesHistory.push(userMsg);

    // 【轨道分流一】：为当前轮创建一个临时持久化队列，用来临时记录大模型的中间件思考
    // 这样可以避免直接污染 chatMessagesHistory 传给下一轮，但能立刻同步写入当前轮的 Redis
    let currentTurnPersistQueue = [userMsg];

    // 3. 开启工具调用循环，直到拿到最终回答或发生错误
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
                { headers: { "Authorization": `Bearer ${apiConfig.apiKey}`, "Content-Type": "application/json" } }
            );
            const message = response.data.choices[0].message;

            // 情况 A：大模型决定调用工具
            if (message.tool_calls && message.tool_calls.length > 0) {
                console.log(`\n🤖 AI 决定调用工具...`);

                chatMessagesHistory.push(message);
                currentTurnPersistQueue.push(message);

                //  【核心修改点 1】：让 map 变成纯净函数，不污染任何外部变量
                const toolPromises = message.tool_calls.map(async (toolCall) => {
                    const toolName = toolCall.function.name;
                    const args = JSON.parse(toolCall.function.arguments);
                    console.log(`   [Tool Executing] -> ${toolName}`);

                    if (toolName === "search_knowledge_base") {
                        // 传入当前历史的快照
                        const { mergedResult, pureTexts } = await retrieveBestDoc(args.query, [...chatMessagesHistory], 3);

                        //  将纯文本和拼好的结果打包，作为 Promise 的 Resolve 结果返回
                        return {
                            isValid: true,
                            toolCallId: toolCall.id,
                            toolName: toolName,
                            mergedResult: mergedResult,
                            pureTexts: pureTexts || []

                        };
                    }
                    return { isValid: false };
                });

                //  【核心修改点 2】：在这里集结 3 路并发，此时网络请求全部彻底闭环
                const results = await Promise.all(toolPromises);

                //  【核心修改点 3】：在绝对安全的单线程同步循环中，一次性安全推入
                for (const res of results) {
                    if (res && res.isValid) {
                        // 1. 把真正的原始文本，平铺塞进我们准备审计的篮子里
                        if (res.pureTexts.length > 0) {
                            currentTurnContexts.push(...res.pureTexts);
                        }

                        // 2. 构造标本的 role: tool 消息，喂给当前轮的大模型看
                        const toolRes = {
                            role: "tool",
                            tool_call_id: res.toolCallId,
                            name: res.toolName,
                            content: res.mergedResult
                        };
                        chatMessagesHistory.push(toolRes);

                        // 3. 构造脱敏后的 role: tool 消息，准备塞进 Redis，彻底阻断下一轮污染
                        const optimizedToolRes = {
                            ...toolRes,
                            content: `[已完成内部知识库检索，针对子查询已成功召回 ${res.pureTexts.length} 个相关切片片段]`
                        };
                        currentTurnPersistQueue.push(optimizedToolRes);
                    }
                }
                console.log(`  资料已就位（当前已累积收集 ${currentTurnContexts.length} 个核心审计切片），重新提交给大模型...`);
                continue;
            }
            // 情况 B：拿到最终文本回答
            else {
                const reply = message.content;
                console.log(`\n AI:\n${reply}`);

                const assistantMsg = { role: "assistant", content: reply };
                currentTurnPersistQueue.push(assistantMsg);

                // 对当前轮多波循环累积下来的 pureTexts 进行严格清洗去重
                const uniqueContexts = Array.from(new Set(currentTurnContexts.filter(c => c && c.trim().length > 0)));

                console.log(`\n===================  RAGAS 正在执行实时审计 ===================`);
                console.log(` 交付给裁判官的独占参考资料切片共: ${uniqueContexts.length} 条`);

                // 交付审计
                await evaluator.evaluate(query, uniqueContexts, reply);

                // 保存无噪历史进 Redis
                for (const msgToStorage of currentTurnPersistQueue) {
                    await RedisMemoryManager.appendMessage(MEMORY_STRATEGY, SESSION_ID, msgToStorage);
                }

                // 内存裁剪
                if (MEMORY_STRATEGY === "window") {
                    await RedisMemoryManager.trimWindowMemoryIfNeeded(SESSION_ID, 3);
                } else {
                    const currentHistory = await RedisMemoryManager.getSummaryMemory(SESSION_ID, query);
                    await RedisMemoryManager.updateSummaryIfNeeded(SESSION_ID, currentHistory.recentMessagesCount);
                }
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
    await setupKnowledgeBase();
    await startConversation();
}
main();
