export type LLMType = 'basic' | 'reasoning' | 'vision'

export const AGENT_LLM_MAP = {
  coordinator: 'basic',
  planner: 'basic',
  researcher: 'basic',
  coder: 'basic',
  reporter: 'basic',
  podcast_script_writer: 'basic',
  ppt_composer: 'basic',
  prose_writer: 'basic',
} satisfies Record<string, LLMType>
