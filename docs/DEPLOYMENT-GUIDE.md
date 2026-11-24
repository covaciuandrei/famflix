# Deploy FamFlix

FamFlix runs as a hybrid Next.js app on Azure Static Web Apps. Supabase provides
Postgres and Google sign-in, and TMDB supplies movie and series metadata. Do not
deploy it as a static export: sign-in and the app's server actions need a server.

## 1. Set up Supabase and TMDB

- For a new Supabase project, run [`db_init.sql`](../supabase/db_init.sql) once in
  the SQL Editor. Do not run it on a database with existing FamFlix data.
- [Enable Google sign-in and disable email sign-up](../README.md#3-enable-authentication).
  In Google Cloud, authorize `https://<project-ref>.supabase.co/auth/v1/callback`.
- Get a TMDB **API Read Access Token**. For local setup and a smoke test before
  deploying, follow [Getting started](../README.md#getting-started).

## 2. Create the Azure Static Web App

Use the Azure CLI with Bicep installed. Sign in, select your intended Azure
subscription, and choose a unique name and a supported region. The
[`infra/main.bicep`](../infra/main.bicep) template creates a resource group and a
Free Static Web App. Replace the example values before running these commands.

```bash
ENVIRONMENT=famflix-example
LOCATION=westeurope

az deployment sub what-if \
  --name "$ENVIRONMENT" \
  --location "$LOCATION" \
  --template-file infra/main.bicep \
  --parameters environmentName="$ENVIRONMENT" location="$LOCATION"
```

Check that the preview targets the intended resources. Then create them:

```bash
az deployment sub create \
  --name "$ENVIRONMENT" \
  --location "$LOCATION" \
  --template-file infra/main.bicep \
  --parameters environmentName="$ENVIRONMENT" location="$LOCATION"
```

The resource group is named `rg-<environment>` and the app is named
`swa-<environment>`. The deployment outputs the Azure hostname. You can also
create a Free Static Web App in the Azure portal. Don't generate a second
GitHub workflow; use the one included in this repository.

## 3. Configure GitHub and Azure

In GitHub, add repository secrets under **Settings > Secrets and variables >
Actions**. In the Azure Static Web App, add the runtime values under
**Environment variables**.

| Name | GitHub Actions secret | Azure runtime variable |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Yes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Yes |
| `TMDB_ACCESS_TOKEN` | Yes | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | No | Yes |
| `AZURE_STATIC_WEB_APPS_API_TOKEN` | Yes | No |

Get the deployment token from the Static Web App in Azure. The
[workflow](../.github/workflows/azure-static-web-apps.yml) runs on pushes to
`main` and deploys automatically when the checks pass. Its browser tests use
a throwaway local Supabase, not the hosted database. Pull requests do not run
this workflow. If you add previews later, use a separate workflow with its own
Azure app and Supabase project, without production credentials.

Never commit real credentials. The Supabase service-role key stays server-side
and must never have a `NEXT_PUBLIC_` prefix. If you change either
`NEXT_PUBLIC_` setting, also update the build secrets and redeploy: changing
only the runtime value doesn't update the browser bundle.

## 4. Set the public URL and smoke-test

1. If using a custom domain, add it under **Custom domains** in Azure and follow
   the DNS validation instructions for your own app. Wait for the binding and
   managed HTTPS to be ready.
2. In Supabase **Authentication > URL Configuration**, set the Site URL to
   your production origin. Allow the same address with `/auth/callback`
   appended. Add your local callback URL if needed for development.
3. Check that the latest deployment succeeded in GitHub Actions. Open your
   site over HTTPS, sign in with Google, add a title, and start a movie night
   to check that sign-in and server-side database operations work.

## Database changes after deployment

GitHub Actions deploys the app, not SQL. Back up existing databases and apply
any required schema change separately before deploying code that needs it.
Keep [`db_init.sql`](../supabase/db_init.sql) current so that a new installation
gets the complete schema, permissions, and row-level security in one step.
