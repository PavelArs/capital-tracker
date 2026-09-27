import { type ReactNode, useId, useState } from 'react';
import './AccountAnalytics.css';

const tasks = [
  { id: 'valuation', label: 'Оценка на дату' },
  { id: 'history', label: 'История стоимости' },
  { id: 'accounting', label: 'Учётные позиции' },
] as const;

type AnalysisTask = (typeof tasks)[number]['id'];

export function AccountAnalytics({
  valuation,
  history,
  accounting,
}: {
  valuation: ReactNode;
  history: ReactNode;
  accounting: ReactNode;
}) {
  const id = useId();
  const [selected, setSelected] = useState<AnalysisTask>('valuation');
  const contents = { valuation, history, accounting };

  return (
    <div className="account-analytics">
      <div className="account-analytics__choice">
        <label htmlFor={`${id}-choice`}>Задача анализа</label>
        <select
          id={`${id}-choice`}
          value={selected}
          aria-controls={`${id}-${selected}`}
          onChange={(event) => {
            const task = tasks.find((item) => item.id === event.target.value);
            if (task) setSelected(task.id);
          }}
        >
          {tasks.map((task) => (
            <option key={task.id} value={task.id}>
              {task.label}
            </option>
          ))}
        </select>
      </div>
      {tasks.map((task) => (
        <div
          key={task.id}
          id={`${id}-${task.id}`}
          className="account-analytics__panel"
          hidden={selected !== task.id}
        >
          {contents[task.id]}
        </div>
      ))}
    </div>
  );
}
