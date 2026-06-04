import { ref } from 'vue'

export interface UseAgentChatOptions {
  query: string
  threadId: string
}

export interface AgentMeta {
  retryCount: number
  reviewStatus: string
  currentDraft: string | null
}

/**
 * Agent 对话 Hook - 处理 SSE 流式响应
 */
export function useAgentChat() {
  const isLoading = ref(false)
  const currentStep = ref('')
  const currentDraft = ref('')
  const retryCount = ref(0)
  const reviewStatus = ref('')
  const taskStatus = ref<'IDLE' | 'RUNNING' | 'FINISHED' | 'ERROR'>('IDLE')

  async function startChat(options: UseAgentChatOptions) {
    if (!options.query.trim()) return

    // 重置状态
    isLoading.value = true
    currentStep.value = ''
    currentDraft.value = ''
    retryCount.value = 0
    reviewStatus.value = ''
    taskStatus.value = 'RUNNING'

    try {
      const response = await fetch('http://localhost:3000/api/agent/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          query: options.query,
          threadId: options.threadId
        })
      })

      if (!response.body) {
        throw new Error('未返回可读流')
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder('utf-8')
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const messages = buffer.split('\n\n')
        buffer = messages.pop() || ''

        for (const message of messages) {
          if (!message.startsWith('data: ')) continue

          const jsonStr = message.replace('data: ', '').trim()
          if (!jsonStr) continue

          try {
            const parsed = JSON.parse(jsonStr)

            // useAgentChat.ts 内部解析部分的微调
            if (parsed.event === 'node_update') {
              currentStep.value = parsed.node
              if (parsed.meta) {
                if (parsed.meta.retryCount !== undefined) retryCount.value = parsed.meta.retryCount
                if (parsed.meta.reviewStatus !== undefined) reviewStatus.value = parsed.meta.reviewStatus
                if (parsed.meta.currentDraft) currentDraft.value = parsed.meta.currentDraft

                // 实时感知后端返回的全局任务状态（RUNNING | NEED_RETRY | FAILED | APPROVED）
                if (parsed.meta.taskStatus) {
                  if (parsed.meta.taskStatus === 'FAILED') {
                    taskStatus.value = 'ERROR'; // 触发前端熔断样式
                  } else if (parsed.meta.taskStatus === 'APPROVED') {
                    taskStatus.value = 'FINISHED';
                  }
                }
              }
            } else if (parsed.event === 'done') {
              taskStatus.value = 'FINISHED'
              currentStep.value = ''
            } else if (parsed.event === 'error') {
              taskStatus.value = 'ERROR'
              console.error('Agent 错误:', parsed.message)
            }
          } catch (e) {
            console.error('解析流数据失败:', e)
          }
        }
      }
    } catch (error) {
      console.error('请求失败:', error)
      taskStatus.value = 'ERROR'
    } finally {
      isLoading.value = false
    }
  }

  function reset() {
    isLoading.value = false
    currentStep.value = ''
    currentDraft.value = ''
    retryCount.value = 0
    reviewStatus.value = ''
    taskStatus.value = 'IDLE'
  }

  return {
    isLoading,
    currentStep,
    currentDraft,
    retryCount,
    reviewStatus,
    taskStatus,
    startChat,
    reset
  }
}
