import type { AuthenticatedRequest } from '@n8n/db';
import { mock } from 'jest-mock-extended';
import type { Request, Response } from 'express';

import { AgentsController } from '../agents.controller';

import type {
	AgentsService,
	ExternalAgentConfig,
	AgentDto,
	LlmConfig,
} from '@/services/agents.service';
import { buildSystemPrompt, callExternalAgent, callLlm } from '@/services/agents.service';

// Mock SSRF validation — unit tests don't resolve DNS
jest.mock('@/agents/validate-agent-url', () => ({
	validateExternalAgentUrl: jest.fn().mockResolvedValue(undefined),
}));

function makeAgentDto(overrides: Partial<AgentDto> = {}): AgentDto {
	return {
		id: 'agent-1',
		firstName: 'TestAgent',
		lastName: '',
		email: 'agent-test@internal.n8n.local',
		avatar: null,
		description: null,
		agentAccessLevel: 'external',
		...overrides,
	};
}

describe('AgentsController', () => {
	const agentsService = mock<AgentsService>();
	let controller: AgentsController;

	beforeEach(() => {
		jest.clearAllMocks();
		controller = new AgentsController(agentsService);
	});

	describe('getAgentCard', () => {
		it('should return valid A2A agent card schema', async () => {
			const card = {
				id: 'agent-1',
				name: 'TestAgent',
				provider: { name: 'n8n', description: 'Handles docs' },
				capabilities: { streaming: true, pushNotifications: false, multiTurn: true },
				skills: [],
				interfaces: [{ type: 'http+json', url: 'https://example.com/api/v1/agents/agent-1/task' }],
				securitySchemes: {
					apiKey: { type: 'apiKey', name: 'x-n8n-api-key', in: 'header' },
				},
				security: [{ apiKey: [] }],
			};
			agentsService.getAgentCard.mockResolvedValue(card);

			const req = mock<Request>({ protocol: 'https' });
			req.get.mockReturnValue('example.com');

			const result = await controller.getAgentCard(req, mock<Response>(), 'agent-1');

			expect(agentsService.getAgentCard).toHaveBeenCalledWith('agent-1', 'https://example.com');
			expect(result).toEqual(card);
		});

		it('should propagate 404 for non-existent agent', async () => {
			agentsService.getAgentCard.mockRejectedValue(new Error('Agent nonexistent not found'));

			const req = mock<Request>();
			await expect(controller.getAgentCard(req, mock<Response>(), 'nonexistent')).rejects.toThrow(
				'Agent nonexistent not found',
			);
		});
	});

	describe('createAgent', () => {
		it('should delegate to service and return result', async () => {
			const dto = makeAgentDto({ description: 'Test desc', agentAccessLevel: 'external' });
			agentsService.createAgent.mockResolvedValue(dto);

			const result = await controller.createAgent(mock(), mock<Response>(), {
				firstName: 'TestAgent',
				description: 'Test desc',
				agentAccessLevel: 'external',
			} as never);

			expect(agentsService.createAgent).toHaveBeenCalled();
			expect(result.description).toBe('Test desc');
			expect(result.agentAccessLevel).toBe('external');
		});
	});

	describe('updateAgent', () => {
		it('should delegate to service and return updated agent', async () => {
			const dto = makeAgentDto({ description: 'Updated desc', agentAccessLevel: 'internal' });
			agentsService.updateAgent.mockResolvedValue(dto);

			const result = await controller.updateAgent(mock(), mock<Response>(), 'agent-1', {
				description: 'Updated desc',
				agentAccessLevel: 'internal',
			} as never);

			expect(agentsService.updateAgent).toHaveBeenCalledWith('agent-1', {
				description: 'Updated desc',
				agentAccessLevel: 'internal',
			});
			expect(result.description).toBe('Updated desc');
		});

		it('should propagate 404 for non-existent agent', async () => {
			agentsService.updateAgent.mockRejectedValue(new Error('Agent bad-id not found'));

			await expect(
				controller.updateAgent(mock(), mock<Response>(), 'bad-id', {} as never),
			).rejects.toThrow('Agent bad-id not found');
		});
	});

	describe('getCapabilities', () => {
		it('should delegate to service', async () => {
			const caps = {
				agentId: 'agent-1',
				agentName: 'TestAgent',
				description: 'A helpful agent',
				agentAccessLevel: 'external' as const,
				llmConfigured: true,
				projects: [] as Array<{ id: string; name: string }>,
				workflows: [] as Array<{ id: string; name: string; active: boolean }>,
				credentials: [] as Array<{ id: string; name: string; type: string }>,
			};
			agentsService.getCapabilities.mockResolvedValue(caps);

			const result = await controller.getCapabilities(mock(), mock<Response>(), 'agent-1');

			expect(result.description).toBe('A helpful agent');
			expect(result.agentAccessLevel).toBe('external');
			expect(result.llmConfigured).toBe(true);
		});

		it('should return 404 when queried with a non-agent user ID', async () => {
			agentsService.getCapabilities.mockRejectedValue(new Error('Agent human-user-id not found'));

			await expect(
				controller.getCapabilities(mock(), mock<Response>(), 'human-user-id'),
			).rejects.toThrow('Agent human-user-id not found');
		});
	});

	describe('deleteAgent', () => {
		it('should delete agent and return 204', async () => {
			agentsService.deleteAgent.mockResolvedValue(undefined);

			const res = mock<Response>();
			res.status.mockReturnValue(res);

			await controller.deleteAgent(mock(), res, 'agent-1');

			expect(agentsService.deleteAgent).toHaveBeenCalledWith('agent-1');
			expect(res.status).toHaveBeenCalledWith(204);
		});

		it('should propagate 404 for non-existent agent', async () => {
			agentsService.deleteAgent.mockRejectedValue(new Error('Agent bad-id not found'));

			await expect(controller.deleteAgent(mock(), mock<Response>(), 'bad-id')).rejects.toThrow(
				'Agent bad-id not found',
			);
		});
	});

	describe('listAgents', () => {
		it('should return all agents', async () => {
			const agents = [
				makeAgentDto({ id: 'a-1', firstName: 'Bot1' }),
				makeAgentDto({ id: 'a-2', firstName: 'Bot2' }),
			];
			agentsService.listAgents.mockResolvedValue(agents);

			const result = await controller.listAgents(mock());

			expect(result).toHaveLength(2);
			expect(result[0].id).toBe('a-1');
			expect(result[1].id).toBe('a-2');
		});

		it('should return empty array when no agents exist', async () => {
			agentsService.listAgents.mockResolvedValue([]);

			const result = await controller.listAgents(mock());

			expect(result).toEqual([]);
		});
	});

	describe('dispatchTask', () => {
		function makeAuthReq(accept: string) {
			const req = mock<AuthenticatedRequest>();
			req.user = { id: 'caller-1' } as AuthenticatedRequest['user'];
			Object.defineProperty(req, 'headers', {
				value: { accept, 'push-ref': 'test' },
				writable: true,
			});
			return req;
		}

		it('should enforce access level before executing', async () => {
			agentsService.enforceAccessLevel.mockResolvedValue(undefined);
			agentsService.executeAgentTask.mockResolvedValue({
				status: 'completed',
				summary: 'Done',
				steps: [],
			});

			const req = makeAuthReq('application/json');

			await controller.dispatchTask(req, mock<Response>(), 'agent-1', {
				prompt: 'Do something',
			} as never);

			expect(agentsService.enforceAccessLevel).toHaveBeenCalledWith('agent-1', req.user);
		});

		it('should return JSON for non-stream requests', async () => {
			agentsService.enforceAccessLevel.mockResolvedValue(undefined);
			const taskResult = { status: 'completed', summary: 'Done', steps: [] };
			agentsService.executeAgentTask.mockResolvedValue(taskResult);

			const req = makeAuthReq('application/json');
			const res = mock<Response>();

			await controller.dispatchTask(req, res, 'agent-1', {
				prompt: 'Test',
			} as never);

			expect(res.json).toHaveBeenCalledWith(taskResult);
		});

		it('should write SSE headers for stream requests', async () => {
			agentsService.enforceAccessLevel.mockResolvedValue(undefined);
			agentsService.executeAgentTask.mockResolvedValue({
				status: 'completed',
				summary: 'Done',
				steps: [],
			});

			const req = makeAuthReq('text/event-stream');
			const res = mock<Response>();

			await controller.dispatchTask(req, res, 'agent-1', {
				prompt: 'Test',
			} as never);

			expect(res.writeHead).toHaveBeenCalledWith(200, {
				'Content-Type': 'text/event-stream; charset=UTF-8',
				'Cache-Control': 'no-cache',
				Connection: 'keep-alive',
			});
			expect(res.end).toHaveBeenCalled();
		});
	});
});

