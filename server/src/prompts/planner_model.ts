import { z } from 'zod'

export enum StepType {
  RESEARCH = 'research',
  PROCESSING = 'processing',
}

export const Step = z.object({
  need_web_search: z.boolean().describe('Must be explicitly set for each step'),
  title: z.string(),
  description: z.string().describe('Specify exactly what data to collect'),
  step_type: z
    .nativeEnum(StepType)
    .describe('Indicates the nature of the step'),
  execution_res: z.string().optional().describe('The Step execution result'),
})

export const Plan = z.object({
  locale: z.string().describe(`
    User's language locale (e.g. 'en-US' or 'zh-CN').
    Example: "zh-CN"
  `),
  has_enough_context: z.boolean(),
  thought: z.string(),
  title: z.string(),
  steps: z.array(Step).default([]).describe(`Research steps example:
    [{
      "need_web_search": true,
      "title": "Current AI Market Analysis",
      "description": "Collect data on market size...",
      "step_type": "research"
    }]`),
}).describe(`Example Plan:
{
  "locale": "zh-CN",
  "has_enough_context": false,
  "thought": "To understand the current market trends...",
  "title": "AI Market Research Plan",
  "steps": [{
    "need_web_search": true,
    "title": "Market Analysis",
    "description": "Collect data on market size...",
    "step_type": "research"
  }]
}`)
