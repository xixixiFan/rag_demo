import axios from 'axios';
import config from '../config/index.js';

async function testConnection() {
    try{
        const apiConfig = config.ai.deepseek;
        
        const response = await axios.post(
           `${apiConfig.baseURL}/chat/completions`,
            {
                model: apiConfig.chatModel,
                messages: [
                    {role:"system", content:"You are a helpful assistant."},
                    {role:"user", content:"Hello, how are you?"}
                ]
            },{
                headers: {
                    "Authorization": `Bearer ${apiConfig.apiKey}`,
                    "Content-Type": "application/json"
                }
            }
        );
        console.log("API Response:", response.data.choices[0].message.content);
    }catch(error){
        console.error("API Error:", error.message);
    }
}

testConnection();
