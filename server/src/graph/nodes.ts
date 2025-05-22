import { State } from './types'
import { Command, END, interrupt } from '@langchain/langgraph'
import { Logger } from '../logger'
import { apply_prompt_template } from '../prompts/template'
import { get_llm_by_type } from '../llms/llm'
import { AGENT_LLM_MAP, LLMType } from '../config/agents'
import {
  DynamicStructuredTool,
  DynamicTool,
  StructuredToolInterface,
  tool,
} from '@langchain/core/tools'
import { z } from 'zod'
import { isEmpty, isString, last } from 'lodash-es'
import { MultiServerMCPClient } from '@langchain/mcp-adapters'

import { RunnableConfig } from '@langchain/core/runnables'
import { Configuration } from '../config/configuration'
import { get_web_search_tool, LoggedUnifiedSearch } from '../tools/search'
import { AIMessage, HumanMessage } from '@langchain/core/messages'
import { Plan, StepType } from '../prompts/planner_model'
import { repair_json_output } from '../utils/json_utils'
import { create_agent } from '../agents/agents'
import { AgentState } from '@langchain/langgraph/prebuilt'

const logger = new Logger('nodes')

const handoff_to_planner = tool(() => null, {
  name: 'handoff_to_planner',
  description: '转交给规划代理进行计划制定。',
  schema: z.object({
    task_title: z.string().describe('需要转交的任务标题。'),
    locale: z.string().describe('用户检测到的语言区域（例如：en-US、zh-CN）。'),
  }),
})
export const coordinator_node = async (
  state: typeof State.State,
): Promise<Command<'planner' | 'background_investigator' | typeof END>> => {
  // Coordinator node that communicate with customers.
  logger.log('背景调查节点正在运行。')
  const messages = apply_prompt_template('coordinator', state)
  const response = await get_llm_by_type(AGENT_LLM_MAP.coordinator)
    .bindTools([handoff_to_planner])
    .invoke(messages)

  logger.debug(`当前状态消息: ${JSON.stringify(state.messages)}`)

  let goto = END
  let locale = state.locale || 'en-US'

  if (response.tool_calls && !isEmpty(response.tool_calls)) {
    goto = 'planner'
    if (state.enable_background_investigation) {
      goto = 'background_investigator'
    }
    try {
      for (const tool_call of response.tool_calls) {
        const toolName = tool_call.name || ''
        const toolArgs = tool_call.args || {}

        if (toolName !== 'handoff_to_planner') {
          continue
        }

        // 使用可选链和类型保护
        if (typeof toolArgs === 'object' && 'locale' in toolArgs) {
          const toolLocale = toolArgs.locale
          if (typeof toolLocale === 'string') {
            locale = toolLocale
            break
          }
        }
      }
    } catch (e) {
      logger.error(`处理工具调用时出错: ${e}`)
    }
  } else {
    logger.warn('协调器响应未包含任何工具调用。终止工作流执行。')
    logger.debug(`协调器响应内容: ${response}`)
  }
  return new Command({
    update: { locale },
    goto,
  })
}

// 背景调查
export const background_investigation_node = async (
  state: typeof State.State,
  // config: RunnableConfig,
): Promise<Command<'planner'>> => {
  logger.log('背景调查节点正在运行。')
  // const configurable = Configuration.fromRunnableConfig(config)
  const query = last(state.messages)?.content
  const _searched_content = await LoggedUnifiedSearch.invoke({
    query: query as string,
  })
  let searched_content: unknown
  if (isString(_searched_content)) {
    try {
      searched_content = JSON.parse(_searched_content)
    } catch {}
  }
  let background_investigation_results: unknown = null
  if (Array.isArray(searched_content)) {
    background_investigation_results = searched_content.map((elem) => ({
      title: elem.title || '',
      content: elem.content || '',
    }))
  } else {
    logger.error(`Unified search 返回了格式错误的响应: ${searched_content}`)
  }
  return new Command({
    goto: 'planner',
    update: {
      background_investigation_results: JSON.stringify(
        background_investigation_results,
      ),
    },
  })
}

