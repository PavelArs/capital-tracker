import './SubNav.css';

export interface SubNavItem {
  key: string;
  label: string;
}

interface SubNavProps {
  items: SubNavItem[];
  activeKey: string;
  onSelect: (key: string) => void;
  className?: string;
}

export function SubNav({ items, activeKey, onSelect, className = '' }: SubNavProps) {
  return (
    <nav className={`sub-nav ${className}`}>
      {items.map((item) => (
        <button
          key={item.key}
          className={`sub-nav__btn ${activeKey === item.key ? 'active' : ''}`}
          onClick={() => onSelect(item.key)}
          aria-current={activeKey === item.key ? 'page' : undefined}
        >
          {item.label}
        </button>
      ))}
    </nav>
  );
}
