import { setupKnowledgeBase } from './init_db.js';

async function main() {
    await setupKnowledgeBase();
    console.log("\n 知识库初始化完成！可以运行 step2.js 了。");
    process.exit(0);
}

main().catch(err => {
    console.error("初始化失败:", err);
    process.exit(1);
});
