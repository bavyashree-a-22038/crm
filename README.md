# Mini CRM

A small, framework-free CRM interface that will connect to a user's real Zoho CRM organization. Express serves the static HTML/CSS/JavaScript frontend and owns all OAuth and CRM API communication, so Zoho credentials and tokens never enter browser JavaScript.

This checkpoint implements project setup, Zoho OAuth, dynamic modules and metadata, record listing, search, pagination, metadata-driven record CRUD, and live module analytics.

## Architecture

```text
Browser (frontend/) -> Express routes (backend/) -> Zoho Accounts / CRM APIs
															|
											-> Catalyst Data Store sessions in production
```

The browser receives only an opaque, HTTP-only session cookie. Access and refresh tokens are stored in the server-side session. Local development uses Express's in-memory session store. AppSail production uses Catalyst Data Store so instances do not depend on local files or process memory for OAuth state.

## Project structure

```text
backend/
	config.js                   Environment parsing and production checks
	server.js                   Express app, security headers, sessions, static files
	middleware/errorHandler.js  JSON 404 and error responses
	middleware/auth.js          Auth guard and session-bound CRM client factory
	routes/auth.js              Login, callback, status, and logout routes
	routes/analytics.js         Authenticated module analytics endpoint
	routes/modules.js           Read-only module and field metadata endpoints
	routes/records.js           Record list, search, detail, and mutation endpoints
	services/tokenStore.js      Catalyst Data Store or local session store
	services/zohoAnalyticsService.js Bounded record and metadata aggregation
	services/zohoAuthService.js Zoho authorization, token, refresh, and revoke calls
	services/zohoCrmService.js  Authenticated V8 requests with refresh and retry
	services/zohoMetadataService.js Module filtering and dynamic field selection
	services/zohoRecordService.js Record validation, CRUD, search, and pagination
frontend/
	index.html                  Phase 2 application shell
	css/styles.css              Responsive CRM styling
	js/api.js                   Internal backend API client
	js/analytics.js             Module analytics loading and rendering
	js/auth.js                  Authentication API methods
	js/modules.js               Dynamic module API and sidebar controller
	js/recordForm.js            Metadata-driven create and edit form
	js/records.js               Records table, CRUD requests, search, and pagination
	js/ui.js                    Authentication view rendering
	js/app.js                   Browser entry point
app-config.json               Catalyst AppSail managed-runtime configuration
```

## Local setup

