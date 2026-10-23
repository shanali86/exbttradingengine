# Exbeast Token Dashboard

Frontend for projects that listed their token on Exbeast. A token owner and
their team sign in here, separately from the exchange. They can:

- follow their token's trading;
- edit its public profile;
- ask the exchange for market changes;
- manage their team.

- Angular 22 (standalone components, signals, zoneless, lazy-loaded pages), no UI library
- Backend: Laravel API `/api/token-owner/*` in `Exbotix_BackEnd_laravel_Rebuild`. The API is
  described in `docs/guides/token-owner-dashboard.md` there.

## Run locally

Requirements: Node 20.19+ / 22+ / 24, and the Laravel backend running on `http://localhost:8000`
(`php artisan serve`).

```bash
npm install
npm start          # http://localhost:4200
```

`ng serve` sends `/api/*` to `http://localhost:8000` (see `proxy.conf.json`), so there are no CORS problems
in development. To use another backend, change the `target` there.

The backend must have run its migrations and created the dashboard's Passport client once:

```bash
php artisan migrate
php artisan passport:client --personal --provider=token_owners --name="Token owner dashboard"
```

The first account comes from an admin. In the admin panel, use `POST /api/admin/exchange/tokens/{id}/team {email}`.
The invite email links to `<dashboard>/accept-invite?token=…`.

## Configuration

| File | Used by | Setting |
|---|---|---|
| `src/environments/environment.development.ts` | `ng serve` | `apiUrl: '/api/token-owner'` (proxied) |
| `src/environments/environment.ts` | `ng build` (production) | `apiUrl`: full URL of the backend, e.g. `https://newapi.thinkoworkspace.com/api/token-owner` |

On the backend, set `TOKEN_OWNER_DASHBOARD_URL` to the URL this app is served from. The invite and
password-reset emails link to `<that URL>/accept-invite` and `<that URL>/reset-password`.

## Build & deploy

```bash
npm run build
```

Upload the contents of `dist/Exbeast_Token_Dashboard/browser/` to the web root. It is a static site.

- **Apache / Hostinger:** `.htaccess` is included. It sends every route to `index.html`.
- **nginx:** `location / { try_files $uri $uri/ /index.html; }`
- **In a sub-folder** (e.g. `https://exbeast.com/token-owner/`): build with
  `npx ng build --base-href /token-owner/`.

## Pages

| Route | Who |
|---|---|
| `/login`, `/forgot-password`, `/reset-password`, `/accept-invite` | Public |
| `/tokens` | Tokens the account manages (opens the only one directly) |
| `/tokens/:id/overview` | KPIs, daily chart, markets (auto-refresh every 60 s) |
| `/tokens/:id/trades` | Latest trades, filtered by market |
| `/tokens/:id/profile` | Project profile (owner and manager edit; analyst reads) |
| `/tokens/:id/requests` | Change requests for market rules, status and deposits/withdrawals, approved by the exchange |
| `/tokens/:id/team` | Members, invites and roles (only the owner manages) |
| `/tokens/:id/activity` | Activity log (owner and manager) |
| `/account` | Change password, Google Authenticator |

Tabs and actions follow the role's permissions from the backend (`/auth/me`). The backend
checks them again on every call.

## Code layout

```
src/app/
  core/      api.service (unwraps {status,message,data}), auth.service (session + roles),
             auth.interceptor (bearer, 401 -> login), guards, toast.service, models
  shared/    format pipes, SVG bar chart, password rules
  pages/     auth/, shell/, tokens/, account/
src/styles.scss   global theme (dark, accent #C6F432)
```

## Tests

```bash
npm test -- --watch=false
```
