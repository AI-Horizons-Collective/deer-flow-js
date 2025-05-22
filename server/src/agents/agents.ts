import {
  DynamicStructuredTool,
  DynamicTool,
  StructuredToolInterface,
} from '@langchain/core/tools'
import { AgentState, createReactAgent } from '@langchain/langgraph/prebuilt'
import { get_llm_by_type } from '../llms/llm'
import { LLMType } from '../config/agents'
import { apply_prompt_template } from '../prompts/template'

export const create_agent = ({
  agent_name,
  agent_type,
  tools,
  prompt_template,
}: {
  agent_name: string
  agent_type: string
  tools: Array<DynamicStructuredTool | DynamicTool | StructuredToolInterface>
  prompt_template: string
}) => {
  return createReactAgent({
    name: agent_name,
    llm: get_llm_by_type(agent_type),
    tools,
    prompt: (state: AgentState) =>
      apply_prompt_template(prompt_template, state),
  })
}
