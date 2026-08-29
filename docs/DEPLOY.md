# Деплой

Разворачивание на одном сервере через Docker Compose: контейнер приложения (API +
планировщик + фронт) и Postgres рядом. Наружу смотрит только reverse proxy.

## Что понадобится

- Сервер с Docker 24+ и Docker Compose v2 (`docker compose version`).
- Доступ к репозиторию с кодом (см. шаг 1).
- Домен, указывающий на сервер (например `monitoring.company.ru`).
- SMTP-аккаунт для писем со ссылками входа.
- 1 CPU и 1 ГБ памяти хватает на сотни проверок; место на диске считайте как
  ≈150 байт на результат: 100 проверок раз в минуту за 30 дней ≈ 700 МБ.

## Шаг 1. Код на сервере

```bash
git clone https://github.com/freehero-pro/monitoring.git /opt/monitoring
```

**Если репозиторий приватный**, серверу нужен собственный ключ на чтение. Личный ключ с
ноутбука копировать не надо: deploy-ключ выдаётся одному репозиторию, и при компрометации
сервера чужие проекты и запись в этот останутся недоступны.

```bash
ssh-keygen -t ed25519 -f ~/.ssh/monitoring_deploy -C "monitoring deploy" -N ""
cat ~/.ssh/monitoring_deploy.pub
```

Выведенную строку добавьте в настройках репозитория: **Settings → Deploy keys → Add deploy
key**, галочку «Allow write access» не ставьте. Затем пропишите ключ в `~/.ssh/config` на
сервере — иначе ssh переберёт другие ключи и получит отказ раньше, чем дойдёт до нужного:

```
Host github.com
    User git
    IdentityFile ~/.ssh/monitoring_deploy
    IdentitiesOnly yes
```

После этого клонируйте по ssh:

```bash
ssh -T git@github.com    # проверка: должно поздороваться и отказать в shell
git clone git@github.com:freehero-pro/monitoring.git /opt/monitoring
```

## Шаг 2. Окружение

```bash
cd /opt/monitoring
cp .env.example .env
```

Обязательно поменяйте в `.env`:

| Переменная | Чему быть равной | Почему важно |
|---|---|---|
| `POSTGRES_PASSWORD` | случайная строка | из неё собирается `DATABASE_URL` контейнера |
| `APP_BASE_URL` | `https://monitoring.company.ru` | из него строится ссылка в письме; схема `https` включает флаг `Secure` у cookie сессии |
| `ADMIN_EMAIL` | ваша почта | из-под неё создаётся первый администратор |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM` | данные почтового ящика | без них ссылка входа уходит только в лог |

Пароль можно сгенерировать так:

```bash
sed -i "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$(openssl rand -hex 24)/" .env
```

`DATABASE_URL` в `.env` править не нужно: она используется только при запуске вне
контейнера (миграции с хоста, `npm run dev`). Контейнер собирает строку подключения сам
из `POSTGRES_*` и ходит в базу по внутренней сети.

`APP_BIND` оставьте `127.0.0.1` — приложение слушает только локально, наружу его отдаёт
reverse proxy. Порт Postgres тоже привязан к `127.0.0.1` и наружу не доступен.

## Шаг 3. Запуск

```bash
docker compose --profile prod up -d --build
```

Приложение само применяет миграции при старте, поэтому отдельного шага для базы нет.
Проверьте, что всё поднялось:

```bash
docker compose ps                      # postgres healthy, app healthy
curl -s localhost:3000/health          # {"status":"ok"}
```

## Шаг 4. Первый администратор

```bash
docker compose exec app node server/dist/db/seed.js
```

Команда создаёт пользователя из `ADMIN_EMAIL` с ролью `admin`. Повторный запуск
безопасен — существующий пользователь не дублируется.

Остальных заводите через базу:

```bash
docker compose exec postgres psql -U monitoring -d monitoring \
  -c "INSERT INTO users (email, role) VALUES ('dev@company.ru', 'viewer');"
