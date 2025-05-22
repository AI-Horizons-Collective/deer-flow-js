import { RunnableConfig } from '@langchain/core/runnables'

export class Configuration {
  /** The configurable fields */
  max_plan_iterations: number = 1 // Maximum number of plan iterations
  max_step_num: number = 3 // Maximum number of steps in a plan
  max_search_results: number = 3 // Maximum number of search results
  mcp_settings: Record<
    string,
    {
      servers: {
        enabled_tools: Array<string>
        add_to_agents: Array<string>
      }
    }
  > | null = null // MCP settings, including dynamic loaded tools

  constructor(params?: Partial<Configuration>) {
    if (params) {
      Object.assign(this, params)
    }
  }

  static fromRunnableConfig(config?: RunnableConfig): Configuration {
    /** Create a Configuration instance from a RunnableConfig */
    const configurable = config?.configurable || {}
    const values: Record<string, any> = {}

    // Get all class properties (including inherited ones)
    const propertyNames = Object.getOwnPropertyNames(
      Configuration.prototype,
    ).filter((name) => name !== 'constructor' && !name.startsWith('from'))

    // Add instance properties (from constructor)
    const instanceProperties = [
      'max_plan_iterations',
      'max_step_num',
      'max_search_results',
      'mcp_settings',
    ]

    for (const prop of [...propertyNames, ...instanceProperties]) {
      const envValue = process.env[prop.toUpperCase()]
      const configValue = configurable[prop]
      if (envValue !== undefined || configValue !== undefined) {
        values[prop] = envValue !== undefined ? envValue : configValue
      }
    }

    return new Configuration(values)
  }
}
