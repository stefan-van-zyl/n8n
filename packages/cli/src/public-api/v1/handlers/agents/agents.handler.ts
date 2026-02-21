import { Container } from '@n8n/di';
import type express from 'express';

import type { AuthenticatedRequest } from '@n8n/db';
import type { ExternalAgentConfig } from '@/services/agents.service';
import { AgentsService, MAX_ITERATIONS, sseWrite } from '@/services/agents.service';

import { apiKeyHasScope } from '../../shared/middlewares/global.middleware';

export = {
	getAgentCard: [
		apiKeyHasScope('agent:read'),
		async (
			req: AuthenticatedRequest<{ id: string }>,
			res: express.Response,
		): Promise<express.Response> => {
			const agentsService = Container.get(AgentsService);
			const baseUrl = `${req.protocol}://${req.get('host')}`;
			const card = await agentsService.getAgentCard(req.params.id, baseUrl);
			return res.json(card);
		},
	],
	dispatchAgentTask: [
		apiKeyHasScope('agent:execute'),
		async (req: AuthenticatedRequest<{ id: string }>, res: express.Response) => {
			const agentsService = Container.get(AgentsService);
			const agentId = req.params.id;

			await agentsService.enforceAccessLevel(agentId, req.user);

			const { prompt, externalAgents } = req.body as {
				prompt: string;
				externalAgents?: ExternalAgentConfig[];
			};
			const wantsStream = req.headers.accept?.includes('text/event-stream');
			const callChain = new Set<string>();

			if (!wantsStream) {
				const result = await agentsService.executeAgentTask(
					agentId,
					prompt,
					{ remaining: MAX_ITERATIONS },
					{ externalAgents, callChain },
				);
				return res.json(result);
			}

			res.writeHead(200, {
				'Content-Type': 'text/event-stream; charset=UTF-8',
				'Cache-Control': 'no-cache',
				Connection: 'keep-alive',
			});

			const result = await agentsService.executeAgentTask(
				agentId,
				prompt,
				{ remaining: MAX_ITERATIONS },
				{ onStep: (event) => sseWrite(res, event), externalAgents, callChain },
			);

			sseWrite(res, { type: 'done', status: result.status, summary: result.summary });
			res.end();
			return res;
		},
	],
};
