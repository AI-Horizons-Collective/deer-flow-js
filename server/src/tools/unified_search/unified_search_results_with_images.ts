import { UnifiedSearchAPIWrapper } from './unified_search_api_wrapper'
import { tool } from '@langchain/core/tools'
import { z } from 'zod'

export interface SearchResult {
  type: 'page' | 'image'
  title?: string
  url?: string
  content?: string
  score?: number
  raw_content?: string
  image_url?: string
  image_description?: string
}

interface RunOptions {
  query: string
  apiWrapper: UnifiedSearchAPIWrapper
  maxResults?: number
  includeRawContent?: boolean
  timeRange?: string
  category?: string
  engineType?: string
}

async function unifiedSearchRun(options: RunOptions) {
  const {
    query,
    apiWrapper,
    maxResults = 10,
    includeRawContent = false,
    timeRange = 'NoLimit',
    category,
    engineType = 'Generic',
  } = options

  // 参数校验
  if (!query?.trim()) {
    console.error(
      `UnifiedSearchResultsWithImages: query 字段缺失, query=${query}`,
    )
    throw new Error('query 字段不能为空')
  }

  // 结果清洗函数
  const cleanResults = (raw: any): SearchResult[] => {
    const results: SearchResult[] = []

    for (const item of raw.pageItems || []) {
      const pageResult: SearchResult = {
        type: 'page',
        title: item.title,
        url: item.link,
        content: item.snippet,
        score: item.rerankScore,
      }

      if (item.mainText) {
        pageResult.raw_content = item.mainText
      }

      results.push(pageResult)

      if (item.images) {
        for (const imgUrl of item.images) {
          results.push({
            type: 'image',
            image_url: imgUrl,
            image_description: item.title || '',
          })
        }
      }
    }

    return results.slice(0, maxResults)
  }

  // 执行搜索
  const contents = {
    mainText: includeRawContent,
    markdownText: false,
    summary: true,
    rerankScore: true,
  }

  try {
    const rawResult = await apiWrapper.search(
      query,
      timeRange,
      category,
      engineType,
      contents,
    )

    const cleaned = cleanResults(rawResult)
    console.log('sync results:', JSON.stringify(cleaned, null, 2))
    return [cleaned]
  } catch (e) {
    console.error('Search failed:', e)
    throw e
  }
}

export const UnifiedSearchResultsWithImages = tool(
  async ({ query }: { query: string }) => {
    const [results] = await unifiedSearchRun({
      query,
      apiWrapper: new UnifiedSearchAPIWrapper(),
      maxResults: 10,
    })
    return JSON.stringify(results)
  },
  {
    name: 'web_search',
    description: '联网查询工具，返回结构化搜索结果',
    schema: z.object({
      query: z.string().describe('要搜索的查询内容'),
    }),
  },
)
