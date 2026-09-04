# Деплой

Пошаговое развёртывание на чистом сервере. Всё разворачивается в Docker: контейнер
приложения (API + планировщик + фронт) и Postgres рядом. Наружу смотрит только reverse
proxy. Порядок команд рассчитан на один проход сверху вниз.

## Перед началом

- Сервер с Docker 24+ и Docker Compose v2 — проверьте: `docker compose version`.
- Домен с A-записью на IP сервера (например `monitoring.company.ru`) и свободные порты
  80 и 443 — на них Caddy получает сертификат и принимает трафик.
- SMTP-аккаунт: с него уходят письма со ссылками для входа.
- 1 CPU и 1 ГБ памяти хватает на сотни проверок. Место на диске считайте как ≈150 байт на
  результат: 100 проверок раз в минуту за 30 дней ≈ 700 МБ.

## 1. Забрать код

```bash
git clone https://github.com/freehero-pro/monitoring.git /opt/monitoring
cd /opt/monitoring
```

## 2. Заполнить .env

```bash
cp .env.example .env
sed -i "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$(openssl rand -hex 24)/" .env
```

Дальше откройте `.env` и заполните четыре вещи:

```ini
APP_BASE_URL=https://monitoring.company.ru   # адрес, по которому люди открывают сайт
ADMIN_EMAIL=you@company.ru                   # ваш адрес: из него создастся администратор
SMTP_HOST=smtp.company.ru                    # почта для писем со ссылками входа
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=monitoring@company.ru
SMTP_PASSWORD=...
MAIL_FROM=monitoring@company.ru
```

`APP_BASE_URL` — самая важная строка во всём файле. Из неё строится ссылка в письме, по ней
же проверяется заголовок `Origin` при сохранении форм, а схема `https` включает флаг
`Secure` у cookie сессии. Ошибка здесь проявится не сразу, а на первом входе.

Остальное трогать не нужно. В частности, `DATABASE_URL` править не надо: контейнер собирает
строку подключения сам из `POSTGRES_*`, а эта переменная используется только при запуске вне
Docker. `APP_BIND=127.0.0.1` оставьте как есть — наружу приложение отдаёт reverse proxy.

## 3. Запустить

```bash
docker compose --profile prod up -d --build
```

Эта команда поднимает всё: Postgres, приложение и Caddy, который сам получит сертификат
для домена из `APP_BASE_URL`. Первая сборка занимает пару минут. Миграции применяются при
старте приложения, отдельного шага для базы нет. Проверьте, что всё поднялось:

```bash
docker compose ps               # postgres и app в состоянии healthy, caddy запущен
curl -s localhost:3000/health   # {"status":"ok"}
```

Если `app` перезапускается, смотрите причину: `docker compose logs app | tail -30`.

## 4. Создать администратора

```bash
docker compose exec app node server/dist/db/seed.js
```

Команда заводит пользователя из `ADMIN_EMAIL` с ролью `admin`. Повторный запуск безопасен —
существующий пользователь не дублируется.

Регистрации в приложении нет: все последующие пользователи добавляются в базу вручную.

```bash
docker compose exec postgres psql -U monitoring -d monitoring \
  -c "INSERT INTO users (email, role) VALUES ('dev@company.ru', 'viewer');"
```

Роль `viewer` только смотрит статистику, `admin` ещё и правит проверки и каналы. Отобрать
доступ, сохранив историю: `UPDATE users SET is_active = false WHERE email = '…';`

## 5. Включить HTTPS

Отдельно настраивать ничего не нужно: в стек уже входит Caddy, который получает
сертификат Let's Encrypt и продлевает его сам. Нужно лишь три вещи.

1. A-запись домена указывает на IP сервера — Let's Encrypt проверяет владение доменом,
   постучавшись на него снаружи.
2. Порты 80 и 443 открыты в файрволе и не заняты другим веб-сервером на этом сервере.
3. В `.env` указан `APP_BASE_URL` со схемой `https` — из него же Caddy берёт имя сайта,
   поэтому адрес задан ровно в одном месте и разойтись не может:

```ini
APP_BASE_URL=https://monitoring.company.ru
```

Если приложение уже запущено по шагу 3, перечитайте конфигурацию:

```bash
docker compose --profile prod up -d
```

Сертификат выпускается за несколько секунд при первом обращении к домену. Убедиться:

