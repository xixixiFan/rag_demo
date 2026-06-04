import chromadb
from llama_index.vector_stores.chroma import ChromaVectorStore

# 创建本地持久化数据库（数据保存在 ./chroma_db 文件夹）
chroma_client = chromadb.PersistentClient(path="./chroma_db")

# 创建 collection（相当于数据库里的表）
collection = chroma_client.get_or_create_collection("my_docs")

# 包装成 LlamaIndex 可用的 VectorStore
vector_store = ChromaVectorStore(chroma_collection=collection)

print("✅ ChromaDB 本地模式启动成功！")
print(f"Collection 名称: {collection.name}")