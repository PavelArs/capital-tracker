import type {
	FlowCommand,
	FlowOriginCommand,
	FlowOriginReceipt,
	FlowReceipt,
	FlowVoidCommand,
} from "../../api/portfolio-flows.api";

export type OriginalFlowCommand =
	| { kind: "initialize"; body: FlowOriginCommand }
	| { kind: "create"; body: FlowCommand }
	| { kind: "correct"; flowId: string; body: FlowCommand }
	| { kind: "void"; flowId: string; body: FlowVoidCommand };

export type FlowRecovery =
	| { phase: "sending" | "unknown"; command: OriginalFlowCommand }
	| {
			phase: "accepted";
			command: OriginalFlowCommand;
			receipt: FlowOriginReceipt | FlowReceipt;
	  };

const byOwner = new Map<string, FlowRecovery>();
const listeners = new Set<() => void>();

export function flowRecovery(ownerId: string): FlowRecovery | null {
	return byOwner.get(ownerId) ?? null;
}

export function retainFlowRecovery(
	ownerId: string,
	value: FlowRecovery | null,
): void {
	if (value) byOwner.set(ownerId, value);
	else byOwner.delete(ownerId);
	for (const notify of listeners) notify();
}

export function subscribeFlowRecovery(notify: () => void): () => void {
	listeners.add(notify);
	return () => listeners.delete(notify);
}
