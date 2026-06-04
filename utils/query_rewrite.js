import axios from 'axios';
import config from '../config/index.js';

/**
 * 查询改写函数 - 使用 LLM 优化搜索关键词
 * @param {string} query - 用户原始查询
 * @param {Array} chatHistory - 对话历史
 * @returns {Promise<string>} - 改写后的查询词
 */
export async function rewriteQuery(query, chatHistory = []) {
    try {
        const response = await axios.post(
            `${config.ai.deepseek.baseURL}/chat/completions`,
            {
                model: config.ai.deepseek.chatModel,
                messages: [
                    {
                        role: "system",
                        content: `你是专业的RAG检索优化助手。你的任务是将用户的口语化问题改写成更适合向量数据库检索的精准关键词。

改写要求：
1. 提取核心实体和概念（人名、技术名词、专有名词）
2. 补充可能的同义词和相关术语
3. 去除口语化的修饰词和语气词
4. 如果问题过于模糊，适当扩展和具体化
5. 保留原问题的语义意图

输出格式：
直接输出改写后的关键词，用空格分隔，不要解释，不要加引号。

示例：
输入："那个做AI大模型的公司叫什么来着"
输出："AI大模型公司 名称 商汤科技 旷视科技"

输入："怎么让RAG的回答更准啊"
输出："RAG检索精度 优化策略 准确率提升"`

                    },
                    {
                        role: "user",
                        content: `原始问题：${query}\n对话历史：${JSON.stringify(chatHistory.slice(-3))}\n\n请改写为适合检索的关键词：`
                    }
                ],
                temperature: 0.3,
                max_tokens: 100
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${config.ai.deepseek.apiKey}`
                }
            }
        );

        const rewrittenQuery = response.data.choices[0].message.content.trim();
        console.log(`Query Rewrite: "${query}" → "${rewrittenQuery}"`);
        return rewrittenQuery;

    } catch (error) {
        console.error('Query Rewrite 失败:', error.message);
        // 失败时返回原始查询
        return query;
    }
}

export default rewriteQuery;
