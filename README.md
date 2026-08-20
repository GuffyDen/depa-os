# DEPA OS

Внутренняя операционная система DEPA Stroy.

## Backend architecture

- Vercel запускает Next.js App Router и production deployment из ветки `main`.
- Neon — единственная PostgreSQL-база. В ней находятся пользователи, локальные Auth identities, сессии, бизнес-данные, финансы, audit log и только metadata файлов.
- DEPA Local Auth использует PBKDF2-SHA256, HttpOnly cookie `depa_session` и хеши сессий в `auth_sessions`.
- Private Vercel Blob store `depa-os-files` хранит бинарные файлы. `BLOB_READ_WRITE_TOKEN` доступен только серверу.
- `attachments` хранит provider/path, внутренний Blob URL, исходное имя, MIME, размер, SHA-256, автора, категорию, видимость, статус и связи с сущностями. Base64 в PostgreSQL не хранится.

Файл загружается браузером напрямую в private Blob по короткоживущему разрешению от `/api/files/upload`. Endpoint проверяет DEPA session, категорию, объект, MIME, размер и сгенерированный системой pathname. После фактической проверки Blob metadata финансовая операция атомарно связывает attachment. Чтение выполняется только через `/api/files/:attachmentId`, где повторно проверяются DEPA session и доступ к операции/объекту.

## Requirements

- Node.js `>=22.13.0`
- npm
- `DATABASE_URL` для Neon Postgres
- `BLOB_READ_WRITE_TOKEN` для private Vercel Blob

Имена переменных перечислены в `.env.example`. Секреты находятся только в `.env.local` или Vercel Environment Variables и не коммитятся.

## Local setup

```bash
npm ci
npm run db:migrate:local
npm run dev
```

`vercel env pull .env.local --environment=development --yes` синхронизирует development credentials. Команда перезаписывает `.env.local`.

## PostgreSQL-first migrations

`db/schema.ts` использует `drizzle-orm/pg-core`, а `drizzle.config.ts` — dialect `postgresql`. Новая схема изменений:

1. изменить PostgreSQL-native schema;
2. выполнить `npm run db:generate`;
3. проверить сгенерированный SQL;
4. применить `npm run db:migrate:local` или `DATABASE_URL=... npm run db:migrate`;
5. проверить запись в `depa_migrations` и production data.

Миграции 0000–0003 сохранены как исторический SQLite-era baseline и уже применены в production. Они не конвертируются и не запускаются повторно. Активный pipeline читает только PostgreSQL SQL из `drizzle/postgres`; первая стабилизационная миграция — `0004_postgres_integrity_and_blob.sql`. Старый SQLite→PostgreSQL converter удалён.

Все бизнес-FK используют `ON DELETE RESTRICT`, чтобы финансовая и операционная история не исчезала. Изменение технического идентификатора родительской записи поддерживает `ON UPDATE CASCADE`. Удаление бизнес-сущностей предполагает inactive/archived/soft-delete.

## File policy

- RECEIPT: до 10 МБ.
- PROJECT_PHOTO, DAILY_REPORT, HIDDEN_WORK, INSPECTION, WARRANTY: до 20 МБ; целевой длинный край будущей photo-processing abstraction — 2400 px.
- CONTRACT, ACT, ESTIMATE, OTHER: до 25 МБ.
- Разрешены `image/jpeg`, `image/png`, `image/webp`, `image/heic`, `image/heif`, `application/pdf`.
- Executable и произвольные MIME отклоняются.
- Неиспользованные upload получают статус и удаляются компенсационно; связанные бизнес-файлы нельзя удалить через обычный flow.

## Checks

```bash
npm run typecheck
npm run lint
npm test
```

`npm test` включает production-сборку Next.js.

## Finance model

- У пользователя не более одной персональной кассы. Базовые кассы — «Касса Дениса» и «Касса Павла».
- `TRANSFER` хранится одной транзакцией с кассой-источником и кассой-получателем. Отрицательный остаток разрешён и означает долг DEPA владельцу кассы.
- Сотрудник получает финансовый доступ и собственную кассу по двум отдельным разрешениям Owner. Деактивация сохраняет историю.
- Баланс объекта рассчитывается по журналу операций; физический остаток касс не является прибылью.

## Production

Production размещён на Vercel, связан с private GitHub repository и веткой `main`. После безопасного применения database migration push в `main` запускает production deployment.
