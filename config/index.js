import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function findProjectRoot(startDir) {
    let dir = startDir;
    for (let i = 0; i < 5; i++) {
        if (fs.existsSync(path.join(dir, 'package.json'))) {
            return dir;
        }
        dir = path.join(dir, '..');
    }
    return startDir;
}

const projectRoot = findProjectRoot(__dirname);

dotenv.config({ path: path.join(projectRoot, '.env') });
dotenv.config({ path: path.join(projectRoot, '.env.local'), override: true });
dotenv.config({ path: path.join(projectRoot, '.env.development'), override: true });
dotenv.config({ path: path.join(projectRoot, '.env.production'), override: true });

export const config = {
    ai: {
        deepseek: {
            apiKey: process.env.DEEPSEEK_API_KEY,
            baseURL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1',
            chatModel: process.env.DEEPSEEK_CHAT_MODEL || 'deepseek-chat',
            embeddingModel: process.env.DEEPSEEK_EMBEDDING_MODEL || 'text-embedding-3-small',
            timeout: parseInt(process.env.DEEPSEEK_TIMEOUT) || 30000
        },
        zhipu: {
            apiKey: process.env.ZHIPU_API_KEY,
            baseURL: process.env.ZHIPU_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4',
            chatModel: process.env.ZHIPU_CHAT_MODEL || 'glm-4'
        }
    },

    // Web Search 配置
    webSearch: {
        tavily: {
            apiKey: process.env.TAVILY_API_KEY,
            baseURL: process.env.TAVILY_BASE_URL || 'https://api.tavily.com',
            searchDepth: process.env.TAVILY_SEARCH_DEPTH || 'advanced',
            maxResults: parseInt(process.env.TAVILY_MAX_RESULTS) || 3,
            timeout: parseInt(process.env.TAVILY_TIMEOUT) || 10000
        }
    },

    redis: {
        url: process.env.REDIS_URL || 'redis://localhost:6379',
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT) || 6379,
        password: process.env.REDIS_PASSWORD || null
    },

    chromadb: {
        host: process.env.CHROMA_HOST || 'localhost',
        port: parseInt(process.env.CHROMA_PORT) || 8000,
        ssl: process.env.CHROMA_SSL === 'true'
    },

    rag: {
        topK: parseInt(process.env.RAG_TOP_K) || 10,
        rerankTopK: parseInt(process.env.RAG_RERANK_TOP_K) || 3,
        similarityThreshold: parseFloat(process.env.RAG_SIMILARITY_THRESHOLD) || 0.55,
        chunkSize: parseInt(process.env.RAG_CHUNK_SIZE) || 512,
        chunkOverlap: parseInt(process.env.RAG_CHUNK_OVERLAP) || 50
    },

    memory: {
        strategy: process.env.MEMORY_STRATEGY || 'window',
        windowSize: parseInt(process.env.MEMORY_WINDOW_SIZE) || 6,
        maxTokens: parseInt(process.env.MEMORY_MAX_TOKENS) || 4000
    },

    langgraph: {
        checkpointer: process.env.LANGGRAPH_CHECKPOINTER || 'memory',
        threadsEnabled: process.env.LANGGRAPH_THREADS_ENABLED !== 'false'
    },
    langfuse: {
        publicKey: process.env.LANGFUSE_PUBLIC_KEY,
        secretKey: process.env.LANGFUSE_SECRET_KEY,
        baseUrl: process.env.LANGFUSE_BASE_URL || 'https://cloud.langfuse.com',
        timeout: parseInt(process.env.LANGFUSE_TIMEOUT) || 10000
    },
    project: {
        env: process.env.NODE_ENV || 'development',
        debug: process.env.DEBUG === 'true'
    }
};

const requiredVars = ['DEEPSEEK_API_KEY'];
const missing = requiredVars.filter(v => !process.env[v]);
if (missing.length > 0) {
    console.warn(`⚠️  缺少环境变量: ${missing.join(', ')}，部分功能可能受限`);
}

export default config;
