---
name: testing-ecom-prod
description: How to verify the deployed Inventory/E-commerce app at ecom.intubemedia.com (Next.js behind Nginx) — confirm TLS and the real login page, avoid 404-vs-fallback false positives, log in, and diagnose "works on mobile but not on laptop" reports.
---

# Testing ecom.intubemedia.com in production

The app is the `E-commerce-System-` monorepo: `apps/web` (Next.js App Router) + `apps/api` (Node API).
In production both are served from **one origin** behind Nginx on `162.35.107.192`, run by **PM2** (not docker):
`ecom-web` (`/var/www/ecom/apps/web`, port 3400) and `ecom-api` (`/var/www/ecom/apps/api`, port 4400); vhost
`/etc/nginx/sites-available/ecom.intubemedia.com`; uploads in `/var/www/ecom-uploads`. `/var/www/ecom` is not a git
checkout: deploy = `git archive origin/main`, build in a staging dir, `prisma migrate deploy`, swap dirs, `pm2 restart`.

## First check: DNS points at the right box

```bash
dig +short ecom.intubemedia.com   # must be 162.35.107.192
```

If it resolves elsewhere (it once pointed at `162.35.117.25`, which had nothing on 80/443, so every request got
"connection refused" and `curl` printed `000`), the app itself is fine: test it with
`curl --resolve ecom.intubemedia.com:443:162.35.107.192 ...` to prove that, then fix the `ecom` A record
(DNS for intubemedia.com is at Hostinger).

## Topology facts worth knowing before testing

- `ecom.intubemedia.com` has its **own** Let's Encrypt cert (`/etc/letsencrypt/live/ecom.intubemedia.com`). It used
  to share the reels cert; if the vhost points at another site's cert, browsers show a name-mismatch error.
- The API is proxied **same-origin** at `/api/*`. A quick liveness probe:
  `curl -s https://ecom.intubemedia.com/api/health` should return app JSON
  (`{"success":false,"error":{"code":"UNAUTHORIZED",...}}` when unauthenticated). If you instead get
  Next.js **HTML**, the Nginx `/api` proxy is broken/missing — that is the failure mode to look for.
- Port 80 issues a **301** to `https://ecom.intubemedia.com/login`. Permanent redirects are cached
  indefinitely by browsers, which matters for stale-client reports (below).
- There is normally **no** `Strict-Transport-Security` header. So a stale-HSTS pin is usually *not* the cause
  of client-side TLS failures here.
- DNS has an **A record only** (no AAAA), so an IPv4/IPv6 split is not a valid explanation for
  "works on one device, not another".

## The 404-vs-real-page trap (most important)

Unlike a static SPA host, this deployment returns a **genuine 404** for unknown paths, so a `200` on a real
route is meaningful. Always prove the difference rather than trusting a status code alone:

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://ecom.intubemedia.com/login              # expect 200
curl -s -o /dev/null -w "%{http_code}\n" https://ecom.intubemedia.com/zzz-does-not-exist # expect 404
```

Next.js ships a real `not-found` chunk (`/_next/static/chunks/app/not-found-*.js`), so a 404 is a fully
renderable page. **Judge success on pixels**: a passing login page visibly shows the heading
`Inventory Management`, the subtitle "Sign in to manage stock, purchasing, kitchen and e-commerce
operations.", `Email` + `Password` inputs, a `Sign in` button and a "Forgot your password?" link
(`apps/web/src/app/login/page.tsx:38-76`).

## Check the baked-in API base before blaming the browser

`apps/web/src/lib/api.ts` ends with `process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'`. Because
`NEXT_PUBLIC_*` is inlined at **build** time, a build made without that env var ships `localhost:4000` and
every login fails on the visitor's own machine. This exact class of bug has bitten the sibling
`intubemedia.com` project. Verify before UI testing:

```bash
curl -s https://ecom.intubemedia.com/login | grep -oE '/_next/static/chunks/[a-zA-Z0-9._/-]+\.js' | sort -u
# download the login/page-*.js and shared chunks, then:
grep -l "localhost:4000" chunk_*.js   # must find NOTHING
```

## Logging in

The blueprint's demo password is local-development-only and must never be tried against production.
Use the current production credential provided through the organization's secret/credential process.

Login posts `POST /api/auth/login` (`apps/web/src/components/AuthProvider.tsx:49`); success does
`router.replace('/dashboard')`, failure renders an inline `ErrorState`. A successful admin dashboard shows
tiles such as "Active products", "Warehouses", "Inventory value".

**Security check to always perform:** if a seeded demo credential works against *production*, escalate it
as a finding and rotate all seeded accounts immediately. Sign out afterwards via the "Sign out" button in
the header so no production session is left open, and stay read-only unless mutation was explicitly requested.

## Diagnosing "site opens on mobile but not on my laptop"

You cannot reproduce a user's device state from the box. Confirm the server is healthy, then hand the user
targeted remediation instead of guessing:

1. Prove the current live state: load `/login` in maximized desktop Chrome, click the padlock (expect
   "Connection is secure"), and check DevTools → Network → **Doc** filter for the top-level request = `200`.
2. Press `ctrl+shift+r` to bypass cache and re-verify `200`. This is the decisive test, because a stale cached
   404 or a cached permanent redirect is the most likely laptop-only cause once the server checks out.
3. Console will normally show a single harmless `favicon.ico` 404. Treat 404s on `/_next/static/*` as a real
   problem (half-deployed build); the favicon one is cosmetic.
4. Remediation to relay to the user: hard refresh, try an Incognito window, clear cached redirects, and flush
   DNS via `chrome://net-internals/#dns`. Ask whether the laptop is on a different DNS/VPN than the phone.
5. Note timing: if a cert/Nginx change was just made, a client that cached the pre-fix response can keep
   failing for a long time even though the server is fixed. Always ask when their screenshot was taken.

## Devin Secrets Needed

None for read-only production verification. Authenticated checks require the current production admin
credential from the organization's secret/credential process; never use the blueprint's local demo password.
