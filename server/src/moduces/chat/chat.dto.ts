import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsInt, IsObject, IsOptional, IsString } from 'class-validator';

export class ChatMessage {
  @ApiProperty({ description: 'Role of the message sender (user/assistant/system)' })
  @IsString()
  role: string;

  @ApiProperty({ description: 'Content of the message' })
  @IsString()
  content: string;
}

export class ChatRequest {
  @ApiProperty({
    description: 'History of messages between the user and the assistant',
    type: [ChatMessage],
    required: false,
    default: [],
  })
  @IsOptional()
  @IsArray()
  messages?: ChatMessage[] = [];

  @ApiProperty({ description: 'Whether to enable debug logging', required: false, default: false })
  @IsOptional()
  @IsBoolean()
  debug?: boolean = false;

  @ApiProperty({ description: 'A specific conversation identifier', required: false, default: '__default__' })
  @IsOptional()
  @IsString()
  thread_id?: string = '__default__';

  @ApiProperty({ description: 'The maximum number of plan iterations', required: false, default: 1 })
  @IsOptional()
  @IsInt()
  max_plan_iterations?: number = 1;

  @ApiProperty({ description: 'The maximum number of steps in a plan', required: false, default: 3 })
  @IsOptional()
  @IsInt()
  max_step_num?: number = 3;

  @ApiProperty({ description: 'The maximum number of search results', required: false, default: 3 })
  @IsOptional()
  @IsInt()
  max_search_results?: number = 3;

  @ApiProperty({ description: 'Whether to automatically accept the plan', required: false, default: false })
  @IsOptional()
  @IsBoolean()
  auto_accepted_plan?: boolean = false;

  @ApiProperty({ description: 'Interrupt feedback from the user on the plan', required: false, default: null })
  @IsOptional()
  @IsString()
  interrupt_feedback?: string | null = null;

  @ApiProperty({ description: 'MCP settings for the chat request', required: false, default: null })
  @IsOptional()
  @IsObject()
  mcp_settings?: Record<string, any> | null = null;

  @ApiProperty({ description: 'Whether to get background investigation before plan', required: false, default: true })
  @IsOptional()
  @IsBoolean()
  enable_background_investigation?: boolean = true;
}
