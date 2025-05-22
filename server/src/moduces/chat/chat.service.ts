import { Observable, from, filter } from 'rxjs'
import { map } from 'rxjs/operators'
import { Injectable } from '@nestjs/common'
import { ChatMessage } from './chat.dto'
import { Command } from '@langchain/langgraph'
import {
  AIMessageChunk,
  BaseMessage,
  ToolMessage,
} from '@langchain/core/messages'
import { build_graph_with_memory } from '../../graph/builder'
import { isArray, isEmpty } from 'lodash-es'
import * as dotenv from 'dotenv'
import { last } from 'lodash-es'
import { State } from '../../graph/types'
dotenv.config()
const graph = build_graph_with_memory()

@Injectable()
export class ChatService {
  async streamWorkflowObservable({
    messages,
    thread_id,
    max_plan_iterations,
    max_step_num,
    max_search_results,
    auto_accepted_plan,
    interrupt_feedback,
    mcp_settings,
    enable_background_investigation,
  }: {
    messages: Array<ChatMessage>
    thread_id?: string
    max_plan_iterations?: number
    max_step_num?: number
    max_search_results?: number
    auto_accepted_plan?: boolean
    interrupt_feedback?: string | null
    mcp_settings?: Record<string, unknown> | null
    enable_background_investigation?: boolean
  }) {
    // 构造 input_
    let input_: unknown = {
      messages: messages,
      plan_iterations: 0,
      final_report: '',
      current_plan: null,
      observations: [],
      auto_accepted_plan: auto_accepted_plan,
      enable_background_investigation: enable_background_investigation,
    }
    if (!auto_accepted_plan && interrupt_feedback) {
      let resume_msg = `[${interrupt_feedback}]`
      if (messages) {
        resume_msg += ` ${last(messages)?.content}`
      }
      input_ = new Command({ resume: resume_msg })
    }

    const streams = await graph.stream(input_ as typeof State.State, {
      configurable: {
        thread_id,
        max_plan_iterations,
        max_step_num,
        max_search_results,
        mcp_settings,
      },
      streamMode: ['messages', 'updates'],
      subgraphs: true,
    })

    // 用 rxjs from+pipe 实现流式推送
    return from(streams).pipe(
      filter(([_, __, event_data]) => {
        return (
          (typeof event_data === 'object' && '__interrupt__' in event_data) ||
          isArray(event_data)
        )
      }),
      map(([agent, _, event_data]) => {
        if (typeof event_data === 'object' && '__interrupt__' in event_data) {
          return this.makeEvent('interrupt', {
            thread_id,
            id: event_data['__interrupt__'][0].ns[0],
            role: 'assistant',
            content: event_data['__interrupt__'][0].value,
            finish_reason: 'interrupt',
            options: [
              { text: 'Edit plan', value: 'edit_plan' },
              { text: 'Start research', value: 'accepted' },
            ],
          })
        }

        if (!isArray(event_data)) {
          return this.makeEvent('message_chunk', event_data)
        }

        const [message_chunk, message_metadata] = event_data as [
          BaseMessage,
          Record<string, any>,
        ]
        const agentName = agent[0].split(':')[0]
        const event_stream_message: Record<string, any> = {
          thread_id,
          agent: agentName,
          id: message_chunk.id,
          role: 'assistant',
          content: message_chunk.content,
        }

        const finish_reason =
          message_chunk.response_metadata?.finish_reason ||
          // @ts-expect-error
          message_chunk.additional_kwargs?.__raw_response?.choices?.[0]
            ?.finish_reason

        if (finish_reason) {
          event_stream_message.finish_reason = finish_reason
        }

        if (message_chunk instanceof ToolMessage) {
          event_stream_message.tool_call_id = message_chunk.tool_call_id
          return this.makeEvent('tool_call_result', event_stream_message)
        } else if (message_chunk instanceof AIMessageChunk) {
          if (!isEmpty(message_chunk.tool_calls)) {
            event_stream_message.tool_calls = message_chunk.tool_calls
            event_stream_message.tool_call_chunks =
              message_chunk.tool_call_chunks
            return this.makeEvent('tool_calls', event_stream_message)
          } else if (!isEmpty(message_chunk.tool_call_chunks)) {
            event_stream_message.tool_call_chunks =
              message_chunk.tool_call_chunks
            return this.makeEvent('tool_call_chunks', event_stream_message)
          }
        }
        return this.makeEvent('message_chunk', event_stream_message)
      }),
    )
  }
  private makeEvent(event_type: string, data: Record<string, any>): string {
    if (data.content === '') {
      delete data.content
    }
    return `event: ${event_type}\ndata: ${JSON.stringify(data, null, 0)}\n\n`
  }
}