describe('buildSystemPrompt', () => {
	it('should include send_message instructions when canDelegate is true', () => {
		const agents = [{ id: 'a-1', firstName: 'Helper', description: 'Helps with things' }];
		const prompt = buildSystemPrompt('TestAgent', [], agents, true);

		expect(prompt).toContain('send_message');
		expect(prompt).toContain('Helper (id: a-1): Helps with things');
	});

	it('should exclude send_message when canDelegate is false', () => {
		const agents = [{ id: 'a-1', firstName: 'Helper', description: 'Helps' }];
		const prompt = buildSystemPrompt('TestAgent', [], agents, false);

		expect(prompt).not.toContain('send_message');
		expect(prompt).not.toContain('Helper');
	});

	it('should use description in agent list', () => {
		const agents = [
			{ id: 'a-1', firstName: 'DocBot', description: 'Knowledge Base' },
			{ id: 'a-2', firstName: 'QABot', description: '' },
		];
		const prompt = buildSystemPrompt('TestAgent', [], agents, true);

		expect(prompt).toContain('DocBot (id: a-1): Knowledge Base');
		expect(prompt).toContain('QABot (id: a-2)');
	});

	it('should list workflows when provided', () => {
		const workflows = [
			{ id: 'wf-1', name: 'Deploy', active: true },
			{ id: 'wf-2', name: 'Test', active: false },
		];
		const prompt = buildSystemPrompt('TestAgent', workflows, [], false);

		expect(prompt).toContain('Deploy (id: wf-1, active: true)');
		expect(prompt).toContain('Test (id: wf-2, active: false)');
	});

	it('should show (none) when no workflows', () => {
		const prompt = buildSystemPrompt('TestAgent', [], [], false);
		expect(prompt).toContain('(none)');
	});

	it('should only allow execute_workflow and complete when canDelegate is false', () => {
		const prompt = buildSystemPrompt('TestAgent', [], [], false);
		expect(prompt).toContain('"execute_workflow" or "complete"');
		expect(prompt).not.toContain('"send_message"');
	});

	it('should include toAgentId in delegation instructions', () => {
		const agents = [{ id: 'a-1', firstName: 'Helper', description: 'Helps' }];
		const prompt = buildSystemPrompt('TestAgent', [], agents, true);

		expect(prompt).toContain('toAgentId');
		expect(prompt).not.toContain('"toAgent"');
	});

	it('should include external agents in prompt alongside local agents', () => {
		const localAgents = [{ id: 'a-1', firstName: 'LocalBot', description: 'Local helper' }];
		const externalAgents = [
			{ id: 'external:RemoteBot', firstName: 'RemoteBot', description: 'Remote helper' },
		];
		const merged = [...localAgents, ...externalAgents];
		const prompt = buildSystemPrompt('TestAgent', [], merged, true);

		expect(prompt).toContain('LocalBot (id: a-1): Local helper');
		expect(prompt).toContain('RemoteBot (id: external:RemoteBot): Remote helper');
		expect(prompt).toContain('send_message');
	});

	it('should show external-only agents when no local agents exist', () => {
		const externalOnly = [
			{ id: 'external:ExtBot', firstName: 'ExtBot', description: 'External only' },
		];
		const prompt = buildSystemPrompt('TestAgent', [], externalOnly, true);

		expect(prompt).toContain('ExtBot (id: external:ExtBot): External only');
		expect(prompt).toContain('send_message');
	});
});

