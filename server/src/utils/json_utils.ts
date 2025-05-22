import { jsonrepair } from 'jsonrepair'
import { Logger } from '../logger'

const logger = new Logger('json_utils')

/**
 * 修复和规范化JSON输出（严格保持蛇形命名）
 * @param content 可能包含JSON的字符串内容
 * @returns 修复后的JSON字符串，如果不是JSON则返回原始内容
 */
export function repair_json_output(content: string): string {
  content = content.trim()

  // 检查是否是JSON或代码块（保持原始逻辑）
  const is_json_like =
    content.startsWith('{') ||
    content.startsWith('[') ||
    content.includes('```json') ||
    content.includes('```ts')

  if (!is_json_like) {
    return content
  }

  try {
    // 移除代码块标记（保持原始处理逻辑）
    let processed_content = content
    if (processed_content.startsWith('```json')) {
      processed_content = processed_content.substring('```json'.length)
    } else if (processed_content.startsWith('```ts')) {
      processed_content = processed_content.substring('```ts'.length)
    }

    if (processed_content.endsWith('```')) {
      processed_content = processed_content.substring(
        0,
        processed_content.length - '```'.length,
      )
    }

    // 尝试修复JSON（保持原始处理流程）
    const repaired_content = jsonrepair(processed_content)
    return JSON.stringify(JSON.parse(repaired_content), null, 2)
  } catch (error) {
    // 保持原始错误处理方式
    if (error instanceof Error) {
      logger.warn(`JSON修复失败: ${error.message}`)
    } else {
      logger.warn(`JSON修复失败: ${String(error)}`)
    }
    return content
  }
}
