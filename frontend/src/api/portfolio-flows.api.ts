import apiClient from "./client";

export type FlowDirection = "contribution" | "withdrawal";
export type FlowKind = "create" | "correct" | "void";

export interface FlowVersion {
	flowId: string;
	version: number;
	journalRevision: number;
	requestId: string;
	kind: FlowKind;
	direction: FlowDirection;
	occurredAt: string;
	amountUsd: string;
	createdAt: string;
}

export interface FlowJournal {
	requestId: string;
	coverageFrom: string;
	createdAt: string;
	journalRevision: number;
	activeFlowCount: number;
	versionCount: number;
	limits: { activeFlows: number; versions: number };
}

export interface FlowJournalState {
	journal: FlowJournal | null;
	basis: "owner-declared-usd-flows";
	completeness: "unreconciled";
}

export interface FlowOriginCommand {
	requestId: string;
	coverageFrom: string;
	assertReviewed: true;
}

export interface FlowCommand {
	requestId: string;
	expectedJournalRevision: number;
	direction: FlowDirection;
	occurredAt: string;
	amountUsd: string;
	assertExternal: true;
}

export interface FlowVoidCommand {
	requestId: string;
	expectedJournalRevision: number;
}

export interface FlowOriginReceipt {
	requestId: string;
	coverageFrom: string;
	createdAt: string;
}

export interface FlowReceipt {
	journalRevision: number;
	flow: FlowVersion;
}

export interface FlowPeriod {
	from: string;
	to: string;
	coverageFrom: string;
	journalRevision: number;
	basis: "owner-declared-usd-flows";
	completeness: "unreconciled";
	summary: {
		contributionsUsd: string;
		withdrawalsUsd: string;
		netContributionsUsd: string;
		flowCount: number;
	};
	items: FlowVersion[];
	nextOffset: number | null;
}

export interface FlowVersions {
	flowId: string;
	items: FlowVersion[];
	nextBeforeVersion: number | null;
}

const path = "/accounting/portfolio";

export const portfolioFlowsApi = {
	journal: async (): Promise<FlowJournalState> =>
		(await apiClient.get<FlowJournalState>(`${path}/cash-flow-journal`)).data,
	initialize: async (body: FlowOriginCommand): Promise<FlowOriginReceipt> =>
		(await apiClient.post<FlowOriginReceipt>(`${path}/cash-flow-journal`, body))
			.data,
	create: async (body: FlowCommand): Promise<FlowReceipt> =>
		(await apiClient.post<FlowReceipt>(`${path}/cash-flows`, body)).data,
	correct: async (flowId: string, body: FlowCommand): Promise<FlowReceipt> =>
		(
			await apiClient.post<FlowReceipt>(
				`${path}/cash-flows/${encodeURIComponent(flowId)}/corrections`,
				body,
			)
		).data,
	void: async (flowId: string, body: FlowVoidCommand): Promise<FlowReceipt> =>
		(
			await apiClient.post<FlowReceipt>(
				`${path}/cash-flows/${encodeURIComponent(flowId)}/voids`,
				body,
			)
		).data,
	period: async (
		from: string,
		to: string,
		offset = 0,
		journalRevision?: number,
	): Promise<FlowPeriod> =>
		(
			await apiClient.get<FlowPeriod>(`${path}/cash-flows`, {
				params: {
					from,
					to,
					offset,
					limit: 50,
					...(journalRevision === undefined ? {} : { journalRevision }),
				},
			})
		).data,
	versions: async (
		flowId: string,
		beforeVersion?: number,
	): Promise<FlowVersions> =>
		(
			await apiClient.get<FlowVersions>(
				`${path}/cash-flows/${encodeURIComponent(flowId)}/versions`,
				{
					params: {
						limit: 10,
						...(beforeVersion === undefined ? {} : { beforeVersion }),
					},
				},
			)
		).data,
};
