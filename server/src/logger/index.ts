import { ConsoleLogger } from '@nestjs/common'
import { ConsoleLoggerOptions } from '@nestjs/common/services/console-logger.service'

export class Logger extends ConsoleLogger {
  constructor(name: string, options?: ConsoleLoggerOptions) {
    super(name, {
      colors: true,
      ...options,
    })
  }
}