describe('callExternalAgent', () => {
	const originalFetch = global.fetch;

	afterEach(() => {
		global.fetch = originalFetch;
	});

	it('should POST to external agent URL with correct headers and body (no keys)', async () => {
		const config: ExternalAgentConfig = {
			name: 'RemoteBot',
			url: 'https://remote.example.com/rest/agents/abc/task',
			apiKey: 'remote-api-key',
		};

		global.fetch = jest.fn().mockResolvedValue({
			ok: true,
			json: async () => ({
				data: { status: 'completed', summary: 'Done remotely', steps: [] },
			}),
		});

		const result = await callExternalAgent(config, 'Do something');

		expect(global.fetch).toHaveBeenCalledWith(
			'https://remote.example.com/rest/agents/abc/task',
			expect.objectContaining({
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'x-n8n-api-key': 'remote-api-key',
				},
				body: JSON.stringify({ prompt: 'Do something' }),
			}),
		);

		expect(result.status).toBe('completed');
		expect(result.summary).toBe('Done remotely');
	});

	it('should not forward keys in the request body', async () => {
		const config: ExternalAgentConfig = {
			name: 'RemoteBot',
			url: 'https://remote.example.com/rest/agents/abc/task',
			apiKey: 'key',
		};

		global.fetch = jest.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ status: 'completed', summary: 'OK', steps: [] }),
		});

		await callExternalAgent(config, 'Hello');

		const fetchCall = (global.fetch as jest.Mock).mock.calls[0];
		const body = JSON.parse(fetchCall[1].body as string);
		expect(body).not.toHaveProperty('keys');
	});

	it('should unwrap response without data envelope', async () => {
		const config: ExternalAgentConfig = {
			name: 'RemoteBot',
			url: 'https://remote.example.com/rest/agents/abc/task',
			apiKey: 'key',
		};

		global.fetch = jest.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ status: 'completed', summary: 'Direct', steps: [] }),
		});

		const result = await callExternalAgent(config, 'Hello');

		expect(result.status).toBe('completed');
		expect(result.summary).toBe('Direct');
	});

	it('should throw on non-OK response', async () => {
		const config: ExternalAgentConfig = {
			name: 'RemoteBot',
			url: 'https://remote.example.com/rest/agents/abc/task',
			apiKey: 'key',
		};

		global.fetch = jest.fn().mockResolvedValue({
			ok: false,
			status: 500,
			text: async () => 'Internal Server Error',
		});

		await expect(callExternalAgent(config, 'Hello')).rejects.toThrow(
			'External agent returned 500: Internal Server Error',
		);
	});
});

