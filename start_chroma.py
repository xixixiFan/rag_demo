import chromadb

# 启动本地持久化模式（数据保存在 ./chroma_db）
client = chromadb.PersistentClient(path="./chroma_db")
collection = client.get_or_create_collection("my_docs")

print("✅ ChromaDB 本地模式启动成功！")
print(f"Collection: {collection.name}")
print(f"数据目录: ./chroma_db")

# 保持运行
import time
while True:
    time.sleep(30)