import axios from 'axios';
import config from '../config/index.js';

const toolsDefinitions = [
    {
        type: "function",
        function: {
            name: "get_current_weather",
            description: "获取给定位置的当前天气",
            parameters: {
                type: "object",
                properties: {
                    location: { type: "string", description: "格式为 '城市, 国家'，例如 '香港，中国'" }
                },
                required: ["location"]
            },
        }
    }
]

function getCurrentWeather(location) {
    if (location.includes("香港")) {
        return JSON.stringify({ temperature: "28°C", condition: "多云有阵雨", humidity: "85%" });
    } else if (location.includes("北京")) {
        return JSON.stringify({ temperature: "15°C", condition: "晴朗", humidity: "30%" });
    } else {
        return JSON.stringify({ temperature: "22°C", condition: "阴天", humidity: "60%" });
    }
}

async function runWeatherFlow() {
    const apiConfig = config.ai.deepseek;
    
    // 【步骤 1】初始化对话历史，放入用户的真实提问
    const messages = [
        { role: "user", content: "香港现在的天气怎么样？需要带伞吗？北京的呢？" }
    ];

    try {
        console.log(`🚀 用户提问: "${messages[0].content}"`);
        console.log("📡 正在发送第一次请求，让大模型识别意图...");

        // 发送第一次请求
        const res1 = await axios.post(
             `${apiConfig.baseURL}/chat/completions`,
            { 
                model: apiConfig.chatModel, 
                messages: messages, 
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

        const assistantMessage = res1.data.choices[0].message;

        // 核心工程细节：必须把大模型的这个"摇人意图"也记录到历史队列中
        messages.push(assistantMessage);

        // 【步骤 2】判断大模型是否需要调用天气工具
        if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
            
            console.log(assistantMessage.tool_calls.length);
            const toolCall = assistantMessage.tool_calls[0];
            const toolName = toolCall.function.name;
            
            // 解析大模型帮我们提炼出来的结构化参数
            const args = JSON.parse(toolCall.function.arguments);
            console.log(`💡 大模型发出呼叫：想调用函数 [${toolName}]，提取到的参数是:`, args);

            if (toolName === "get_current_weather") {
                // 执行本地的 JS 函数拿到真实/模拟天气数据
                const weatherResult = getCurrentWeather(args.location);
                console.log("📥 本地天气函数执行完毕，拿到结果:", weatherResult);

                // 【步骤 3】把天气结果，以 role: 'tool' 的身份塞进对话历史
                // 必须带上 tool_call_id，大模型才能和上面的呼叫对号入座
                messages.push({
                    role: "tool",
                    tool_call_id: toolCall.id,
                    name: toolName,
                    content: weatherResult
                });

                console.log("🔄 正在把天气数据送回给大模型，让它结合你的提问做最终总结...");

                // 【步骤 4】发送第二次请求！此时 messages 历史里已经包含了：用户提问 + 模型想调工具 + 本地查出来的天气数据
                const res2 = await axios.post(
                    `${apiConfig.baseURL}/chat/completions`,
                    { model: apiConfig.chatModel, messages: messages }, 
                    { headers: { "Authorization": `Bearer ${apiConfig.apiKey}` } }
                );
                
                console.log("\n🤖 大模型最终回复：");
                console.log(res2.data.choices[0].message.content);
            }
        } else {
            // 如果大模型觉得不需要调工具（比如用户只是说"你好"），直接打印回复
            console.log("🤖 大模型直接回复：", assistantMessage.content);
        }

    } catch (error) {
        console.error("❌ 发生错误：", error.response ? error.response.data : error.message);
    }
}

// 运行
runWeatherFlow();
