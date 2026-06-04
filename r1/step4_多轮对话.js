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

async function runAgent(userPrompt) {
    const apiConfig = config.ai.deepseek;
    
    // 1. 初始化消息队列（这个队列是全局状态，所有步骤都在读写它）
    const messages = [
        { role: "system", content: "你是一个贴心的天气提醒助手。" },
        { role: "user", content: userPrompt }
    ];

    let loopCount = 0;
    const maxLoops = 5;

    while (true) {
        loopCount++;
        if (loopCount > maxLoops) {
            console.log("\n熔断：Agent 连续思考次数过多，可能陷入死循环，强制停止！");
            break;
        }
        console.log(`\n思考中... (第 ${loopCount} 轮决策)`);
        const response = await axios.post(
            `${apiConfig.baseURL}/chat/completions`,
            { model: apiConfig.chatModel, messages, tools: toolsDefinitions },
            { headers: { "Authorization": `Bearer ${apiConfig.apiKey}` } }
        );
        const assistantMessage = response.data.choices[0].message;

        // 关键：立刻把模型的这次回复记录到历史中（无论它是想说话还是想调工具）
        messages.push(assistantMessage);

        // 3. 决策分支 A：模型说"我要摇人"（调用工具）
        if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {

            const toolPromises = assistantMessage.tool_calls.map(async (toolCall) => {
                const toolName = toolCall.function.name;
                const args = JSON.parse(toolCall.function.arguments);

                if (toolName === "get_current_weather") {
                    // 异步查询天气（不再阻塞彼此）
                    const toolResult = await getCurrentWeather(args.location);

                    // 返回组装好的消息对象
                    return {
                        role: "tool",
                        tool_call_id: toolCall.id,
                        name: toolName,
                        content: toolResult
                    };
                }
            })

            const results = await Promise.all(toolPromises);

            messages.push(...results);

            // 核心点：执行完本地工具后，循环不 break！
            // continue 会直接进入下一次 while 循环，把刚拿到的天气数据再次送给大模型看
            console.log("结果已装填，交回大脑继续判断...");
            continue;
        } else {
            // 4. 决策分支 B：模型说"我知道答案了，不用调工具了"
            console.log("\n任务完成！Agent 最终汇报：");
            console.log(`模型回复: ${assistantMessage.content}`);
            break; // 只有模型主动不调工具时，循环才正式终止
        }
    }
}

// 运行
runAgent("我明天要从北京飞去香港出差，能帮我看看这两个地方的天气吗？我该怎么穿衣服？");
