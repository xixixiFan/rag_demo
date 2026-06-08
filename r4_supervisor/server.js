import Fastify from 'fastify';
import cors from '@fastify/cors';
import { StateGraph, END, START, MemorySaver } from "@langchain/langgraph";
import { RAGGraphState } from "./state.js";

// 导入原始节点函数（重命名）
import { queryRewriteNode as rawRewrite } from "./nodes/rewrite.js";
import { retrieveAndRankNode as rawRetrieve } from "./nodes/retrieve.js";
import { draftNode as rawDraft } from "./nodes/make_draft.js";
import { incrementRetryNode as rawRetry } from "./nodes/handle_retry.js";
import { evaluateNode as rawEvaluate } from "./nodes/review.js";
import { webSearchNode as rawWebSearch } from "./nodes/web_search.js";
import { supervisorNode } from "./nodes/supervisor.js";

// 导入 Langfuse 可观测性客户端
import langfuse from "../utils/langfuse.js";
// 导入节点追踪包装器（AOP 切面）
import { traceNode } from "../utils/traceNode.js";

// 使用 traceNode 包装器包装所有节点（AOP 风格）
// 节点函数内部无感知，由包装器自动记录 Span
const queryRewriteNode = traceNode(rawRewrite, 'rewrite');
const retrieveAndRankNode = traceNode(rawRetrieve, 'retrieve');
const draftNode = traceNode(rawDraft, 'make_draft');
const check_quality = traceNode(rawEvaluate, 'check_quality');
const handle_retry = traceNode(rawRetry, 'handle_retry');
const webSearchNode = traceNode(rawWebSearch, 'web_search');

// 初始化 Fastify
const fastify = Fastify({ logger: false });

// 注册跨域插件，允许前端 Vue 3 访问
await fastify.register(cors, {
    origin: true,
    methods: ['POST', 'GET']
});

// ==================== 1. 编译 LangGraph 图结构 ====================

const workflow = new StateGraph(RAGGraphState)
    // 1. 定义节点：改写、检索、草稿生成、评审打分、重试计数
    .addNode("supervisor", supervisorNode)
    .addNode("rewrite", queryRewriteNode)
    .addNode("retrieve", retrieveAndRankNode)
    .addNode("make_draft", draftNode)
    .addNode("check_quality", check_quality)
    .addNode("handle_retry", incrementRetryNode)
    .addNode("web_search", webSearchNode)

    // 2. 定义边：Supervisor 是中央调度者，其他节点都要把结果返回给 Supervisor，由 Supervisor 决定下一步派发给哪个节点继续处理
    .addEdge(START, "supervisor")
    .addEdge("rewrite", "supervisor")
    .addEdge("retrieve", "supervisor")
    .addEdge("make_draft", "supervisor")
    .addEdge("check_quality", "supervisor")
    .addEdge("handle_retry", "supervisor")
    .addEdge("web_search", "supervisor")

    .addConditionalEdges(
        "supervisor",
        (state) => state.nextAgent,
        {
            rewrite: "rewrite",
            retrieve: "retrieve",
            make_draft: "make_draft",
            check_quality: "check_quality",
            handle_retry: "handle_retry",
            web_search: "web_search",
            end: END
        }
    )

// 挂载内存检查点用于管理线程会话
const memory = new MemorySaver();
const graphApp = workflow.compile({ checkpointer: memory });

// ==================== 2. 编写 SSE 流式接口 ====================

