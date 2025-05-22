import { Controller, Post, Body, Res, HttpStatus, Header } from '@nestjs/common'
import { Response } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { ChatRequest } from './chat.dto'
import { ChatService } from './chat.service'

@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post('stream')
  @Header('Content-Type', 'text/event-stream; charset=utf-8')
  async chatStream(@Body() request: ChatRequest, @Res() res: Response) {
    let thread_id = request.thread_id
    if (thread_id === '__default__') {
      thread_id = uuidv4()
    }

    // 设置与 Python 完全一致的响应头
    res.set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })
    res.status(HttpStatus.OK)

    // 调用流式 Observable（需确保返回原始 JSON 字符串）
    const observable = await this.chatService.streamWorkflowObservable({
      messages: request.messages || [],
      thread_id,
      max_plan_iterations: request.max_plan_iterations,
      max_step_num: request.max_step_num,
      max_search_results: request.max_search_results,
      auto_accepted_plan: request.auto_accepted_plan,
      interrupt_feedback: request.interrupt_feedback,
      mcp_settings: request.mcp_settings,
      enable_background_investigation: request.enable_background_investigation,
    })

    observable.subscribe({
      next: (event) => {
        // 直接写入 JSON 字符串 + 换行（无 data: 前缀）
        res.write(event)
      },
      error: (err) => {
        res.write(`${JSON.stringify({ error: err.message })}\n`)
        res.end()
      },
      complete: () => {
        res.end()
      },
    })
  }
}
