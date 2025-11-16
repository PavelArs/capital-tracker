import { useNavigate } from 'react-router-dom';
import './SubscriptionBadge.css';

export type SubscriptionType = 'free' | 'pro' | 'enterprise';

interface SubscriptionBadgeProps {
  type: SubscriptionType;
  clickable?: boolean;
}

export default function SubscriptionBadge({ type, clickable = true }: SubscriptionBadgeProps) {
  const navigate = useNavigate();

  const getSubscriptionInfo = (type: SubscriptionType) => {
    switch (type) {
      case 'pro':
        return {
          label: 'PRO',
          icon: '⭐',
          className: 'subscription-badge-pro',
        };
      case 'enterprise':
        return {
          label: 'ENTERPRISE',
          icon: '💎',
          className: 'subscription-badge-enterprise',
        };
      default:
        return {
          label: 'FREE',
          icon: '🆓',
          className: 'subscription-badge-free',
        };
    }
  };

  const info = getSubscriptionInfo(type);

  const handleClick = () => {
    if (clickable) {
      navigate('/subscriptions');
    }
  };

  return (
    <span
      className={`subscription-badge ${info.className} ${clickable ? 'clickable' : ''}`}
      title={clickable ? `Click to manage subscription: ${info.label}` : `Subscription: ${info.label}`}
      onClick={handleClick}
    >
      <span className="subscription-icon">{info.icon}</span>
      <span className="subscription-label">{info.label}</span>
    </span>
  );
}

