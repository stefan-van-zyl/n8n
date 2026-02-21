import { CreateAgentDto, DispatchTaskDto, UpdateAgentDto } from '@n8n/api-types';
import { AuthenticatedRequest } from '@n8n/db';
import {
	RestController,
	Body,
	Get,
	Post,
	Patch,
	Delete,
	Param,
	GlobalScope,
} from '@n8n/decorators';
import type { Request, Response } from 'express';

import type { ExternalAgentConfig } from '@/services/agents.service';
import { AgentsService, MAX_ITERATIONS, sseWrite } from '@/services/agents.service';

@RestController('/agents')
export class AgentsController {
	constructor(private readonly agentsService: AgentsService) {}

	@Post('/')
	@GlobalScope('chatHubAgent:create')
	async createAgent(_req: AuthenticatedRequest, _res: Response, @Body payload: CreateAgentDto) {
		return await this.agentsService.createAgent(payload);
	}

	@Patch('/:agentId')
	@GlobalScope('chatHubAgent:update')
	async updateAgent(
		_req: AuthenticatedRequest,
		_res: Response,
		@Param('agentId') agentId: string,
		@Body payload: UpdateAgentDto,
	) {
		return await this.agentsService.updateAgent(agentId, payload);
	}

	@Delete('/:agentId')
	@GlobalScope('chatHubAgent:delete')
	async deleteAgent(_req: AuthenticatedRequest, res: Response, @Param('agentId') agentId: string) {
		await this.agentsService.deleteAgent(agentId);
		res.status(204).send();
		return undefined;
	}

	@Get('/')
	@GlobalScope('chatHubAgent:list')
	async listAgents(_req: AuthenticatedRequest) {
		return await this.agentsService.listAgents();
	}

	@Get('/:agentId/capabilities')
	@GlobalScope('chatHubAgent:read')
	async getCapabilities(
		_req: AuthenticatedRequest,
		_res: Response,
		@Param('agentId') agentId: string,
	) {
		return await this.agentsService.getCapabilities(agentId);
	}

	@Get('/:agentId/card', { apiKeyAuth: true, allowUnauthenticated: true })
	async getAgentCard(req: Request, _res: Response, @Param('agentId') agentId: string) {
		const baseUrl = `${req.protocol}://${req.get('host')}`;
		return await this.agentsService.getAgentCard(agentId, baseUrl);
	}

	@Post('/:agentId/task', {
		apiKeyAuth: true,
		usesTemplates: true,
		ipRateLimit: { limit: 20, windowMs: 60_000 },
		keyedRateLimit: { source: 'user' as const, limit: 10, windowMs: 60_000 },
	})
	async dispatchTask(
		req: AuthenticatedRequest,
		res: Response,
		@Param('agentId') agentId: string,
		@Body payload: DispatchTaskDto,
	) {
		await this.agentsService.enforceAccessLevel(agentId, req.user.id);

		const { prompt, externalAgents } = payload;
		const wantsStream = req.headers.accept?.includes('text/event-stream');
		const callChain = new Set<string>();

		if (!wantsStream) {
			return await this.agentsService.executeAgentTask(
				agentId,
				prompt,
				{ remaining: MAX_ITERATIONS },
				{ externalAgents: externalAgents as ExternalAgentConfig[] | undefined, callChain },
			);
		}

		res.writeHead(200, {
			'Content-Type': 'text/event-stream; charset=UTF-8',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive',
		});

		const result = await this.agentsService.executeAgentTask(
			agentId,
			prompt,
			{ remaining: MAX_ITERATIONS },
			{
				onStep: (event) => sseWrite(res, event),
				externalAgents: externalAgents as ExternalAgentConfig[] | undefined,
				callChain,
			},
		);

		sseWrite(res, { type: 'done', status: result.status, summary: result.summary });
		res.end();
		return undefined;
	}
}