```

Отобрать доступ, сохранив историю: `UPDATE users SET is_active = false WHERE email = '…';`

## Шаг 5. HTTPS и домен

Приложение не занимается TLS — поставьте перед ним прокси. Достаточно проксировать всё
на порт 3000, никаких особых путей выделять не нужно.

**Caddy** (сам получит сертификат Let's Encrypt), `/etc/caddy/Caddyfile`:

```caddy
monitoring.company.ru {
    reverse_proxy 127.0.0.1:3000
}
```

**nginx** (сертификат — через certbot):

```nginx
server {
    listen 443 ssl;
    server_name monitoring.company.ru;

    ssl_certificate     /etc/letsencrypt/live/monitoring.company.ru/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/monitoring.company.ru/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Заголовок `X-Forwarded-For` важен: по нему работает лимит запросов ссылок входа с одного
IP, иначе все запросы будут выглядеть как приходящие с самого прокси.

После настройки домена проверьте, что `APP_BASE_URL` в `.env` совпадает с адресом, по
которому люди открывают сайт, и перезапустите приложение: расхождение сломает и ссылку в
письме, и проверку `Origin` при сохранении форм.

```bash
docker compose --profile prod up -d
```

## Обновление версии

```bash
cd /opt/monitoring
git pull
docker compose --profile prod up -d --build
```

Новые миграции применяются при старте контейнера. Простой — несколько секунд на
перезапуск; результаты проверок за это время просто не собираются, история не теряется.

Откат: `git checkout <прошлый коммит> && docker compose --profile prod up -d --build`.
Миграции назад не откатываются, поэтому откат безопасен только на версию, в которой не
было изменений схемы, — иначе восстанавливайте базу из резервной копии.

## Резервные копии

Данные живут в volume `monitoring_postgres-data`. Ежедневный дамп:

```bash
# /etc/cron.daily/monitoring-backup
#!/bin/sh
cd /opt/monitoring
docker compose exec -T postgres pg_dump -U monitoring monitoring \
  | gzip > /var/backups/monitoring-$(date +%F).sql.gz
find /var/backups -name 'monitoring-*.sql.gz' -mtime +14 -delete
```

Восстановление:

```bash
docker compose --profile prod stop app
gunzip -c /var/backups/monitoring-2026-08-29.sql.gz \
  | docker compose exec -T postgres psql -U monitoring -d monitoring
docker compose --profile prod start app
```

## Наблюдение

```bash
docker compose logs -f app          # лог приложения (JSON, pino)
docker compose ps                   # состояние и healthcheck
```

`GET /health` отвечает без авторизации и проверяет соединение с базой — на него удобно
повесить внешний пинг. Мониторинг не может уследить за собственным падением, поэтому
заведите одну внешнюю проверку этого адреса: из другого сервиса, из uptime-робота или
хотя бы из cron на другой машине.

Место на диске контролируется само: сырые результаты старше `RAW_RETENTION_DAYS` дней
удаляются раз в час, часовые агрегаты остаются.

## Если что-то не работает

| Симптом | Что смотреть |
|---|---|
| Письмо не приходит | `docker compose logs app \| grep -i smtp`. Если `SMTP_HOST` пуст, ссылка печатается в лог с предупреждением — ей можно войти вручную |
| Ссылка ведёт на localhost | `APP_BASE_URL` не совпадает с публичным адресом; поправьте `.env` и перезапустите |
| Форма не сохраняется, 403 | Тот же `APP_BASE_URL`: браузер шлёт `Origin`, отличный от настроенного |
| Проверки не выполняются | `SCHEDULER_ENABLED` должен быть `true`; в логе при старте есть строка «Планировщик запущен» |
| Слишком много одновременных запросов к вашим сервисам | Уменьшите `MAX_CONCURRENT_CHECKS` или увеличьте интервалы проверок |
| Все запросы входа с одного IP | Прокси не передаёт `X-Forwarded-For` |

## Запуск в Kubernetes

Проект намеренно собран под Docker Compose, но переезжает в кластер без изменений в коде:
нужен образ из `Dockerfile`, Postgres и те же переменные окружения — через ConfigMap, а
пароли и SMTP через Secret. Отдельная джоба для миграций не нужна, приложение применяет их
при старте.

Единственная особенность: планировщик живёт внутри того же процесса, что и API. Несколько
реплик безопасны — очередь проверок разбирается через `FOR UPDATE SKIP LOCKED`, и каждую
проверку заберёт ровно один под. Но часовые агрегаты каждая реплика считает независимо, раз
в пять минут. Операция идемпотентная, так что это лишь лишняя работа, — и всё же до сотен
проверок держите одну реплику.