export const planner_node = async (
  state: typeof State.State,
  config: RunnableConfig,
): Promise<Command<'human_feedback' | 'reporter'>> => {
  // Planner node that generate the full plan.
  logger.log('规划器正在生成完整方案')
  const configurable = Configuration.fromRunnableConfig(config)
  const plan_iterations = state.plan_iterations ?? 0
  const messages = apply_prompt_template('planner', state, configurable)
  let llm: ReturnType<typeof get_llm_by_type>
  if (
    plan_iterations === 0 &&
    state.enable_background_investigation &&
    state.background_investigation_results
  ) {
    messages.push(
      new HumanMessage(
        '用户查询的背景调查结果：\n' +
          state.background_investigation_results +
          '\n',
      ),
    )
  }

  if (AGENT_LLM_MAP.planner === 'basic') {
    llm = get_llm_by_type(AGENT_LLM_MAP.planner).withStructuredOutput(Plan, {
      method: 'jsonMode',
    }) as unknown as ReturnType<typeof get_llm_by_type>
  } else {
    llm = get_llm_by_type(AGENT_LLM_MAP.planner)
  }

  if (plan_iterations >= configurable.max_plan_iterations) {
    return new Command({
      goto: 'reporter',
    })
  }
  let full_response = ''
  if (AGENT_LLM_MAP.planner === 'basic') {
    const response = await llm.invoke(messages)
    full_response = JSON.stringify(response, null, 4)
  } else {
    const stream = await llm.stream(messages)
    for await (const chunk of stream) {
      if (chunk.content) {
        full_response += chunk.content
      }
    }
  }
  logger.debug(`当前状态消息: ${state.messages}`)
  logger.log(`规划器响应结果: ${full_response}`)
  let curr_plan: z.infer<typeof Plan>
  try {
    curr_plan = JSON.parse(repair_json_output(full_response))
  } catch (e) {
    logger.error('规划器返回的不是有效的JSON格式')
    if (plan_iterations > 0) {
      return new Command({ goto: 'reporter' })
    } else {
      return new Command({
        goto: END,
      })
    }
  }
  if (curr_plan?.has_enough_context) {
    logger.log('规划器响应包含足够上下文信息。')
    const new_plan = Plan.parse(curr_plan)
    return new Command({
      update: {
        messages: [
          new AIMessage({
            content: full_response,
            name: 'planner',
          }),
        ],
        current_plan: new_plan,
      },
      goto: 'reporter',
    })
  }

  return new Command({
    update: {
      messages: [
        new AIMessage({
          content: full_response,
          name: 'planner',
        }),
      ],
      current_plan: full_response,
    },
    goto: 'human_feedback',
  })
}

export const reporter_node = async (state: typeof State.State) => {
  /** Reporter node that write a final report. */
  console.info('报告员正在撰写最终报告')
  const current_plan = (state.current_plan as z.infer<typeof Plan>) || null

  // 准备输入消息
  const input_ = {
    messages: [
      new HumanMessage({
        content: `# 调研要求\n\n## 任务\n\n${current_plan?.title}\n\n## 描述\n\n${current_plan?.thought}`,
      }),
    ],
    locale: state.locale || 'en-US',
  }

  // 应用提示模板
  let invoke_messages = apply_prompt_template(
    'reporter',
    input_ as unknown as AgentState,
  )
  const observations = state.observations || []

  // 添加报告格式提醒
  invoke_messages.push(
    new HumanMessage({
      content: `重要提示：请按照提示中的格式撰写报告。务必包含以下内容：\n\n1. 关键要点 - 列出最重要的发现（使用项目符号）\n2. 概述 - 对主题的简要介绍\n3. 详细分析 - 按逻辑分章节组织内容\n4. 调查备注（可选） - 适用于更全面的报告\n5. 主要参考文献 - 在结尾列出所有引用\n\n关于文献引用：\n- 不要在正文中使用内联引用\n- 所有引用统一放在"主要参考文献"部分\n- 使用格式：\`- [来源标题](URL)\`\n- 每个引用之间空一行以提高可读性\n\n数据呈现优先使用Markdown表格：\n- 当展示对比数据、统计数据、特性或选项时请使用表格\n- 表格需包含清晰的表头和对齐的列\n\n示例表格格式：\n\n| 特性 | 描述 | 优点 | 缺点 |\n|------|------|------|------|\n| 特性1 | 描述1 | 优点1 | 缺点1 |\n| 特性2 | 描述2 | 优点2 | 缺点2 |`,
      name: 'system',
    }),
  )

  // 添加观察结果
  for (const observation of observations) {
    invoke_messages.push(
      new HumanMessage({
        content: `以下是针对调研任务的一些观察结果：\n\n${observation}`,
        name: 'observation',
      }),
    )
  }

  console.debug(`当前调用消息内容: ${JSON.stringify(invoke_messages)}`)

  // 调用LLM生成报告
  const response = await get_llm_by_type(AGENT_LLM_MAP['reporter']).invoke(
    invoke_messages,
  )
  const response_content = response.content
  logger.log(`报告生成结果: ${response_content}`)

  return { final_report: response_content }
}

