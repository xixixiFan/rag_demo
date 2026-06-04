# 配置说明

## 目录结构

```
rag/
├── config/
│   ├── index.js              # 统一配置管理（核心）
│   └── README.md             # 本文档
├── .env.example              # 环境变量模板（可提交 git）
├── .env                      # 实际配置（不提交 git）
├── .env.local                # 本地覆盖（不提交 git）
├── .env.development          # 开发环境配置
└── .env.production           # 生产环境配置
```

## 使用方法

### 1. 复制模板创建 .env 文件

```bash
cp .env.example .env
```

### 2. 填写实际配置值

编辑 `.env` 文件，填入真实的 API Key 等敏感信息。

### 3. 在代码中引入配置

**推荐方式：统一使用 config 模块**

```javascript
// 从统一配置模块引入
import config from '../../config/index.js';

// 使用配置
const apiKey = config.ai.deepseek.apiKey;
const topK = config.rag.topK;
```

**不推荐：直接使用 process.env**

```javascript
// ❌ 不推荐：分散的 process.env
const apiKey = process.env.DEEPSEEK_API_KEY;
```

## 配置优先级

从低到高（后面的会覆盖前面的）：

1. `.env` - 基础配置
2. `.env.development` - 开发环境
3. `.env.production` - 生产环境
4. `.env.local` - 本地覆盖（优先级最高）

## 配置项说明

### AI 模型配置 (config.ai)

| 配置项 | 环境变量 | 默认值 | 说明 |
|--------|---------|--------|------|
| API Key | `DEEPSEEK_API_KEY` | - | DeepSeek API 密钥（必须） |
| Base URL | `DEEPSEEK_BASE_URL` | `https://api.deepseek.com/v1` | API 地址 |
| Chat Model | `DEEPSEEK_CHAT_MODEL` | `deepseek-chat` | 对话模型 |
| Embedding Model | `DEEPSEEK_EMBEDDING_MODEL` | `text-embedding-3-small` | 向量化模型 |

### Redis 配置 (config.redis)

| 配置项 | 环境变量 | 默认值 | 说明 |
|--------|---------|--------|------|
| URL | `REDIS_URL` | `redis://localhost:6379` | Redis 连接 URL |
| Host | `REDIS_HOST` | `localhost` | Redis 主机 |
| Port | `REDIS_PORT` | `6379` | Redis 端口 |
| Password | `REDIS_PASSWORD` | - | Redis 密码 |

### ChromaDB 配置 (config.chromadb)

| 配置项 | 环境变量 | 默认值 | 说明 |
|--------|---------|--------|------|
| Host | `CHROMA_HOST` | `localhost` | ChromaDB 主机 |
| Port | `CHROMA_PORT` | `8000` | ChromaDB 端口 |
| SSL | `CHROMA_SSL` | `false` | 是否启用 SSL |

### RAG 配置 (config.rag)

| 配置项 | 环境变量 | 默认值 | 说明 |
|--------|---------|--------|------|
| Top-K | `RAG_TOP_K` | `10` | 向量检索返回数量 |
| Rerank Top-K | `RAG_RERANK_TOP_K` | `3` | 重排后保留数量 |
| 相似度阈值 | `RAG_SIMILARITY_THRESHOLD` | `0.55` | 过滤低相似度结果 |
| 切片大小 | `RAG_CHUNK_SIZE` | `512` | 文本切片 token 数 |
| 切片重叠 | `RAG_CHUNK_OVERLAP` | `50` | 相邻切片重叠 token 数 |

### 记忆管理配置 (config.memory)

| 配置项 | 环境变量 | 默认值 | 说明 |
|--------|---------|--------|------|
| 策略 | `MEMORY_STRATEGY` | `window` | `window` 或 `summary` |
| 窗口大小 | `MEMORY_WINDOW_SIZE` | `6` | 滑动窗口保留轮数 |
| 最大 Token | `MEMORY_MAX_TOKENS` | `4000` | 历史记录最大 token |

### LangGraph 配置 (config.langgraph)

| 配置项 | 环境变量 | 默认值 | 说明 |
|--------|---------|--------|------|
| Checkpointer | `LANGGRAPH_CHECKPOINTER` | `memory` | 状态持久化方式 |
| 多线程 | `LANGGRAPH_THREADS_ENABLED` | `true` | 是否启用多线程 |

## 各阶段使用示例

### r1 (基础对话)

```javascript
import config from '../../config/index.js';

// 获取 AI 配置
const { apiKey, chatModel } = config.ai.deepseek;
```

### r2 (RAG + 记忆)

```javascript
import config from '../../config/index.js';

// 获取 RAG 配置
const { topK, rerankTopK } = config.rag;

// 获取 Redis 配置
const { host, port } = config.redis;
```

### r3 (LangGraph)

```javascript
import config from '../../config/index.js';

// 获取 LangGraph 配置
const { checkpointer, threadsEnabled } = config.langgraph;
```

## 常见问题

### Q: 如何在不同环境使用不同配置？

```bash
# .env.development
NODE_ENV=development
DEBUG=true

# .env.production
NODE_ENV=production
DEBUG=false
```

### Q: 如何临时覆盖某个配置？

编辑 `.env.local`（此文件不会被 git 跟踪）：

```bash
DEEPSEEK_API_KEY=临时测试key
DEBUG=true
```

### Q: 如何确认配置是否正确加载？

```javascript
import config from '../../config/index.js';

console.log('当前环境:', config.project.env);
console.log('DeepSeek API Key:', config.ai.deepseek.apiKey ? '已配置' : '未配置');
```
