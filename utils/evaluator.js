import axios from 'axios';
import config from '../config/index.js';

class RAGEvaluator {
    constructor() {
        if (RAGEvaluator.instance) {
            return RAGEvaluator.instance;
        }

        const apiConfig = config.ai.deepseek;
        this.apiKey = apiConfig.apiKey;
        this.apiUrl = `${apiConfig.baseURL}/chat/completions`;
        this.chatModel = apiConfig.chatModel;

        RAGEvaluator.instance = this;
    }

    async evaluate(query, contexts, response, hasWebSearch = false) {
        // 基础校验：如果没有切片或回答为空，直接打回
        if (!contexts || contexts.length === 0 || !response) {
            return {
                faithfulness: 0,
                context_precision: 0,
                reason: "未获取到有效的本地知识库参考资料或草稿为空，拒绝放行。",
                feedback: "系统未召回有效的参考切片，请检查前置检索节点或扩充知识库。"
            };
        }

        const contextStr = contexts.map((c, i) => `[切片 ${i + 1}]: ${c}`).join('\n');

        const webSearchNote = hasWebSearch
            ? `\n【重要提示】本次检索包含【外网搜索结果】（标记为"来自外网权威检索"或"补充资料"）。
如果答案基于这些外网资料进行了正确、客观的回答，没有瞎编乱造，则忠实度应该给高分。
如果外网资料与问题相关且答案利用了这些信息，则上下文精确率也应该给高分。`
            : ``;

        const systemPrompt = `你是一个冷酷、严谨的 RAG 系统自动化审计裁判官。你的任务是根据提供的【原始问题】、【检索上下文】和【生成答案】，严格计算两个指标：

【核心评分原则】
1. 忠实度 (Faithfulness): 评估答案中的**技术性内容/知识点**是否能在检索上下文中找到直接依据。
   - 如果答案是"资料中没有相关信息，无法回答"→ 这说明检索失败，忠实度应该给 **0.5 分以下**（因为答案没有从上下文中获得任何有效信息）
   - 如果答案包含了上下文没提的技术细节或瞎编（幻觉），分数极低。
   - 只有当答案基于上下文给出了正确回答，且每句话都有依据时，才给高分。

2. 上下文精确率 (Context Precision): 评估检索到的前几个切片中，真正有用的切片是否排在靠前的位置。范围 0.0 ~ 1.0。
   - 如果所有切片都与问题无关 → 0 分
   - 如果有用切片排在前面 → 高分

${webSearchNote}

你必须严格以下列 JSON 格式输出，不要包含任何多余的反引号、markdown(如 \`\`\`json) 或转义标记：
{
"faithfulness": 0.0 到 1.0 的浮点数，
"context_precision": 0.0 到 1.0 的浮点数，
"reason": "对分数的客观审计总结原因",
"feedback": "如果不通过，请详细说出草稿中哪一句话说错了、凭空捏造了什么，以便下游进行定向重写修正；如果通过，写一句鼓励的话即可"
}`;

        const userContent = `【原始问题】: ${query}\n\n【检索上下文】:\n${contextStr}\n\n【生成答案】:\n${response}`;

        try {
            const res = await axios.post(this.apiUrl, {
                model: this.chatModel,
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userContent }
                ],
                temperature: 0.1,
                response_format: { type: "json_object" }
            }, {
                headers: { "Authorization": `Bearer ${this.apiKey}` }
            });

            const evalResult = JSON.parse(res.data.choices[0].message.content);

            console.log(`\n===================  RAGAS 质量审计报告 ===================`);
            console.log(`忠实度 (Faithfulness)        : ${(evalResult.faithfulness * 100).toFixed(1)}%`);
            console.log(`上下文精确率 (Context Precision) : ${(evalResult.context_precision * 100).toFixed(1)}%`);
            console.log(`裁判官审计意见                : ${evalResult.reason}`);
            console.log(`纠错整改批注 (Feedback)      : "${evalResult.feedback}"`);
            console.log(`===========================================================`);

            // evaluator 只负责返回分数和反馈，不决定流程状态
            return {
                faithfulness: evalResult.faithfulness,
                context_precision: evalResult.context_precision,
                reason: evalResult.reason,
                feedback: evalResult.feedback
            };
        } catch (error) {
            console.error("[RAGEvaluator] 审计节点发生致命失败:", error.message);
            return {
                faithfulness: 0.5,
                context_precision: 0.5,
                reason: `裁判服务异常：${error.message}`,
                feedback: "审计服务暂时不可用，请重试或检查 API 配置。"
            };
        }
    }
}

export default new RAGEvaluator();
