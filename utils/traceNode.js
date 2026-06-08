// utils/traceNode.js
// 节点追踪包装器 - 为每个 LangGraph 节点自动记录 Langfuse Span
// AOP 设计：业务节点函数无感知，由包装器自动注入追踪逻辑

/**
 * 包装节点函数，自动记录 Span（输入、输出、耗时、错误）
 * @param {Function} nodeFn - 原始节点函数
 * @param {string} nodeName - 节点名称（用于 Langfuse 显示）
 * @returns {Function} 包装后的节点函数
 */
export function traceNode(nodeFn, nodeName) {
    return async (state, config) => {
        // 从 config.configurable 获取 trace（LangGraph 通过 config 传递）
        const trace = config?.configurable?.langfuseTrace;

        console.log(`[traceNode] ${nodeName}: trace = ${trace ? '存在' : 'null'}`);

        if (!trace) {
            // 如果没有 trace，直接执行原函数（降级处理）
            return await nodeFn(state);
        }

        // 创建 Span
        const span = trace.span({
            name: nodeName,
            input: sanitizeInput(nodeName, state)
        });

        const startTime = Date.now();

        try {
            // 调用原始节点函数（只传 state）
            const result = await nodeFn(state);
            const duration = Date.now() - startTime;

            span.update({
                output: sanitizeOutput(nodeName, result),
                metadata: { duration, status: 'success' }
            });

            return result;
        } catch (error) {
            const duration = Date.now() - startTime;

            span.update({
                output: { error: error.message },
                metadata: { duration, status: 'error' },
                level: 'ERROR'
            });
            throw error;
        }
    };
}

/**
 * 清理输入数据 - 移除敏感/过大的字段
 */
function sanitizeInput(nodeName, state) {
    const base = {
        query: state.query?.substring(0, 100),
        retryCount: state.retryCount || 0
    };

    // 根据节点类型添加特定字段
    if (nodeName === 'rewrite') {
        return base;
    }

    if (nodeName === 'retrieve') {
        return {
            ...base,
            currentRewrites: state.currentRewrites?.slice(0, 3)
        };
    }

    if (nodeName === 'make_draft') {
        return {
            ...base,
            retrievedContextsCount: state.retrievedContexts?.length || 0,
            hasWebSearch: state.hasWebSearch || false
        };
    }

    if (nodeName === 'check_quality') {
        return {
            ...base,
            currentDraftPreview: state.currentDraft?.substring(0, 100)
        };
    }

    if (nodeName === 'web_search') {
        return {
            ...base,
            searchQuery: state.query?.substring(0, 100)
        };
    }

    return base;
}

/**
 * 清理输出数据 - 根据节点类型选择性保留字段
 */
export function sanitizeOutput(nodeName, result) {
    const base = {
        agentHistory: result.agentHistory
    };

    if (nodeName === 'rewrite') {
        return {
            ...base,
            currentRewrites: result.currentRewrites
        };
    }

    if (nodeName === 'retrieve') {
        return {
            ...base,
            retrievedContextsCount: result.retrievedContexts?.length || 0
        };
    }

    if (nodeName === 'make_draft') {
        return {
            ...base,
            currentDraft: result.currentDraft?.substring(0, 500)
        };
    }

    if (nodeName === 'check_quality') {
        return {
            ...base,
            reviewStatus: result.reviewStatus,
            contextPrecision: result.contextPrecision,
            reviewFeedback: result.reviewFeedback?.substring(0, 200),
            issueType: result.issueType
        };
    }

    if (nodeName === 'web_search') {
        return {
            ...base,
            hasWebSearch: result.hasWebSearch,
            webResultsCount: result.retrievedContexts?.length || 0
        };
    }

    if (nodeName === 'handle_retry') {
        return {
            ...base,
            retryCount: result.retryCount
        };
    }

    // 默认返回全部（安全节点）
    return result;
}
