<script setup lang="ts">
import { ref } from 'vue'
import { useAgentChat } from '@/hooks/useAgentChat'

const userQuery = ref('如何理解滑动窗口算法中的左右双指针扩张与收缩机制？')

const {
  isLoading,
  currentStep,
  currentDraft,
  retryCount,
  reviewStatus,
  taskStatus,
  startChat
} = useAgentChat()

function handleSubmit() {
  if (!userQuery.value.trim()) return

  startChat({
    query: userQuery.value,
    threadId: `vue_run_${Date.now()}`
  })
}
</script>

<template>
  <div class="agent-dashboard">
    <div class="main-panel">
      <!-- 输入区 -->
      <div class="input-area">
        <input
          v-model="userQuery"
          placeholder="请输入您的问题"
          :disabled="isLoading"
          @keyup.enter="handleSubmit"
        />
        <button @click="handleSubmit" :disabled="isLoading">
          {{ isLoading ? '运行中...' : '启动智能体' }}
        </button>
      </div>

      <!-- 输出区 -->
      <div class="output-area">
        <h3>当前生成草稿</h3>
        <div v-if="currentDraft" class="draft-content">
          {{ currentDraft }}
        </div>
        <div v-else-if="isLoading" class="loading-text">
          智能体正在深度思考，请观察右侧轨迹...
        </div>
        <div v-else class="empty-text">
          暂无数据，请输入问题并启动。
        </div>
      </div>
    </div>

    <!-- 状态面板 -->
    <div class="status-panel">
      <h3>Agent 内部动态流水线</h3>

      <div class="metrics" v-if="isLoading || reviewStatus">
        <p>当前状态：<span class="status-badge" :class="taskStatus">{{ taskStatus }}</span></p>
        <p>重试轮次：<span>{{ retryCount }} / 2</span></p>
        <p>
          质检结果：
          <span :class="reviewStatus || ''">{{ reviewStatus || '待评估' }}</span>
        </p>
      </div>

      <ul class="node-list">
        <li :class="{ 'node-active': currentStep === 'rewrite' }">
          查询改写节点 (rewrite)
        </li>
        <li :class="{ 'node-active': currentStep === 'retrieve' }">
          知识库检索节点 (retrieve)
        </li>
        <li :class="{ 'node-active': currentStep === 'make_draft' }">
          草稿工厂加工 (make_draft)
        </li>
        <li :class="{ 'node-active': currentStep === 'check_quality' }">
          裁判官质检评估 (check_quality)
        </li>
        <li :class="{ 'node-active': currentStep === 'handle_retry' }">
          重试计数器 (handle_retry)
        </li>
        <li :class="{ 'node-active': currentStep === 'web_search' }">
          网络搜索兜底 (web_search)
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.agent-dashboard {
  display: flex;
  gap: 20px;
  padding: 20px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  height: 80vh;
}

.main-panel {
  flex: 2;
  display: flex;
  flex-direction: column;
  gap: 15px;
}

.input-area {
  display: flex;
  gap: 10px;
}

.input-area input {
  flex: 1;
  padding: 10px 15px;
  font-size: 14px;
  border: 1px solid #ddd;
  border-radius: 4px;
  outline: none;
}

.input-area input:focus {
  border-color: #42b983;
}

.input-area button {
  padding: 10px 20px;
  background-color: #42b983;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-weight: 500;
}

.input-area button:hover:not(:disabled) {
  background-color: #3aa876;
}

.input-area button:disabled {
  background-color: #ccc;
  cursor: not-allowed;
}

.output-area {
  flex: 1;
  border: 1px solid #ddd;
  padding: 15px;
  background-color: #f9f9f9;
  border-radius: 4px;
  overflow-y: auto;
}

.draft-content {
  white-space: pre-wrap;
  line-height: 1.6;
  color: #2c3e50;
}

.loading-text,
.empty-text {
  color: #999;
  text-align: center;
  padding: 20px;
}

.status-panel {
  flex: 1;
  border: 1px solid #ddd;
  padding: 15px;
  background-color: #fff;
  border-radius: 4px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
}

.metrics {
  background-color: #f0f4f8;
  padding: 10px;
  margin-bottom: 15px;
  font-size: 14px;
  border-radius: 4px;
}

.status-badge {
  font-weight: bold;
  padding: 2px 8px;
  border-radius: 3px;
}

.status-badge.RUNNING {
  color: #1890ff;
  background-color: #e6f7ff;
}

.status-badge.FINISHED {
  color: #52c41a;
  background-color: #f6ffed;
}

.status-badge.ERROR {
  color: #ff4d4f;
  background-color: #fff1f0;
}

.node-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.node-list li {
  padding: 12px;
  margin-bottom: 8px;
  border-left: 4px solid #ddd;
  background-color: #f5f5f5;
  transition: all 0.3s ease;
  color: #666;
  border-radius: 0 4px 4px 0;
}

.node-list li.node-active {
  border-left-color: #42b983;
  background-color: #e8f7f0;
  color: #2c3e50;
  font-weight: bold;
  transform: translateX(5px);
}

.APPROVED {
  color: #52c41a;
  font-weight: bold;
}

.REJECT {
  color: #ff4d4f;
  font-weight: bold;
}

.SEARCH_WEB {
  color: #fa8c16;
  font-weight: bold;
}
</style>