export const research_team_node = async (
  state: typeof State.State,
): Promise<Command<'planner' | 'researcher' | 'coder'>> => {
  // Research team node that collaborates on tasks.
  logger.log('研究团队正在协作完成任务。')
  const current_plan = state.current_plan as z.infer<typeof Plan>

  if (!current_plan || !current_plan.steps) {
    return new Command({ goto: 'planner' })
  }
  if (current_plan.steps.every((step) => step.execution_res)) {
    return new Command({ goto: 'planner' })
  }
  let step: z.infer<typeof Plan>['steps'][number] | null = null
  for (const _step of current_plan.steps) {
    if (!_step.execution_res) {
      step = _step
      break
    }
  }
  if (step?.step_type === StepType.RESEARCH) {
    return new Command({ goto: 'researcher' })
  }
  // if (step?.step_type === StepType.PROCESSING) {
  //   return new Command({ goto: 'coder' })
  // }
  return new Command({ goto: 'planner' })
}

// Helper function to execute a step using the specified agent.
const _execute_agent_step = async (
  state: typeof State.State,
  agent: ReturnType<typeof create_agent>,
  agent_name: string,
): Promise<Command<'research_team'>> => {
  /** Helper function to execute a step using the specified agent. */
  let current_plan = state.current_plan as z.infer<typeof Plan>
  const observations = state.observations || []

  // Find the first unexecuted step
  let current_step: z.infer<typeof Plan>['steps'][number] | null = null
  const completed_steps: z.infer<typeof Plan>['steps'] = []

  if (current_plan?.steps) {
    for (const step of current_plan.steps) {
      if (!step.execution_res) {
        current_step = step
        break
      } else {
        completed_steps.push(step)
      }
    }
  }

  if (!current_step) {
    logger.warn('未找到待执行的步骤')
    return new Command({ goto: 'research_team' })
  }

  logger.log(`正在执行步骤: ${current_step.title}`)

  // Format completed steps information
  let completed_steps_info = ''
  if (completed_steps.length > 0) {
    completed_steps_info = '# 已有研究成果\n\n'
    completed_steps.forEach((step, i) => {
      completed_steps_info += `## 已有发现 ${i + 1}: ${step.title}\n\n`
      completed_steps_info += `<研究结果>\n${step.execution_res}\n</研究结果>\n\n`
    })
  }

  // Prepare the input for the agent with completed steps info
  const agent_input = {
    messages: [
      new HumanMessage({
        content: `${completed_steps_info}# 当前任务\n\n## 任务标题\n\n${current_step.title}\n\n## 任务描述\n\n${current_step.description}\n\n## 语言区域\n\n${state.locale || 'en-US'}`,
      }),
    ],
  }

  // Add citation reminder for researcher agent
  if (agent_name === 'researcher') {
    agent_input.messages.push(
      new HumanMessage({
        content:
          '重要提示：请勿在正文中使用内联引用。请追踪所有来源并在报告末尾添加"参考文献"部分，使用链接引用格式。每个引用之间空一行以提高可读性。请使用以下格式：\n- [来源标题](URL)\n\n- [其他来源](URL)',
        name: 'system',
      }),
    )
  }

  // Invoke the agent
  const default_recursion_limit = 25
  let recursion_limit = default_recursion_limit

  try {
    const env_value_str =
      process.env.AGENT_RECURSION_LIMIT || default_recursion_limit.toString()
    const parsed_limit = parseInt(env_value_str)

    if (parsed_limit > 0) {
      recursion_limit = parsed_limit
      logger.log(`递归深度限制设置为: ${recursion_limit}`)
    } else {
      logger.warn(
        `环境变量 AGENT_RECURSION_LIMIT 的值 '${env_value_str}' (解析为 ${parsed_limit}) 不是正数。` +
          `将使用默认值 ${default_recursion_limit}。`,
      )
    }
  } catch (error) {
    const raw_env_value = process.env.AGENT_RECURSION_LIMIT
    logger.warn(
      `无效的 AGENT_RECURSION_LIMIT 值: '${raw_env_value}'。` +
        `将使用默认值 ${default_recursion_limit}。`,
    )
  }

  const result = await agent.invoke(agent_input, {
    recursionLimit: recursion_limit,
  })

  // Process the result
  const response_content = result.messages[result.messages.length - 1].content
  logger.debug(
    `${agent_name.charAt(0).toUpperCase() + agent_name.slice(1)} full response: ${response_content}`,
  )

  // Update the step with the execution result
  current_step.execution_res = response_content as string
  logger.log(`步骤"${current_step.title}"执行完成，执行者: ${agent_name}`)

  return new Command({
    update: {
      messages: [
        new HumanMessage({
          content: response_content,
          name: agent_name,
        }),
      ],
      observations: [...observations, response_content],
    },
    goto: 'research_team',
  })
}

