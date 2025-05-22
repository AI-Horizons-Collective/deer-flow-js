import { Annotation, MessagesAnnotation } from '@langchain/langgraph'
import { Plan } from '../prompts/planner_model'
import { z } from 'zod'

// State for the agent system, extends MessagesState with next field.
export const State = Annotation.Root({
  ...MessagesAnnotation.spec,
  locale: Annotation<string>({
    default: () => 'en-US',
    reducer: (_, b) => b,
  }),
  observations: Annotation<string[]>({
    default: () => [],
    reducer: (a, b) => a.concat(b),
  }),
  plan_iterations: Annotation<number>({
    default: () => 0,
    reducer: (_, b) => b,
  }),
  current_plan: Annotation<z.infer<typeof Plan> | string | null>({
    default: () => null,
    reducer: (_, b) => b,
  }),
  final_report: Annotation<string>({
    default: () => '',
    reducer: (_, b) => b,
  }),
  auto_accepted_plan: Annotation<boolean>({
    default: () => false,
    reducer: (_, b) => b,
  }),
  enable_background_investigation: Annotation<boolean>({
    default: () => true,
    reducer: (_, b) => b,
  }),
  background_investigation_results: Annotation<string | null>({
    default: () => null,
    reducer: (_, b) => b,
  }),
  structuredResponse: Annotation<Record<string, any>>,
})
