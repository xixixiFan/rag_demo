import apiClient from './request'

export interface AgentChatRequest {
  query: string
  threadId: string
}

export interface AgentChatResponse {
  event: 'node_update' | 'done' | 'error'
  node?: string
  meta?: {
    retryCount?: number
    reviewStatus?: string
    currentDraft?: string
  }
  message?: string
}

/**
 * Agent 对话接口 - 返回 SSE 流
 */
export async function chatWithAgent(params: AgentChatRequest): Promise<ReadableStream<Uint8Array>> {
  const response = await fetch(`${apiClient.defaults?.baseURL}/agent/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(params)
  })

  if (!response.body) {
    throw new Error('未返回可读流')
  }

  return response.body
}
