import * as https from 'https'

// 环境变量配置
const UNIFIED_SEARCH_API_URL = 'https://cloud-iqs.aliyuncs.com/search/unified'
const UNIFIED_API_KEY =
  process.env.UNIFIED_API_KEY || 'zi6Qt1l3yVFZIfVNDEbaLzci7GJ1-nA2ODJhZWQ1Mw'

// 类型定义
interface SearchPayload {
  query: string
  engineType?: string
  timeRange?: string
  category?: string
  contents?: Record<string, any>
}

interface SearchResponse {
  [key: string]: any // 根据实际API响应结构调整
}

export class UnifiedSearchAPIWrapper {
  private readonly apiKey: string
  private httpsAgent?: https.Agent

  constructor(apiKey?: string) {
    this.apiKey = apiKey || UNIFIED_API_KEY
    if (!this.apiKey) {
      throw new Error('UNIFIED_API_KEY 环境变量未设置')
    }

    // 可选：配置HTTPS代理（如需）
    this.httpsAgent = new https.Agent({
      rejectUnauthorized: false, // 根据实际需求配置
    })
  }

  /**
   * 异步请求 unified search (使用fetch API)
   */
  async search(
    query: string,
    timeRange: string = 'NoLimit',
    category?: string,
    engineType: string = 'Generic',
    contents?: Record<string, any>,
  ): Promise<SearchResponse> {
    const headers = {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    }

    const payload: SearchPayload = {
      query,
      engineType,
      timeRange,
    }

    if (category) payload.category = category
    if (contents) payload.contents = contents

    try {
      const response = await fetch(UNIFIED_SEARCH_API_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        // agent: this.httpsAgent // Node.js环境下可配置
      })

      if (!response.ok) {
        throw new Error(
          `搜索请求失败: ${response.status} ${response.statusText}`,
        )
      }

      return await response.json()
    } catch (error) {
      throw new Error(
        `搜索请求异常: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
}
