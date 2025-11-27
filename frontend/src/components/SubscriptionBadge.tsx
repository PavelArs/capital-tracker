import { useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import type { SubscriptionType } from '@shared/types';
import './SubscriptionBadge.css';

// Re-export for backward compatibility
export type { SubscriptionType };

interface SubscriptionBadgeProps {
  type: SubscriptionType;
  clickable?: boolean;
}

interface SubscriptionInfo {
  label: string;
  icon: string;
  className: string;
}

const SUBSCRIPTION_INFO: Record<SubscriptionType, SubscriptionInfo> = {
  pro: {
    label: 'PRO',
    icon: '⭐',
    className: 'subscription-badge-pro',
  },
  enterprise: {
    label: 'ENTERPRISE',
    icon: '💎',
    className: 'subscription-badge-enterprise',
  },
  free: {
    label: 'FREE',
    icon: '🆓',
    className: 'subscription-badge-free',
  },
};

export default function SubscriptionBadge({ type, clickable = true }: SubscriptionBadgeProps) {
  const navigate = useNavigate();

  const info = useMemo(() => SUBSCRIPTION_INFO[type] || SUBSCRIPTION_INFO.free, [type]);

  const handleClick = useCallback(() => {
    if (clickable) {
      navigate('/subscriptions');
    }
  }, [clickable, navigate]);

  const title = clickable
    ? `Click to manage subscription: ${info.label}`
    : `Subscription: ${info.label}`;

  return (
    <span
      className={`subscription-badge ${info.className} ${clickable ? 'clickable' : ''}`}
      title={title}
      onClick={handleClick}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e) => e.key === 'Enter' && handleClick() : undefined}
    >
      <span className="subscription-icon">{info.icon}</span>
      <span className="subscription-label">{info.label}</span>
    </span>
  );
}
