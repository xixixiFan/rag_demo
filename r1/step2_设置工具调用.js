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
                    location: {type: "string", description: "格式为 '城市, 国家'，例如 '香港，中国'"}
                },
                required: ["location"]
            }
        }
    }
];


async function testTools() {
    const apiConfig = config.ai.deepseek;
    
    const response = await axios.post(
        `${apiConfig.baseURL}/chat/completions`,
        {
            model: apiConfig.chatModel,
            messages: [
                {role:"system", content:"You are a helpful assistant."},
                {role:"user", content:"请调用 get_current_weather 函数获取香港的天气"}
            ],
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
    //stringify 的第二个参数设置为 null，表示不使用任何替换函数，保持对象的原始结构不变；
    //第三个参数设置为 2，可以让输出的 JSON 字符串在每个层级增加两个空格的缩进，这样就能更清晰地展示嵌套结构，特别适合调试和查看复杂对象。
    console.log("API Response:", JSON.stringify(message, null, 2));
}

testTools();
