# ElimuOs API

Multi-tenant school management backend (Node/Express + PostgreSQL, row-level-security tenant isolation).

## Setup

```bash
npm install
cp .env.example .env      # then fill in real values
```

Apply the schema and the migrations from this review, in order, against
your database (the base schema — `ELIMU.sql` — should already be
applied; `007` and `008` are new):

```bash
psql "$DATABASE_URL" -f migrations/007_tenant_isolation_hardening.sql
psql "$DATABASE_URL" -f migrations/008_timetable_generation.sql
psql "$DATABASE_URL" -f migrations/009_school_messaging_configs.sql
```

Then verify the app's DB role can't bypass RLS (this must print `f` for
both columns, or every tenant-isolation fix in this codebase is inert):

```sql
SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'app_user';
```

Create your first (and only, unless you want more) platform operator
account — this is CLI-only, deliberately not an HTTP route:

```bash
npm run create-super-admin -- --name "Your Name" --email you@example.com --password "Str0ngPass!1"
```

Run it:

```bash
npm run dev     # nodemon, restarts on file change
npm start       # plain node, for production
```

`GET /health` → `{"status":"ok"}` confirms the server is up (this doesn't
touch the database — hit any real `/api/v1/...` route to confirm DB
connectivity too).

## Layout

```
app.js              Express app (middleware, routes, error handling) — no .listen()
server.js           Starts the HTTP server, owns graceful shutdown of the DB pool
src/
  config/db.js       Pool + withTenantClient (the RLS tenant-scoping mechanism)
  routes/            One file per resource, mounted under /api/v1 in main.routes.js
  controllers/       Request handling, validation, calls into models/
  models/            All SQL lives here
  middleware/        auth, error, rate limiting, subscription-gating (opt-in)
  utils/             JWT, password hashing, PDF rendering, M-Pesa client, etc.
  scripts/           One-off CLI scripts (currently: createSuperAdmin.js)
migrations/          Schema changes since the base ELIMU.sql dump
public/              Static frontend — served directly by app.js before the API routes
```

## Notes carried over from the backend review

- Every tenant-owned table is isolated via Postgres RLS, keyed off
  `app.current_school_id` (set per-request inside `withTenantClient`) —
  never trust a `schoolId` from a request body/query param for anything;
  it always comes from `req.user.school_id` on the verified JWT.
- `daraja.client.js` and `notification.provider.js` are written to their
  documented APIs but have not been exercised against live endpoints
  (this sandbox has no network access to Safaricom/SMTP/Africa's
  Talking) — test both against real sandbox credentials before relying
  on them.
- The timetable generator (`utils/timetableGenerator.util.js`) is a
  greedy placement algorithm, not a full solver — see the comment at the
  top of that file for what it guarantees and what it reports as
  `unplaced` instead of forcing.