1. Create a **Server-based Application** in the [Zoho API Console](https://api-console.zoho.com/).
2. Register this exact development callback URL: `http://localhost:3000/api/auth/callback`.
3. Copy `.env.example` to `.env` and fill in `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, and a long random `SESSION_SECRET`.
4. Select the Accounts and API domains for the data center where the client is registered. The defaults are the US domains.
5. Install and start:

```sh
npm install
npm start
```

Open `http://localhost:3000`. The app requests offline access so Zoho can issue a refresh token. Zoho only returns a refresh token under the documented consent conditions; `prompt=consent` is included for this development flow.

## OAuth flow

1. The browser opens `/api/auth/login`.
2. Express creates a random, short-lived `state` value in the server session and redirects to the configured Zoho Accounts domain.
3. The user approves the requested CRM scopes and Zoho redirects to `/api/auth/callback` with a one-time code, `state`, and its data-center-specific Accounts server.
4. Express validates `state` and exchanges the code directly with Zoho. The response's access token, refresh token, Accounts URL, expiry, and `api_domain` stay in the server-side session.
5. The browser receives only the session cookie. `/api/auth/me` retrieves the current CRM user through Zoho and returns only allowlisted profile fields.
6. Later CRM requests use the stored `api_domain` and the `Zoho-oauthtoken` authorization header on the backend. Expired access tokens are refreshed and saved back to the same server session.
7. Signing out revokes the refresh token with Zoho and destroys the server session.

The requested scopes are:

- `ZohoCRM.modules.ALL` for record read, create, update, and delete operations.
- `ZohoCRM.settings.ALL` for module, field, and layout metadata.
- `ZohoCRM.users.READ` for authenticated user information returned by `/api/auth/me`.
- `ZohoCRM.coql.READ` for supported filtering/query work in a later phase.
- `ZohoSearch.securesearch.READ` for the V8 Search Records API.

These scopes grant API capability but do not override the signed-in user's CRM permissions.

If a user authorized the application before `ZohoSearch.securesearch.READ` was added, sign out and authorize again so Zoho can grant the additional scope.

## CRM API flow

The frontend calls only the Express API:

- `GET /api/modules` returns modules whose Zoho metadata says they are visible, viewable, and API-supported.
- `GET /api/modules/:module` returns normalized metadata for one accessible module.
- `GET /api/modules/:module/fields` returns its visible field metadata.
- `GET /api/records/:module` retrieves a field-selected record page using `page`, `per_page`, or the documented `page_token` continuation.
- `GET /api/records/:module/search` uses Zoho's `word` search when `global_search_supported` is true for that module.
- `GET /api/records/:module/:recordId` retrieves one metadata-filtered record for editing.
- `POST /api/records/:module` creates one record after module and field validation.
- `PUT /api/records/:module/:recordId` updates allowlisted editable fields.
- `DELETE /api/records/:module/:recordId` deletes a record when module metadata permits it.
- `GET /api/analytics/:module` returns sampled record activity, completeness, a six-month creation trend, category distribution, and a populated numeric-field summary for one accessible module.

Analytics uses visible field metadata and samples at most the first 200 records in the selected module. The response explicitly marks the sample as partial when Zoho reports more records. This keeps requests bounded and avoids presenting a page count as an organization-wide total.

On module selection, the browser fetches module metadata and fields, then requests records. The backend chooses up to ten visible, non-complex fields for the table and sends at most the documented 50 field API names to Zoho. Labels, API names, columns, and values all come from Zoho responses; no application CRM records are bundled.

Create and edit forms are generated from visible Zoho field metadata. The backend independently checks module capabilities, field API names, per-operation editability, supported value types, maximum lengths, picklist values, and system-mandatory fields before sending a mutation. Unsupported complex fields remain read-only. Zoho remains authoritative for layout-specific mandatory rules and organization validation rules that are not included in the Fields Metadata response.

Access tokens are checked before every Zoho request. An expiring token is refreshed proactively. If Zoho returns `401`, the backend refreshes and retries the request once. Permission, scope, rate-limit, validation, and upstream errors are returned as controlled internal API responses rather than terminating Express.

## Catalyst AppSail deployment

The checked-in `app-config.json` uses the Catalyst-managed Node.js 18 stack, runs `npm start`, and builds from the repository root. Express listens on `process.env.X_ZOHO_CATALYST_LISTEN_PORT` and `0.0.0.0`, with local and production fallbacks.

1. In the Catalyst console, create a Data Store table named `MiniCrmSessions` with these custom columns:

```text
SESSION_ID    Var Char  Unique and mandatory
SESSION_DATA  Text      Mandatory
EXPIRES_AT    BigInt    Mandatory
```

The SDK supplies system columns such as `ROWID`; do not create them manually. Create the table in every Catalyst environment where AppSail will run.

2. Connect the repository and `catalyst-crm` branch to AppSail, using the repository root as the build path. Keep the existing `app-config.json`.
3. Configure `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REDIRECT_URI`, `ZOHO_ACCOUNTS_URL`, `ZOHO_CRM_API_URL`, `SESSION_SECRET`, `SESSION_TABLE=MiniCrmSessions`, `TRUST_PROXY=true`, and `APP_ENV=production` as AppSail environment variables. Do not set `PORT`; AppSail supplies it. Do not put secret values in `app-config.json` or commit `.env`.
4. Register the deployed HTTPS callback URL in the Zoho API Console and use that exact value for `ZOHO_REDIRECT_URI`.
5. Deploy the AppSail service and verify `/api/health` returns `{"status":"ok"}`.

AppSail injects Catalyst project and admin credentials into each request. The session store initializes the official Node SDK from those request headers. The application stores only server-side login sessions in Data Store; CRM records remain authoritative in Zoho CRM.

## Validation

```sh
npm run check
npm test
```

A complete real OAuth round trip requires valid Zoho client credentials and a callback URL registered for that client. No CRM data is mocked.

## Official references

- [Zoho CRM API V8](https://www.zoho.com/crm/developer/docs/api/v8/)
- [Zoho CRM OAuth authorization](https://www.zoho.com/crm/developer/docs/api/v8/auth-request.html)
- [Generate access and refresh tokens](https://www.zoho.com/crm/developer/docs/api/v8/access-refresh.html)
- [Refresh access tokens](https://www.zoho.com/crm/developer/docs/api/v8/refresh.html)
- [Zoho CRM scopes](https://www.zoho.com/crm/developer/docs/api/v8/scopes.html)
- [Catalyst AppSail](https://docs.catalyst.zoho.com/en/cloud-scale/help/app-sail/introduction/)
