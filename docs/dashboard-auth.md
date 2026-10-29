# Dashboard accounts and sessions

Dashboard accounts are separate from mobile/app `User` accounts. All dashboard API paths have the `/api/v1` prefix. The shared `INTERNAL_OPS_KEY` / `x-ops-key` mechanism is removed; app JWTs cannot access staff routes.

## Enable the feature

1. Deploy the backend and dashboard together. Apply the new Prisma migration against the intended environment with `npx prisma migrate deploy`, and generate the client with `npx prisma generate` before building the backend. The migration adds `DashboardUser`, `DashboardSession`, their enums, indexes and foreign keys; existing app users are unaffected.
2. In a trusted terminal, set `DASHBOARD_BOOTSTRAP_USERNAME`, `DASHBOARD_BOOTSTRAP_FULL_NAME` and `DASHBOARD_BOOTSTRAP_PASSWORD`, then run `npm run dashboard:bootstrap` from the backend. The script loads `.env.local` / `.env` for database configuration. Supply the password through a hidden terminal prompt or secret injection, never a committed file or command-line literal. Unset the bootstrap variables afterwards.
3. Bootstrap creates an admin only when no active dashboard admin exists. It cannot reset an existing admin's password. Sign in at `/login` and change the temporary password. Use **Dashboard users** to create additional users or admins.
4. Remove the retired ops-key secret from deployment configuration. ALAT transfer webhooks now require the existing provider signature verification; an ops key can no longer substitute for a valid signature. Configure the existing ALAT webhook verification secret before sending webhooks.

No migration, bootstrap account or live credential is created automatically by the code change. Bootstrap requires development dependencies (`ts-node` / `tsconfig-paths`) available in the trusted administrative checkout.

## Access

- `USER`: read overview, events, KYC, payouts/ALAT, payment risks, refunds, settlement queues/calculations/history, and active event carpools. Cannot submit operational decisions or manage staff.
- `ADMIN`: the same reads, plus KYC/payout/ALAT reviews, risk single/batch decisions, refund confirmation, settlement creation/outcome recording, and account management.
- Both roles can change their own password and sign out. Temporary-password sessions can only use `me`, `password` and `logout` until the password is changed.

The dashboard uses `GET /carpool/internal/event/:eventId/paginated`. It supports the existing `all` and `close_to_you` filters, not user-following ranking. Mobile/app carpool endpoints keep their existing authentication.

## API contracts

Non-paginated responses use `{status,message,data}`. `user` below includes `id`, `username`, `fullName`, `role`, `status`, `mustChangePassword`, `createdAt`, `updatedAt`, `createdById`; it never includes the password hash or login counters.

| Method and path | Body / response data |
| --- | --- |
| `POST /dashboard/auth/login` | `{username,password}` → `{token,expiresAt,user}` |
| `GET /dashboard/auth/me` | `{user,expiresAt}` |
| `POST /dashboard/auth/logout` | `{}` → `{signedOut:true}` |
| `POST /dashboard/auth/password` | `{currentPassword,password}` → `{user}` |
| `GET /dashboard/users` | `page` (1+), `pageSize` (1–50), optional `search` (100 chars). Top-level `data:user[]` and `meta:{page,pageSize,total,hasNextPage}`. Admin only. |
| `POST /dashboard/users` | `{username,fullName,role,password}` → `user`. Admin only; temporary password. |
| `PATCH /dashboard/users/:id` | Optional `{fullName,role,status}` → `user`. Admin only. Username is immutable. |
| `POST /dashboard/users/:id/password` | `{password}` → `user`. Admin only; temporary password. |

Usernames normalize to lowercase, contain 3–40 letters/numbers/`._-`, and start with a letter or number. Full names contain 2–100 characters. Passwords require at least 12 characters and at most 72 UTF-8 bytes (bcrypt's limit). Roles are `USER` / `ADMIN`; statuses are `ACTIVE` / `DISABLED`.

Authenticated requests use `Authorization: Bearer <token>`. Tokens are random 32-byte secrets represented as 64 lowercase hex characters; only their SHA-256 hashes are stored server-side. Sessions expire after 8 hours and are checked against current account status and role on every request. Passwords use bcrypt cost 12. Login has the existing IP rate guard plus a persisted 15-minute lock after five failed attempts; invalid credentials use a generic error. Password changes are rate limited too.

Disabling an account, changing its role or resetting its password revokes every session. A user password change revokes other sessions and retains the current one. Admins cannot demote/disable themselves or reset their own password through account management. A serializable transaction protects the last active admin. Duplicate usernames and conflicting edits return 409; rejected roles return 403; invalid/expired sessions return 401.

The frontend persists only the backend URL in localStorage and the session token in sessionStorage for the current tab. Passwords are never persisted. Old stored ops keys and app tokens are removed. Reloads validate `/me` before showing private data; logout clears local access even if the server cannot be reached, and reports that revocation was not confirmed. Changing servers clears credentials before connecting to the new origin. Use HTTPS in deployed environments and configure `CORS_ALLOWED_ORIGINS` for the dashboard origin as usual.
