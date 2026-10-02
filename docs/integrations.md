# Google and Microsoft sign-in and calendars

One OAuth app per provider powers both **"Continue with Google/Microsoft"** on the login page and
the **Connect calendar** buttons on the Integrations page. Until you add the keys below, those
buttons are hidden.

Your callback URLs (replace the domain if yours differs):

- Google: `https://app.aicall.business/api/oauth/google/callback`
- Microsoft: `https://app.aicall.business/api/oauth/microsoft/callback`

## Google

1. Go to [console.cloud.google.com](https://console.cloud.google.com), create a project.
2. **APIs & Services → Library**: enable **Google Calendar API**.
3. **Google Auth Platform → Branding / Audience**: user type **External**, add your app name,
   support email and the authorized domain `aicall.business`.
4. **Data access**: add the scopes `openid`, `email`, `profile`,
   `.../auth/calendar.events` and `.../auth/calendar.readonly`.
5. **Clients → Create client → Web application**. Under *Authorized redirect URIs* add the
   Google callback URL above.
6. Put the client ID and secret in `infra/.env` as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

Google treats calendar access as a *sensitive* scope. While the app is in **Testing**, only the
test users you list can connect, and tokens expire after 7 days. To let any client connect, submit
the app for **verification** (Google reviews it; plan for days to weeks). Sign-in alone (openid,
email, profile) doesn't need verification.

## Microsoft

1. Go to [portal.azure.com](https://portal.azure.com) → **Microsoft Entra ID → App registrations
   → New registration**.
2. Supported account types: **Accounts in any organizational directory and personal Microsoft
   accounts**. Redirect URI: platform **Web**, the Microsoft callback URL above.
3. **Certificates & secrets → New client secret**. Copy the *Value* right away. Secrets expire
   (up to 24 months); set a reminder to rotate it.
4. **API permissions → Add → Microsoft Graph → Delegated**: `openid`, `email`, `profile`,
   `offline_access`, `User.Read`, `Calendars.ReadWrite`.
5. Put the *Application (client) ID* and the secret value in `infra/.env` as
   `MICROSOFT_CLIENT_ID` and `MICROSOFT_CLIENT_SECRET`.

Some company tenants only allow apps an administrator approved; their admin can grant consent
once for everyone.

## Apply

```sh
cd ~/voice/infra && nano .env      # add the four keys, and ENCRYPTION_KEY if it's empty
docker compose up -d --build
```

Generate `ENCRYPTION_KEY` once with `openssl rand -hex 32` and never change it: it encrypts the
calendar tokens and integration secrets in the database.

## How booking works on a call

1. The caller asks for an appointment; the agent asks which day suits them.
2. `check_availability` reads busy times from the connected calendar and offers free slots inside
   the agent's bookable hours (Tools tab), respecting appointment length, gaps, minimum notice and
   how far ahead bookings are allowed.
3. The agent repeats the day, time and name back; after a clear yes, `book_appointment` checks the
   slot again (two callers can't take the same slot) and creates the event. If the caller gave an
   email, Google or Outlook sends them an invitation.
4. The appointment appears on the **Appointments** page and in the calendar.

Microsoft bookings go to the account's default calendar.
