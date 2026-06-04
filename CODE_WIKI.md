# RAG 项目技术文档

## 一、项目概述

本项目是一个基于 **Node.js** 的 **RAG（Retrieval-Augmented Generation，检索增强生成）** 系统，集成了本地向量化模型、Chroma向量数据库、Cross-Encoder精排模型和DeepSeek大语言模型，实现了一个完整的企业级知识库问答系统。

### 核心特性

| 特性 | 说明 |
|-----|------|
| **本地向量化** | 使用 BGE-small-zh-v1.5 模型实现纯本地语义向量化 |
| **向量数据库** | 集成 ChromaDB 实现高效向量检索 |
| **Query Rewrite** | 支持查询词智能改写，提升检索准确性 |
| **Reranker精排** | 使用 MiniLM-L-6-v2 交叉编码器进行深度精排 |
| **RAGAS评估** | 内置评估框架，自动评估回答质量 |
| **多轮对话** | 支持上下文保持的多轮问答 |

---

## 二、项目架构

### 2.1 整体架构图

```
┌─────────────────────────────────────────────────────────────────────┐
│                        用户层 (User Layer)                          │
│                    [终端交互 / API调用]                              │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     应用层 (Application Layer)                      │
│  ┌─────────────┐  ┌─────────────┐  ┌───────────────────────────┐   │
│  │  rag_demo   │  │    r1/r2    │  │ 多轮对话管理 (ChatHistory) │   │
│  │ (主演示)    │  │ (示例代码)   │  └───────────────────────────┘   │
│  └──────┬──────┘  └──────┬──────┘                                   │
└─────────┼────────────────┼──────────────────────────────────────────┘
          │                │
          ▼                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     服务层 (Service Layer)                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌───────────┐  │
│  │ VectorService│  │ RerankService│ │ QueryRewrite│  │ Evaluator │  │
│  │  (向量化)    │  │   (精排)     │ │  (查询重写)  │  │  (评估)   │  │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └─────┬─────┘  │
└─────────┼────────────────┼────────────────┼────────────────┼────────┘
          │                │                │                │
          ▼                ▼                ▼                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     数据层 (Data Layer)                             │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                    Chroma Vector DB                         │    │
│  │  • 向量存储与检索  • 支持自定义Embedding  • 内存/持久化模式    │    │
│  └─────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 模块职责划分

| 模块 | 目录 | 核心职责 |
|-----|------|---------|
| **配置管理** | `config/` | 环境变量加载、API密钥管理 |
| **向量服务** | `utils/Vector_service.js` | 文本向量化、单条/批量嵌入 |
| **数据库服务** | `utils/chromaService.js` | 向量导入、检索查询 |
| **精排服务** | `utils/reranker.js` | Cross-Encoder精排打分 |
| **查询重写** | `utils/query_rewrite.js` | 查询词智能改写 |
| **评估服务** | `utils/evaluator.js` | RAGAS质量评估 |
| **文本切片** | `utils/Splitter/` | Markdown/字符切片 |
| **工具定义** | `tools/` | LLM工具调用定义 |
| **演示代码** | `rag_demo/` | 完整RAG流程演示 |

---

## 三、核心类与函数详解

### 3.1 VectorService - 向量化服务

**文件位置**: [utils/Vector_service.js](file:///C:/Users/fanying01/Desktop/Projects/rag/utils/Vector_service.js)

**设计模式**: 单例模式，防止重复加载模型

**核心方法**:

| 方法 | 功能 | 参数 | 返回值 |
|-----|------|------|--------|
| `embed(text)` | 单条文本向量化 | `text`: 待编码文本 | `Promise<number[]>` - 向量数组 |
| `embedBatch(texts)` | 批量文本向量化 | `texts`: 文本数组 | `Promise<number[][]>` - 向量二维数组 |

**关键实现细节**:
- 使用 `Xenova/bge-small-zh-v1.5` 中文优化模型
- 采用 `pooling: 'cls'` 策略提取句子级语义特征
- 自动处理首次加载时的并发请求，通过 `isLoading` 和 `loadPromise` 防止重复加载

---

### 3.2 ChromaService - 向量数据库服务

**文件位置**: [utils/chromaService.js](file:///C:/Users/fanying01/Desktop/Projects/rag/utils/chromaService.js)

**核心方法**:

| 方法 | 功能 | 参数 | 返回值 |
|-----|------|------|--------|
| `importChunksToDB(chunks)` | 导入切片到向量库 | `chunks`: 文本切片数组 | `Promise<void>` |
| `queryFromDB(queryText, k)` | 查询相似文档 | `queryText`: 查询词, `k`: 返回数量 | `Promise<{docText, score}[]>` |

**关键实现细节**:
- 使用自定义空Embedding函数绕过Chroma内置编码器
- 手动传入预计算的向量，保证精度
- 支持批量写入，每批10条，带进度输出

---

### 3.3 RerankService - 精排服务

**文件位置**: [utils/reranker.js](file:///C:/Users/fanying01/Desktop/Projects/rag/utils/reranker.js)

**设计模式**: 单例模式

**核心方法**:

| 方法 | 功能 | 参数 | 返回值 |
|-----|------|------|--------|
| `init()` | 初始化精排模型 | 无 | `Promise<void>` |
| `rerank(query, candidates)` | 对候选文档精排打分 | `query`: 查询词, `candidates`: 粗排结果 | `Promise<{docText, oldScore, score}[]>` |

**关键实现细节**:
- 使用 `Xenova/ms-marco-MiniLM-L-6-v2` 经典精排模型
- 采用 Cross-Encoder 架构，将 query 和 doc 拼接输入
- 返回重排序后的文档列表，包含原始得分和精排得分

---

### 3.4 QueryRewrite - 查询重写

**文件位置**: [utils/query_rewrite.js](file:///C:/Users/fanying01/Desktop/Projects/rag/utils/query_rewrite.js)

**核心函数**:

| 函数 | 功能 | 参数 | 返回值 |
|-----|------|------|--------|
| `rewriteQuery(rawQuery, chatHistory)` | 智能改写模糊查询 | `rawQuery`: 原始查询, `chatHistory`: 历史对话 | `Promise<string>` - 改写后的查询词 |

**触发条件**:
- 查询包含模糊词（这个、那个、它、刚才等）
- 查询长度小于8个字符
- 存在对话历史上下文

---

### 3.5 RAGEvaluator - RAG质量评估

**文件位置**: [utils/evaluator.js](file:///C:/Users/fanying01/Desktop/Projects/rag/utils/evaluator.js)

**核心方法**:

| 方法 | 功能 | 参数 | 返回值 |
|-----|------|------|--------|
| `evaluate(query, contexts, response)` | 评估RAG回答质量 | `query`: 原始问题, `contexts`: 检索上下文, `response`: 生成答案 | `Promise<{faithfulness, context_precision, reason}>` |

**评估指标**:
- **忠实度 (Faithfulness)**: 答案是否有上下文依据，0.0-1.0
- **上下文精确率 (Context Precision)**: 检索结果的相关性，0.0-1.0

---

### 3.6 文本切片器

#### 3.6.1 Markdown切片器

**文件位置**: [utils/Splitter/markdownSplitter.js](file:///C:/Users/fanying01/Desktop/Projects/rag/utils/Splitter/markdownSplitter.js)

**函数**: `advancedMarkdownSplitter(text, maxChunkSize, overlap)`

**功能**: 按Markdown标题结构进行语义切片，保留标题与内容的关联性

#### 3.6.2 递归字符切片器

**文件位置**: [utils/Splitter/recursiveCharacterSplitter.js](file:///C:/Users/fanying01/Desktop/Projects/rag/utils/Splitter/recursiveCharacterSplitter.js)

**函数**: `recursiveCharacterSplitter(text, maxChunkSize, overlap)`

**分隔符优先级**: `\n\n` → `\n` → `。` → `，` → ` ` → 强制截断

---

## 四、依赖关系

### 4.1 依赖列表

| 依赖 | 版本 | 用途 |
|-----|------|------|
| `@huggingface/transformers` | ^4.2.0 | 本地BGE和MiniLM模型推理 |
| `axios` | ^1.16.1 | HTTP请求（调用DeepSeek API） |
| `chromadb` | ^3.4.3 | 向量数据库 |
| `dotenv` | ^17.4.2 | 环境变量加载 |
| `redis` | ^6.0.0 | 缓存（预留） |

### 4.2 模块依赖图

```
rag_demo.js
    ├── Vector_service.js      (向量化)
    ├── chromaService.js       (数据库)
    │       └── Vector_service.js
    ├── reranker.js            (精排)
    ├── query_rewrite.js       (查询重写)
    │       └── config/index.js
    ├── evaluator.js           (评估)
    ├── calculateSimilarity.js (相似度计算)
    ├── tools/searchKnowledge.js (工具定义)
    └── Splitter/*.js          (切片器)
```

---

## 五、核心工作流程

### 5.1 文档入库流程

```
原始文档 → 文本切片 → 向量化 → 批量写入ChromaDB
    │           │          │              │
    ▼           ▼          ▼              ▼
  rag_documents.js  Splitter/  VectorService  chromaService.importChunksToDB()
```

### 5.2 查询检索流程

```
用户提问
    │
    ▼
┌──────────────────────────────────────────────────────────────────┐
│ 1. Query Rewrite 智能改写                                        │
│    - 检测模糊词 → 调用DeepSeek生成优化查询词                        │
└──────────────────────────────────────────────────────────────────┘
    │
    ▼
┌──────────────────────────────────────────────────────────────────┐
│ 2. ChromaDB 粗检索                                               │
│    - 查询向量化 → 向量相似度搜索 → 返回Top-10候选                   │
└──────────────────────────────────────────────────────────────────┘
    │
    ▼
┌──────────────────────────────────────────────────────────────────┐
│ 3. Cross-Encoder 精排                                            │
│    - 将(query, doc)对送入MiniLM模型 → 交叉注意力打分 → 重排序       │
└──────────────────────────────────────────────────────────────────┘
    │
    ▼
┌──────────────────────────────────────────────────────────────────┐
│ 4. 阈值过滤 & Top-K选取                                          │
│    - 过滤低置信度结果 → 选取Top-3高质量切片                        │
└──────────────────────────────────────────────────────────────────┘
    │
    ▼
┌──────────────────────────────────────────────────────────────────┐
│ 5. LLM 生成回答                                                  │
│    - 将切片注入Prompt → 调用DeepSeek生成最终答案                   │
└──────────────────────────────────────────────────────────────────┘
    │
    ▼
┌──────────────────────────────────────────────────────────────────┐
│ 6. RAGAS 质量评估                                                │
│    - 评估忠实度和上下文精确率 → 输出审计报告                        │
└──────────────────────────────────────────────────────────────────┘
```

---

## 六、配置与运行

### 6.1 环境变量配置

创建 `.env` 文件：

```env
# DeepSeek API
DEEPSEEK_API_KEY=your_api_key_here
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
DEEPSEEK_CHAT_MODEL=deepseek-chat

# 可选：智谱API
ZHIPU_API_KEY=your_zhipu_key
ZHIPU_BASE_URL=https://open.bigmodel.cn/api/paas/v4

# Redis (预留)
REDIS_URL=redis://localhost:6379

# RAG参数
RAG_TOP_K=3
RAG_RERANK_TOP_K=3
RAG_SIMILARITY_THRESHOLD=0.55
MEMORY_WINDOW_SIZE=6
```

### 6.2 启动步骤

1. **安装依赖**：
   ```bash
   npm install
   ```

2. **启动ChromaDB服务**（需提前安装）：
   ```bash
   chroma run --host localhost --port 8000
   ```

3. **初始化知识库**（首次运行）：
   ```bash
   node r2/init_db.js
   ```

4. **运行演示**：
   ```bash
   node r2/step1_排序和query重写.js
   ```

### 6.3 运行模式说明

| 模式 | 入口文件 | 功能特点 |
|-----|---------|---------|
| **基础RAG** | `rag_demo/rag_demo.js` | 基础检索+工具调用 |
| **步骤示例** | `r1/*.js` | 分步教学示例 |
| **进阶RAG** | `r2/step1_排序和query重写.js` | QueryRewrite + Reranker + Evaluator |

---

## 七、代码示例

### 7.1 基础检索示例

```javascript
import vectorService from './utils/Vector_service.js';
import { queryFromDB } from './utils/chromaService.js';

// 查询
const results = await queryFromDB("什么是RAG?", 3);
console.log(results);
// 输出: [{ docText: "...", score: 0.92 }, ...]
```

### 7.2 Query Rewrite示例

```javascript
import { rewriteQuery } from './utils/query_rewrite.js';

const rewritten = await rewriteQuery("这个怎么做?", []);
console.log(rewritten);
// 输出: "RAG实现方法"
```

### 7.3 Reranker精排示例

```javascript
import reranker from './utils/reranker.js';

const candidates = [
    { docText: "RAG是检索增强生成...", score: 0.85 },
    { docText: "向量数据库用于...", score: 0.78 }
];
const ranked = await reranker.rerank("什么是RAG?", candidates);
console.log(ranked);
```

---

## 八、关键技术要点

### 8.1 向量模型选择

| 模型 | 类型 | 特点 |
|-----|------|------|
| `Xenova/bge-small-zh-v1.5` | Embedding | 中文优化，轻量高效 |
| `Xenova/ms-marco-MiniLM-L-6-v2` | Cross-Encoder | 经典精排模型，精度高 |

### 8.2 切片策略

- **推荐切片大小**: 200-400字符
- **重叠大小**: 20-60字符
- **原则**: 保持语义完整性，避免切割句子或段落

### 8.3 级联检索策略

```
粗检索(Top-10) → 精排过滤 → 最终Top-3
    │                    │              │
  ChromaDB          MiniLM          LLM输入
  快，召回为主      准，精确匹配    高质量上下文
```

---

## 九、项目目录结构

```
rag/
├── config/                    # 配置模块
│   └── index.js               # 环境变量与配置管理
├── utils/                     # 核心工具模块
│   ├── Vector_service.js      # 向量化服务
│   ├── chromaService.js       # Chroma数据库服务
│   ├── reranker.js            # 精排服务
│   ├── query_rewrite.js       # 查询重写
│   ├── evaluator.js           # RAG评估
│   ├── calculateSimilarity.js # 余弦相似度计算
│   └── Splitter/              # 文本切片器
│       ├── markdownSplitter.js
│       └── recursiveCharacterSplitter.js
├── tools/                     # LLM工具定义
│   └── searchKnowledge.js     # 知识库检索工具
├── rag_demo/                  # 演示代码
│   ├── rag_demo.js            # 主演示入口
│   └── rag_documents.js       # 示例文档数据
├── r1/                        # 步骤教学示例
│   ├── step1_调用对话接口.js
│   ├── step2_设置工具调用.js
│   ├── step3_根据工具结果请求结论.js
│   ├── step4_多轮对话.js
│   ├── step5_向量化数据.js
│   └── step6_重复调用检索工具.js
├── r2/                        # 进阶示例
│   ├── chroma/                # Chroma测试
│   ├── utils/                 # 工具扩展
│   ├── init_db.js             # 知识库初始化
│   ├── splitter_test.js       # 切片测试
│   ├── step1_排序和query重写.js
│   └── step2.js
├── package.json               # 项目依赖配置
└── .gitignore                 # Git忽略配置
```

---

## 十、扩展与优化建议

### 10.1 当前限制

- 文档数据硬编码在 `rag_documents.js`，建议支持外部文档导入
- Redis依赖已声明但未实际使用，可用于会话缓存
- 缺乏API接口封装，建议增加RESTful API层

### 10.2 优化方向

| 方向 | 描述 |
|-----|------|
| **Hybrid Search** | 融合BM25关键词搜索与向量检索 |
| **RRF融合** | 使用RRF算法合并多检索结果 |
| **增量更新** | 支持文档增量向量化入库 |
| **多模态支持** | 扩展图片、表格等多模态内容处理 |
| **API服务化** | 封装为RESTful服务供外部调用 |