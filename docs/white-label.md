# White label: agencies and sub-accounts

Any top-level workspace can act as an agency.

- **Sub-accounts** (Settings → Sub-accounts): a workspace per client. Agency owners and admins can
  open every client workspace from the workspace switcher; the client's own people only see theirs.
  Invite the client when you create it, or later from the client's Settings → Team.
- **Branding** (Settings → White label): product name, logo, colour, support email, and "Powered
  by" on widgets. Client workspaces show the agency's branding instead of the platform's.
- **Custom domain:** e.g. `app.youragency.com`. Sign-in pages at that domain show the agency's
  branding, and invite links and widget embed code use it.

## Serving a custom domain (platform admin)

1. The agency adds a DNS record: `CNAME app.youragency.com → app.aicall.business` (your APP_DOMAIN).
2. On the server, add the domain to the web server and get a certificate:

   **nginx (certbot):** copy the `app.` server block in `/etc/nginx/sites-available/voice-platform.conf`,
   change `server_name` to the agency's domain, then run
   `certbot --nginx -d app.youragency.com` and `nginx -s reload`.

   **Caddy:** add the domain to the `{$APP_DOMAIN}` site line in `infra/Caddyfile`
   (`{$APP_DOMAIN}, app.youragency.com {`) and run `docker compose restart caddy`.

3. The agency enters the domain under Settings → White label.

Google and Microsoft sign-in only work on the main domain (their redirect URLs are registered for
it); email sign-in works on every domain.
