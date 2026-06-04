// utils/rerankService.js
import { pipeline } from '@huggingface/transformers';

class RerankService {
    constructor() {
        if (RerankService.instance) {
            return RerankService.instance; // 阻止重复实例化
        }
        this.reranker = null;
        this.modelName = 'Xenova/ms-marco-MiniLM-L-6-v2'; // 工业界非常经典的轻量级 Cross-Encoder 交叉编码器精排模型
        this.initPromise = null;
        this.isLoading = false;
        RerankService.instance = this;
    }

    /**
     * 初始化精排模型
     */
    async init() {
        // // 1. 如果已经加载完毕，直接返回
        // if (this.reranker) return this.rerank;
        // // 2. 如果发现别的并发请求正在加载中，立刻“排队等待”同一个 Promise，不再向下执行
        // if (this.isLoading) return this.loadPromise;
        // // 3. 第一次进入，把整个异步加载过程赋值给 initPromise 挂起
        // this.initPromise = (async () => {
        //     console.log(`\n 正在初始化本地 Reranker 精排模型 (${this.modelName})...`);
        //     this.isLoading = true;
        //     this.reranker = await pipeline('text-classification', this.modelName);
        //     console.log(`本地 Reranker 精排模型加载成功！`);
        //     this.initPromise = null; // 加载完成后释放锁
        // })();

        // await this.initPromise;
        // this.isLoading = false;
        // return this.rerank;

        // 1. 如果已经加载完毕，直接返回
        if (this.reranker) return;
        // 2. 如果发现 initPromise 已经存在，说明已经有并发请求在前面占位并开始加载了,此时后来的请求二话不说，立刻同步返回这个 Promise，跟着一起排队等待它完成！
        if (this.initPromise) {
            return this.initPromise;
        }
        this.initPromise = (async () => {
            console.log(`\n 正在初始化本地 Reranker 精排模型 (${this.modelName})...`);
            this.reranker = await pipeline('text-classification', this.modelName);
            console.log(`本地 Reranker 精排模型加载成功！`);
        })();

        await this.initPromise;
        // 成功后将 Promise 锁释放，下次直接走 this.reranker 缓存
        this.initPromise = null;
    }

    /**
     * 对检索出来的候选切片进行硬核精排打分
     * @param {string} query 原始问题 
     * @param {Array} candidates ChromaDB 召回的粗选数组 [{ docText, score }]
     * @returns {Promise<Array>} 重新洗牌并按高分排序后的切片数组
     */
    async rerank(query, candidates) {
        if (!candidates || candidates.length === 0) return [];
        await this.init();

        console.log(`\n [Reranker 交叉编码器] 开始对 ${candidates.length} 个候选切片进行实时交互精排打分...`);

        /**
             * 1. 模型输入结构说明：
             * 对于 Cross-Encoder (交叉编码器)，我们不能单独给它一个文本。
             * 必须把【用户问题】和【文档切片】组合成一个 text_pair（文本对）同时喂给模型。
             * 模型内部会让问题中的每个字和切片中的每个字进行全注意力的交叉计算。
             */
        const promises = candidates.map(async (item) => {
            // 喂给 Cross-Encoder 模型进行深度语义交互打分
            const result = await this.reranker(query, {
                text_pair: item.docText
            });
            /**
             * 2. 模型返回结构（黑盒拆解）：
             * pipeline('text-classification') 的标准输出是一个【数组】，代表对输入样本的分类预测。
             * 因为我们只传了一个 text_pair，所以数组只有 1 项，即 result[0]。
             * * 真实返回的 JSON 结构如下：
             * [
             * {
             * label: 'LABEL_0', // 模型内部的分类标签，精排场景中我们不用理会它
             * score: 0.985632   // 这就是匹配度得分！范围通常在 0 ~ 1 之间（或者是未归一化的 Logits 映射）
             * }
             * ]
             */
            const rerankScore = result[0].score;
            return {
                docText: item.docText,
                oldScore: item.score,      // 记录旧的向量粗排得分
                score: rerankScore         // 覆盖为最新的高精度精排得分
            };
        });

        const rerankedList = await Promise.all(promises);

        // 2. 核心：按精排后的最高得分，从大到小重新洗牌降序排列！
        rerankedList.sort((a, b) => b.score - a.score);

        return rerankedList;
    }
}

// 导出单例，避免重复加载模型占用内存
export default new RerankService();