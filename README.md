# Capital Tracker - Личный учёт капитала

Минимально жизнеспособное веб-приложение для личного учёта капитала с перспективой дальнейшего расширения.

## Архитектура

- **Backend**: NestJS (Node.js)
- **Frontend**: React + TypeScript + Vite
- **База данных**: PostgreSQL
- **Развёртывание**: Docker + docker-compose

## Функциональные возможности

### 1. Управление активами и пассивами

- CRUD операции для активов с двумя типами:
  - **Stock Assets** (балансовые): Недвижимость, инвестиции, сбережения, техника, авто (входят в Net Worth)
  - **Flow Assets** (потоковые доходы): Зарплата, дивиденды, фриланс, аренда, пенсия (входят в Cash Flow)
- CRUD операции для пассивов (subscriptions, regular_expenses, loans, mortgage, credit_card, other)
- Поддержка различных валют и дат

### 2. Криптокошельки

- Добавление Ethereum и Bitcoin адресов
- Автоматическое получение балансов нативных валют
- Поддержка ERC-20 токенов для Ethereum
- Конвертация криптовалют в фиатные валюты (USD)
- Отображение стоимости в реальном времени
- Автоматическое обновление балансов и цен по расписанию

### 3. Валюты

- Хранение активов/пассивов в разных валютах
- Автоматическое получение курсов валют
- Конвертация в любую выбранную валюту

### 4. Метрики

- Финансовый запас прочности (runway) - рассчитывается на основе Net Worth
- FL-ratio (Financial Independence ratio) - рассчитывается на основе Stock Assets (правило 4%)
- Распределение капитала по категориям балансовых активов (Stock)
- Распределение потоковых доходов (Flow)
- Распределение пассивов
- Включение стоимости криптовалют и токенов в общий капитал

### 5. Графики

- Пайчарт активов
- Пайчарт пассивов
- Динамика общей стоимости капитала (30 дней)

### 6. Обновление данных

- Cron задачи для обновления криптовалютных балансов (каждый час)
- Автоматическое обновление курсов валют (каждый час)
- Автоматическое обновление цен криптовалют и токенов (каждые 10 минут)

### 7. Аутентификация и Email уведомления

- Регистрация и вход (JWT)
- Защищённые маршруты
- Архитектура готова для добавления уровней доступа
- **Приветственные email** при регистрации
- **Восстановление пароля** через email с токеном сброса
- Email подтверждения изменения пароля

## Структура проекта

```
.
├── backend/              # NestJS backend
│   ├── src/
│   │   ├── auth/        # Аутентификация
│   │   ├── assets/      # Управление активами
│   │   ├── liabilities/ # Управление пассивами
│   │   ├── crypto/      # Криптокошельки
│   │   ├── currencies/  # Валюты и курсы
│   │   ├── metrics/     # Метрики и аналитика
│   │   └── entities/    # Модели БД
│   ├── Dockerfile
│   └── package.json
├── frontend/            # React frontend
│   ├── src/
│   │   ├── pages/      # Страницы приложения
│   │   ├── components/ # Компоненты
│   │   └── contexts/   # React контексты
│   ├── Dockerfile
│   └── package.json
├── docker-compose.yml         # Единый Docker Compose для dev и prod
├── env.local.example          # Шаблон .env для локальной разработки
├── env.production.example     # Шаблон .env для production
├── QUICK_START.md            # Быстрый старт
├── DOCKER_SETUP.md           # Полная документация по Docker
├── DEPLOYMENT.md             # Деплой на Yandex Cloud
├── EMAIL_SETUP.md            # Настройка email уведомлений
└── README.md
```

## Быстрый старт

### Требования

- Docker и Docker Compose (для Docker развёртывания)
- Node.js 20+ (для локальной разработки)
- PostgreSQL (для локальной разработки)

### Вариант 1: Автоматическая установка (рекомендуется)

Используйте скрипт установки для автоматической настройки проекта:

```bash
# Установить все зависимости
chmod +x install.sh
./install.sh
```

Или установите backend и frontend отдельно:

```bash
# Backend
cd backend
chmod +x install.sh
./install.sh

# Frontend
cd ../frontend
chmod +x install.sh
./install.sh
```

### Вариант 2: Запуск с Docker (Рекомендуется)

1. Клонируйте репозиторий:

```bash
git clone <repository-url>
cd capital-tracker
```

2. Создайте `.env` файл из шаблона:

```bash
cp env.local.example .env
```

3. Запустите приложение:

```bash
docker compose up -d
```

4. Приложение будет доступно:

   - Frontend: http://localhost:3001
   - Backend API: http://localhost:3000
   - PostgreSQL: localhost:5432

5. Остановка:

```bash
docker compose down
```

**📖 Подробная документация:**

- [QUICK_START.md](QUICK_START.md) - Быстрый старт и troubleshooting
- [DOCKER_SETUP.md](DOCKER_SETUP.md) - Полная документация по Docker
- [DEPLOYMENT.md](DEPLOYMENT.md) - Деплой на Yandex Cloud
- [EMAIL_SETUP.md](EMAIL_SETUP.md) - Настройка email уведомлений (приветственные письма, восстановление пароля)

### Вариант 3: Локальная разработка (ручная установка)

#### Backend

1. Перейдите в директорию backend:

```bash
cd backend
```

