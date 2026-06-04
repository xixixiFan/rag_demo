export async function supervisorNode(state) {
    const agentHistory = [...(state.agentHistory || []), "supervisor"];
    const decisionLog = [...(state.decisionLog || [])];

    if (!state.currentRewrites || state.currentRewrites.length === 0) {
        decisionLog.push("缺少 currentRewrites，派发给 rewrite");
        return {
            nextAgent: "rewrite",
            taskStatus: "RUNNING",
            agentHistory,
            decisionLog
        };
    }

    if (!state.retrievedContexts || state.retrievedContexts.length === 0) {
        decisionLog.push("缺少 retrievedContexts，派发给 retrieve");
        return {
            nextAgent: "retrieve",
            taskStatus: "RUNNING",
            agentHistory,
            decisionLog
        };
    }

    if (!state.currentDraft) {
        decisionLog.push("缺少 currentDraft，派发给 make_draft");
        return {
            nextAgent: "make_draft",
            taskStatus: "RUNNING",
            agentHistory,
            decisionLog
        };
    }

    if (!state.reviewStatus) {
        decisionLog.push("缺少 reviewStatus，派发给 check_quality");
        return {
            nextAgent: "check_quality",
            taskStatus: "RUNNING",
            agentHistory,
            decisionLog
        };
    }

    if (state.reviewStatus === "SEARCH_WEB") {
        decisionLog.push("reviewStatus=SEARCH_WEB，派发给 web_search");
        return {
            nextAgent: "web_search",
            taskStatus: "RUNNING",
            agentHistory,
            decisionLog
        };
    }

    // 如果 reviewStatus === "APPROVED"，Supervisor 就可以结束流程了。
    // 这时除了 nextAgent，还要把 finalAnswer 写进去。
    if (state.reviewStatus === "APPROVED") {
        decisionLog.push("reviewStatus=APPROVED，流程结束");
        return {
            nextAgent: "end",
            taskStatus: "APPROVED",
            finalAnswer: state.currentDraft,
            agentHistory,
            decisionLog
        };
    }

    if (state.reviewStatus === "REJECT" && (state.retryCount || 0) < 2) {
        const retryTarget = state.retryTarget || "make_draft";

        if (retryTarget === "rewrite") {
            decisionLog.push(`reviewStatus=REJECT，retryTarget=rewrite，派发给 rewrite`);
            return {
                nextAgent: "rewrite",
                taskStatus: "NEED_RETRY",
                agentHistory,
                decisionLog
            };
        }

        if (retryTarget === "retrieve") {
            decisionLog.push(`reviewStatus=REJECT，retryTarget=retrieve，派发给 retrieve`);
            return {
                nextAgent: "retrieve",
                taskStatus: "NEED_RETRY",
                agentHistory,
                decisionLog
            };
        }

        if (retryTarget === "web_search") {
            decisionLog.push(`reviewStatus=REJECT，retryTarget=web_search，派发给 web_search`);
            return {
                nextAgent: "web_search",
                taskStatus: "NEED_RETRY",
                agentHistory,
                decisionLog
            };
        }

        decisionLog.push(`reviewStatus=REJECT，retryTarget=${retryTarget}，派发给 handle_retry`);
        return {
            nextAgent: "handle_retry",
            taskStatus: "NEED_RETRY",
            agentHistory,
            decisionLog
        };
    }


    decisionLog.push(`流程失败结束，reviewStatus=${state.reviewStatus}, retryCount=${state.retryCount || 0}`);
    return {
        nextAgent: "end",
        taskStatus: "FAILED",
        reviewStatus: "MELT",
        failureReason: state.reviewStatus === "MELT"
            ? "melt"
            : "retry_limit_or_unknown_status",
        agentHistory,
        decisionLog
    };
}
