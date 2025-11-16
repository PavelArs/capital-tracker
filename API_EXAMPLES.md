# Примеры использования API

## Аутентификация

### Регистрация

```bash
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "password123",
    "firstName": "John",
    "lastName": "Doe"
  }'
```

### Вход

```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "password123"
  }'
```

Ответ:

```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "firstName": "John",
    "lastName": "Doe"
  }
}
```

### Получить информацию о текущем пользователе

```bash
curl -X GET http://localhost:3000/auth/me \
  -H "Authorization: Bearer YOUR_TOKEN"
```

Ответ:

```json
{
  "id": "uuid",
  "email": "user@example.com",
  "firstName": "John",
  "lastName": "Doe",
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z"
}
```

Этот endpoint используется для восстановления сессии пользователя при перезагрузке страницы.

## Активы

### Создать балансовый актив (Stock)

```bash
curl -X POST http://localhost:3000/assets \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Apartment",
    "assetType": "stock",
    "category": "real_estate",
    "amount": 500000,
    "currency": "USD",
    "date": "2024-01-01",
    "description": "Main apartment"
  }'
```

### Создать потоковый доход (Flow)

```bash
curl -X POST http://localhost:3000/assets \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Monthly Salary",
    "assetType": "flow",
    "category": "salary",
    "amount": 5000,
    "currency": "USD",
    "date": "2024-01-01",
    "description": "Regular monthly income"
  }'
```

### Категории активов

**Stock Assets (балансовые)**:

- `real_estate` - Недвижимость
- `investments` - Инвестиции
- `savings` - Сбережения
- `crypto` - Криптовалюта (также автоматически учитывается из crypto wallets)
- `vehicle` - Транспорт
- `equipment` - Оборудование/техника
- `other` - Другое

**Flow Assets (потоковые доходы)**:

- `salary` - Зарплата
- `dividends` - Дивиденды
- `freelance` - Фриланс
- `rent_income` - Доход от аренды
- `pension` - Пенсия
- `other` - Другое

### Получить все активы

```bash
curl -X GET http://localhost:3000/assets \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### Обновить актив

```bash
curl -X PATCH http://localhost:3000/assets/ASSET_ID \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 550000
  }'
```

### Удалить актив

```bash
curl -X DELETE http://localhost:3000/assets/ASSET_ID \
  -H "Authorization: Bearer YOUR_TOKEN"
```

## Пассивы

### Создать пассив

```bash
curl -X POST http://localhost:3000/liabilities \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Netflix Subscription",
    "category": "subscriptions",
    "amount": 15.99,
    "currency": "USD",
    "date": "2024-01-01",
    "description": "Monthly subscription"
  }'
```

### Получить все пассивы

```bash
curl -X GET http://localhost:3000/liabilities \
  -H "Authorization: Bearer YOUR_TOKEN"
```

## Криптокошельки

### Добавить Ethereum кошелёк

```bash
curl -X POST http://localhost:3000/crypto \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "ethereum",
    "address": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb"
  }'
```

### Добавить Bitcoin кошелёк

```bash
curl -X POST http://localhost:3000/crypto \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "bitcoin",
    "address": "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"
  }'
```

### Получить все кошельки

```bash
curl -X GET http://localhost:3000/crypto \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### Получить цены криптовалют

```bash
curl -X GET http://localhost:3000/crypto/prices \
  -H "Authorization: Bearer YOUR_TOKEN"
```

Ответ:

```json
{
  "BTC": {
    "usd": 45000.5,
    "lastUpdated": "2023-10-01T12:00:00.000Z"
  },
  "ETH": {
    "usd": 2500.75,
    "lastUpdated": "2023-10-01T12:00:00.000Z"
  }
}
```

### Обновить баланс кошелька

```bash
curl -X PATCH http://localhost:3000/crypto/WALLET_ID/update-balance \
  -H "Authorization: Bearer YOUR_TOKEN"
```

## Валюты

### Получить курсы валют

```bash
curl -X GET "http://localhost:3000/currencies/rates?base=USD" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### Конвертировать валюту

```bash
curl -X GET "http://localhost:3000/currencies/convert?amount=100&from=USD&to=EUR" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

## Метрики

### Получить метрики

```bash
curl -X GET "http://localhost:3000/metrics?currency=USD" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

Ответ:

```json
{
  "netWorth": 500000,
  "totalStockAssets": 600000,
  "totalFlowIncome": 5000,
  "cryptoValue": 25000,
  "totalLiabilities": 100000,
  "monthlyExpenses": 5000,
  "runway": 100,
  "flRatio": 0.4,
  "stockAssetDistribution": {
    "real_estate": 75.0,
    "investments": 20.0,
    "savings": 5.0
  },
  "flowIncomeDistribution": {
    "salary": 80.0,
    "dividends": 20.0
  },
  "liabilityDistribution": {
    "subscriptions": 20,
    "regular_expenses": 80
  },
  "currency": "USD"
}
```

**Описание полей**:

- `netWorth` - чистая стоимость (Stock Assets - Liabilities)
- `totalStockAssets` - балансовые активы + криптовалюта
- `totalFlowIncome` - потоковые доходы (не входят в Net Worth)
- `cryptoValue` - стоимость криптовалют (включена в totalStockAssets)
- `runway` - количество месяцев на текущих активах без дохода
- `flRatio` - коэффициент финансовой независимости (основан на правиле 4%)
- `stockAssetDistribution` - распределение балансовых активов по категориям
- `flowIncomeDistribution` - распределение потоковых доходов по категориям

### Получить историю капитала

```bash
curl -X GET "http://localhost:3000/metrics/history?days=30&currency=USD" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

Ответ:

```json
[
  {
    "date": "2024-01-01",
    "netWorth": 490000,
    "totalAssets": 590000,
    "totalLiabilities": 100000
  },
  {
    "date": "2024-01-02",
    "netWorth": 495000,
    "totalAssets": 595000,
    "totalLiabilities": 100000
  }
]
```
