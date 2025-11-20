# Инструкция по деплою на Yandex Cloud

Это руководство поможет вам настроить автоматический деплой приложения Capital Tracker на Yandex Cloud.

## Предварительные требования

1. Аккаунт в Yandex Cloud
2. Приватный репозиторий на GitHub
3. Yandex Cloud CLI установлен локально (опционально, для ручного деплоя)

## Шаг 1: Создание ресурсов в Yandex Cloud

### 1.1. Создание Container Registry

1. Войдите в [Yandex Cloud Console](https://console.cloud.yandex.ru/)
2. Перейдите в раздел **Container Registry**
3. Создайте новый реестр (Registry)
4. Запишите **Registry ID** (он понадобится для настройки)

### 1.2. Создание виртуальной машины

1. Перейдите в раздел **Compute Cloud** → **Виртуальные машины**
2. Создайте новую VM:

   - **Имя**: `capital-tracker-vm`
   - **Зона доступности**: выберите ближайшую
   - **Образ**: Ubuntu 22.04 LTS
   - **Платформа**: Intel Ice Lake
   - **vCPU**: минимум 2
   - **RAM**: минимум 4 GB
   - **Диск**: минимум 20 GB SSD
   - **Публичный IP**: включите
   - **Доступ**: SSH ключ (создайте или используйте существующий)

3. После создания VM запишите:
   - **Публичный IP адрес**
   - **Имя пользователя** (обычно `ubuntu` или `yc-user`)

### 1.3. Настройка VM

Подключитесь к VM по SSH:

```bash
ssh -i ~/.ssh/your-key.pem username@your-vm-ip
```

Установите Docker и Docker Compose:

```bash
# Обновление системы
sudo apt update && sudo apt upgrade -y

# Установка Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER

# Установка Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# Перезайдите в систему для применения изменений группы
exit
```

Создайте директорию для проекта:

```bash
sudo mkdir -p /opt/capital-tracker
sudo chown $USER:$USER /opt/capital-tracker
cd /opt/capital-tracker
```

Скопируйте файлы на сервер:

```bash
# С вашего локального компьютера
scp -i ~/.ssh/your-key.pem docker-compose.yml username@your-vm-ip:/opt/capital-tracker/
# Copy production environment template
scp -i ~/.ssh/your-key.pem env.production.example username@your-vm-ip:/opt/capital-tracker/
scp -i ~/.ssh/your-key.pem .env.production.example username@your-vm-ip:/opt/capital-tracker/.env
```

### 1.4. Настройка переменных окружения

На VM создайте файл `.env` в директории `/opt/capital-tracker/`:

```bash
cd /opt/capital-tracker
nano .env
```

Содержимое `.env`:

```env
# Database
DB_USERNAME=postgres
DB_PASSWORD=your-secure-password-here
DB_NAME=capital_tracker

# Backend
JWT_SECRET=your-very-secure-jwt-secret-key-min-32-chars
FRONTEND_URL=https://your-domain.com

# Docker Images (будут установлены автоматически через CI/CD)
BACKEND_IMAGE=cr.yandex/your-registry-id/capital-tracker-backend:latest
FRONTEND_IMAGE=cr.yandex/your-registry-id/capital-tracker-frontend:latest
```

**Важно**: Замените `your-registry-id` на ваш Registry ID из шага 1.1.

## Шаг 2: Настройка GitHub Secrets

В вашем GitHub репозитории перейдите в **Settings** → **Secrets and variables** → **Actions** и добавьте следующие секреты:

### 2.1. Yandex Cloud Secrets

- `YC_TOKEN` - OAuth токен или IAM токен для Yandex Cloud
  - Получить можно в [IAM Tokens](https://console.cloud.yandex.ru/iam)
- `YC_FOLDER_ID` - ID каталога в Yandex Cloud

  - Найти можно в URL консоли или в настройках каталога

- `YC_REGISTRY_ID` - ID вашего Container Registry
  - Найти можно в разделе Container Registry

### 2.2. VM Secrets

- `YC_VM_HOST` - Публичный IP адрес вашей VM
- `YC_VM_USER` - Имя пользователя для SSH (обычно `ubuntu` или `yc-user`)
- `YC_VM_SSH_KEY` - Приватный SSH ключ для доступа к VM
  - Содержимое файла `~/.ssh/your-key.pem` (весь ключ, включая `-----BEGIN` и `-----END`)

### 2.3. Application Secrets

- `VITE_API_URL` - URL вашего backend API (например, `https://api.your-domain.com` или `http://your-vm-ip:3000`)

## Шаг 3: Настройка DNS (опционально)

Если у вас есть домен, настройте DNS записи:

1. **A запись** для основного домена → IP адрес VM
2. **A запись** для поддомена API (например, `api.your-domain.com`) → IP адрес VM

## Шаг 4: Настройка Nginx на VM (для домена)

Если вы используете домен, установите Nginx на VM для проксирования:

```bash
sudo apt install nginx -y
```

Создайте конфигурацию:

```bash
sudo nano /etc/nginx/sites-available/capital-tracker
```

Содержимое:

```nginx
server {
    listen 80;
    server_name pavelars.com www.pavelars.com;

    location / {
        proxy_pass http://localhost:80;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    listen 80;
    server_name api.pavelars.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Активируйте конфигурацию:

```bash
sudo ln -s /etc/nginx/sites-available/capital-tracker /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

## Шаг 5: Первый деплой

### Автоматический деплой через GitHub Actions

1. Убедитесь, что все секреты настроены в GitHub
2. Сделайте push в ветку `main`:
   ```bash
   git add .
   git commit -m "Setup CI/CD"
   git push origin main
   ```
3. Перейдите в **Actions** в вашем GitHub репозитории
4. Дождитесь завершения workflow

### Ручной деплой

Если нужно выполнить деплой вручную:

```bash
# На VM
cd /opt/capital-tracker
docker compose pull
docker compose up -d
```

## Шаг 6: Проверка деплоя

1. Проверьте статус контейнеров:

   ```bash
   docker compose ps
   ```

2. Проверьте логи:

   ```bash
   docker compose logs -f
   ```

3. Откройте в браузере:
   - Frontend: `http://your-vm-ip` или `https://your-domain.com`
   - Backend API: `http://your-vm-ip:3000` или `https://api.your-domain.com`

4. Проверьте миграции БД:

   ```bash
   # Проверить, что миграции выполнены
   docker compose exec postgres psql -U postgres -d capital_tracker -c "SELECT * FROM migrations;"
   
   # Проверить, что seed данные (валюты) на месте
   docker compose exec postgres psql -U postgres -d capital_tracker -c "SELECT code, name, type FROM currencies;"
   ```

**Примечание**: Миграции выполняются автоматически при первом запуске приложения (через `migrationsRun: true` в TypeORM конфигурации).

## Шаг 7: Настройка SSL (HTTPS)

Для production рекомендуется настроить SSL сертификат через Let's Encrypt:

```bash
sudo apt install certbot python3-certbot-nginx -y
sudo certbot --nginx -d your-domain.com -d www.your-domain.com -d api.your-domain.com
```

Certbot автоматически обновит конфигурацию Nginx и настроит автоматическое обновление сертификата.

## Мониторинг и обслуживание

### Просмотр логов

```bash
# Все сервисы
docker compose logs -f

# Конкретный сервис
docker compose logs -f backend
docker compose logs -f frontend
docker compose logs -f postgres
```

### Перезапуск сервисов

```bash
docker compose restart backend
docker compose restart frontend
```

### Обновление приложения

При push в ветку `main` автоматически запустится деплой. Или вручную:

```bash
cd /opt/capital-tracker
docker compose pull
docker compose up -d
```

### Управление миграциями БД

TypeORM автоматически выполняет миграции при старте приложения. Для ручного управления миграциями:

```bash
# Посмотреть статус миграций (какие выполнены)
docker compose exec postgres psql -U postgres -d capital_tracker -c "SELECT * FROM migrations;"

# Откатить последнюю миграцию (если что-то пошло не так)
docker compose exec backend npm run migration:revert

# Генерация новой миграции (при изменении Entity)
docker compose exec backend sh -c "npm run migration:generate -- src/migrations/MigrationName"
```

**Важно**: После генерации новой миграции необходимо:
1. Скомпилировать backend: `npm run build`
2. Закоммитить миграцию в Git
3. Задеплоить через GitHub Actions или вручную

### Резервное копирование базы данных

Создайте скрипт для бэкапа:

```bash
nano /opt/capital-tracker/backup.sh
```

Содержимое:

```bash
#!/bin/bash
BACKUP_DIR="/opt/backups"
DATE=$(date +%Y%m%d_%H%M%S)
mkdir -p $BACKUP_DIR

docker exec capital_tracker_db pg_dump -U postgres capital_tracker > $BACKUP_DIR/backup_$DATE.sql
find $BACKUP_DIR -name "backup_*.sql" -mtime +7 -delete
```

Сделайте скрипт исполняемым и добавьте в cron:

```bash
chmod +x /opt/capital-tracker/backup.sh
crontab -e
# Добавьте строку для ежедневного бэкапа в 2:00
0 2 * * * /opt/capital-tracker/backup.sh
```

## Устранение неполадок

### Контейнеры не запускаются

1. Проверьте логи: `docker compose logs`
2. Проверьте переменные окружения в `.env`
3. Убедитесь, что порты не заняты: `sudo netstat -tulpn | grep :3000`

### Проблемы с подключением к базе данных

1. Проверьте, что контейнер PostgreSQL запущен: `docker ps`
2. Проверьте логи PostgreSQL: `docker compose logs postgres`
3. Проверьте переменные окружения для БД

### Проблемы с образами из Container Registry

1. Убедитесь, что образы успешно собраны и загружены в реестр
2. Проверьте права доступа к Container Registry
3. Убедитесь, что `YC_REGISTRY_ID` правильный в секретах GitHub

## Дополнительные ресурсы

- [Документация Yandex Cloud](https://cloud.yandex.ru/docs/)
- [Документация Container Registry](https://cloud.yandex.ru/docs/container-registry/)
- [Документация Compute Cloud](https://cloud.yandex.ru/docs/compute/)
