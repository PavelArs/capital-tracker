import { type ReactNode, useId } from 'react';
import './AccountOperations.css';

const workflows = [
  { id: 'trades', label: 'Сделки в USD' },
  { id: 'swaps', label: 'Обмены активов' },
  { id: 'rewards', label: 'Вознаграждения' },
  { id: 'imports', label: 'Импорт CSV' },
] as const;

export type OperationWorkflow = (typeof workflows)[number]['id'];

export function AccountOperations({
  selected,
  onSelect,
  trades,
  swaps,
  rewards,
  imports,
}: {
  selected: OperationWorkflow;
  onSelect: (workflow: OperationWorkflow) => void;
  trades: ReactNode;
  swaps: ReactNode;
  rewards: ReactNode;
  imports: ReactNode;
}) {
  const id = useId();
  const contents = { trades, swaps, rewards, imports };
  return (
    <div className="account-operations">
      <div className="manual-field account-operations__choice">
        <label htmlFor={`${id}-choice`}>Вид операций</label>
        <select
          id={`${id}-choice`}
          value={selected}
          aria-controls={`${id}-${selected}`}
          onChange={(event) => {
            const workflow = workflows.find((item) => item.id === event.target.value);
            if (workflow) onSelect(workflow.id);
          }}
        >
          {workflows.map((workflow) => (
            <option key={workflow.id} value={workflow.id}>
              {workflow.label}
            </option>
          ))}
        </select>
      </div>
      {workflows.map((workflow) => (
        <div
          key={workflow.id}
          id={`${id}-${workflow.id}`}
          className="account-operations__panel"
          hidden={selected !== workflow.id}
        >
          {contents[workflow.id]}
        </div>
      ))}
    </div>
  );
}
