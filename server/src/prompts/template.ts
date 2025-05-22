import { format } from 'date-fns'
import { Configuration } from '@nestjs/cli/lib/configuration'
import { BaseMessage, SystemMessage } from '@langchain/core/messages'
import { AgentState } from '@langchain/langgraph/prebuilt'
import * as mustache from 'mustache'
import * as fs from 'node:fs'

const get_template = (name: string) => {
  const file = fs.readFileSync(`${__dirname}/${name}`, 'utf8')
  return {
    render: (view: Record<string, unknown>) => {
      return mustache.render(file, view)
    },
  }
}

export function apply_prompt_template(
  promptName: string,
  state: AgentState,
  configurable?: Configuration,
): BaseMessage[] {
  /**
   * Apply template variables to a prompt template and return formatted messages.
   *
   * @param promptName - Name of the prompt template to use
   * @param state - Current agent state containing variables to substitute
   * @param configurable - Optional configuration object
   * @returns List of messages with the system prompt as the first message
   * @throws Error when template rendering fails
   */

  // Convert state to object for template rendering
  const stateVars = {
    CURRENT_TIME: format(new Date(), 'EEE MMM dd yyyy HH:mm:ss XX'),
    ...state,
  }

  // Add configurable variables
  if (configurable) {
    Object.assign(stateVars, configurable)
  }

  try {
    // Note: You'll need to implement your template engine equivalent
    // This is a placeholder - replace with your actual template engine
    const template = get_template(`${promptName}.md`)
    const systemPrompt = template.render(stateVars)

    return [new SystemMessage(systemPrompt), ...state.messages]
  } catch (e) {
    throw new Error(`Error applying template ${promptName}: ${e}`)
  }
}
