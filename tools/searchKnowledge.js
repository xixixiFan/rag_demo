const toolsDefinitions = [{
    type: "function",
    function: {
        name: "search_knowledge_base",
        description: "专门用于检索企业内部的『大模型核心技术与 RAG 架构设计规范』专家级文档。当用户询问任何与大语言模型、检索增强生成(RAG)、知识库问答系统、向量数据库、语义检索、知识总结、出题系统、多层排序架构、重排(Reranking)、精排(Cross-Encoder)、RAGAS评估、防幻觉方案、向量检索、BM25、Embedding模型、ChromaDB、FAISS、召回策略、Chunk切分等技术选型或设计规范相关的问题时，必须调用此工具获取最新权威参考资料。",
        parameters: {
            type: "object",
            properties: {
                query: { 
                    type: "string", 
                    description: "用于在向量知识库中检索的技术关键词或短语，例如：'Corrective RAG'、'防幻觉方案'、'Lost in the Middle'、'向量数据库'、'知识库问答'、'重排技术'、'RAGAS评估'" 
                }
            },
            required: ["query"]
        }
    }
}];

export default toolsDefinitions;