import { AzureChatOpenAI } from '@langchain/openai'
import { LLMType } from '../config/agents'
import { env } from '../utils/env_utils'

export function get_llm_by_type(type: LLMType | string) {
  return new AzureChatOpenAI({
    azureOpenAIApiVersion: env.AZURE_OPENAI_API_VERSION,
    azureOpenAIApiDeploymentName: env.AZURE_OPENAI_API_DEPLOYMENT_NAME,
    model: env.MODEL,
    azureOpenAIApiKey: env.AZURE_OPENAI_API_KEY,
    azureOpenAIEndpoint: env.AZURE_OPEN_AI_ENDPOINT,
    timeout: 30 * 60 * 1000,
    configuration: {
      timeout: 30 * 60 * 1000,
    },
    __includeRawResponse: true,
  })
}
