import axios from "axios";
import config from "./index.js";
import langfuse from "../utils/langfuse.js";

class ChatClient {
    constructor() {
        const apiConfig = config.ai.deepseek;

        this.client = axios.create({
            baseURL: apiConfig.baseURL,
            timeout: apiConfig.timeout || 30000,
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiConfig.apiKey}`
            }
        });

        this.client.interceptors.response.use(
            (response) => response,
            (error) => {
                console.error("[ChatClient] 请求大模型发生网络错误:", error.message);
                if (error.response) {
                    console.error(`[ChatClient] 响应状态：${error.response.status}, 响应数据:`, error.response.data);
                }
                return Promise.reject(error);
            }
        );
    }

    /**
     * 封装统一的对话方法
     * @param {Array} messages 符合 OpenAI 格式的聊天上下文数组
     * @param {Object} options 可选参数
     * @param {Object} options.trace Langfuse Trace 对象（可选，用于可观测性追踪）
     * @param {string} options.name Generation 名称（用于 Langfuse 显示）
     * @param {number} options.temperature 温度参数
     * @param {string} options.model 模型名称
     */
    async create(messages, options = {}) {
        const { trace, name = 'deepseek_chat', ...apiOptions } = options;

        // 创建 Langfuse Generation（如果有 trace）
        const generation = trace ? langfuse.generation({
            name,
            input: messages,
            model: apiOptions.model || config.ai.deepseek.chatModel,
            modelParameters: { temperature: apiOptions.temperature ?? 0.1 }
        }) : null;

        try {
            const apiConfig = config.ai.deepseek;

            const response = await this.client.post("/chat/completions", {
                model: apiOptions.model || apiConfig.chatModel,
                messages: messages,
                temperature: apiOptions.temperature ?? 0.1,
                ...apiOptions
            });

            const message = response.data.choices[0].message;
            const usage = response.data.usage;

            // 记录 Token 使用到 Langfuse
            if (generation && usage) {
                generation.update({
                    output: message,
                    usage: {
                        promptTokens: usage.prompt_tokens,
                        completionTokens: usage.completion_tokens,
                        totalTokens: usage.total_tokens
                    },
                    metadata: {
                        model: apiOptions.model || apiConfig.chatModel,
                        temperature: apiOptions.temperature ?? 0.1
                    }
                });
            } else if (generation) {
                // 有些模型可能不返回 usage，至少记录输出
                generation.update({
                    output: message,
                    metadata: {
                        model: apiOptions.model || apiConfig.chatModel,
                        temperature: apiOptions.temperature ?? 0.1,
                        usageAvailable: false
                    }
                });
            }

            // 1. 检查大模型是不是想调用工具了
            if (message.tool_calls && message.tool_calls.length > 0) {
                console.log("[ChatClient] 检测到大模型发出工具调用信号！");
                return message;
            }
            // 2. 正常文本回答，直接返回纯文本
            return message.content.trim();
        } catch (err) {
            // 记录错误到 Langfuse
            if (generation) {
                generation.update({
                    output: { error: err.message },
                    level: 'ERROR'
                });
            }
            console.error("[ChatClient] create 方法错误:", err.message);
            throw err;
        }
    }
}

export const chatClient = new ChatClient();
