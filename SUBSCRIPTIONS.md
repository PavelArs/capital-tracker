# Система подписок и доступов

## Уровни подписок

### FREE (Бесплатная)

- Текущий функционал приложения
- Базовые активы и обязательства
- Bitcoin и Ethereum кошельки
- Базовая аналитика

### PRO

Все возможности FREE, плюс:

- **Интеграции с брокерами** (`/integrations/brokers`)

  - Interactive Brokers
  - TD Ameritrade
  - Charles Schwab
  - E\*Trade
  - Robinhood
  - Custom брокеры

- **Интеграции с банками** (`/integrations/banks`)

  - Chase
  - Bank of America
  - Wells Fargo
  - Citibank
  - Capital One
  - Open Banking API
  - Custom банки

- **Дополнительные блокчейны** (`/crypto`)

  - Polygon
  - Binance Smart Chain
  - Avalanche
  - Solana
  - Arbitrum
  - Optimism
  - Base

- **DeFi интеграции** (`/defi`)

  - Uniswap
  - Aave
  - Compound
  - Curve
  - Balancer
  - SushiSwap
  - PancakeSwap
  - Liquidity pools, lending, staking, yield farming

- **AI рекомендации** (`/ai-recommendations`)
  - Рекомендации по инвестициям
  - Диверсификация
  - Управление рисками
  - Распределение активов
  - Управление долгами
  - Оптимизация налогов

### ENTERPRISE

Все возможности PRO, плюс:

- **Множественные капиталы** (`/capitals`)

  - Ведение нескольких капиталов независимо друг от друга
  - Переключение между капиталами
  - Установка капитала по умолчанию

- **Формирование отчетов** (`/reports`)
  - Финансовые сводки
  - Распределение активов
  - Отчеты о производительности
  - Налоговые отчеты
  - Экспорт в PDF, Excel, CSV, JSON

## API Endpoints

### Подписки

- `GET /subscriptions/current` - Получить текущую подписку
- `POST /subscriptions/upgrade` - Обновить подписку
  ```json
  {
    "type": "pro" | "enterprise"
  }
  ```
- `POST /subscriptions/cancel` - Отменить подписку

### Интеграции (PRO+)

- `POST /integrations/brokers` - Создать интеграцию с брокером
- `GET /integrations/brokers` - Список интеграций с брокерами
- `POST /integrations/brokers/:id/sync` - Синхронизировать данные
- `POST /integrations/banks` - Создать интеграцию с банком
- `GET /integrations/banks` - Список интеграций с банками
- `POST /integrations/banks/:id/sync` - Синхронизировать данные

### DeFi (PRO+)

- `POST /defi` - Создать DeFi позицию
- `GET /defi` - Список DeFi позиций
- `POST /defi/:id/sync` - Синхронизировать позицию

### AI Рекомендации (PRO+)

- `GET /ai-recommendations` - Получить рекомендации
- `POST /ai-recommendations/generate` - Сгенерировать новые рекомендации
- `PUT /ai-recommendations/:id` - Обновить статус рекомендации

### Капиталы (ENTERPRISE)

- `POST /capitals` - Создать капитал
- `GET /capitals` - Список капиталов
- `POST /capitals/:id/set-default` - Установить капитал по умолчанию

### Отчеты (ENTERPRISE)

- `POST /reports` - Создать отчет
- `GET /reports` - Список отчетов
- `POST /reports/:id/generate` - Сгенерировать отчет

## Guards

Используйте `@RequireSubscription(SubscriptionType.PRO)` или `@RequireSubscription(SubscriptionType.ENTERPRISE)` для защиты эндпоинтов.

Пример:

```typescript
@Post()
@RequireSubscription(SubscriptionType.PRO)
async create(@Request() req, @Body() createDto: CreateDto) {
  // ...
}
```

## Entities

### Subscription

- `type`: FREE | PRO | ENTERPRISE
- `status`: ACTIVE | CANCELLED | EXPIRED
- `startDate`, `endDate`

### BrokerIntegration

- `brokerType`: Тип брокера
- `credentials`: Зашифрованные учетные данные
- `status`: ACTIVE | INACTIVE | ERROR

### BankIntegration

- `bankType`: Тип банка
- `credentials`: Зашифрованные учетные данные
- `status`: ACTIVE | INACTIVE | ERROR

### DeFiPosition

- `platform`: Платформа DeFi
- `positionType`: Тип позиции (liquidity_pool, lending, staking, etc.)
- `value`, `apy`

### AiRecommendation

- `type`: Тип рекомендации
- `status`: PENDING | ACCEPTED | REJECTED | IMPLEMENTED
- `priority`: Приоритет (0-10)

### Capital

- `name`: Название капитала
- `isDefault`: Капитал по умолчанию
- `isActive`: Активен ли капитал

### Report

- `type`: Тип отчета
- `format`: PDF | EXCEL | CSV | JSON
- `data`: Сгенерированные данные отчета

## Миграции

Необходимо создать миграции для новых таблиц:

- `subscriptions`
- `broker_integrations`
- `bank_integrations`
- `defi_positions`
- `ai_recommendations`
- `capitals`
- `reports`

Также нужно обновить таблицу `users` - добавить поле `subscriptionType`.
