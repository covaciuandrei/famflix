# FamFlix deployment: a beginner's guide

This guide explains how we took FamFlix from a project on your Mac to a live
website at **<https://famflix.andreicovaciu.dev>**. It covers the deployment work
from our session, why each part exists, how the parts work together, and how to
repeat the process manually.

Written on **8 October 2026**, using the checked-in project configuration, session
deployment records, and read-only checks of the live Azure resources. Cloud
interfaces, supported runtimes, prices, and limits change; consult the official
references at the end before recreating this setup later.

> This is a learning guide, not a script to run from top to bottom on the existing
> production app. Some commands create, change, or delete resources. Read each
> explanation first. Never paste a real password or token into this document.

## Contents

1. [The big picture](#1-the-big-picture)
2. [The services and terms](#2-the-services-and-terms)
3. [What is free and what is not](#3-what-is-free-and-what-is-not)
4. [What happened in our session](#4-what-happened-in-our-session)
5. [The actual production configuration](#5-the-actual-production-configuration)
6. [Installing and signing in to the tools](#6-installing-and-signing-in-to-the-tools)
7. [Preparing the application](#7-preparing-the-application)
8. [Putting the code on GitHub](#8-putting-the-code-on-github)
9. [Understanding the infrastructure files](#9-understanding-the-infrastructure-files)
10. [Creating the Azure infrastructure manually](#10-creating-the-azure-infrastructure-manually)
11. [Environment variables and secrets](#11-environment-variables-and-secrets)
12. [Understanding the deployment workflow](#12-understanding-the-deployment-workflow)
13. [Running and inspecting a deployment](#13-running-and-inspecting-a-deployment)
14. [Domains, nameservers, and DNS](#14-domains-nameservers-and-dns)
15. [Connecting famflix at Name.com and Azure](#15-connecting-famflix-at-namecom-and-azure)
16. [The original apex and www setup](#16-the-original-apex-and-www-setup)
17. [HTTPS and certificates](#17-https-and-certificates)
18. [Supabase authentication configuration](#18-supabase-authentication-configuration)
19. [Google login and the two callbacks](#19-google-login-and-the-two-callbacks)
20. [Database deployment is a separate job](#20-database-deployment-is-a-separate-job)
21. [Verifying the complete deployment](#21-verifying-the-complete-deployment)
22. [Troubleshooting, including our DNS failure](#22-troubleshooting-including-our-dns-failure)
23. [Day-to-day changes and recovery](#23-day-to-day-changes-and-recovery)
24. [What was changed and what was not](#24-what-was-changed-and-what-was-not)
25. [Cleanup and a practice checklist](#25-cleanup-and-a-practice-checklist)
26. [Official references](#26-official-references)

## 1. The big picture

There are two different journeys to understand:

**Deploying new code**

```text
Your Mac
  -> git commit and git push
  -> private GitHub repository
  -> GitHub Actions builds the Next.js app
  -> Azure deployment action uploads the result
  -> Azure serves the new version
```

**A person using the website**

```text
Browser asks DNS where famflix.andreicovaciu.dev is
  -> DNS points to Azure's generated hostname
  -> browser makes an HTTPS request to Azure
  -> Azure serves Next.js pages and runs server-side application code
  -> application uses Supabase for accounts and saved data
  -> application uses TMDB for movie and series information
```

For Google login, there is an extra round trip:

```text
FamFlix -> Supabase Auth -> Google -> Supabase Auth -> FamFlix
```

The website does **not** run on your Mac once deployed. You can shut down the
development server and other people can still visit the Azure-hosted site.
Name.com does **not** host the application; it manages the domain and, in our
setup, its DNS.

## 2. The services and terms

| Term or service | Plain-English explanation | Its job in FamFlix |
| --- | --- | --- |
| Next.js | A framework that combines browser UI and server-side application features | Pages, forms, server actions, authentication callbacks |
| React | The UI library used by Next.js | Interactive components |
| Node.js | The JavaScript runtime used for development/building and server execution | Runs the Next.js toolchain and supported server-side code |
| npm | Installs JavaScript packages and runs project scripts | `npm ci`, `npm run build`, `npm run lint` |
| Git | Saves versions of your source code | Commits, branches, recoverable history |
| GitHub | Stores the Git repository online | Private source repository and Actions |
| GitHub Actions | Runs automated jobs when repository events occur | Builds and deploys on pushes and pull requests |
| Azure Static Web Apps, or SWA | Microsoft's managed web-hosting service | Hosts FamFlix, its domain bindings, and managed TLS |
| Azure subscription | The account-level container for resource access, billing, and limits | Where our Azure resources belong |
| Tenant | The Microsoft identity directory behind the Azure account | Controls who can sign in and receive access |
| Resource group | A named collection of Azure resources | Groups the FamFlix infrastructure |
| Region | The Azure location selected for a resource | West Europe for this deployment |
| SKU | The service's pricing/feature tier | `Free` |
| Bicep | A language for describing Azure infrastructure as code | Recreates the resource group and SWA resource |
| Infrastructure as code, or IaC | Files describing resources rather than creating everything by hand | The files under `infra/` |
| Supabase | Hosted Postgres database plus authentication and related services | Accounts, families, watchlists, ratings, access rules |
| Postgres | The database engine inside Supabase | Stores application records |
| Row-level security, or RLS | Database rules deciding which rows each user can access | Protects private and family lists |
| TMDB | The Movie Database API | Movie/series metadata and images |
| Registrar | The company managing your domain registration | Name.com |
| DNS | The system that translates names into destinations | Sends `famflix.andreicovaciu.dev` traffic toward Azure |
| Nameserver | A server responsible for publishing DNS records for a domain | Name.com's authoritative servers |
| TLS/HTTPS | Encryption plus verification of the server's identity | Secure browser connections to FamFlix |
| OAuth | A sign-in flow that lets another provider authenticate someone | Google sign-in through Supabase |
| Callback | A URL a service returns to after completing part of a flow | Supabase and FamFlix each have a callback |
| CI/CD | Continuous integration and continuous delivery/deployment | Automated checking/building/publishing |
| Environment variable | A named configuration value supplied outside source code | Supabase URL/key and TMDB token |

## 3. What is free and what is not

We chose **Azure Static Web Apps Free**, not a paid virtual machine, App Service
plan, or Container App. The SWA resource's tier was checked as `Free`.

The limits documented when this guide was written include:

- 100 GB of included bandwidth per month.
- Two custom domains per app.
- Three preview environments per app.
- 250 MB storage per environment and 500 MB total across environments.
- No paid bandwidth overage option on Free; reaching a limit can affect service.
- No production availability SLA on the Free tier.

Azure manages the generated hostname and TLS certificates without a separate
certificate purchase. We did not create a paid Azure DNS zone.

**"$0 Azure hosting" is not the same as "everything is always free":**

- Your `andreicovaciu.dev` registration/renewal is still paid to the registrar.
- Supabase has its own database, auth, storage, email, and inactivity limits.
- GitHub Actions in a private repository has its own usage/storage allowance.
- TMDB has its own terms and API limits.
- Creating unrelated paid Azure resources or upgrading the SKU can incur costs.

Keep the Free SKU, inspect usage, and use budget alerts if appropriate. A budget
alert is a notification, **not** a universal automatic spending cutoff.

### Why a service called "Static Web Apps" works for this app

FamFlix is not only a folder of static HTML:

- It uses Next.js App Router and React Server Components.
- It uses server actions for operations such as login and list changes.
- It has an `/auth/callback` route handler.
- It refreshes authenticated sessions and protects signed-in routes.

We therefore used Azure's **hybrid Next.js** integration. Azure handles static
assets and the supported server-side Next.js runtime together.

We did **not** add `output: "export"` or treat `.next` as a plain static website.
A static export cannot preserve the server-dependent behavior used here.

Microsoft documents hybrid Next.js support as **preview**. That is a limitation
of the hosting integration, not a claim that every new Next.js feature will work
automatically. Check compatibility when upgrading. Microsoft's current guide
also lists restrictions, including no SWA CLI local emulation/deployment for
hybrid apps and limitations on linked APIs and configuration features.

## 4. What happened in our session

| Stage | What we did | Why |
| --- | --- | --- |
| Assess the app | Read its dependencies, routes, auth, and data usage | Choose hosting based on the actual app rather than a generic template |
| Install tools | Installed Azure CLI and installed/upgraded GitHub CLI through Homebrew | Manage Azure and GitHub from the terminal |
| Authenticate | Used Azure device-code login and selected the subscription | Give the CLI permission to manage the correct account |
| Prepare source | Created private `covaciuandrei/famflix`, configured `origin`, pushed `main` | Give CI/CD a remote source repository |
| Plan | Selected Free SWA in West Europe, leaving Supabase and TMDB external | Meet the low-traffic/free-hosting requirement |
| Define infrastructure | Created Bicep entry point, module, and parameters | Make resource creation inspectable and repeatable |
| Review | Checked quota/availability, compiled Bicep, reviewed what-if | Catch mistakes before making cloud changes |
| Provision | Created the resource group and SWA | Provide a hosting destination |
| Configure credentials | Added GitHub secrets and Azure app settings | Supply configuration without committing credentials |
| Deploy code | Added the GitHub Actions workflow, built and deployed | Publish the real Next.js application |
| Original domains | Moved DNS authority from DigitalOcean to Name.com; added apex and `www` | Make Name.com DNS changes authoritative and connect the domain |
| Change the preferred URL | Added the `famflix` CNAME and replaced the Azure `www` binding | Use `famflix.andreicovaciu.dev` within the two-domain limit |
| Auth URLs | Updated Supabase Site URL and callback allowlist | Return sign-ins and confirmation links to production |
| Verify | Checked Azure domain readiness, HTTP responses, DNS, TLS, saved settings | Separate successful provisioning from successful operation |
| Diagnose DNS | Compared authoritative/public DNS with router DNS | Prove the browser error came from stale resolver data |

The first successful GitHub deployment was
[run 37685113294](https://github.com/covaciuandrei/famflix/actions/runs/37685113294)
for commit `1e5b305474e4bf24f5f3a42b8181a48348bbc6e8`. It completed in roughly
three minutes. That is a historical run, not necessarily the latest app version.

## 5. The actual production configuration

| Item | Value |
| --- | --- |
| Primary website | <https://famflix.andreicovaciu.dev> |
| Apex fallback | <https://andreicovaciu.dev> |
| Azure-generated website | <https://green-ocean-027b21c03.2.azurestaticapps.net> |
| GitHub repository | <https://github.com/covaciuandrei/famflix> (private) |
| Production branch | `main` |
| Azure subscription | `Visual Studio Enterprise Subscription` |
| Subscription ID | `c845cd59-f72e-4d9c-9e2a-192309b52255` |
| Resource group | `rg-famflix-prod-a85c` |
| Static Web App | `swa-famflix-prod-a85c` |
| Region | `westeurope` / West Europe |
| Tier | Free |
| Infrastructure deployment name | `famflix-prod-a85c` |
| Supabase project reference | `hqixpuwszqemnkyuxjuq` |
| Google Cloud project shown during the session | `famflix-510920` |

Resource names, project IDs, subscription IDs, and hostnames identify resources;
they are not passwords. Credentials are deliberately omitted.

At the guide's read-only check, Azure reported both the apex and `famflix`
custom-domain bindings as **Ready**, and the production login URL returned
HTTP 200.

The apex currently remains another address for the same application. Merely
calling `famflix` the primary URL does **not** automatically redirect the apex
to it. We did not configure an apex-to-`famflix` redirect during this work.

## 6. Installing and signing in to the tools

### macOS/Homebrew

Homebrew is a package manager. On this Apple Silicon Mac it was installed under
`/opt/homebrew/bin`, but the tool shell initially did not include that directory
in its `PATH`.

`PATH` is the list of folders the shell searches when you type a command name.
An installed command can still appear "not found" if its folder is missing.

For a shell with that problem:

```bash
export PATH="/opt/homebrew/bin:$PATH"
```

This changes the current shell. If needed, follow Homebrew's installation
instructions to configure the appropriate shell startup file permanently.

Install the management tools:

```bash
brew install azure-cli gh
az version
gh --version
```

If already installed, `brew upgrade azure-cli gh` updates them. Our recorded
session versions were Azure CLI 2.90.0 and GitHub CLI 2.102.0; there is no need
to force those exact CLI versions merely to follow this guide.

### Azure login

```bash
az login --use-device-code
```

The CLI displays a Microsoft sign-in URL and a short-lived code. Open the URL,
enter the code, and complete account login yourself. Never share that code
publicly or approve a code generated by someone you do not trust.

Select and verify the subscription:

```bash
az account list --output table
az account set --subscription c845cd59-f72e-4d9c-9e2a-192309b52255
az account show --query '{name:name,id:id,tenantId:tenantId}' --output json
```

For your own independent deployment, replace the ID with **your** subscription.
Selecting the wrong subscription is a common way to create resources in the
wrong place. Resource creation also requires appropriate Azure permissions;
being able to log in alone does not grant them.

### GitHub login

```bash
gh auth login
gh auth status
```

Follow the prompts and use the browser-based flow if offered. Azure and GitHub
are different accounts: signing in to one does not sign in to the other.

## 7. Preparing the application

Work from the repository root: the folder containing `package.json`.

```bash
node --version
npm --version
npm ci
```

`npm ci` installs the versions recorded in the lockfile. It is useful for
reproducible builds; it replaces the existing `node_modules` dependency tree.
`npm install` is the usual command when intentionally changing dependencies.

The project's original deployment pins Node to `20.x` in
[`package.json`](../package.json), mirrored in
[`package-lock.json`](../package-lock.json). This helped align builds with the
hosting integration at the time. A pin is **not** a permanent security/support
guarantee: before reproducing this later, check the Node release lifecycle and
Azure's supported Next.js runtimes. Upgrade in a tested change rather than
blindly copying an old runtime or assuming the latest one is supported.

Create local configuration:

```bash
cp .env.local.example .env.local
```

Open `.env.local` locally and fill in the four values described in
[the example](../.env.local.example). Do not commit the real file.

Understand the project scripts:

| Command | Purpose |
| --- | --- |
| `npm run dev` | Development server with rapid refresh, normally on `http://localhost:3000` |
| `npm run lint` | ESLint checks for code problems |
| `npx tsc --noEmit` | TypeScript checking without emitting compiled output |
| `npm run build` | Creates the production build; catches build-time failures |
| `npm start` | Runs a previously built Next.js app locally in production mode |

The original deployment work passed `npm run lint` and `npm run build`.
Type checking is also a useful pre-push check, but this guide does not claim a
separate original unit-test suite existed. A successful build is necessary;
it does not prove every user action works.

## 8. Putting the code on GitHub

Our initial blocker was the lack of a Git remote, not an inability of Azure to
host the application. GitHub Actions needed an online repository.

For a **new project that has no repository/remote yet**:

```bash
git init
git branch -M main
git status
```

Review `.gitignore` and the files before staging. Commit selected project files,
not credentials or generated output:

```bash
git add <reviewed-files>
git commit -m "Prepare application for deployment"
gh repo create <your-account>/<new-repository> --private --source=. --remote=origin --push
```

Replace angle-bracket placeholders; do not paste them literally. If the GitHub
repository already exists, configure its URL instead:

```bash
git remote add origin https://github.com/<your-account>/<your-repository>.git
git push -u origin main
```

Do not repeat `git init`, repository creation, or `remote add` on the existing
FamFlix checkout. Inspect it with `git remote -v` and `git status`.

### What the Git words mean

- **Working tree:** files currently on your disk.
- **Staging:** choosing the exact changes for the next commit.
- **Commit:** a saved version with an ID and message.
- **Branch:** a named line of commits; `main` is our production source.
- **Remote/origin:** the online repository's address.
- **Push:** sends local commits to GitHub; our workflow responds to this event.
- **Pull request:** proposes changes for review before merging into `main`.

Our initial application commit was `80a2e5e`. The deployment configuration was
added in `1e5b305`. Infrastructure metadata was aligned in `4fbce46`, using
`[skip ci]` to avoid an unnecessary app deployment for that metadata-only commit.
Do not use `[skip ci]` when you actually want the hosted app updated.

## 9. Understanding the infrastructure files

There are **two deployments**, not one:

1. **Infrastructure deployment:** creates/configures the Azure hosting resource.
2. **Application deployment:** builds and uploads the website code.

Bicep handles the first. GitHub Actions handles the second.

### The files

| File | What it does |
| --- | --- |
| [`infra/main.bicep`](../infra/main.bicep) | Subscription-scope entry point; creates the resource group and invokes the SWA module |
| [`infra/modules/static-web-app.bicep`](../infra/modules/static-web-app.bicep) | Defines the Free Static Web App and exports its ID/hostname |
| [`infra/main.parameters.json`](../infra/main.parameters.json) | Supplies deployment input values |
| [`infra/bicepconfig.json`](../infra/bicepconfig.json) | Bicep formatting configuration |

`targetScope = 'subscription'` allows the main template to create a resource
group. The module runs **inside that group**, using `scope: rg`.

A **parameter** is an input. A **variable** is a computed or named value inside
the template. A **resource** describes something Azure should manage. A
**module** splits the template into a reusable file. An **output** returns useful
information, such as the generated hostname, after deployment.

The module uses the Azure API version `Microsoft.Web/staticSites@2025-05-01`.
The session checked that version against the live provider registry. The local
Bicep compiler produced a `BCP081` type-metadata warning: its type catalogue did
not fully describe that API version. Compilation/deployment still succeeded.
This does not mean every warning is safe to ignore; inspect its actual cause.

### Why our SWA is "detached"

The Bicep SWA resource has no GitHub repository URL or repository credentials in
its properties. Azure creates a hosting destination. Our checked-in workflow
publishes to it using a deployment token.

This avoids relying on Azure to create/manage the GitHub workflow and avoids
putting a repository access token in infrastructure files. Do not add a second,
portal-generated deployment workflow alongside the existing one without a plan:
both could deploy on the same push.

### Tags

The template adds labels such as `project`, `environment`, `deploymentMethod`,
and the onboarding session ID. Tags help identify and track resources; they do
not themselves grant permissions or control application behavior.

### Important limitation of this template

The resource-group and SWA names are currently **hardcoded** in the main file.
Changing only `environmentName` in the parameters file does not create a
completely separate environment.

Before practicing on a separate app, copy/adapt the template and choose new
resource names. Read the what-if result to ensure you are not updating production.
The current template does **not** recreate DNS, custom-domain bindings, runtime
settings, GitHub secrets, Google settings, or the Supabase database.

## 10. Creating the Azure infrastructure manually

### Recommended reproducible route: Bicep

These commands use the existing files and therefore target the existing FamFlix
resources. For a fresh practice deployment, change the hardcoded resource names
and parameters first.

```bash
az bicep install
az bicep build --file infra/main.bicep --stdout > /dev/null
```

The build translates Bicep into Azure's deployment template format. Redirecting
to `/dev/null` avoids leaving an unneeded generated JSON file in the repository;
warnings/errors remain visible.

Preview the intended changes:

```bash
az deployment sub what-if \
  --name famflix-prod-a85c \
  --location westeurope \
  --template-file infra/main.bicep \
  --parameters @infra/main.parameters.json
```

`what-if` is a preview, not a deployment. In our initial run it showed creation
of the resource group and Free SWA, with no updates/deletions. On today's existing
resources you should not expect the same "create" result.

If the preview is correct, deploy:

```bash
az deployment sub create \
  --name famflix-prod-a85c \
  --location westeurope \
  --template-file infra/main.bicep \
  --parameters @infra/main.parameters.json
```

Here `--location` also identifies where Azure stores the subscription deployment
record; the template's `location` parameter sets resource placement.

Inspect the result:

```bash
az staticwebapp show \
  --name swa-famflix-prod-a85c \
  --resource-group rg-famflix-prod-a85c \
  --query '{name:name,hostname:defaultHostname,sku:sku.name}' \
  --output json
```

The generated hostname is assigned by Azure. A new SWA can get a **different**
hostname and inbound IP, so do not copy this app's DNS targets to another app.

### Portal alternative

For a new independent deployment:

1. Sign in to <https://portal.azure.com>.
2. Create a resource group in the intended subscription/region.
3. Search for **Static Web Apps** and choose **Create**.
4. Select the resource group, an app name, and **Free** hosting.
5. Select the appropriate region.
6. Choose a deployment-source option that lets you create the resource without
   generating a second GitHub workflow, if offered by the current interface.
7. Review the subscription, tier, and other settings, then create it.
8. Copy its generated hostname and find its deployment token.

The portal and Bicep operate on the same kinds of Azure resources. Bicep makes
the intended configuration easier to review/repeat, but copying these manual
steps is still useful for learning.

## 11. Environment variables and secrets

### The values we configured

| Name | Purpose | Where it belongs |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Identifies the Supabase API endpoint | Local file, GitHub build environment, Azure runtime settings |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser-compatible Supabase public/anon key | Same three places |
| `SUPABASE_SERVICE_ROLE_KEY` | Lets the server, and only the server, save the shared movie info that signed-in users cannot write | Local file and Azure runtime settings. Not a GitHub secret (the build does not use it), never a `NEXT_PUBLIC_` variable |
| `TMDB_ACCESS_TOKEN` | Authorizes server calls to TMDB | Same three places, never exposed as a browser variable |
| `AZURE_STATIC_WEB_APPS_API_TOKEN` | Permits publishing to this SWA | GitHub Actions secret, not app runtime |
| `GITHUB_TOKEN` | Temporary GitHub token automatically supplied to a workflow | Used by the workflow; no manually created repository secret needed |
| Google OAuth client secret | Allows Supabase's Google provider to authenticate its OAuth client | Supabase provider configuration, not FamFlix source |

`NEXT_PUBLIC_` is meaningful in Next.js: those values may be embedded into browser
JavaScript at build time. They are not made private just because GitHub stores
them in a secret.

The Supabase anon key is designed for client use, subject to database policies.
It is **not** the powerful Supabase service-role key. Never substitute a
service-role key into `NEXT_PUBLIC_SUPABASE_ANON_KEY`; RLS is essential to making
public client access safe.

FamFlix does use the service-role key, but only on the server and in one place:
`src/lib/save-media.ts` saves TMDB data into the shared `media` table, which
signed-in users have no right to write. The key skips row-level security, so keep
it out of `NEXT_PUBLIC_` variables, Git, screenshots, and logs. If it leaks, create
a new one in Supabase (Project Settings -> API Keys) and update the two places
above.

`TMDB_ACCESS_TOKEN` uses TMDB's long **API Read Access Token**, not its short API
key. It does not have the `NEXT_PUBLIC_` prefix and is used server-side.

### Why configuration exists in three places

1. `.env.local` is read on your computer during local development.
2. GitHub Actions secrets are injected while the hosted runner builds the app.
3. Azure app settings are available to deployed server-side code at runtime.

The service-role key belongs in the first and third place only: the GitHub build
never needs it. Your local file is ignored by Git; it does not magically arrive
at GitHub or Azure. Changing a `NEXT_PUBLIC_` value in Azure alone does not
replace values already compiled into a browser bundle: update build
configuration and redeploy.

### Add GitHub secrets manually

Open the repository, then **Settings -> Secrets and variables -> Actions ->
New repository secret**. Add the four manually configured names in the table.

Find the SWA deployment token in the Azure resource's deployment-token management
screen. Treat it like a password. Use Supabase's project settings for its URL and
public/anon key, and TMDB settings for its token.

CLI alternative: `gh secret set` prompts for a value instead of requiring it in
the command line:

```bash
gh secret set NEXT_PUBLIC_SUPABASE_URL --repo covaciuandrei/famflix
gh secret set NEXT_PUBLIC_SUPABASE_ANON_KEY --repo covaciuandrei/famflix
gh secret set TMDB_ACCESS_TOKEN --repo covaciuandrei/famflix
```

To transfer Azure's deployment token directly into GitHub without printing it:

```bash
set -o pipefail
az staticwebapp secrets list \
  --name swa-famflix-prod-a85c \
  --resource-group rg-famflix-prod-a85c \
  --query properties.apiKey --output tsv |
  gh secret set AZURE_STATIC_WEB_APPS_API_TOKEN --repo covaciuandrei/famflix
```

Only do this against the intended account and resource. Confirm command success
and verify that the secret name appears in GitHub. Do not run the Azure half
alone in a recorded/shared terminal: that would print the token.
`pipefail` makes an error from the Azure command visible in the pipeline's exit
status instead of checking only the GitHub command's result.

### Add Azure runtime settings manually

Open the SWA in Azure Portal. Find **Environment variables** or **Configuration**
(labels can change), select the production environment, and set the four app
variables: Supabase URL, anon key, service-role key, and TMDB token. Save them.

Do not add the deployment token there; the app does not need it.

The CLI also has `az staticwebapp appsettings set --setting-names KEY=VALUE ...`,
but the portal is safer for beginners than putting real credentials into shell
history. Some CLI settings/secret commands return sensitive values; avoid
posting their output or using `--debug` around credentials.

## 12. Understanding the deployment workflow

The workflow is
[`.github/workflows/azure-static-web-apps.yml`](../.github/workflows/azure-static-web-apps.yml).
YAML is a structured configuration format where indentation matters.

| Workflow feature | Meaning |
| --- | --- |
| `on: push`, branch `main` | Publish production when commits are pushed to `main` |
| Pull-request opened/synchronize/reopened events | Build/deploy a preview when a proposed change is created or updated |
| Pull-request closed event | Run a separate job to close its preview |
| `test` job | Lint, type-check, the database tests (against a `postgres:17` service container) and the browser tests (against a throwaway Supabase in Docker); see the README's Tests section |
| `needs: test` | The deploy job only runs when the tests pass |
| `runs-on: ubuntu-latest` | GitHub supplies a temporary Linux machine for the job |
| `actions/checkout@v4` | Downloads the repository files onto that machine |
| `Azure/static-web-apps-deploy@v1` | Azure's action builds/packages/uploads the supported app |
| `action: upload` | Publish an application |
| `app_location: /` | App source is at the repository root |
| `api_location: ""` | No separately supplied Azure Functions API directory |
| `output_location: ""` | Let the Next.js integration handle its output, rather than specifying a plain static export directory |
| `app_build_command: npm run build` | Run the project's production build |
| `env:` | Supply the three application variables during the build |
| `repo_token` | Supports GitHub integration such as pull-request feedback |
| `action: close` | Remove a closed pull request's preview environment |

The empty `api_location` does not mean "this app has no server." Its server
actions and route handlers are part of the Next.js integration.

The workflow grants `contents: read` and `pull-requests: write`. These are
GitHub token permissions, not Azure permissions.

Preview environments are useful for testing before merging. They do not get a
separate database automatically: if they use production Supabase credentials,
actions in a preview may modify production data. Their auth callback must also
be explicitly allowed in Supabase to test login there. Prefer precise preview
URLs or a separate test Supabase project over a broad allowlist for every
`azurestaticapps.net` site.

Secrets are generally unavailable to workflows from forked pull requests. Do not
"fix" that by exposing deployment credentials to untrusted pull-request code.

The current workflow builds/deploys; it does **not** have dedicated lint,
unit-test, or database-migration steps. Run the checks locally or deliberately
add CI checks in a separate change.

## 13. Running and inspecting a deployment

For a reviewed change:

```bash
npm run lint
npx tsc --noEmit
npm run build
git status
git diff
git add <the-reviewed-files>
git commit -m "Describe the change"
git push origin main
```

That push triggers production deployment. You do not need to keep your terminal
open while GitHub runs the job.

In GitHub, open **Actions -> Azure Static Web Apps CI/CD -> the latest run**.
Expand failed steps to read their logs. A green check means the workflow
completed, not that every possible user scenario was tested.

CLI examples:

```bash
gh run list --repo covaciuandrei/famflix --limit 5
gh run view <run-id> --repo covaciuandrei/famflix
gh run watch <run-id> --repo covaciuandrei/famflix
```

If you only changed GitHub secrets, no source push occurred. To rebuild with the
new values, rerun the appropriate workflow run from GitHub Actions, or:

```bash
gh run rerun <run-id> --repo covaciuandrei/famflix
```

Rerunning a run rebuilds its original commit; make sure it is the commit you
intend to publish. The existing workflow has no `workflow_dispatch` trigger, so
do not assume a generic "Run workflow" button exists.

## 14. Domains, nameservers, and DNS

### Domain versus subdomain

- `andreicovaciu.dev` is the **apex/root** domain.
- `famflix.andreicovaciu.dev` is a **subdomain**.
- `www.andreicovaciu.dev` is another subdomain; `www` is not special magic.
- `https://.../auth/callback` is a URL with a path, not a DNS record name.

Owning the apex lets you configure subdomains without registering each
subdomain separately.

### Why nameservers mattered

Originally the domain registration pointed to DigitalOcean nameservers.
Creating a record in Name.com's DNS editor did not make that record effective
while the domain was delegated somewhere else.

We changed the domain's nameserver delegation to Name.com's defaults:

```text
ns1hwy.name.com
ns2dky.name.com
ns3ghw.name.com
ns4jpz.name.com
```

The exact defaults are domain/account-specific. Use the nameservers assigned by
your registrar, not this list as a universal template.

Before switching DNS providers on another domain, copy all needed records
(especially email MX/TXT records). Switching authority without preserving them
can break mail or other sites.

Name.com briefly displayed a stale warning about not using its nameservers even
after registry delegation was correct. We checked DNS itself rather than
trusting the cached UI message.

### Record types

| Record | Meaning | Our use |
| --- | --- | --- |
| `CNAME` | An alias from one hostname to another hostname | `famflix` to the Azure-generated hostname |
| `A` | A hostname to an IPv4 address | The original apex setup |
| `TXT` | A text record, often used to prove domain ownership | Azure's apex validation token |
| `NS` | Identifies authoritative nameservers | Delegates the domain to its DNS provider |
| `SOA` | Zone metadata, including cache-related timing | Helped identify old DigitalOcean negative responses |
| `MX` | Routes email for a domain | Not changed as part of this website deployment |

A CNAME target contains only the hostname: no `https://`, slash, or port.
Avoid conflicting records at the same hostname.

### TTL and propagation

TTL, or time to live, tells resolvers how long a DNS answer may be cached.
Our Name.com records used **300 seconds**.

That does not guarantee a nameserver change or an earlier "name does not exist"
answer disappears in five minutes. Nameserver delegation and negative answers
have their own cache lifetimes. Different people can see different answers
temporarily because they use different resolvers.

## 15. Connecting famflix at Name.com and Azure

These are **two separate operations**: DNS points to Azure; Azure must also be
configured to recognize your custom hostname.

### Name.com

1. Sign in and open `andreicovaciu.dev`.
2. Confirm it uses the correct Name.com nameservers.
3. Open **Manage DNS**.
4. Add:

| Field | Value |
| --- | --- |
| Type | `CNAME` |
| Host | `famflix` |
| Answer/target | `green-ocean-027b21c03.2.azurestaticapps.net` |
| TTL | `300` or the default |

The Name.com form shown in our session appended `.andreicovaciu.dev` after the
Host input. Enter `famflix`, not the complete domain twice.

For a new app, replace the target with **its** generated Azure hostname.

### Azure Portal

1. Open `swa-famflix-prod-a85c`.
2. Open **Custom domains**.
3. Choose **Add -> Custom domain on other DNS**.
4. Enter `famflix.andreicovaciu.dev`.
5. Use CNAME validation.
6. Wait for validation and managed certificate provisioning.
7. Verify the binding is **Ready** and HTTPS works.

CLI equivalent:

```bash
az staticwebapp hostname set \
  --name swa-famflix-prod-a85c \
  --resource-group rg-famflix-prod-a85c \
  --hostname famflix.andreicovaciu.dev

az staticwebapp hostname list \
  --name swa-famflix-prod-a85c \
  --resource-group rg-famflix-prod-a85c \
  --output table
```

### Why we removed the Azure www binding

Our first attempt to add `famflix` failed with:

```text
The maximum number of custom domains allowed for this static site is 2.
```

The two slots were already occupied by the apex and `www`. To stay on Free,
we removed the Azure `www` binding and kept the apex as a fallback:

```bash
# Historical change: do not remove a hostname you still need.
az staticwebapp hostname delete \
  --name swa-famflix-prod-a85c \
  --resource-group rg-famflix-prod-a85c \
  --hostname www.andreicovaciu.dev \
  --yes
```

Then the `famflix` addition succeeded. Deleting a binding can take time to
propagate. The generated Azure hostname does not consume a custom-domain slot.

Deleting an Azure binding does not delete the DNS record in Name.com. The old
`www` CNAME may remain, but DNS alone cannot make an unbound hostname a working
custom site. If unused, remove that old record; do not advertise `www` as a
working production address.

## 16. The original apex and www setup

Before choosing `famflix`, we configured:

| Type | Host | Target/purpose |
| --- | --- | --- |
| `CNAME` | `www` | Azure-generated hostname |
| `A` | `@` / apex | `20.82.13.59`, the address obtained for this SWA setup |
| `TXT` | `@` / apex | Azure-generated domain validation token |

The apex TXT value was a domain-ownership proof, not an application credential.
A new resource/domain validation request generates its own value; copy it from
Azure rather than reusing a historical token.

A conventional apex CNAME can conflict with the apex's required DNS records.
Some providers offer ALIAS/ANAME or flattening support. For our Name.com setup,
we used Azure's apex validation flow and its displayed inbound address.

To initiate TXT validation from the CLI:

```bash
az staticwebapp hostname set \
  --name swa-famflix-prod-a85c \
  --resource-group rg-famflix-prod-a85c \
  --hostname andreicovaciu.dev \
  --validation-method dns-txt-token \
  --no-wait
```

Use Azure's portal/current validation details to obtain the required TXT value
and routing target, then create those records at your DNS provider. Do not
assume `20.82.13.59` is a universal Azure IP.

The apex is still bound to the app. This does not reserve it forever: if you
later want a personal portfolio there, plan to remove/reassign the apex binding
and its DNS records while leaving `famflix` alone.

## 17. HTTPS and certificates

DNS answers "where should I connect?" TLS answers "is this really the server
authorized for this name, and can we encrypt the conversation?"

Azure automatically provisions/renews certificates for validated custom domains.
We did not buy an SSL certificate or configure a web server manually.

Domains under `.dev` are on browsers' HSTS preload list: browsers require HTTPS.
A broken or not-yet-issued certificate cannot be worked around by casually
using HTTP.

During provisioning, one Azure edge request briefly received a certificate that
did not include `famflix`, while another received the correct one. We waited and
retested. A **Ready** domain binding is useful evidence, but always test actual
HTTPS afterward.

Do not use `curl -k` to claim HTTPS is fixed: it disables certificate validation.
Our successful TLS checks did not bypass verification.

## 18. Supabase authentication configuration

Azure hosting and Supabase authentication are separate. Changing DNS does not
automatically update Supabase.

Open **Supabase -> Authentication -> URL Configuration**.

Set the **Site URL** to:

```text
https://famflix.andreicovaciu.dev
```

The Site URL is Supabase's default/fallback destination when no allowed explicit
redirect is supplied. It also matters for authentication email links/templates.

Add precise **Redirect URLs** for the addresses you use:

```text
http://localhost:3000/auth/callback
https://famflix.andreicovaciu.dev/auth/callback
https://andreicovaciu.dev/auth/callback
https://green-ocean-027b21c03.2.azurestaticapps.net/auth/callback
```

The session also added `https://www.andreicovaciu.dev/auth/callback` while `www`
was in use. It can be removed from the allowlist if that hostname is retired.
Allowing it in Supabase does not restore its Azure binding.

Save and **reload the settings page to verify persistence**. One initial
attempt at saving the Site URL did not persist; seeing text in an edited form is
not proof that the backend saved it.

We first changed the Site URL from localhost to the apex, then changed it to
`famflix` once the new Azure binding was ready.

### What the application does

[`src/app/login/actions.ts`](../src/app/login/actions.ts) builds the current
origin using forwarded host/protocol headers or normal request headers. It asks
Supabase to return to that origin plus `/auth/callback`.

[`src/app/auth/callback/route.ts`](../src/app/auth/callback/route.ts) receives a
code, exchanges it for a Supabase session, and redirects the user into `/app`.
It reports a failed exchange through the login page. A bare callback request
without a valid code is expected to redirect with an error; that is not a
successful Google-login test.

[`src/proxy.ts`](../src/proxy.ts) and
[`src/lib/supabase/middleware.ts`](../src/lib/supabase/middleware.ts) handle session
refresh and signed-in route protection. Session cookies mean the browser can
remain logged in between requests.

Cookies belong to their host/domain. Moving from the apex to `famflix` may
require signing in again; your database records have not disappeared.

### Email authentication is switched off

FamFlix signs people in with Google only: the login page has no email or
password form, and Supabase's **Email** provider is disabled (Authentication →
Sign In / Providers), so nobody can sign up with a password through the API
either. That also means FamFlix sends no emails, so it needs no SMTP provider.
Google accounts are the protection against sign-up bots.

## 19. Google login and the two callbacks

The most important distinction:

| Callback | Who uses it? | Exact address for this app |
| --- | --- | --- |
| Supabase provider callback | Google returns the OAuth result to Supabase | `https://hqixpuwszqemnkyuxjuq.supabase.co/auth/v1/callback` |
| FamFlix app callback | Supabase returns the browser to FamFlix | `https://famflix.andreicovaciu.dev/auth/callback` |

Do **not** replace Google's authorized redirect URI with the FamFlix callback.
Supabase brokers the provider login and needs to receive Google's result first.

### How to configure this manually

1. Open a Google Cloud project, then **Google Auth Platform**.
2. Configure branding/application name and support details.
3. Configure **Audience**. If the app is in testing, add intended users as test
   users; people outside the allowed audience may be blocked.
4. Configure only the necessary data access scopes, normally OpenID, email, and
   basic profile for this sign-in flow.
5. Under **Clients**, create a **Web application** OAuth client.
6. Configure authorized JavaScript origins as appropriate for the current
   Supabase Google setup instructions, including the production site origin.
7. Set the authorized redirect URI to the **Supabase provider callback** above.
8. Copy the client ID and client secret into **Supabase -> Authentication ->
   Sign In / Providers -> Google**, enable the provider, and save.
9. Configure the app callback in Supabase's redirect allowlist.
10. Test using an intended user's account.

Origins do not contain `/auth/callback`. Redirect URIs do. An OAuth client ID
identifies the integration; the client **secret** must stay private.

Google Cloud branding/audience pages were available during our session, but the
deployment records do not establish the final consent-screen publishing or
verification status. Check the console rather than assuming it is published
for everyone. Testing, publishing, domain verification, and brand verification
are distinct concepts.

Adding the Azure website domain did not change the Supabase project URL.
Seeing a `supabase.co` hostname during Google authentication can therefore be
normal. A Supabase custom auth domain is a separate feature and was not
configured here.

## 20. Database deployment is a separate job

Supabase continued to host the database; we did not move it into Azure. Pushing
to GitHub deploys application code, **not SQL migrations**.

For a fresh Supabase project, follow the database instructions in
[`README.md`](../README.md): run [`supabase/db_init.sql`](../supabase/db_init.sql)
once on the empty database. It defines the tables, functions and security
policies.

For the existing production project:

1. Establish which migrations have already run.
2. Read the new migration and check whether it is safe for existing data.
3. Back up appropriately before risky schema/data changes.
4. Apply required new migrations using the SQL Editor or a deliberately managed
   migration process.
5. Deploy application code that depends on them in the correct order.

Do not run `db_init.sql` on a live database: it is only for an empty one, and
it stops at the first table that already exists. Our Actions workflow does not
track or apply SQL. To start over on a project that has FamFlix in it (before
release, when there is nothing to keep), the README has the three statements
that empty the schema and the users; then run `db_init.sql`.

Supabase changed what a new table or function gets by default: no access for
the API roles unless granted (new projects since 30 May 2026, every project from
30 October 2026; tables that already exist keep their grants). `db_init.sql`
therefore grants everything explicitly at its end and doesn't depend on those
defaults, and the database tests run it both ways. A change that adds a table or
function has to add its `grant` statements as well, in the SQL you run and in
`db_init.sql`.

RLS is what enforces database access boundaries even when a browser has the
Supabase public key. Hiding a button in React is not a substitute for database
security policies.

## 21. Verifying the complete deployment

Verification has layers. A success at one layer is not proof of the next.

### Layer 1: Azure resources exist

```bash
az staticwebapp show \
  --name swa-famflix-prod-a85c \
  --resource-group rg-famflix-prod-a85c \
  --query '{name:name,hostname:defaultHostname,sku:sku.name}' --output json
```

Check the resource name, generated hostname, and Free tier.

### Layer 2: Code deployment completed

Check GitHub Actions for a successful run and the expected commit ID.

### Layer 3: DNS resolves

```bash
dig famflix.andreicovaciu.dev CNAME
dig @1.1.1.1 famflix.andreicovaciu.dev CNAME
dig @8.8.8.8 famflix.andreicovaciu.dev CNAME
dig @ns1hwy.name.com famflix.andreicovaciu.dev CNAME
```

Without `@...`, `dig` uses your configured resolver. With it, you ask a specific
server. Look for `status: NOERROR` and the expected CNAME. `NXDOMAIN` means that
resolver currently says the name does not exist. A correct CNAME also needs its
target to resolve to an address; try `dig @1.1.1.1 famflix.andreicovaciu.dev A`
to inspect the chain.

### Layer 4: HTTPS and application routes respond

```bash
curl -sS -o /dev/null -w 'HTTP %{http_code}\n' \
  https://famflix.andreicovaciu.dev/login
```

HTTP 200 means the route responded successfully. A redirect, often 307 in this
app, may be expected when accessing a protected route without a session.

To separate DNS failure from Azure/TLS failure:

```bash
curl --resolve famflix.andreicovaciu.dev:443:20.82.13.59 \
  -sS -o /dev/null -w 'HTTP %{http_code}\n' \
  https://famflix.andreicovaciu.dev/login
```

`--resolve` supplies an address for this request while preserving the URL's
hostname for HTTP routing and certificate validation. It does not edit DNS or
your hosts file. Use the current app's address, not this value for unrelated
apps.

### Layer 5: Real user behavior

Use a test account and confirm:

- [ ] Home and login pages load at the intended domain.
- [ ] Google login returns to `famflix`, not localhost or an old hostname.
- [ ] The login page offers only "Continue with Google".
- [ ] Refreshing a signed-in page preserves the session.
- [ ] Signing out prevents access to protected `/app` pages.
- [ ] Browsing/searching retrieves TMDB data.
- [ ] Creating a test family/list and saving a title persists after refresh.
- [ ] Another account cannot read a private list or an unrelated family's data.
- [ ] The site works on a phone or another network.

The session verified route HTTP responses, valid TLS, Azure readiness, and
Supabase URL-setting persistence. A callback redirect by itself is **not**
proof of a completed OAuth exchange. Treat end-to-end login/data checks as
separate tests whenever you redeploy. The later shared browser page shows
signed-in production use, but it is not an automated test of every auth mode.

## 22. Troubleshooting, including our DNS failure

### Our actual NXDOMAIN incident

After the `famflix` binding was ready, Chrome showed:

```text
DNS_PROBE_FINISHED_NXDOMAIN
```

We compared DNS answers:

| Source | Answer at the time |
| --- | --- |
| All four Name.com authoritative servers | Correct Azure CNAME |
| Cloudflare `1.1.1.1` | Correct CNAME |
| Google `8.8.8.8` | Correct CNAME |
| Quad9 `9.9.9.9` | Correct CNAME |
| Local router `192.168.100.1` | NXDOMAIN with an old DigitalOcean SOA |

The router's answer included `ns1.digitalocean.com` despite the domain now using
Name.com. Its cached negative answer had around 1,303 seconds (22 minutes) left
at the time of that check. That was evidence of stale DNS resolution, not an
absent Name.com record or a broken application.

We also used `curl --resolve` to reach Azure directly and verified valid TLS and
HTTP 200. This isolated the failure to DNS on the local network.

The 22-minute figure was an observation of that cached answer, not a universal
maximum for delegation changes. Other upstream caches can have different TTLs.

**Ways to recover:**

1. Wait for the relevant cache to expire and retry.
2. In Chrome settings, search **Use secure DNS** and select a trusted provider
   such as Cloudflare or Google if your browser/network permits it.
3. Change the device's DNS settings to a trusted public resolver. On macOS this
   is under **System Settings -> Network -> active connection -> Details -> DNS**.
   Record the old configuration so you can restore it.
4. Test on mobile data to distinguish a local-network problem from a site issue.

Clearing only the browser cache may not clear a router/upstream cache.
Repeatedly deleting/recreating correct DNS records is not a fix. We did not
change the Mac's DNS settings or hosts file as part of this diagnosis.

### Other symptoms

| Symptom | Likely layer | What to check |
| --- | --- | --- |
| `az` or `gh` not found | Local tooling | Installation and `/opt/homebrew/bin` in `PATH` |
| Azure authorization error | Account/access | Selected subscription and Azure role permissions |
| GitHub workflow build fails | Build | First failing log step, dependency/runtime compatibility, missing env values |
| Workflow rejects deployment token | Deployment credentials | Secret name, correct SWA token, token rotation |
| Default Azure URL works but custom hostname does not | Domain/TLS | DNS, Azure hostname binding, certificate provisioning |
| Name.com record exists but public DNS disagrees | DNS authority/cache | Registry delegation, authoritative answers, resolver caches |
| `maximum number of custom domains ... is 2` | Free-tier limit | Remove an unused binding or deliberately change hosting tier |
| Google `redirect_uri_mismatch` | Provider OAuth | Google's redirect URI must exactly match the Supabase provider callback |
| Login returns to localhost | App/Supabase redirect configuration | Saved Site URL, precise allowlist, actual request origin |
| Some Google users are blocked | Google audience | Test users/publishing status and provider policy |
| "You're doing that too often" | App limits | Someone added titles, searched or tried invite codes faster than the limits in the README; wait and retry |
| Missing table/function errors | Database | Required SQL migration was not applied |
| Titles do not load | App/TMDB | Server runtime token, TMDB response/logs, API limits |
| Adding a title says "Couldn't save this title" | Server settings | `SUPABASE_SERVICE_ROLE_KEY` missing or wrong in Azure's runtime settings (the server log says which) |
| Old UI after a code change | Delivery/browser cache | Deployed commit, successful latest run, refresh and static-asset cache |

Read the actual error before changing multiple settings. When reporting a
problem, include the URL, time, expected behavior, and redacted logs, but never
passwords, deployment tokens, OAuth secrets, or session cookies.

## 23. Day-to-day changes and recovery

### For an ordinary application change

Edit locally, test, review the diff, commit selected files, and push. GitHub
deploys it automatically. Infrastructure and DNS normally do not need changing.

### For a change that needs new SQL

Some features (Movie night added tables, functions and changed a few existing
ones) need database changes. Run the SQL in the Supabase SQL Editor **first**,
then push: the push deploys the code within minutes, and code that calls
something the database doesn't have yet fails until the SQL is there. A new table
or function needs its `grant` statements in that SQL as well (see section 20).
Keep `supabase/db_init.sql` in step, and check the two match by building a fresh
database from it and comparing its schema with the live one.

### For a new hostname

Create its DNS record, check resolution, add its Azure binding, verify TLS, add
the Supabase callback, then switch the Site URL when appropriate. Retire old
hostnames deliberately. Check the two-domain limit first.

### For a changed environment variable

Update the relevant local/build/runtime copies. Redeploy if build-time values
changed. Rotating the SWA deployment token means updating GitHub's deployment
secret too; rotating it only in Azure breaks subsequent uploads.

### For an infrastructure change

Edit Bicep, compile, run what-if, review, then deploy. Changing a file alone does
not change Azure: the current Actions workflow does not deploy Bicep.

### If a bad application version is deployed

Use Git history to identify the offending change. Prefer a reviewed revert
commit that triggers a normal deployment:

```bash
git revert <bad-commit-id>
git push origin main
```

Resolve any conflicts carefully. This changes code history by adding a new
commit; it is not a destructive reset. Reverting code does not undo database
changes or cloud settings. A previous Actions run can also be rerun, but its
old code must still be compatible with current database/configuration.

### Keep development and production separate

`localhost` is the app on your own machine; `famflix` is the deployed build.
Local file edits do not appear in production until pushed and deployed.
Conversely, sharing the same Supabase project means local code can still modify
production data. Use a separate test project when experimenting with risky
features or migrations.

## 24. What was changed and what was not

### Deployment-related repository changes

- [`package.json`](../package.json) and
  [`package-lock.json`](../package-lock.json): recorded the original Node `20.x`
  engine constraint.
- [`.github/workflows/azure-static-web-apps.yml`](../.github/workflows/azure-static-web-apps.yml):
  production/preview build and deployment.
- [`infra/`](../infra/): Bicep resource definitions and parameters.
- [`.gitignore`](../.gitignore): excludes local onboarding session artifacts in
  `.copilot-azure/`, alongside ignored secrets and build output.

The local ignored session directory was:

```text
.copilot-azure/sessions/a85cc517-3338-45cb-bc73-dd434d0dfb57/
```

It held readiness, plan, scaffold, deployment result, and handoff records.
Those were deployment bookkeeping, not code needed to run the app. This
committable guide is the durable learning reference; the ignored folder will
not automatically appear in a fresh Git clone.

### Configuration outside Git

- Azure resource creation, app settings, and custom-domain bindings.
- GitHub encrypted repository secrets.
- Name.com nameserver delegation and DNS records.
- Supabase Site URL, callback allowlist, provider settings, and database.
- Google OAuth configuration.

### Things we did not set up as part of this hosting work

- A VM, Docker deployment, Kubernetes cluster, or paid Azure DNS service.
- Migration of Supabase data into Azure.
- Automatic SQL migrations in GitHub Actions.
- A purchased TLS certificate or a Supabase custom auth domain.
- An automatic redirect from apex/`www` to `famflix`.
- A complete dedicated monitoring/backup/disaster-recovery system.

Knowing what is outside the deployment is important: recreating the Bicep
resources alone is not enough to recreate a fully functioning app.

## 25. Cleanup and a practice checklist

### Deleting Azure resources

**Destructive: this removes every Azure resource in the specified group. Do not
run it on production unless you intend to take the site down.**

```bash
az group delete --name rg-famflix-prod-a85c
```

The CLI asks for confirmation. Inspect the subscription and contents first:

```bash
az account show --query '{name:name,id:id}' --output json
az resource list --resource-group rg-famflix-prod-a85c --output table
```

Deleting Azure hosting does not delete Supabase data, the GitHub repository, the
domain registration, or Name.com records. Remove/adjust stale DNS and auth
allowlist entries separately, and disable the workflow if you no longer want it
trying to deploy to a deleted resource.

### A safe learning exercise

Use a separate app name, resource group, and preferably test Supabase project.
Do not point a practice deployment at the production database by accident.

- [ ] Explain which service hosts code, which stores data, and which manages DNS.
- [ ] Install tools and verify account/subscription selection.
- [ ] Run a local production build.
- [ ] Review `.gitignore` and make a private source repository.
- [ ] Adapt Bicep's hardcoded names for the practice environment.
- [ ] Compile and understand every proposed what-if change.
- [ ] Create a Free SWA and record its own generated hostname.
- [ ] Supply build/runtime configuration without committing secrets.
- [ ] Deploy through one GitHub workflow and inspect its logs.
- [ ] Test the generated Azure URL before adding a custom domain.
- [ ] Add DNS and an Azure custom-domain binding.
- [ ] Verify HTTPS without disabling certificate checks.
- [ ] Configure Supabase/Google callbacks and test a real sign-in.
- [ ] Confirm database permissions and data persistence.
- [ ] Review usage and delete only the practice resources when finished.

If you can explain each checked item in your own words, you understand the
deployment rather than merely copying commands.

## 26. Official references

These explain the concepts and are the place to check changing limits,
compatibility, pricing, and dashboard instructions:

- [Azure hybrid Next.js deployment and preview limitations](https://learn.microsoft.com/azure/static-web-apps/deploy-nextjs-hybrid)
- [Azure Static Web Apps quotas](https://learn.microsoft.com/azure/static-web-apps/quotas)
- [Azure Static Web Apps hosting plans](https://learn.microsoft.com/azure/static-web-apps/plans)
- [Custom subdomain with an external DNS provider](https://learn.microsoft.com/azure/static-web-apps/custom-domain-external)
- [Custom apex domain with external DNS](https://learn.microsoft.com/azure/static-web-apps/apex-domain-external)
- [Azure Static Web Apps application settings](https://learn.microsoft.com/azure/static-web-apps/application-settings)
- [Azure CLI installation on macOS](https://learn.microsoft.com/cli/azure/install-azure-cli-macos)
- [Bicep deployment with Azure CLI](https://learn.microsoft.com/azure/azure-resource-manager/bicep/deploy-cli)
- [GitHub Actions documentation](https://docs.github.com/actions)
- [GitHub Actions secrets](https://docs.github.com/actions/security-for-github-actions/security-guides/using-secrets-in-github-actions)
- [Supabase auth redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)
- [Supabase Google sign-in setup](https://supabase.com/docs/guides/auth/social-login/auth-google)
- [Supabase row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase SMTP configuration](https://supabase.com/docs/guides/auth/auth-smtp)
- [Node.js release lifecycle](https://nodejs.org/en/about/previous-releases)
- [TMDB API documentation](https://developer.themoviedb.org/docs)
