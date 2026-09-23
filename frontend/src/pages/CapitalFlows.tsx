import {
	type FlowDirection,
	type FlowJournalState,
	type FlowPeriod,
	type FlowVersion,
	type FlowVersions,
	portfolioFlowsApi,
} from "@api/portfolio-flows.api";
import { useAuth } from "@contexts/AuthContext";
import { accountingError, newRequestId } from "@features/accounting/feedback";
import {
	type OriginalFlowCommand,
	flowRecovery,
	retainFlowRecovery,
	subscribeFlowRecovery,
} from "@features/accounting/flow-recovery";
import { isAxiosError } from "axios";
import {
	useCallback,
	useEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import "./CapitalFlows.css";

type ReadState = "loading" | "ready" | "error";

function directionLabel(direction: FlowDirection): string {
	return direction === "contribution" ? "Ввод" : "Вывод";
}

function kindLabel(kind: FlowVersion["kind"]): string {
	if (kind === "create") return "Создание";
	if (kind === "correct") return "Исправление";
	return "Аннулирование";
}

function commandLabel(command: OriginalFlowCommand): string {
	if (command.kind === "initialize") return "объявление границы";
	if (command.kind === "create") return "создание потока";
	if (command.kind === "correct") return "исправление потока";
	return "аннулирование потока";
}

function acceptedRevision(
	receipt: Awaited<ReturnType<typeof sendCommand>>,
): number | null {
	return "journalRevision" in receipt ? receipt.journalRevision : null;
}

async function sendCommand(command: OriginalFlowCommand) {
	switch (command.kind) {
		case "initialize":
			return portfolioFlowsApi.initialize(command.body);
		case "create":
			return portfolioFlowsApi.create(command.body);
		case "correct":
			return portfolioFlowsApi.correct(command.flowId, command.body);
		case "void":
			return portfolioFlowsApi.void(command.flowId, command.body);
	}
}

function CapitalFlowsOwner({ ownerId }: { ownerId: string }) {
	const recovery = useSyncExternalStore(subscribeFlowRecovery, () =>
		flowRecovery(ownerId),
	);
	const [journalState, setJournalState] = useState<FlowJournalState | null>(
		null,
	);
	const [journalRead, setJournalRead] = useState<ReadState>("loading");
	const [journalError, setJournalError] = useState("");
	const [commandError, setCommandError] = useState("");
	const [needsReview, setNeedsReview] = useState(false);
	const [receipt, setReceipt] = useState<Awaited<
		ReturnType<typeof sendCommand>
	> | null>(null);
	const [coverageFrom, setCoverageFrom] = useState("");
	const [coverageReviewed, setCoverageReviewed] = useState(false);
	const [editingFlowId, setEditingFlowId] = useState<string | null>(null);
	const [direction, setDirection] = useState<FlowDirection>("contribution");
	const [occurredAt, setOccurredAt] = useState("");
	const [amountUsd, setAmountUsd] = useState("");
	const [externalReviewed, setExternalReviewed] = useState(false);
	const [voidFlowId, setVoidFlowId] = useState<string | null>(null);
	const [from, setFrom] = useState("");
	const [to, setTo] = useState("");
	const [period, setPeriod] = useState<FlowPeriod | null>(null);
	const [periodRead, setPeriodRead] = useState<"idle" | ReadState>("idle");
	const [periodError, setPeriodError] = useState("");
	const [versionFlowId, setVersionFlowId] = useState<string | null>(null);
	const [versions, setVersions] = useState<FlowVersions | null>(null);
	const [versionsRead, setVersionsRead] = useState<"idle" | ReadState>("idle");
	const [versionsError, setVersionsError] = useState("");
	const live = useRef(true);
	const journalGeneration = useRef(0);
	const periodGeneration = useRef(0);
	const versionGeneration = useRef(0);
	const observedRevision = useRef<number | null>(null);

	const invalidatePeriod = useCallback(() => {
		periodGeneration.current++;
		setPeriod(null);
		setPeriodRead("idle");
		setPeriodError("");
	}, []);

	const invalidateVersions = useCallback(() => {
		versionGeneration.current++;
		setVersions(null);
		setVersionFlowId(null);
		setVersionsRead("idle");
		setVersionsError("");
	}, []);

	const refreshJournal = useCallback(
		async (
			releaseAccepted = false,
			expectedReceipt?: Awaited<ReturnType<typeof sendCommand>>,
		) => {
			const generation = ++journalGeneration.current;
			setJournalRead("loading");
			setJournalError("");
			try {
				const current = await portfolioFlowsApi.journal();
				if (!live.current || generation !== journalGeneration.current) return;
				const nextRevision = current.journal?.journalRevision ?? null;
				if (observedRevision.current !== nextRevision) {
					observedRevision.current = nextRevision;
					invalidatePeriod();
					invalidateVersions();
				}
				setJournalState(current);
				setJournalRead("ready");
				const pending = flowRecovery(ownerId);
				if (releaseAccepted && pending?.phase === "accepted") {
					const confirmed = expectedReceipt ?? pending.receipt;
					const revision = acceptedRevision(confirmed);
					if (
						(revision !== null &&
							nextRevision !== null &&
							nextRevision >= revision) ||
						("requestId" in confirmed &&
							current.journal?.requestId === confirmed.requestId)
					) {
						retainFlowRecovery(ownerId, null);
						setNeedsReview(false);
					} else {
						setJournalError(
							"Принятая команда ещё не видна в журнале. Обновите состояние ещё раз.",
						);
					}
				} else if (releaseAccepted && !pending) {
					setNeedsReview(false);
				}
			} catch (error) {
				if (!live.current || generation !== journalGeneration.current) return;
				setJournalRead("error");
				setJournalError(accountingError(error, "загрузить состояние потоков"));
			}
		},
		[invalidatePeriod, invalidateVersions, ownerId],
	);

	useEffect(() => {
		live.current = true;
		void refreshJournal();
		return () => {
			live.current = false;
			journalGeneration.current++;
			periodGeneration.current++;
			versionGeneration.current++;
		};
	}, [refreshJournal]);

	const runCommand = async (command: OriginalFlowCommand, retry = false) => {
		if (
			!retry &&
			(flowRecovery(ownerId) || needsReview || journalRead !== "ready")
		)
			return;
		const priorUnknown = retry && flowRecovery(ownerId)?.phase === "unknown";
		retainFlowRecovery(ownerId, { phase: "sending", command });
		setCommandError("");
		try {
			const accepted = await sendCommand(command);
			retainFlowRecovery(ownerId, {
				phase: "accepted",
				command,
				receipt: accepted,
			});
			if (!live.current) return;
			setReceipt(accepted);
			if (command.kind !== "initialize") {
				invalidatePeriod();
				invalidateVersions();
				setEditingFlowId(null);
				setVoidFlowId(null);
				setExternalReviewed(false);
			}
			await refreshJournal(true, accepted);
		} catch (error) {
			const status = isAxiosError(error) ? error.response?.status : undefined;
			const definitiveFirstFailure =
				!priorUnknown && [400, 403, 404, 409].includes(status ?? 0);
			retainFlowRecovery(
				ownerId,
				definitiveFirstFailure ? null : { phase: "unknown", command },
			);
			if (!live.current) return;
			setNeedsReview(definitiveFirstFailure);
			setCommandError(
				definitiveFirstFailure
					? `${accountingError(error, "сохранить команду")} Обновите состояние и проверьте данные.`
					: "Исход команды неизвестен. Новые записи заблокированы; повторите только исходную команду.",
			);
		}
	};

	const showPeriod = async (offset = 0, current = period) => {
		const requestedFrom = offset === 0 ? from : current?.from;
		const requestedTo = offset === 0 ? to : current?.to;
		if (!requestedFrom || !requestedTo || (offset > 0 && !current)) return;
		const generation = ++periodGeneration.current;
		setPeriodRead("loading");
		setPeriodError("");
		try {
			const result = await portfolioFlowsApi.period(
				requestedFrom,
				requestedTo,
				offset,
				offset > 0 ? current?.journalRevision : undefined,
			);
			if (!live.current || generation !== periodGeneration.current) return;
			if (observedRevision.current !== result.journalRevision) {
				setNeedsReview(true);
				observedRevision.current = result.journalRevision;
				invalidateVersions();
			}
			setPeriod(
				offset === 0 || !current
					? result
					: { ...result, items: [...current.items, ...result.items] },
			);
			setPeriodRead("ready");
		} catch (error) {
			if (!live.current || generation !== periodGeneration.current) return;
			setPeriodRead("error");
			setPeriodError(
				isAxiosError(error) && error.response?.status === 409
					? "Журнал изменился. Обновите состояние и заново покажите период."
					: accountingError(error, "загрузить потоки за период"),
			);
			if (isAxiosError(error) && error.response?.status === 409) {
				periodGeneration.current++;
				setPeriod(null);
				setNeedsReview(true);
			}
		}
	};

	const showVersions = async (flowId: string, beforeVersion?: number) => {
		const generation = ++versionGeneration.current;
		setVersionFlowId(flowId);
		setVersionsRead("loading");
		setVersionsError("");
		try {
			const result = await portfolioFlowsApi.versions(flowId, beforeVersion);
			if (!live.current || generation !== versionGeneration.current) return;
			setVersions((previous) =>
				beforeVersion !== undefined && previous?.flowId === flowId
					? { ...result, items: [...previous.items, ...result.items] }
					: result,
			);
			setVersionsRead("ready");
		} catch (error) {
			if (!live.current || generation !== versionGeneration.current) return;
			setVersionsRead("error");
			setVersionsError(accountingError(error, "загрузить версии потока"));
		}
	};

	const journal = journalState?.journal;
	const writeBlocked =
		Boolean(recovery) || needsReview || journalRead !== "ready";
	const visibleReceipt =
		recovery?.phase === "accepted" ? recovery.receipt : receipt;

	return (
		<div className="flow-page">
			<header className="flow-header">
				<h1>Внешние денежные потоки</h1>
				<p>
					Только ваши объявленные вводы и выводы USD через границу
					отслеживаемого портфеля. Данные не сверены с банком и не подтверждают
					полноту операций.
				</p>
				<p>
					Покупки, продажи, переводы между своими счетами, начальные остатки,
					награды, комиссии и переводы активов не являются внешними потоками.
					Этот журнал не рассчитывает денежный остаток, стоимость активов или
					доходность.
				</p>
				<p className="flow-note">
					Восстановление исходной команды хранится в памяти этой вкладки при
					переходах и повторном входе. Полная перезагрузка страницы очищает
					память; проверьте журнал и период перед новой записью.
				</p>
			</header>

			<section className="flow-card" aria-label="Состояние журнала">
				<div className="flow-row flow-row--between">
					<h2>Состояние журнала</h2>
					<button
						type="button"
						className="flow-button flow-button--secondary"
						onClick={() => void refreshJournal(true)}
						disabled={journalRead === "loading"}
					>
						Обновить состояние потоков
					</button>
				</div>
				{journalRead === "loading" && (
					<output>Загрузка состояния потоков…</output>
				)}
				{journalRead === "error" && <p role="alert">{journalError}</p>}
				{journalRead === "ready" && !journal && (
					<p>Граница учёта ещё не объявлена.</p>
				)}
				{journalRead === "ready" && journal && (
					<p>
						Граница учёта: {journal.coverageFrom}. Ревизия:{" "}
						{journal.journalRevision}. Активных потоков:{" "}
						{journal.activeFlowCount}. Версий: {journal.versionCount}. Учёт
						основан на декларации владельца и не сверен с внешними источниками.
					</p>
				)}
			</section>

			{recovery?.phase === "unknown" && (
				<section className="flow-card flow-alert" role="alert">
					<h2>Нужно восстановить исходную команду</h2>
					<p>
						Результат отправки неизвестен ({commandLabel(recovery.command)}).
						Новые записи заблокированы. Повтор отправит сохранённый ключ, цель,
						ревизию и данные без изменений.
					</p>
					<button
						type="button"
						className="flow-button"
						onClick={() => void runCommand(recovery.command, true)}
					>
						Повторить исходную команду
					</button>
				</section>
			)}
			{recovery?.phase === "sending" && (
				<output className="flow-card">Исходная команда отправляется…</output>
			)}
			{recovery?.phase === "accepted" && (
				<output className="flow-card flow-alert">
					Команда принята, но актуальный журнал ещё не подтверждён. Новые записи
					заблокированы. Нажмите «Обновить состояние потоков».
				</output>
			)}
			{visibleReceipt && (
				<output className="flow-card flow-success">
					Принятая команда:{" "}
					{"flow" in visibleReceipt
						? `${kindLabel(visibleReceipt.flow.kind)} потока ${visibleReceipt.flow.flowId}, версия ${visibleReceipt.flow.version}, ревизия ${visibleReceipt.journalRevision}.`
						: `граница ${visibleReceipt.coverageFrom}, запрос ${visibleReceipt.requestId}.`}
				</output>
			)}
			{needsReview && (
				<p className="flow-card" role="alert">
					Перед новой отправкой обновите состояние и проверьте данные.
				</p>
			)}
			{commandError && (
				<p className="flow-card flow-error" role="alert">
					{commandError}
				</p>
			)}

			{journalRead === "ready" && !journal && (
				<section className="flow-card">
					<h2>Начало учёта</h2>
					<form
						className="flow-form"
						onSubmit={(event) => {
							event.preventDefault();
							if (!coverageReviewed || !coverageFrom || writeBlocked) return;
							void runCommand({
								kind: "initialize",
								body: {
									requestId: newRequestId(),
									coverageFrom,
									assertReviewed: true,
								},
							});
						}}
					>
						<label className="flow-field">
							<span>Граница учёта потоков (ISO)</span>
							<input
								value={coverageFrom}
								onChange={(event) => setCoverageFrom(event.target.value)}
								required
							/>
						</label>
						<label className="flow-check">
							<input
								type="checkbox"
								checked={coverageReviewed}
								onChange={(event) => setCoverageReviewed(event.target.checked)}
							/>
							Я проверил границу учёта
						</label>
						<button
							type="submit"
							className="flow-button"
							disabled={!coverageReviewed || !coverageFrom || writeBlocked}
						>
							Начать учёт потоков
						</button>
					</form>
				</section>
			)}

			{journalRead === "ready" && journal && (
				<>
					<section className="flow-card">
						<h2>
							{editingFlowId ? "Исправление потока" : "Новый внешний поток"}
						</h2>
						{editingFlowId && (
							<p>
								Исправляется поток {editingFlowId}. История версий сохранится.
							</p>
						)}
						<form
							className="flow-form"
							onSubmit={(event) => {
								event.preventDefault();
								if (
									!externalReviewed ||
									!occurredAt ||
									!amountUsd ||
									writeBlocked
								)
									return;
								const body = {
									requestId: newRequestId(),
									expectedJournalRevision: journal.journalRevision,
									direction,
									occurredAt,
									amountUsd,
									assertExternal: true as const,
								};
								void runCommand(
									editingFlowId
										? { kind: "correct", flowId: editingFlowId, body }
										: { kind: "create", body },
								);
							}}
						>
							<label className="flow-field">
								<span>Направление</span>
								<select
									value={direction}
									onChange={(event) =>
										setDirection(event.target.value as FlowDirection)
									}
								>
									<option value="contribution">Ввод</option>
									<option value="withdrawal">Вывод</option>
								</select>
							</label>
							<label className="flow-field">
								<span>Момент операции (ISO)</span>
								<input
									value={occurredAt}
									onChange={(event) => setOccurredAt(event.target.value)}
									required
								/>
							</label>
							<label className="flow-field">
								<span>Сумма, USD</span>
								<input
									value={amountUsd}
									onChange={(event) => setAmountUsd(event.target.value)}
									required
									inputMode="decimal"
								/>
							</label>
							<label className="flow-check">
								<input
									type="checkbox"
									checked={externalReviewed}
									onChange={(event) =>
										setExternalReviewed(event.target.checked)
									}
								/>
								Это внешний ввод или вывод USD
							</label>
							<div className="flow-row">
								<button
									type="submit"
									className="flow-button"
									disabled={
										!externalReviewed ||
										!occurredAt ||
										!amountUsd ||
										writeBlocked
									}
								>
									Сохранить поток
								</button>
								{editingFlowId && (
									<button
										type="button"
										className="flow-button flow-button--secondary"
										onClick={() => setEditingFlowId(null)}
									>
										Отменить исправление
									</button>
								)}
							</div>
						</form>
					</section>

					<section className="flow-card">
						<h2>Потоки за период</h2>
						<p>
							Период включает начало и исключает конец. Итоги отражают только
							записанные активные потоки.
						</p>
						<form
							className="flow-form flow-form--period"
							onSubmit={(event) => {
								event.preventDefault();
								void showPeriod(0, null);
							}}
						>
							<label className="flow-field">
								<span>Начало периода (ISO, включительно)</span>
								<input
									value={from}
									onChange={(event) => {
										setFrom(event.target.value);
										invalidatePeriod();
									}}
									required
								/>
							</label>
							<label className="flow-field">
								<span>Конец периода (ISO, не включительно)</span>
								<input
									value={to}
									onChange={(event) => {
										setTo(event.target.value);
										invalidatePeriod();
									}}
									required
								/>
							</label>
							<button
								type="submit"
								className="flow-button"
								disabled={!from || !to || periodRead === "loading"}
							>
								Показать потоки
							</button>
						</form>
						{periodRead === "loading" && (
							<output>Загрузка потоков за период…</output>
						)}
						{periodRead === "error" && <p role="alert">{periodError}</p>}
						{periodRead === "ready" && period && (
							<>
								<p>
									Период: [{period.from}, {period.to}). Граница:{" "}
									{period.coverageFrom}. Ревизия:
									{period.journalRevision}. Данные не сверены.
								</p>
								<div className="flow-totals">
									<p>Вводы: {period.summary.contributionsUsd} USD</p>
									<p>Выводы: {period.summary.withdrawalsUsd} USD</p>
									<p>Чистые вводы: {period.summary.netContributionsUsd} USD</p>
									<p>Количество потоков: {period.summary.flowCount}</p>
								</div>
								{period.items.length === 0 ? (
									<p>За этот период записанных потоков нет.</p>
								) : (
									<div className="flow-table-wrap">
										<table className="flow-table">
											<thead>
												<tr>
													<th>Поток</th>
													<th>Версия</th>
													<th>Момент UTC</th>
													<th>Направление</th>
													<th>USD</th>
													<th>Действия</th>
												</tr>
											</thead>
											<tbody>
												{period.items.map((item) => (
													<tr key={item.flowId}>
														<td>{item.flowId}</td>
														<td>{item.version}</td>
														<td>{item.occurredAt}</td>
														<td>{directionLabel(item.direction)}</td>
														<td>{item.amountUsd}</td>
														<td className="flow-actions">
															<button
																type="button"
																className="flow-button flow-button--secondary"
																disabled={writeBlocked}
																onClick={() => {
																	setEditingFlowId(item.flowId);
																	setDirection(item.direction);
																	setOccurredAt(item.occurredAt);
																	setAmountUsd(item.amountUsd);
																	setExternalReviewed(true);
																	setVoidFlowId(null);
																}}
															>
																Исправить
															</button>
															<button
																type="button"
																className="flow-button flow-button--secondary"
																disabled={writeBlocked}
																onClick={() => setVoidFlowId(item.flowId)}
															>
																Аннулировать
															</button>
															<button
																type="button"
																className="flow-button flow-button--secondary"
																onClick={() => void showVersions(item.flowId)}
															>
																Версии
															</button>
														</td>
													</tr>
												))}
											</tbody>
										</table>
									</div>
								)}
								{period.nextOffset !== null && (
									<button
										type="button"
										className="flow-button flow-button--secondary"
										onClick={() =>
											void showPeriod(period.nextOffset ?? 0, period)
										}
									>
										Следующая страница
									</button>
								)}
							</>
						)}
					</section>

					{voidFlowId && (
						<section className="flow-card flow-alert">
							<h2>Аннулирование потока</h2>
							<p>
								Поток {voidFlowId} станет неактивным. Версии останутся
								доступными.
							</p>
							<div className="flow-row">
								<button
									type="button"
									className="flow-button"
									disabled={writeBlocked}
									onClick={() =>
										void runCommand({
											kind: "void",
											flowId: voidFlowId,
											body: {
												requestId: newRequestId(),
												expectedJournalRevision: journal.journalRevision,
											},
										})
									}
								>
									Подтвердить аннулирование
								</button>
								<button
									type="button"
									className="flow-button flow-button--secondary"
									onClick={() => setVoidFlowId(null)}
								>
									Отмена
								</button>
							</div>
						</section>
					)}

					{versionFlowId && (
						<section className="flow-card">
							<h2>Версии потока</h2>
							<p>Неизменяемая история потока {versionFlowId}.</p>
							{versionsRead === "loading" && <output>Загрузка версий…</output>}
							{versionsRead === "error" && <p role="alert">{versionsError}</p>}
							{versions && (
								<>
									<div className="flow-table-wrap">
										<table className="flow-table">
											<thead>
												<tr>
													<th>Версия</th>
													<th>Действие</th>
													<th>Момент UTC</th>
													<th>Направление</th>
													<th>USD</th>
												</tr>
											</thead>
											<tbody>
												{versions.items.map((item) => (
													<tr key={item.version}>
														<td>{item.version}</td>
														<td>{kindLabel(item.kind)}</td>
														<td>{item.occurredAt}</td>
														<td>{directionLabel(item.direction)}</td>
														<td>{item.amountUsd}</td>
													</tr>
												))}
											</tbody>
										</table>
									</div>
									{versions.nextBeforeVersion !== null && (
										<button
											type="button"
											className="flow-button flow-button--secondary"
											onClick={() =>
												void showVersions(
													versionFlowId,
													versions.nextBeforeVersion ?? undefined,
												)
											}
										>
											Более ранние версии
										</button>
									)}
								</>
							)}
						</section>
					)}
				</>
			)}
		</div>
	);
}

export default function CapitalFlows() {
	const { user } = useAuth();
	if (!user) return null;
	return <CapitalFlowsOwner key={user.id} ownerId={user.id} />;
}
