import type { AgentTaskDone } from '@n8n/api-types/push/agents';
import { useAgentsStore } from '@/features/agents/agents.store';

export async function agentTaskDone(_event: AgentTaskDone) {
	const agentsStore = useAgentsStore();
	// Reset all agents — sub-agent done events may arrive before
	// the parent's observation, so reset everything to avoid stale state
	for (const agent of agentsStore.agents) {
		agentsStore.setAgentStatus(agent.id, 'idle');
	}
}
