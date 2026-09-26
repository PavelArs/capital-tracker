import { type ReactNode, useId } from 'react';
import './AccountWorkspace.css';

const sections = [
  { id: 'operations', label: 'Операции' },
  { id: 'analytics', label: 'Аналитика' },
  { id: 'setup', label: 'Начальные данные' },
] as const;

export type AccountSection = (typeof sections)[number]['id'];

export function AccountWorkspace({
  section,
  onSelect,
  operations,
  analytics,
  setup,
}: {
  section: AccountSection;
  onSelect: (section: AccountSection) => void;
  operations: ReactNode;
  analytics: ReactNode;
  setup: ReactNode;
}) {
  const id = useId();
  const contents = { operations, analytics, setup };
  return (
    <div className="account-workspace">
      <div className="account-workspace__navigation" role="group" aria-label="Разделы счета">
        {sections.map((item) => (
          <button
            key={item.id}
            id={`${id}-${item.id}-button`}
            type="button"
            aria-pressed={section === item.id}
            aria-controls={`${id}-${item.id}`}
            onClick={() => onSelect(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {sections.map((item) => (
        <section
          key={item.id}
          id={`${id}-${item.id}`}
          className="account-workspace__panel"
          aria-labelledby={`${id}-${item.id}-button`}
          hidden={section !== item.id}
        >
          {contents[item.id]}
        </section>
      ))}
    </div>
  );
}
