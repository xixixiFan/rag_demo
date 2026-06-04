import axios from 'axios';
import config from '../config/index.js';

async function fetchWebSearch(query) {
    try {
        const apiConfig = config.webSearch.tavily;
        
        if (!apiConfig.apiKey) {
            console.warn(" Tavily API Key 未配置，跳过外网搜索");
            return "（外网搜索功能未配置 API Key）";
        }

        const response = await axios.post(`${apiConfig.baseURL}/search`, {
            api_key: apiConfig.apiKey,
            query: query,
            search_depth: apiConfig.searchDepth,
            max_results: apiConfig.maxResults
        }, {
            timeout: apiConfig.timeout
        });

        const results = response.data.results || [];
        
        const mergedWebContext = results.map((item, index) => {
            return `[来自外网搜索结果 ${index + 1}] 标题: ${item.title}\n链接: ${item.url}\n正文干货: ${item.content}`;
        }).join("\n\n");

        console.log(` 外网搜索成功，返回 ${results.length} 条结果`);
        return mergedWebContext;
    } catch (error) {
        console.error(" 外网搜索引擎异常:", error.message);
        return "（外网搜索网络故障，未能成功补充外部知识）";
    }
}

export default fetchWebSearch;
