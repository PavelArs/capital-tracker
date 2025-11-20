import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useError } from '../contexts/ErrorContext';
import axios from 'axios';
import SubscriptionBadge, { SubscriptionType } from '../components/SubscriptionBadge';
import './Subscriptions.css';

interface SubscriptionPlan {
  type: SubscriptionType;
  name: string;
  price: string;
  features: string[];
  popular?: boolean;
}

export default function Subscriptions() {
  const { user, refreshUser } = useAuth();
  const { showError } = useError();
  // const { t } = useTranslation(); // Removed unused translation hook
  const [loading, setLoading] = useState(false);
  const [currentSubscription, setCurrentSubscription] = useState<any>(null);

  useEffect(() => {
    fetchCurrentSubscription();
  }, []);

  const fetchCurrentSubscription = async () => {
    try {
      const response = await axios.get('/subscriptions/current');
      setCurrentSubscription(response.data);
    } catch (error: any) {
      // Ignore 404 - user might not have a subscription record yet
      if (error.response?.status !== 404) {
        console.error('Failed to fetch subscription:', error);
      }
    }
  };

  const handleUpgrade = async (type: SubscriptionType) => {
    if (loading) return;
    
    setLoading(true);
    try {
      await axios.post('/subscriptions/upgrade', { type });
      await refreshUser();
      await fetchCurrentSubscription();
      setLoading(false);
    } catch (error: any) {
      showError(error.response?.data?.message || 'Failed to upgrade subscription');
      setLoading(false);
    }
  };

  const handleCancel = async () => {
    if (loading || !confirm('Are you sure you want to cancel your subscription?')) return;
    
    setLoading(true);
    try {
      await axios.post('/subscriptions/cancel');
      await refreshUser();
      await fetchCurrentSubscription();
      setLoading(false);
    } catch (error: any) {
      showError(error.response?.data?.message || 'Failed to cancel subscription');
      setLoading(false);
    }
  };

  const plans: SubscriptionPlan[] = [
    {
      type: 'free',
      name: 'Free',
      price: '$0',
      features: [
        'Базовые активы и обязательства',
        'Bitcoin и Ethereum кошельки',
        'Базовая аналитика',
        'Отслеживание капитала',
      ],
    },
    {
      type: 'pro',
      name: 'Pro',
      price: '$29',
      popular: true,
      features: [
        'Все возможности Free',
        'Интеграции с брокерами',
        'Интеграции с банками',
        'Дополнительные блокчейны (Polygon, BSC, Solana и др.)',
        'DeFi интеграции (Uniswap, Aave, Compound и др.)',
        'AI рекомендации по капиталу',
        'Отслеживание liquidity pools и staking',
      ],
    },
    {
      type: 'enterprise',
      name: 'Enterprise',
      price: '$99',
      features: [
        'Все возможности Pro',
        'Множественные капиталы',
        'Формирование отчетов (PDF, Excel, CSV)',
        'Приоритетная поддержка',
        'Кастомные интеграции',
      ],
    },
  ];

  // Removed unused getCurrentPlan function
  // const getCurrentPlan = () => {
  //   return plans.find((plan) => plan.type === user?.subscriptionType) || plans[0];
  // };

  const canUpgrade = (planType: SubscriptionType) => {
    const currentType = user?.subscriptionType || 'free';
    const hierarchy = { free: 0, pro: 1, enterprise: 2 };
    return hierarchy[planType] > hierarchy[currentType as SubscriptionType];
  };

  const canDowngrade = (planType: SubscriptionType) => {
    const currentType = user?.subscriptionType || 'free';
    const hierarchy = { free: 0, pro: 1, enterprise: 2 };
    return hierarchy[planType] < hierarchy[currentType as SubscriptionType];
  };

  return (
    <div className="subscriptions-page">
      <div className="subscriptions-header">
        <h1>Выберите подписку</h1>
        <p>Текущая подписка: <SubscriptionBadge type={user?.subscriptionType || 'free'} /></p>
      </div>

      <div className="subscriptions-grid">
        {plans.map((plan) => {
          const isCurrent = plan.type === user?.subscriptionType;
          const canUpgradePlan = canUpgrade(plan.type);
          const canDowngradePlan = canDowngrade(plan.type);

          return (
            <div
              key={plan.type}
              className={`subscription-card ${plan.popular ? 'popular' : ''} ${isCurrent ? 'current' : ''}`}
            >
              {plan.popular && <div className="popular-badge">Популярный</div>}
              {isCurrent && <div className="current-badge">Текущий план</div>}

              <div className="subscription-header">
                <h2>{plan.name}</h2>
                <div className="subscription-price">
                  <span className="price-amount">{plan.price}</span>
                  <span className="price-period">/месяц</span>
                </div>
                <SubscriptionBadge type={plan.type} />
              </div>

              <ul className="subscription-features">
                {plan.features.map((feature, index) => (
                  <li key={index}>
                    <span className="feature-icon">✓</span>
                    {feature}
                  </li>
                ))}
              </ul>

              <div className="subscription-actions">
                {isCurrent ? (
                  <>
                    <button className="btn-current" disabled>
                      Текущий план
                    </button>
                    {plan.type !== 'free' && (
                      <button
                        className="btn-cancel"
                        onClick={handleCancel}
                        disabled={loading}
                      >
                        Отменить подписку
                      </button>
                    )}
                  </>
                ) : canUpgradePlan ? (
                  <button
                    className="btn-upgrade"
                    onClick={() => handleUpgrade(plan.type)}
                    disabled={loading}
                  >
                    {loading ? 'Обработка...' : 'Обновить'}
                  </button>
                ) : canDowngradePlan ? (
                  <button
                    className="btn-downgrade"
                    onClick={() => handleUpgrade(plan.type)}
                    disabled={loading}
                  >
                    {loading ? 'Обработка...' : 'Перейти на этот план'}
                  </button>
                ) : (
                  <button className="btn-disabled" disabled>
                    Недоступно
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {currentSubscription && currentSubscription.type !== 'free' && (
        <div className="subscription-info">
          <h3>Информация о подписке</h3>
          <div className="info-grid">
            <div>
              <strong>Тип:</strong> {currentSubscription.type}
            </div>
            <div>
              <strong>Статус:</strong> {currentSubscription.status}
            </div>
            {currentSubscription.startDate && (
              <div>
                <strong>Начало:</strong>{' '}
                {new Date(currentSubscription.startDate).toLocaleDateString()}
              </div>
            )}
            {currentSubscription.endDate && (
              <div>
                <strong>Окончание:</strong>{' '}
                {new Date(currentSubscription.endDate).toLocaleDateString()}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

