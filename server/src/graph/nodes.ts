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
import { isEmpty, last } from 'lodash-es'
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
  description: 'Handoff to planner agent to do plan.',
  schema: z.object({
    task_title: z.string().describe('The title of the task to be handed off.'),
    locale: z
      .string()
      .describe("The user's detected language locale (e.g., en-US, zh-CN)."),
  }),
})
export const coordinator_node = async (
  state: typeof State.State,
): Promise<Command<'planner' | 'background_investigator' | typeof END>> => {
  // Coordinator node that communicate with customers.
  logger.log('background investigation node is running.')
  const messages = apply_prompt_template('coordinator', state)
  const response = await get_llm_by_type(AGENT_LLM_MAP.coordinator)
    .bindTools([handoff_to_planner])
    .invoke(messages)

  logger.debug(`Current state messages: ${JSON.stringify(state.messages)}`)

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
      logger.error(`Error processing tool calls: ${e}`)
    }
  } else {
    logger.warn(
      'Coordinator response contains no tool calls. Terminating workflow execution.',
    )
    logger.debug(`Coordinator response: ${response}`)
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
  logger.log('background investigation node is running.')
  // const configurable = Configuration.fromRunnableConfig(config)
  const query = last(state.messages)?.content
  const searched_content = await LoggedUnifiedSearch.invoke({
    query: query as string,
  })
  let background_investigation_results: unknown = null
  if (Array.isArray(searched_content)) {
    background_investigation_results = searched_content.map((elem) => ({
      title: elem.title || '',
      content: elem.content || '',
    }))
  } else {
    logger.error(
      `Unified search returned malformed response: ${searched_content}`,
    )
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
  logger.log('Planner generating full plan')
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
        'background investigation results of user query:\n' +
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
  logger.debug(`Current state messages: ${state.messages}`)
  logger.log(`Planner response: ${full_response}`)
  let curr_plan: z.infer<typeof Plan>
  try {
    curr_plan = JSON.parse(repair_json_output(full_response))
  } catch (e) {
    logger.error('Planner response is not a valid JSON')
    if (plan_iterations > 0) {
      return new Command({ goto: 'reporter' })
    } else {
      return new Command({
        goto: END,
      })
    }
  }
  if (curr_plan?.has_enough_context) {
    logger.log('Planner response has enough context.')
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
  console.info('Reporter write final report')
  const current_plan = (state.current_plan as z.infer<typeof Plan>) || null

  // 准备输入消息
  const input_ = {
    messages: [
      new HumanMessage({
        content: `# Research Requirements\n\n## Task\n\n${current_plan?.title}\n\n## Description\n\n${current_plan?.thought}`,
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
      content: `IMPORTANT: Structure your report according to the format in the prompt. Remember to include:\n\n1. Key Points - A bulleted list of the most important findings\n2. Overview - A brief introduction to the topic\n3. Detailed Analysis - Organized into logical sections\n4. Survey Note (optional) - For more comprehensive reports\n5. Key Citations - List all references at the end\n\nFor citations, DO NOT include inline citations in the text. Instead, place all citations in the 'Key Citations' section at the end using the format: \`- [Source Title](URL)\`. Include an empty line between each citation for better readability.\n\nPRIORITIZE USING MARKDOWN TABLES for data presentation and comparison. Use tables whenever presenting comparative data, statistics, features, or options. Structure tables with clear headers and aligned columns. Example table format:\n\n| Feature | Description | Pros | Cons |\n|---------|-------------|------|------|\n| Feature 1 | Description 1 | Pros 1 | Cons 1 |\n| Feature 2 | Description 2 | Pros 2 | Cons 2 |`,
      name: 'system',
    }),
  )

  // 添加观察结果
  for (const observation of observations) {
    invoke_messages.push(
      new HumanMessage({
        content: `Below are some observations for the research task:\n\n${observation}`,
        name: 'observation',
      }),
    )
  }

  console.debug(`Current invoke messages: ${JSON.stringify(invoke_messages)}`)

  // 调用LLM生成报告
  const response = await get_llm_by_type(AGENT_LLM_MAP['reporter']).invoke(
    invoke_messages,
  )
  const response_content = response.content
  logger.log(`reporter response: ${response_content}`)

  return { final_report: response_content }
}

export const research_team_node = async (
  state: typeof State.State,
): Promise<Command<'planner' | 'researcher' | 'coder'>> => {
  // Research team node that collaborates on tasks.
  logger.log('Research team is collaborating on tasks.')
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
    logger.warn('No unexecuted step found')
    return new Command({ goto: 'research_team' })
  }

  logger.log(`Executing step: ${current_step.title}`)

  // Format completed steps information
  let completed_steps_info = ''
  if (completed_steps.length > 0) {
    completed_steps_info = '# Existing Research Findings\n\n'
    completed_steps.forEach((step, i) => {
      completed_steps_info += `## Existing Finding ${i + 1}: ${step.title}\n\n`
      completed_steps_info += `<finding>\n${step.execution_res}\n</finding>\n\n`
    })
  }

  // Prepare the input for the agent with completed steps info
  const agent_input = {
    messages: [
      new HumanMessage({
        content: `${completed_steps_info}# Current Task\n\n## Title\n\n${current_step.title}\n\n## Description\n\n${current_step.description}\n\n## Locale\n\n${state.locale || 'en-US'}`,
      }),
    ],
  }

  // Add citation reminder for researcher agent
  if (agent_name === 'researcher') {
    agent_input.messages.push(
      new HumanMessage({
        content:
          'IMPORTANT: DO NOT include inline citations in the text. Instead, track all sources and include a References section at the end using link reference format. Include an empty line between each citation for better readability. Use this format for each reference:\n- [Source Title](URL)\n\n- [Another Source](URL)',
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
      logger.log(`Recursion limit set to: ${recursion_limit}`)
    } else {
      logger.warn(
        `AGENT_RECURSION_LIMIT value '${env_value_str}' (parsed as ${parsed_limit}) is not positive. ` +
          `Using default value ${default_recursion_limit}.`,
      )
    }
  } catch (error) {
    const raw_env_value = process.env.AGENT_RECURSION_LIMIT
    logger.warn(
      `Invalid AGENT_RECURSION_LIMIT value: '${raw_env_value}'. ` +
        `Using default value ${default_recursion_limit}.`,
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
  logger.log(
    `Step '${current_step.title}' execution completed by ${agent_name}`,
  )

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
    const feedback = interrupt('Please Review the Plan.')

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
      logger.log('Plan is accepted by user.')
    } else {
      throw new TypeError(`Interrupt value of ${feedback} is not supported.`)
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
    logger.warn('Planner response is not a valid JSON')
    if (plan_iterations > 0) {
      return new Command({ goto: 'reporter' })
    } else {
      return new Command({ goto: END })
    }
  }
}
