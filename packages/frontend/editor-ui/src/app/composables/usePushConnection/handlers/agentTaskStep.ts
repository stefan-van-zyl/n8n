import type { AgentTaskStep } from '@n8n/api-types/push/agents';
import { useAgentsStore } from '@/features/agents/agents.store';

export async function agentTaskStep({ data }: AgentTaskStep) {
	const agentsStore = useAgentsStore();
	const stepEvent = data.event as Record<string, unknown>;

	// Only activate on new actions (type: step), not results (type: observation)
	if (stepEvent.type !== 'step') return;

	agentsStore.setAgentStatus(data.agentId, 'active');

	if (stepEvent.action === 'send_message' && typeof stepEvent.toAgent === 'string') {
		agentsStore.setAgentStatusByName(stepEvent.toAgent, 'active');
	}
}
