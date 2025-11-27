import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@contexts/AuthContext';
import { useError } from '@contexts/ErrorContext';
import { api } from '@api';
import type { SubscriptionType } from '@shared/types';
import SubscriptionBadge from '@components/SubscriptionBadge';
import LoadingButton from '@components/LoadingButton';
import './Subscriptions.css';

interface SubscriptionPlan {
  type: SubscriptionType;
  name: string;
  price: string;
  features: string[];
  popular?: boolean;
}

interface CurrentSubscription {
  type: SubscriptionType;
  status: string;
  startDate?: string;
  endDate?: string;
}

const SUBSCRIPTION_HIERARCHY: Record<SubscriptionType, number> = {
  free: 0,
  pro: 1,
  enterprise: 2,
};

const PLANS: SubscriptionPlan[] = [
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

export default function Subscriptions() {
  const { user, refreshUser } = useAuth();
  const { showError } = useError();
  const [loading, setLoading] = useState(false);
  const [currentSubscription, setCurrentSubscription] = useState<CurrentSubscription | null>(null);

  const fetchCurrentSubscription = useCallback(async () => {
    try {
      const response = await api.get<CurrentSubscription>('/subscriptions/current');
      setCurrentSubscription(response.data);
    } catch (error: any) {
      // Ignore 404 - user might not have a subscription record yet
      if (error.response?.status !== 404) {
        console.error('Failed to fetch subscription:', error);
      }
    }
  }, []);

  useEffect(() => {
    fetchCurrentSubscription();
  }, [fetchCurrentSubscription]);

  const handleUpgrade = useCallback(async (type: SubscriptionType) => {
    if (loading) return;
    
    setLoading(true);
    try {
      await api.post('/subscriptions/upgrade', { type });
      await refreshUser();
      await fetchCurrentSubscription();
    } catch (error: any) {
      showError(error.response?.data?.message || 'Failed to upgrade subscription');
    } finally {
      setLoading(false);
    }
  }, [loading, refreshUser, fetchCurrentSubscription, showError]);

  const handleCancel = useCallback(async () => {
    if (loading || !confirm('Are you sure you want to cancel your subscription?')) return;
    
    setLoading(true);
    try {
      await api.post('/subscriptions/cancel');
      await refreshUser();
      await fetchCurrentSubscription();
    } catch (error: any) {
      showError(error.response?.data?.message || 'Failed to cancel subscription');
    } finally {
      setLoading(false);
    }
  }, [loading, refreshUser, fetchCurrentSubscription, showError]);

  const canUpgrade = useCallback((planType: SubscriptionType) => {
    const currentType = user?.subscriptionType || 'free';
    return SUBSCRIPTION_HIERARCHY[planType] > SUBSCRIPTION_HIERARCHY[currentType];
  }, [user?.subscriptionType]);

  const canDowngrade = useCallback((planType: SubscriptionType) => {
    const currentType = user?.subscriptionType || 'free';
    return SUBSCRIPTION_HIERARCHY[planType] < SUBSCRIPTION_HIERARCHY[currentType];
  }, [user?.subscriptionType]);

  const userSubscriptionType = user?.subscriptionType || 'free';

  return (
    <div className="subscriptions-page">
      <div className="subscriptions-header">
        <h1>Выберите подписку</h1>
        <p>
          Текущая подписка: <SubscriptionBadge type={userSubscriptionType} />
        </p>
      </div>

      <div className="subscriptions-grid">
        {PLANS.map((plan) => {
          const isCurrent = plan.type === userSubscriptionType;
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
                      <LoadingButton
                        className="btn-cancel"
                        onClick={handleCancel}
                        loading={loading}
                        loadingText="Обработка..."
                        variant="danger"
                      >
                        Отменить подписку
                      </LoadingButton>
                    )}
                  </>
                ) : canUpgradePlan ? (
                  <LoadingButton
                    className="btn-upgrade"
                    onClick={() => handleUpgrade(plan.type)}
                    loading={loading}
                    loadingText="Обработка..."
                  >
                    Обновить
                  </LoadingButton>
                ) : canDowngradePlan ? (
                  <LoadingButton
                    className="btn-downgrade"
                    onClick={() => handleUpgrade(plan.type)}
                    loading={loading}
                    loadingText="Обработка..."
                  >
                    Перейти на этот план
                  </LoadingButton>
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
