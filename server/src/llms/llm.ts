import { AzureChatOpenAI } from '@langchain/openai'
import { LLMType } from '../config/agents'

export function get_llm_by_type(type: LLMType | string) {
  return new AzureChatOpenAI({
    azureOpenAIApiVersion: '2025-03-01-preview',
    azureOpenAIApiDeploymentName: 'gpt-4.1',
    model: 'gpt-4.1',
    azureOpenAIApiKey:
      '2y1nDyDFJ7c4d2JmBYrgvbmD8N5PJFwpEcuwTQOidfjA6tZJbJ89JQQJ99BEACHYHv6XJ3w3AAAAACOGQcvC',
    azureOpenAIEndpoint:
      'https://admin-m9qk68sa-eastus2.cognitiveservices.azure.com',
    timeout: 30 * 60 * 1000,
    configuration: {
      timeout: 30 * 60 * 1000,
    },
    __includeRawResponse: true,
  })
}
