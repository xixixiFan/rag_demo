import axios from "axios";
import config from "./index.js";

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
                // 统一的错误拦截
                console.error("[ChatClient] 请求大模型发生网络错误:", error.message);
                if (error.response) {
                    console.error(`[ChatClient] 响应状态: ${error.response.status}, 响应数据:`, error.response.data);
                }
                return Promise.reject(error);
            }
        );
    }

    /**
     * 封装统一的对话方法
     * @param {Array} messages 符合OpenAI格式的聊天上下文数组
     * @param {Object} options 可选参数，如 temperature
     */
    async create(messages, options = {}) {
        try {
            const apiConfig = config.ai.deepseek;
            
            const response = await this.client.post("/chat/completions", {
                model: options.model || apiConfig.chatModel,
                messages: messages,
                temperature: options.temperature ?? 0.1,
                ...options
            });
            const message = response.data.choices[0].message;

            // 1. 检查大模型是不是想调用工具了
            if (message.tool_calls && message.tool_calls.length > 0) {
                console.log("[ChatClient] 检测到大模型发出工具调用信号！");
                // 如果是工具调用，必须返回完整的 message 对象（包含 tool_calls 和 arguments）
                return message;
            }
            // 2. 正常文本回答，直接返回纯文本
            return message.content.trim();
        } catch (err) {
            console.error("[ChatClient] create 方法错误:", err.message);
            throw err;
        }
    }
}

export const chatClient = new ChatClient();