```bash
curl -sI https://monitoring.company.ru/health | head -1   # HTTP/2 200
docker compose logs caddy | grep -i certificate           # получение сертификата
```

Приложение при этом остаётся на `127.0.0.1:3000` и снаружи недоступно — весь трафик идёт
через Caddy. Он же проставляет `X-Forwarded-For` и `X-Forwarded-Proto`, по которым работают
лимит запросов ссылок входа и признак защищённого соединения.

### Если на сервере уже есть свой прокси

Caddy из стека не запускайте — он не сможет занять порты 80 и 443. Поднимайте только базу
и приложение:

```bash
docker compose --profile prod up -d postgres app
```

Дальше выпуск сертификата берёт на себя certbot. Для nginx сначала добавьте обычный
server-блок на 80 порту с проксированием, а TLS certbot допишет сам:

```bash
sudo tee /etc/nginx/sites-available/monitoring.company.ru >/dev/null <<'CONF'
server {
    listen 80;
    server_name monitoring.company.ru;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
CONF

sudo ln -sf /etc/nginx/sites-available/monitoring.company.ru /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d monitoring.company.ru --redirect
```

`certbot --nginx` допишет в этот же блок `listen 443 ssl`, пути к сертификату и редирект
с http, а продление повесит на системный таймер. Порядок важен: без работающего блока на
80 порту certbot не сможет подтвердить владение доменом.

`X-Forwarded-For` обязателен: без него все запросы выглядят приходящими с самого прокси, и
лимит на выдачу ссылок входа сработает сразу на всех.

## 6. Войти и завести первую проверку

Откройте `https://monitoring.company.ru`, введите адрес из `ADMIN_EMAIL` и перейдите по
ссылке из письма — она действует 15 минут и срабатывает один раз. Дальше «Добавить
проверку»: URL, интервал, при необходимости метод, заголовки и условия успешного ответа.

Если письмо не пришло, ссылку можно взять из лога — при незаполненном SMTP она пишется туда
с предупреждением:

```bash
docker compose logs app | grep -i "ссылка для входа"
```

На этом развёртывание закончено. Ниже — то, что понадобится позже.

---

## Обновление версии

```bash
cd /opt/monitoring
git pull
docker compose --profile prod up -d --build
```

Новые миграции применяются при старте контейнера. Простой — несколько секунд на перезапуск;
результаты проверок за это время не собираются, история не теряется.

Откат: `git checkout <прошлый коммит> && docker compose --profile prod up -d --build`.
Миграции назад не откатываются, поэтому откат безопасен только на версию без изменений
схемы — иначе восстанавливайте базу из резервной копии.

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
docker compose logs -f app   # лог приложения (JSON, pino)
docker compose ps            # состояние и healthcheck
```

`GET /health` отвечает без авторизации и проверяет соединение с базой — на него удобно
повесить внешний пинг. За собственным падением мониторинг уследить не может, поэтому
заведите одну внешнюю проверку этого адреса: из другого сервиса, из uptime-робота или хотя
бы из cron на другой машине.

Место на диске контролируется само: сырые результаты старше `RAW_RETENTION_DAYS` дней
удаляются раз в час, часовые агрегаты остаются.

## Если что-то не работает

| Симптом | Что смотреть |
|---|---|
| Письмо не приходит | `docker compose logs app \| grep -i smtp`. При пустом `SMTP_HOST` ссылка печатается в лог — по ней можно войти вручную |
| Ссылка из письма ведёт на localhost | `APP_BASE_URL` не совпадает с публичным адресом; поправьте `.env` и перезапустите |
| Форма не сохраняется, 403 | Тот же `APP_BASE_URL`: браузер шлёт `Origin`, отличный от настроенного |
| Проверки не выполняются | `SCHEDULER_ENABLED` должен быть `true`; в логе при старте есть строка «Планировщик запущен» |
| Слишком много одновременных запросов к вашим сервисам | Уменьшите `MAX_CONCURRENT_CHECKS` или увеличьте интервалы проверок |
| Все запросы входа считаются с одного IP | Прокси не передаёт `X-Forwarded-For` |
| Сертификат не выпускается | `docker compose logs caddy`. Обычно: A-запись не указывает на сервер, порт 80 закрыт файрволом или занят другим веб-сервером |
| Сайт открывается только по http | В `APP_BASE_URL` схема `http` — Caddy поднимает сайт ровно по этому адресу. Поправьте на `https` и выполните `docker compose --profile prod up -d` |

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
