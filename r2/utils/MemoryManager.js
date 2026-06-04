import { createClient } from 'redis';
import axios from 'axios';
import config from '../../../config/index.js';

// 初始化 Redis 客户端
const redisClient = createClient({ 
    url: config.redis.url,
    legacyMode: true  // 兼容旧版本 Redis（< 6.0）
});

redisClient.on('error', (err) => console.error('Redis 客户端错误', err));
redisClient.on('connect', () => console.log('✅ Redis 连接成功'));

/**
 * Redis 记忆管理器
 * 支持两种策略：window（滑动窗口）和 summary（摘要压缩）
 */
export default class RedisMemoryManager {
    
    /**
     * 初始化 Redis 连接
     */
    static async initRedis() {
        if (!redisClient.isOpen) {
            await redisClient.connect();
        }
    }

    /**
     * ==================== Window Memory（滑动窗口）====================
     */

    /**
     * 获取窗口记忆（最近 N 轮对话）
     * @param {string} sessionId - 会话 ID
     * @param {number} maxTurns - 最大保留轮数
     */
    static async getWindowMemory(sessionId, maxTurns = 3) {
        const key = `chat:window:${sessionId}`;
        const redisMemory = await redisClient.lRange(key, 0, -1);
        let messages = redisMemory.map(item => JSON.parse(item));

        // 如果是新会话，自动初始化 System Prompt
        if (messages.length === 0) {
            const SystemPrompt = {
                role: "system",
                content: "你是一个资深的AI助手，名字叫大白。你擅长RAG（检索增强生成）技术、企业知识库问答、以及各类技术问题解答。"
            };
            await redisClient.rPush(key, JSON.stringify(SystemPrompt));
            messages.push(SystemPrompt);
        }

        console.log(`📖 Window Memory: 从 Redis 读取了 ${messages.length} 条历史消息`);
        return messages;
    }

    /**
     * 追加消息到窗口记忆
     */
    static async appendMessage(sessionId, message) {
        const key = `chat:window:${sessionId}`;
        await redisClient.rPush(key, JSON.stringify(message));
        await redisClient.expire(key, 60 * 60 * 24 * 7); // 7天过期
    }

    /**
     * 后台自动裁剪窗口记忆
     */
    static async trimWindowMemoryIfNeeded(sessionId, maxTurns = 3) {
        const key = `chat:window:${sessionId}`;
        const redisMemory = await redisClient.lRange(key, 0, -1);
        const messages = redisMemory.map(item => JSON.parse(item));

        // 统计用户消息数量（计算真实 QA 轮数）
        const userMessages = messages.filter(m => m.role === 'user');

        if (userMessages.length > maxTurns) {
            // 找到最老的 System Prompt
            const systemMessage = messages.find(m => m.role === 'system');
            if (!systemMessage) {
                console.warn('⚠️  未找到 System Prompt，跳过裁剪');
                return;
            }

            // 保留 System Prompt + 最近 maxTurn 轮对话
            const userIndices = messages.map((m, i) => m.role === 'user' ? i : -1).filter(i => i !== -1);
            const keepStartIndex = userIndices[userIndices.length - maxTurns];
            const recentMessages = messages.slice(keepStartIndex);
            const trimmedMessages = [systemMessage, ...recentMessages];

            console.log(`✂️  Window Memory: 裁剪历史记录 ${messages.length} → ${trimmedMessages.length} 条`);

            // 原子操作：先删后加
            const multi = redisClient.multi();
            multi.del(key);
            multi.rPush(key, ...trimmedMessages.map(m => JSON.stringify(m)));
            await multi.exec();
        }
    }

    /**
     * ==================== Summary Memory（摘要压缩）====================
     */

