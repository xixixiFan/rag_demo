// 全局类型定义
export interface ApiResponse<T = any> {
  code?: number
  data: T
  message?: string
}
