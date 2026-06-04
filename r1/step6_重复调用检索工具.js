import { pipeline } from '@huggingface/transformers';
import ragDocuments from '../rag_demo/rag_documents.js';
import vectorService from '../utils/Vector_service.js';
import calculateSimilarity from '../utils/calculateSimilarity.js';
import toolsDefinitions from '../tools/searchKnowledge.js';
import { rewriteQuery } from '../utils/query_rewrite.js';
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
async function retrieveBestDoc(query, k = 3) {
    const queryVector = await vectorService.embed(query);
    let docScores = [];

    for (let i = 0; i < ragDocuments.length; i++) {
        const docText = ragDocuments[i];
        const docVector = await vectorService.embed(docText);
        const score = calculateSimilarity(queryVector, docVector);
        docScores.push({ docText, score });
    }

    docScores.sort((a, b) => b.score - a.score);
    const topK = docScores.slice(0, k);
    const mergedResult = topK
        .map((item, index) => `[相关资料 #${index + 1} (置信度: ${(item.score * 100).toFixed(1)}%)]: ${item.docText}`)
        .join("\n");

    console.log(`【参考资料】："${mergedResult}",\n【用户问题】：${query}`);
    return mergedResult;
}


async function generateAnswerByLLM(query) {
    const apiConfig = config.ai.deepseek;
    
    let currentPrompt = await rewriteQuery(query,chatMessagesHistory);
    chatMessagesHistory.push({ role: "user", content: currentPrompt });

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
                    console.log(`🤖 AI 决定调用工具: ${toolName}`);
                    if (toolName === "search_knowledge_base") {
                        const toolResult = await retrieveBestDoc(args.query, 3);
                        return {
                            role: "tool",
                            tool_call_id: toolCall.id,
                            name: toolName,
                            content: toolResult
                        };
                    }
                    return null;
                })

                const results = await Promise.all(toolPromises);
                chatMessagesHistory.push(...results);
                console.log("⏳ 📡 正在将查到的参考资料二次提交给大模型，生成最终解答...");
                continue;
            }
            else {
                const reply = message.content;
                console.log(`\n🤖 AI:\n${reply}`);
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
    startConversation();
}
main();
