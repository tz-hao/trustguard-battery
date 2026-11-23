import { Body, Controller, Get, Inject, Param, Post, Req } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedRequest } from './auth.js';
import { AiService } from './ai.js';

@ApiTags('ai-advisory')
@Controller('api/v1/ai')
export class AiController {
  constructor(@Inject(AiService) private readonly ai: AiService) {}

  @Get('status')
  @ApiOperation({ summary: '查询 DeepSeek 配置状态；不发起外部请求，不表示连通性已验证' })
  status() { return this.ai.status(); }

  @Get('assets/:assetId/latest')
  latest(@Req() req: AuthenticatedRequest, @Param('assetId') assetId: string) {
    return this.ai.latest(req.actor, assetId);
  }

  @Post('analyses')
  @ApiOperation({ summary: '生成有证据引用的风险解释或单资产溯源问答；仅辅助人工审核', description: '相同 requestId 重试返回原状态；失败或中断不自动再次调用模型。需要当前持有方的业务角色，或 Lab inspector/auditor。' })
  @ApiBody({ schema: { type: 'object', additionalProperties: false, required: ['requestId','assetId','task'], properties: {
    requestId: {type:'string',maxLength:96}, assetId:{type:'string',maxLength:96},
    task:{type:'string',enum:['risk_explanation','trace_question']}, question:{type:'string',maxLength:1000,description:'trace_question 必填；禁止提交密钥或未经授权的敏感内容'},
  } } })
  analyze(@Req() req: AuthenticatedRequest, @Body() body: unknown) { return this.ai.analyze(req.actor, body); }

  @Get('analyses/:requestId')
  @ApiOperation({ summary: '查询本人分析结果；重新核验当前资产权限并标记证据是否过期' })
  get(@Req() req: AuthenticatedRequest, @Param('requestId') requestId: string) { return this.ai.get(req.actor, requestId); }
}
