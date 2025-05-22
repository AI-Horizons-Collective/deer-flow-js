import * as dotenv from 'dotenv'

export const env = dotenv.config().parsed as {
  LANGSMITH_TRACING: string
  LANGSMITH_ENDPOINT: string
  LANGSMITH_API_KEY: string
  LANGSMITH_PROJECT: string
  AZURE_OPENAI_API_VERSION: string
  AZURE_OPENAI_API_DEPLOYMENT_NAME: string
  AZURE_OPENAI_API_KEY: string
  AZURE_OPEN_AI_ENDPOINT: string
  MODEL: string
}
