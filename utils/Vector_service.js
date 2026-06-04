// async function getExtractor() {
//     if (!extractorInstance) {
//         console.log("正在首次初始化本地 BGE 向量模型（首次运行会自动下载模型，请稍候）...");
//         // 使用专门针对中文语义检索优化过的轻量模型
//         extractorInstance = await pipeline('feature-extraction', 'Xenova/bge-small-zh-v1.5');
//         console.log("本地向量模型加载成功！\n");
//     }
//     return extractorInstance;
// }


import { pipeline } from '@huggingface/transformers';
class VectorService {
    constructor() {
        if (VectorService.instance) {
            return VectorService.instance; // 阻止重复实例化
        }
        this.extractor = null;           // 模型实例缓存
        this.isLoading = false;          // 防止并发重复加载
        this.loadPromise = null;         // 共享加载 Promise
        VectorService.instance = this;   // 挂到类属性上
    }

    async _loadModel() {
        if (this.extractor) return this.extractor;
        if (this.isLoading) return this.loadPromise;

        this.isLoading = true;
        this.loadPromise = (async () => {
            console.log(" 首次初始化本地 BGE 向量模型（自动下载中，请稍候）...");
            const model = await pipeline(
                'feature-extraction',
                'Xenova/bge-small-zh-v1.5'
            );
            this.extractor = model;
            console.log("本地 BGE 向量模型加载成功！");
            return model;
        })();

        await this.loadPromise;
        this.isLoading = false;
        return this.extractor;
    }

    // 纯本地计算向量函数
    // async function getLocalVector(text) {
    //     const extractor = await getExtractor();
    //     // pooling: 'cls' 是向量模型的标准做法，提取出句子的核心语义特征
    //     const output = await extractor(text, { pooling: 'cls', normalize: true });
    //     // 将模型返回的 Tensor 数据结构转为纯 JavaScript 数组
    //     return Array.from(output.data);
    // }
    async embed(text) {
        const model = await this._loadModel();
        const output = await model(text, { pooling: 'cls', normalize: true });
        return Array.from(output.data);
    }
    /**
     * 批量接口：多个文本 → 向量数组（内部复用同一模型，只加载一次）
     */
    async embedBatch(texts) {
        const model = await this._loadModel();
        const results = [];
        for (let i = 0; i < texts.length; i++) {
            process.stdout.write(`向量化进度: ${i + 1}/${texts.length}\r`);
            const output = await model(texts[i], { pooling: 'cls', normalize: true });
            results.push(Array.from(output.data));
        }
        process.stdout.write('\n');
        console.log("\n 所有文本向量化计算完成！");
        return results;
    }


}
// ES Module 导出单例（全局唯一）
export default new VectorService();