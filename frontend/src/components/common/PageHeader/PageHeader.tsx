import './PageHeader.css';

interface PageHeaderProps {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
  showAction?: boolean;
  children?: React.ReactNode;
}

export function PageHeader({
  title,
  actionLabel,
  onAction,
  showAction = true,
  children,
}: PageHeaderProps) {
  return (
    <div className="page-header">
      <h1>{title}</h1>
      {children}
      {showAction && actionLabel && onAction && (
        <button className="page-header__action" onClick={onAction}>
          {actionLabel}
        </button>
      )}
    </div>
  );
}
