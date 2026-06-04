import { pipeline } from '@huggingface/transformers';
import ragDocuments from '../rag_demo/rag_documents.js';
import vectorService from '../utils/Vector_service.js';
import calculateSimilarity from '../utils/calculateSimilarity.js';
import axios from 'axios';
import readline from 'readline';
import config from '../config/index.js';

// 创建终端输入输出流接口
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

let chatMessagesHistory = [
    { role: "system", content: "你是一个严谨的生产级大模型架构专家。请严格基于参考资料回答用户的问题。如果无法从资料中推导，请直接说不知道。" }
];


// ========== RAG 检索 ==========
async function retrieveBestDoc(query) {
    // 只算 query 向量，文档向量应该预计算缓存（见下方优化）
    const queryVec = await vectorService.embed(query);
    let bestScore = 0;
    let bestDoc = "";

    for (let i = 0; i < ragDocuments.length; i++) {
        const docVec = await vectorService.embed(ragDocuments[i]);
        const score = calculateSimilarity(queryVec, docVec);
        if (score > bestScore) {
            bestScore = score;
            bestDoc = ragDocuments[i];
        }
    }
    return bestDoc;
}


async function generateAnswerByLLM(query, isFirstTurn = false) {
    const apiConfig = config.ai.deepseek;
    let currentPrompt = query;

    if (isFirstTurn) {
        const reference = await retrieveBestDoc(query);
        console.log(`命中: "${reference.substring(0, 40)}..."`);
        currentPrompt = `【参考资料】：\n"${reference}"\n\n【用户问题】：\n${query}`;
    }

    chatMessagesHistory.push({ role: "user", content: currentPrompt });

    try {
        const response = await axios.post(
            `${apiConfig.baseURL}/chat/completions`,
            {
                model: apiConfig.chatModel,
                messages: chatMessagesHistory
            },
            {
                headers: {
                    "Authorization": `Bearer ${apiConfig.apiKey}`,
                    "Content-Type": "application/json"
                }
            }
        );

        const reply = response.data.choices[0].message.content;
        console.log(`\n🤖 AI:\n${reply}`);
        chatMessagesHistory.push({ role: "assistant", content: reply });
    } catch (err) {
        console.error("请求失败:", err.response?.data || err.message);
    }
}

async function startConversation() {
    console.log("ds驱动的多轮 RAG 机器人已就绪！输入 'exit' 退出对话。\n");
    let isFirstTurn = true; // 第一轮进行 RAG 检索，后续追问纯靠历史记录
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
            await generateAnswerByLLM(userInput, isFirstTurn);

            isFirstTurn = false;
            askQuestion();
        });
    }
    askQuestion();
}

/**
 * RAG 检索主逻辑
 */
async function main() {
    startConversation();
}
main();