fastify.post('/api/agent/chat', async (request, reply) => {
    const { query, threadId } = request.body;

    // 创建 Langfuse Trace
    // traceId 每次请求必须唯一，sessionId 可以复用（同一会话）
    const traceId = `trace-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const sessionId = threadId || `session-${Date.now()}`;
    const trace = langfuse.trace({
        id: traceId,
        sessionId: sessionId,
        userId: 'anonymous',
        input: { query, threadId },
        tags: ['rag', 'supervisor', 'chat']
    });

    console.log(`[Langfuse] Trace 创建：${traceId}, sessionId=${sessionId}`);
    console.log(`\n📩 收到请求：query=${query?.substring(0, 50)}..., threadId=${threadId}`);
    console.log(`   └─ Langfuse Trace: ${traceId}`);

    if (!query) {
        console.error('query 为空');
        trace.update({
            output: { error: "query 不能为空" },
            level: 'ERROR'
        });
        reply.code(400).send({ error: "query 不能为空" });
        return;
    }

    // 设置 Server-Sent Events (SSE) 响应头
    reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
    });

    // 立即刷新响应头，确保前端收到连接
    if (typeof reply.raw.flushHeaders === 'function') {
        reply.raw.flushHeaders();
    }

    // 建立 LangGraph 线程配置，复用前端传过来的 threadId 保持上下文
    const config = {
        configurable: {
            thread_id: threadId
        }
    };

    try {
        // 使用 graphApp.stream 进行异步流式输出 (LangGraph.js 使用 stream 而非 astream)
        // streamMode: 'updates' 返回每个节点的增量更新，格式：{ [节点名]: { 节点输出 } }
        // 注入 langfuseTrace 到 state，让节点内部的包装器可以访问
        const streamResult = await graphApp.stream(
            {
                query,
                langfuseTrace: trace
            },
            {
                ...config,
                streamMode: 'updates'
            }
        );

        const nodeOutputs = [];

        for await (const chunk of streamResult) {
            // chunk 格式：{ 节点名称：{ 该节点的输出字段 } }
            const nodeName = Object.keys(chunk)[0];
            const nodeUpdate = chunk[nodeName];

            // 跳过 supervisor 节点，它只是路由决策，不是实际工作节点
            if (nodeName === 'supervisor') continue;

            console.log(`[SSE] 推送节点：${nodeName}`, nodeUpdate);
            nodeOutputs.push(nodeName);

            // 构造推送到 Vue 3 前端的数据包
            const chunkData = {
                event: 'node_update',
                node: nodeName,
                meta: {
                    retryCount: nodeUpdate.retryCount,
                    reviewStatus: nodeUpdate.reviewStatus,
                    taskStatus: nodeUpdate.taskStatus,
                    contextPrecision: nodeUpdate.contextPrecision,
                    currentDraft: nodeUpdate.currentDraft || null
                }
            };

            // 必须严格遵守 SSE 协议格式：data: JSON 字符串\n\n
            reply.raw.write(`data: ${JSON.stringify(chunkData)}\n\n`);
            if (typeof reply.raw.flush === 'function') {
                reply.raw.flush();
            }
        }

        // 当异步迭代器执行完毕，说明整个图已经顺利走到了 END 节点
        console.log('[SSE] 执行完成');
        reply.raw.write(`data: ${JSON.stringify({ event: 'done' })}\n\n`);

        trace.update({
            output: { completed: true, nodeCount: nodeOutputs.length, nodes: nodeOutputs },
            metadata: { threadId: config.configurable.thread_id }
        });

        // 强制刷新到 Langfuse 云端
        console.log('[Langfuse] 准备刷新到云端...');
        await langfuse.flushAsync();
        console.log('[Langfuse] 刷新完成');

    } catch (error) {
        console.error('[SSE] 错误:', error.message);
        trace.update({
            output: { error: error.message },
            level: 'ERROR'
        });

        // 强制刷新错误到 Langfuse
        console.log('[Langfuse] 准备刷新错误到云端...');
        await langfuse.flushAsync();
        console.log('[Langfuse] 错误刷新完成');

        // 向前端推送错误事件，避免前端一直卡在 loading 状态
        reply.raw.write(`data: ${JSON.stringify({ event: 'error', message: error.message })}\n\n`);
    } finally {
        // 最终一定要关闭流，否则前端连接会一直挂起
        reply.raw.end();
    }
});

// ==================== 3. 启动服务 ====================

const start = async () => {
    try {
        await fastify.listen({ port: 3000, host: '0.0.0.0' });
    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};

start();
