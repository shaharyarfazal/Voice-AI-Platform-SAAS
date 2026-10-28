# Multi-brand platform: one core, a repo per niche

Each niche (HVAC, Limo, …) is its own brand with its own website, SEO, pricing and industry
features. All of them share one voice platform. The goal is that a fix to calling or billing ships to
every brand, and HVAC code never ends up in the Limo product.

## What's shared and what isn't

| Core (this repo, `voice-core`) | Niche repo (`voice-hvac`, `voice-limo`, …) |
|---|---|
| Voice server: LiveKit, SIP, agent worker, scheduler, infra | Marketing site: home, pricing, industry pages, blog, city/service landing pages (SEO) |
| Dashboard and API: agents, numbers, calls, knowledge, widgets, team, white label | Brand: name, logo, colours, domain, copy |
| Credits, Stripe Checkout, ledger | Plans and credit packs (`registerCatalog`) |
| Auth, workspaces, agencies, sub-accounts | Industry agent templates and onboarding questions |
| Admin panel | Industry features and integrations (e.g. ServiceTitan or Housecall Pro for HVAC; flight tracking and vehicle quotes for Limo) |

**Today:** every workspace has a `brand` column, set from the deployment's `BRAND_ID` when it signs up.
The billing catalog is chosen per brand. All brands share one database and one voice server.

## Steps

### 1. Core packages (next)

Split `web/` into an npm workspace inside this repo:

```
packages/core     @voice/core   lib/: db, auth, billing, agents, knowledge, webhooks, migrations
packages/ui       @voice/ui     components/, icons, the app shell, design tokens (globals.css)
packages/app      @voice/app    the dashboard routes as importable page modules
apps/platform                   today's web app, rebuilt from the packages (keeps working as-is)
```

Publish the packages to **GitHub Packages** (private) from CI on each tagged release. A niche repo
then depends on `"@voice/core": "^1.4.0"` and receives core fixes by bumping that version, with no git merges.

### 2. Niche repo template

```
voice-hvac/
  app/(marketing)/        public SEO site: /, /pricing, /services/[service], /areas/[city], /blog/[slug]
  app/(app)/[...]/page.tsx  re-exports dashboard pages: export { default } from "@voice/app/agents/page"
  app/(app)/hvac/...      HVAC-only pages (maintenance plans, service areas, dispatch board)
  brand.ts                registerCatalog("hvac", …), templates, theme, nav additions
  next.config.ts          transpilePackages: ["@voice/core", "@voice/ui", "@voice/app"]
```

Each niche is its own Vercel project with `BRAND_ID=hvac`, its own domain, and its own Stripe products
(or its own Stripe account, by giving that project a different `STRIPE_SECRET_KEY`).

### 3. SEO per niche

The marketing site is rendered on the server and static where possible. It gets per-page metadata,
`sitemap.xml`, `robots.txt`, JSON-LD (`SoftwareApplication`, `FAQPage`, `Product`/`Offer` for pricing),
and generated landing pages per service × city from a reviewed list, not thin doorway pages. The
dashboard is already `noindex`.

### 4. Scaling out

- **Voice:** add LiveKit and SIP nodes per region behind the same Redis, and run agent workers as
  an autoscaled pool. Add a `voice_cluster` column to workspaces so a brand or a big client can be
  pinned to its own cluster.
- **Data:** a brand that outgrows the shared database gets its own `DATABASE_URL`. Workspaces never
  reference across brands, apart from the platform admin's cross-brand view, which then queries each
  brand's database.
- **White label and reselling:** agencies, sub-accounts, branding and custom domains already exist.
  On Vercel, connecting an agency's custom domain becomes one call to Vercel's domains API from the
  White label page. That replaces the manual Caddy/nginx step.

## Brand modules in the app (today)

Until the package split, a niche's app features live in this repo under `web/brands/<brand>/`, and
only the deployment whose `BRAND_ID` matches uses them:

- `web/brands/<brand>/index.ts`: the `BrandModule` (see `web/brands/types.ts`): agent templates,
  setup-wizard industries, billing catalog, extra sidebar links. Register it in `web/brands/index.ts`.
- `web/app/(app)/<brand>/`: brand-only pages. The folder's layout calls `requireBrand("<brand>")`,
  so every other deployment answers 404.
- Admin > Templates edits the templates of the deployment's own brand (stored per brand).

HVAC is the first: `web/brands/hvac` and `web/app/(app)/hvac`. Its marketing website is a separate
repo (`voice-hvac`) and deploys as its own Vercel project.