describe('callLlm', () => {
	const originalFetch = global.fetch;

	afterEach(() => {
		global.fetch = originalFetch;
	});

	const defaultConfig: LlmConfig = {
		apiKey: 'test-key',
		baseUrl: 'https://api.anthropic.com',
		model: 'claude-sonnet-4-5-20250929',
	};

	it('should use config values for API call', async () => {
		global.fetch = jest.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ content: [{ type: 'text', text: 'Hello' }] }),
		});

		const result = await callLlm(
			[
				{ role: 'system', content: 'You are helpful' },
				{ role: 'user', content: 'Hi' },
			],
			defaultConfig,
		);

		expect(result).toBe('Hello');
		expect(global.fetch).toHaveBeenCalledWith(
			'https://api.anthropic.com/v1/messages',
			expect.objectContaining({
				headers: expect.objectContaining({
					'x-api-key': 'test-key',
				}),
				body: expect.stringContaining('"model":"claude-sonnet-4-5-20250929"'),
			}),
		);
	});

	it('should use custom baseUrl from config', async () => {
		global.fetch = jest.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ content: [{ type: 'text', text: 'OK' }] }),
		});

		await callLlm([{ role: 'user', content: 'Hi' }], {
			...defaultConfig,
			baseUrl: 'https://custom.api.com',
		});

		expect(global.fetch).toHaveBeenCalledWith(
			'https://custom.api.com/v1/messages',
			expect.anything(),
		);
	});

	it('should throw on non-OK response', async () => {
		global.fetch = jest.fn().mockResolvedValue({
			ok: false,
			status: 401,
			text: async () => 'Unauthorized',
		});

		await expect(callLlm([{ role: 'user', content: 'Hi' }], defaultConfig)).rejects.toThrow(
			'LLM API returned 401: Unauthorized',
		);
	});
});
