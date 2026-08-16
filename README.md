# DEPA OS

Внутренняя операционная система DEPA Stroy. Приложение работает на Next.js,
использует серверную локальную авторизацию и Neon Postgres для пользователей,
сессий, ограничений входа и аудита.

## Требования

- Node.js `>=22.13.0`
- npm
- `DATABASE_URL` для Neon Postgres

## Локальный запуск

```bash
npm ci
npm run db:migrate:vercel
npm run dev
```

Необходимые имена переменных перечислены в `.env.example`. Реальные значения
хранятся только в локальном `.env.local` или Vercel Environment Variables.

## Проверки

```bash
npm run typecheck
npm run lint
npm test
```

`npm test` включает production-сборку Next.js.

## База данных

Команда `npm run db:migrate:vercel` переносит существующую схему DEPA OS в
Postgres и создаёт защитные триггеры для двух базовых Owner и неизменяемого
журнала аудита. Миграции идемпотентны и учитываются в таблице
`depa_migrations`.

## Production

Production размещён на Vercel и связан с веткой `main` private-репозитория
GitHub. Push в `main` запускает автоматический production deployment.

Секреты, `.env*`, `.vercel`, зависимости и build-артефакты исключены из Git.
