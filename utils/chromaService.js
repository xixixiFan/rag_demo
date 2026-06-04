// utils/chromaService.js
import { ChromaClient } from 'chromadb';
import vectorService from './Vector_service.js';

// 1. 实例化纯内存客户端
const client = new ChromaClient({ host: "localhost", port: "8000" });
const COLLECTION_NAME = "my_rag_knowledge";

// 手写一个符合 Chroma 规范的"空"向量生成函数
// 这样 Chroma 就会直接执行我们这个空函数，而绝不会去实例化它那个报错的 DefaultEmbeddingFunction 
const customEmptyEmbeddingFunction = {
    generate: async (texts) => {
        // 故意返回空数组，因为我们根本不用它自带的生成逻辑，我们自己会手工传入算好的向量
        return [];
    }
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export async function importChunksToDB(chunks) {
    try {
        // 先删除已有 collection，防止重复插入
        try {
            await client.deleteCollection({ name: COLLECTION_NAME });
            console.log(`\n [ChromaDB] 已清除旧数据，等待清理完成...`);
        } catch {
            // collection 不存在时忽略
        }

        const collection = await client.getOrCreateCollection({
            name: COLLECTION_NAME,
            embeddingFunction: customEmptyEmbeddingFunction
        });

        console.log(`\n [ChromaDB] 开始为 ${chunks.length} 个切片生成向量...`);
        // 手动调用我们自己的向量服务来生成切片的向量
        const embeddings = await vectorService.embedBatch(chunks);
        // 注意：这里我们直接调用了自己写的向量服务来生成向量，而不是让 Chroma 自己去生成
        if (!embeddings || embeddings.length !== chunks.length) {
            throw new Error("生成的向量数量与切片数量不一致！");
        }

        console.log(`\n流式写入向量数据库中...`);

        const batchSize = 10;
        for (let i = 0; i < chunks.length; i += batchSize) {
            const batchChunks = chunks.slice(i, i + batchSize);
            const batchEmbeds = embeddings.slice(i, i + batchSize);
            const batchIds = batchChunks.map((_, index) => `chunk_id_${Date.now()}_${i + index}`);

            // Chroma的add接口可以一次批量写入多条数据，这里我们分批写入以防止一次性写入过多导致内存压力
            await collection.add({
                ids: batchIds,
                embeddings: batchEmbeds,
                documents: batchChunks
            });

            console.log(`  已写入 ${Math.min(i + batchSize, chunks.length)}/${chunks.length} 条数据...`);
            await sleep(50);
        }

        console.log(`\n [ChromaDB] ${chunks.length}个语义块全部成功加载至内存数据库！`);
    } catch (error) {
        console.error(" 导入向量数据库失败:", error);
    }
}

/**
 * 检索切片
 * @param {string|string[]} query - 查询词（字符串或字符串数组）
 * @param {number} k - 返回数量
 * @returns {Promise<Array>} 检索结果数组
 */
export async function queryFromDB(query, k = 3) {
    try {
        const collection = await client.getCollection({
            name: COLLECTION_NAME,
        });

        // 处理输入：如果是数组，连接成字符串
        let queryText = query;
        if (Array.isArray(query)) {
            // 如果是数组，将多个查询词用空格连接
            queryText = query.join(' ');
        }

        // 用本地的 BGE 模型生成问题向量
        const queryEmbedding = await vectorService.embed(queryText);

        // 手动把算好的 queryEmbeddings 传给检索接口
        const queryResponse = await collection.query({
            queryEmbeddings: [queryEmbedding],
            nResults: k
        });

        const documents = queryResponse.documents[0] || [];
        const distances = queryResponse.distances[0] || [];

        return documents.map((docText, index) => ({
            docText: docText,
            //score 计算方式：距离越小相似度越高，我们这里简单地用 (1 - distance) 来表示相似度分数，范围在 0 到 1 之间
            score: distances[index] !== undefined ? (1 - distances[index]) : 0.0
        }));
    } catch (error) {
        console.error(" 向量检索失败:", error);
        return [];
    }
}
