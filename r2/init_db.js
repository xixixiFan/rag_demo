// init_db.js (或者放在 rag_demo.js 的 main 函数最开头，只需执行一次)
import rawDocuments from '../rag_demo/rag_documents.js';
import { recursiveCharacterSplitter } from '../utils/Splitter/recursiveCharacterSplitter.js'; 
import { importChunksToDB } from '../utils/chromaService.js';

export async function setupKnowledgeBase() {
    console.log(" 正在初始化知识库...");
    let allChunks = [];
    
    // 循环切片
    for (const doc of rawDocuments) {
        const chunks = recursiveCharacterSplitter(doc, 300, 30);
        allChunks.push(...chunks);
    }
    
    // 灌入数据库
    await importChunksToDB(allChunks);
}