    /**
     * 获取摘要记忆（摘要 + 最近几条原始消息）
     */
    static async getSummaryMemory(sessionId, currentQuery = '') {
        const summaryKey = `chat:summary:text:${sessionId}`;
        const historyKey = `chat:summary:list:${sessionId}`;

        let currentSummary = await redisClient.get(summaryKey);
        if (!currentSummary) {
            currentSummary = "无";
        }

        // 读取最近 6 条消息
        const recentMessages = await redisClient.lRange(historyKey, -6, -1);
        const parsedMessages = recentMessages.map(item => JSON.parse(item));

        console.log(`📖 Summary Memory: 摘要 ${currentSummary.length} 字符 + 最近 ${parsedMessages.length} 条消息`);

        return {
            currentSummary,
            recentMessages: parsedMessages,
            fullMessagesForLLM: [
                { role: "system", content: `之前的【对话摘要】：${currentSummary}\n\n请基于以上摘要，结合当前问题给出回答。如果摘要中没有相关信息，请基于你的知识回答。` },
                ...parsedMessages,
                { role: "user", content: currentQuery }
            ]
        };
    }

    /**
     * 追加消息到摘要列表
     */
    static async appendToSummaryList(sessionId, message) {
        const historyKey = `chat:summary:list:${sessionId}`;
        await redisClient.rPush(historyKey, JSON.stringify(message));
        await redisClient.expire(historyKey, 60 * 60 * 24 * 7);
    }

    /**
     * 触发摘要压缩（当历史消息达到阈值时）
     */
    static async updateSummaryIfNeeded(sessionId) {
        const summaryKey = `chat:summary:text:${sessionId}`;
        const historyKey = `chat:summary:list:${sessionId}`;

        // 读取历史消息数量
        const messageCount = await redisClient.lLen(historyKey);

        // 如果超过 6 条，触发压缩
        if (messageCount >= 6) {
            const oldSummary = await redisClient.get(summaryKey) || "无";
            const recentMessages = await redisClient.lRange(historyKey, 0, -1);
            const parsedMessages = recentMessages.map(item => JSON.parse(item));

            // 调用 LLM 生成新摘要
            const compressRes = await axios.post(
                `${config.ai.deepseek.baseURL}/chat/completions`,
                {
                    model: config.ai.deepseek.chatModel,
                    messages: [
                        { role: "system", content: "你是一个记忆压缩助手。你的任务是将对话历史压缩成简短的摘要。" },
                        { role: "user", content: `【旧的摘要】：${oldSummary}\n\n【新对话】：${JSON.stringify(parsedMessages, null, 2)}\n\n请生成新的摘要，总结对话的核心内容和关键信息。` }
                    ],
                    temperature: 0.3,
                    max_tokens: 500
                },
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${config.ai.deepseek.apiKey}`
                    }
                }
            );

            const newSummary = compressRes.data.choices[0].message.content;

            console.log(`📝 Summary Memory: 压缩 ${messageCount} 条消息为摘要`);

            // 原子操作：更新摘要 + 清空历史
            const multi = redisClient.multi();
            multi.set(summaryKey, newSummary);
            multi.del(historyKey);
            await multi.exec();
        }
    }

    /**
     * ==================== 通用工具====================
     */

    /**
     * 清除会话记忆
     */
    static async clearMemory(sessionId) {
        const keys = [
            `chat:window:${sessionId}`,
            `chat:summary:text:${sessionId}`,
            `chat:summary:list:${sessionId}`
        ];

        await Promise.all(keys.map(key => redisClient.del(key)));
        console.log(`🗑️  Memory: 清除会话 ${sessionId} 的所有记忆`);
    }

    /**
     * 获取会话记忆统计
     */
    static async getMemoryStats(sessionId) {
        const windowKey = `chat:window:${sessionId}`;
        const summaryKey = `chat:summary:text:${sessionId}`;
        const historyKey = `chat:summary:list:${sessionId}`;

        const [windowSize, summaryLength, historySize] = await Promise.all([
            redisClient.lLen(windowKey),
            redisClient.get(summaryKey),
            redisClient.lLen(historyKey)
        ]);

        return {
            windowStrategy: {
                messageCount: windowSize
            },
            summaryStrategy: {
                summaryLength: summaryLength?.length || 0,
                historyCount: historySize
            }
        };
    }
}

// 初始化 Redis 连接
RedisMemoryManager.initRedis().catch(console.error);