/**
 * Helper function to set up an agent with appropriate tools and execute a step.
 *
 * This function handles the common logic for both researcher_node and coder_node:
 * 1. Configures MCP servers and tools based on agent type
 * 2. Creates an agent with the appropriate tools or uses the default agent
 * 3. Executes the agent on the current step
 *
 * @param state - The current state
 * @param config - The runnable config
 * @param agent_type - The type of agent ("researcher" or "coder")
 * @param default_tools - The default tools to add to the agent
 * @returns Command to update state and go to research_team
 */
const _setup_and_execute_agent_step = async (
  state: typeof State.State,
  config: RunnableConfig,
  agent_type: string,
  default_tools: Array<
    DynamicStructuredTool | DynamicTool | StructuredToolInterface
  >,
): Promise<Command<'research_team'>> => {
  const configurable = Configuration.fromRunnableConfig(config)
  const mcp_servers = {}
  const enabled_tools = {}
  // 提取 MCP 服务器配置（根据 agent 类型）
  if (configurable.mcp_settings) {
    for (const [server_name, server_config] of Object.entries(
      configurable.mcp_settings.servers,
    )) {
      if (
        server_config.enabled_tools &&
        server_config.add_to_agents.includes(agent_type)
      ) {
        // 提取需要的服务器配置字段
        mcp_servers[server_name] = Object.fromEntries(
          Object.entries(server_config).filter(([k, _]) =>
            ['transport', 'command', 'args', 'url', 'env'].includes(k),
          ),
        )

        // 记录启用的工具
        for (const tool_name of server_config.enabled_tools) {
          enabled_tools[tool_name] = server_name
        }
      }
    }
  }

  // 创建并执行带有 MCP 工具的 agent（如果可用）
  if (Object.keys(mcp_servers).length > 0) {
    const client = new MultiServerMCPClient(mcp_servers)
    try {
      const loaded_tools = [...default_tools] // 复制默认工具数组
      const mcp_tools = await client.getTools()

      for (const tool of mcp_tools) {
        if (tool.name in enabled_tools) {
          tool.description = `Powered by '${enabled_tools[tool.name]}'.\n${tool.description}`
          loaded_tools.push(tool)
        }
      }

      const agent = create_agent({
        agent_name: agent_type,
        agent_type,
        tools: loaded_tools,
        prompt_template: agent_type,
      })
      return await _execute_agent_step(state, agent, agent_type)
    } finally {
      await client.close() // 确保资源释放
    }
  } else {
    // 如果没有配置 MCP 服务器，使用默认工具
    const agent = create_agent({
      agent_name: agent_type,
      agent_type,
      tools: default_tools,
      prompt_template: agent_type,
    })
    return await _execute_agent_step(state, agent, agent_type)
  }
}
export const researcher_node = async (
  state: typeof State.State,
  config: RunnableConfig,
): Promise<Command<'planner' | 'reporter' | 'research_team'>> => {
  // Researcher node that do research
  logger.log('Researcher node is researching.')
  const configurable = Configuration.fromRunnableConfig(config)
  const web_search_tool = get_web_search_tool(configurable.max_search_results)
  return _setup_and_execute_agent_step(state, config, 'researcher', [
    web_search_tool,
    // crawl_tool,
  ])
}

export const human_feedback_node = async (
  state: typeof State.State,
): Promise<Command<'planner' | 'research_team' | 'reporter' | typeof END>> => {
  const current_plan = state.current_plan || ''
  const auto_accepted_plan = state.auto_accepted_plan || false

  if (!auto_accepted_plan) {
    const feedback = interrupt('请审核该计划。')

    if (feedback && String(feedback).toUpperCase().startsWith('[EDIT_PLAN]')) {
      return new Command({
        update: {
          messages: [
            new HumanMessage({
              content: feedback,
              name: 'feedback',
            }),
          ],
        },
        goto: 'planner',
      })
    } else if (
      feedback &&
      String(feedback).toUpperCase().startsWith('[ACCEPTED]')
    ) {
      logger.log('计划已获得用户确认。')
    } else {
      throw new TypeError(`不支持的中断反馈值: ${feedback}`)
    }
  }

  let plan_iterations = state.plan_iterations || 0
  let goto: 'planner' | 'research_team' | 'reporter' | '__end__' =
    'research_team'

  try {
    const repaired_plan = repair_json_output(current_plan as string)
    plan_iterations += 1
    const new_plan = JSON.parse(repaired_plan)

    if (new_plan.has_enough_context) {
      goto = 'reporter'
    }

    const _current_plan = Plan.parse(new_plan)
    return new Command({
      update: {
        current_plan: _current_plan,
        plan_iterations,
        locale: new_plan.locale,
      },
      goto,
    })
  } catch (error) {
    logger.warn('规划器返回的响应不是有效的JSON格式')
    if (plan_iterations > 0) {
      return new Command({ goto: 'reporter' })
    } else {
      return new Command({ goto: END })
    }
  }
}
