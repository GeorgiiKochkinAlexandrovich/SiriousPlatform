# Sirius Global — выгрузка на хостинг

Нужен Node.js 18+. Один процесс. Данные в файле `backend/data/sirius.json`.

## Безопасность (повторный аудит)

Не найдено: backdoor, eval, child_process, скрытые ключи админа, удалённый шелл.

Закрыто:
- path traversal при раздаче файлов
- сброс админского баланса при старте
- слабый JWT в production (без JWT_SECRET сервер не стартует)
- лимит логина / регистрации / восстановления
- лимит размера JSON
- заголовки nosniff / SAMEORIGIN
- CORS из переменной CORS_ORIGIN
- флаг сброса базы только из папки `backend/`

Остаётся по вашей логике продукта:
- в админке видны пароли пользователей (`password_plain`)
- вход и сброс пароля по коду доступа
- JSON-файл вместо полноценной БД

Обязательно смените `ADMIN_PASSWORD`, `JWT_SECRET` и кошелёк депозита.

## Загрузка

1. Залейте папку `Site` на сервер (весь сайт целиком).
2. `cp backend/.env.example backend/.env` и заполните значения.
3. Запуск:

```bash
chmod +x backend/start.sh
./backend/start.sh
```

Сайт: `http://IP:PORT`  
Админка: `http://IP:PORT/admin`

## Nginx

```nginx
server {
  listen 80;
  server_name yourdomain.com;
  client_max_body_size 80m;
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
  }
}
```

## systemd

Файл `/etc/systemd/system/sirius.service`:

```
[Unit]
Description=Sirius Global
After=network.target

[Service]
WorkingDirectory=/var/www/Site/backend
EnvironmentFile=/var/www/Site/backend/.env
ExecStart=/usr/bin/node server.js
Restart=always
User=www-data

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now sirius
```

## Данные

Бэкап: `backend/data/sirius.json`

Сброс базы: пустой файл `backend/RESET_ON_FULL_UPDATE.flag` и перезапуск. Файл в `data/` базу не трогает.

Видео объектов: `images/<папка>/main-video.mp4`.