2. Инициализируйте проект (если нужно):

```bash
npm init -y
npm install -g @nestjs/cli
```

3. Установите зависимости:

```bash
npm install
```

Или используйте скрипт установки (см. `backend/setup.md` для детальных инструкций):

```bash
chmod +x install.sh
./install.sh
```

4. Создайте файл `.env` на основе `.env.example`:

```bash
cp .env.example .env
# Отредактируйте .env с вашими настройками
```

5. Запустите PostgreSQL (через Docker или локально):

```bash
docker run -d --name postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=capital_tracker -p 5432:5432 postgres:15-alpine
```

6. Запустите backend:

```bash
npm run start:dev
```

#### Frontend

1. Перейдите в директорию frontend:

```bash
cd frontend
```

2. Инициализируйте проект (если нужно):

```bash
npm init -y
```

3. Установите зависимости:

```bash
npm install
```

Или используйте скрипт установки (см. `frontend/setup.md` для детальных инструкций):

```bash
chmod +x install.sh
./install.sh
```

4. Создайте файл `.env` (опционально, если нужен другой API URL):

```bash
cp .env.example .env
# Отредактируйте .env если нужно изменить API URL
```

5. Запустите frontend:

```bash
npm run dev
```

## API Endpoints

### Аутентификация

- `POST /auth/register` - Регистрация (отправляет приветственное письмо)
- `POST /auth/login` - Вход
- `POST /auth/forgot-password` - Запрос на восстановление пароля
- `POST /auth/reset-password` - Сброс пароля по токену
- `GET /auth/me` - Получить текущего пользователя

### Активы

- `GET /assets` - Получить все активы
- `POST /assets` - Создать актив
- `GET /assets/:id` - Получить актив
- `PATCH /assets/:id` - Обновить актив
- `DELETE /assets/:id` - Удалить актив

### Пассивы

- `GET /liabilities` - Получить все пассивы
- `POST /liabilities` - Создать пассив
- `GET /liabilities/:id` - Получить пассив
- `PATCH /liabilities/:id` - Обновить пассив
- `DELETE /liabilities/:id` - Удалить пассив

### Криптокошельки

- `GET /crypto` - Получить все кошельки
- `POST /crypto` - Добавить кошелёк
- `GET /crypto/:id` - Получить кошелёк
- `PATCH /crypto/:id/update-balance` - Обновить баланс
- `DELETE /crypto/:id` - Удалить кошелёк

### Валюты

- `GET /currencies/rates?base=USD` - Получить курсы валют
- `GET /currencies/convert?amount=100&from=USD&to=EUR` - Конвертировать валюту
- `GET /currencies` - Получить список валют

### Метрики

- `GET /metrics?currency=USD` - Получить метрики
- `GET /metrics/history?days=30&currency=USD` - Получить историю капитала

## Внешние API

Приложение использует следующие публичные API:

- **Курсы валют**: ExchangeRate-API (https://api.exchangerate-api.com)
- **Ethereum балансы**: Public RPC endpoints (LlamaRPC, Ankr, PublicNode)
- **Ethereum токены**: Ethplorer API (https://api.ethplorer.io)
- **Bitcoin балансы**: Blockstream API (https://blockstream.info)
- **Цены криптовалют**: CoinGecko API (https://api.coingecko.com)

**Примечание**: Для production рекомендуется использовать API ключи для увеличения лимитов запросов.

## База данных

### Основные таблицы:

- `users` - Пользователи
- `assets` - Активы (с разделением на Stock/Flow типы)
  - `assetType`: ENUM('stock', 'flow')
  - `category`: различные категории в зависимости от типа
- `liabilities` - Пассивы
- `crypto_wallets` - Криптокошельки

### Подробнее о типах активов

См. файл [STOCK_FLOW_ASSETS.md](STOCK_FLOW_ASSETS.md) для детальной информации о концепции разделения активов на Stock и Flow.

### Миграции БД

Проект использует TypeORM для управления миграциями базы данных:

- **Автоматический запуск**: Миграции выполняются автоматически при старте приложения (через `migrationsRun: true`)
- **Seed данные**: Начальные данные (валюты) вставляются через миграции

#### Команды для работы с миграциями:

```bash
# В контейнере Docker
docker compose exec backend sh

# Генерация новой миграции на основе изменений в Entity
npm run migration:generate -- src/migrations/MigrationName

# Запуск миграций вручную (не требуется, т.к. выполняются автоматически)
npm run migration:run

# Откат последней миграции
npm run migration:revert
```

**Примечание**: После изменения Entity файлов генерируйте новые миграции, не полагайтесь на `synchronize: true` в production.

## Безопасность

- JWT токены для аутентификации
- Хеширование паролей (bcrypt)
- Валидация входных данных
- CORS настройки

**Важно**: Перед развёртыванием в production:

1. Измените `JWT_SECRET` на безопасный случайный ключ
2. Настройте переменные окружения
3. Используйте HTTPS
4. Настройте rate limiting
5. Добавьте мониторинг и логирование

## Расширение функциональности

Архитектура спроектирована для удобного перехода к микросервисной архитектуре:

- Каждый модуль (assets, liabilities, crypto, etc.) может быть выделен в отдельный сервис
- Использование TypeORM позволяет легко мигрировать на другие БД
- Frontend и Backend полностью разделены

## Лицензия

MIT
