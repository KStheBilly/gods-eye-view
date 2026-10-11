# Your private God's Eye View online

This fork includes a hosted Node server that serves the built globe and the
original live-data providers behind a private login. It retains the visual
styles, cockpit, tracking, layers, scenes, drawing, weather and API-key voice
paths. Optional services become available when you supply their credentials.
No provider credentials are included.

Use a **Web Service**, because live ships, camera playback and other feeds need
a running backend. Uploading only `dist` to a static host omits those providers.
The hosted entry point is `npm start` (`server/hosted/start.js`); Vite's dev and
preview commands remain local tools.

## Private online link from a Windows PC (no card)

This copy includes **Start My Gods Eye View.cmd** and **Stop My Gods Eye View.cmd**.
Start launches the full server and a Cloudflare Quick Tunnel in the background,
then opens the private login and your local access details. Stop closes only the
two processes recorded by this launcher. Closing the browser does not stop them.
No Windows service, startup task or firewall rule is installed.

The link works while the PC is awake and connected. Each new tunnel has a new
address. Your password persists in `output/private-link/password.txt`; the
current URL and password are saved in `output/private-link/Your online access.txt`.
These files are excluded from Git and restricted to your Windows account.
Keep the access file private. Restarting the app signs existing sessions out.

For a fresh copy, install Node 24.14+ (24.x) or Node 26, run `npm ci --include=dev`
and `npm run build`, then download the official Windows 64-bit
[cloudflared executable](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/downloads/)
to `output/tools/cloudflared.exe`. The launcher also recognizes Codex's bundled
Node runtime. PowerShell users can pass explicit paths:

```powershell
./scripts/private-link.ps1 -NodePath 'C:\path\node.exe' -CloudflaredPath 'C:\path\cloudflared.exe'
```

The app listens only on `127.0.0.1:4180`, and the tunnel supplies HTTPS. The same
password gate protects the page and all provider APIs. Your code, password,
local setup endpoints and local files are not published by the tunnel.

Put optional server provider keys in the ignored `.env.hosted.local` file, then
Stop and Start. For browser tokens, set the values in `.env.local`, rebuild with
`npm run build`, and restart; Mapillary needs its token in both files. Restrict
browser tokens to the current tunnel hostname and update that restriction when
the hostname changes. A stable domain on a named tunnel is a separate setup.

[Cloudflare Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)
are temporary development links without an uptime guarantee, with a limit of
200 concurrent requests and no Server-Sent Events support. This app uses normal
HTTP polling for its hosted feeds; the AIS connection originates on the server.

## Deploy with Render

1. Put this fork, including `render.yaml`, in your own GitHub repository.
2. In the [Render dashboard](https://dashboard.render.com/), choose **New →
   Blueprint**, connect your repository and select the branch containing these
   changes. The supplied Blueprint creates one Node web service in Singapore.
3. Review the service before creating it. The supplied compute plan is explicitly
   **Free**. It does not create paid databases or disks. Account usage charges
   and external API usage are separate from that compute-plan choice.
   Render may still require card verification for the account; use the PC option
   above if you do not want to provide a card.
4. Wait for the build and health check to pass. Open the HTTPS address shown by
   Render. The app automatically uses Render's `RENDER_EXTERNAL_URL` as its
   public origin.
5. In the service's **Environment** settings, reveal the generated
   `GEV_ACCESS_PASSWORD` and use it at the private login screen. Store it in your
   password manager. Anyone who knows this password can use the configured
   provider accounts through this instance.
6. Start with the keyless globe. Add desired provider values in Render's
   **Environment** settings using the table below, then redeploy.

The Blueprint uses Node 24.19.0, `npm ci --include=dev && npm run build`,
`npm start`, and the `/healthz` health check. Chromium download is skipped during
installation. Development dependencies are currently needed by the build and
some provider modules, so do not change the install to `--omit=dev`.
Render documents these settings in its [Blueprint reference](https://render.com/docs/blueprint-spec)
and [Node version guide](https://render.com/docs/node-version).

### What the free plan means

Treat this as a personal trial. Render's free service sleeps after 15 minutes
without incoming traffic, and waking can take about a minute. Restarts clear
in-memory ship history, camera sessions and local caches. Free instances cannot
attach persistent disks. Heavy outbound API traffic can trigger suspension;
bandwidth and build allowances also apply, with possible charges when a payment
method is present. Check your account limits before prolonged use.
See [Render's free-service limits](https://render.com/docs/free).

For reliable continuous operation, choose a paid always-on compute plan with
enough memory after deciding on a budget. Keep **one instance**: the existing
feed caches, session signing key and HLS leases are process-local. This fork
does not coordinate multiple replicas. A running server preserves state between
requests, but its current live history is not durable across restarts.

## Enable the provider features

Set values in the hosting provider's environment settings, or `.env.hosted.local`
for the PC launcher (browser tokens also require `.env.local` and a rebuild).
Do not paste private
keys into chat, source code, the Blueprint or Docker build arguments. The
hosted app intentionally does not offer the local credential-writing panel.

| Feature                                             | Environment variable                                                    | Where used / when to deploy                                                                |
| --------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Photorealistic 3D, ion imagery and world terrain    | `CESIUM_ION_TOKEN`                                                      | Browser token; rebuild after setting or changing                                           |
| Direct Google 3D and Google geocoding               | `GOOGLE_MAPS_API_KEY`                                                   | Browser token; rebuild after setting or changing                                           |
| Google Places and Street View fallback              | `GOOGLE_MAPS_SERVER_API_KEY`                                            | Private server key; restart after changing; otherwise falls back to the Google browser key |
| Realtime voice and AI HUD summaries                 | `OPENAI_API_KEY`                                                        | Private server key; restart after changing                                                 |
| Live global ships                                   | `AISSTREAM_API_KEY`                                                     | Private server key; restart after changing                                                 |
| Live active fires                                   | `FIRMS_MAP_KEY`                                                         | Private server key; restart after changing                                                 |
| Live traffic-flow speeds and congestion colors      | `TOMTOM_API_KEY`                                                        | Private server key; restart after changing                                                 |
| Mapillary street-level coverage and photos          | `MAPILLARY_CLIENT_TOKEN`                                                | Public client token; rebuild and provide the same value at runtime for the coverage proxy  |
| Higher flight-polling allowance                     | `OPENSKY_CLIENT_ID`, `OPENSKY_CLIENT_SECRET`, `OPENSKY_AUTH_MODE=oauth` | Private server credentials; optional; restart after changing                               |
| Higher launch-data allowance                        | `LL2_API_TOKEN`                                                         | Private server token; optional; restart after changing                                     |
| Detailed OpenStreetMap feature and boundary queries | `OVERPASS_UPSTREAMS`                                                    | Server-only comma-separated endpoints you operate or pay for; restart after changing       |

On Render, choose the option that rebuilds and deploys after changing a browser
token. Merely restarting an existing build does not update the bundled token.
Server-only changes need a new running process; rebuilding is also safe.

Get credentials and review provider terms through the links in the upstream
[API key guide](../README.md#-api-keys) and the tracked [environment template](../.env.example).
Use domain-restricted Google and Cesium browser tokens, with the minimum API or
asset permissions needed. These tokens are visible in the browser by design.
Set provider quotas and usage limits for metered services. An app password and
the built-in rate limits do not replace those limits.

Without optional keys, the app starts with keyless imagery and public feeds.
Ships, FIRMS fires, Mapillary photos and AI voice are unavailable until their
providers are configured. Without TomTom, moving traffic is a simulation.
Google or Cesium credentials are needed for the photorealistic 3D upgrade.
Provider coverage, quotas and outages still apply after adding credentials;
"all features" does not mean every geographic area has live data.

Detailed OSM queries use your configured Overpass service. Ordinary keyless
traffic, mapped-installation tiles and ALPR extracts do not need that service.
The Nepal flood scene includes non-commercial datasets; keep their attribution
and respect the terms in [DATA_SOURCES.md](../DATA_SOURCES.md).

## Hosted access and custom domains

`GEV_ACCESS_PASSWORD` must contain at least 20 characters. Render generates a
long random value on first creation. Rotating it and restarting the service
changes the login password. Sessions expire after 12 hours and a restart signs
everyone out.

The hosted server requires one exact HTTPS public origin: either set
`GEV_PUBLIC_ORIGIN=https://your-domain.example` or let it use
`RENDER_EXTERNAL_URL`. For a custom domain, first add and verify the domain in
the hosting dashboard, then set `GEV_PUBLIC_ORIGIN` to that domain and redeploy.
Update the allowed URLs on browser-token accounts too. Use the configured
origin for login and for shared view links.

The login uses a Secure, HttpOnly, SameSite cookie. The `/healthz` endpoint is
public and only reports whether the process is running; it does not validate
all external feeds. The rest of the app and its data routes require a session.
Hosted mode refuses local setup, Codex OAuth, MCP, voice debug-log and local
receiver endpoints. Use an OpenAI API key for hosted voice. Remote local-device
integration is not implemented by this deployment.

Share links reproduce a view but do not bypass login. This is one private
instance with one shared password, rather than an account system with individual
users or per-user provider keys. For broader public access, add a reviewed
identity and account system before sharing access widely. See the upstream
[security model](../SECURITY.md) for provider-specific restrictions.

## Run the container on another host

The supplied Dockerfile builds with Node 24.19.0 and runs the hosted server as
the unprivileged `node` user. It includes the provider source data as well as
`dist`. The Docker context excludes dotenv files, Codex credentials and local
logs. Pass secrets at **runtime** using your host's secret manager or an ignored
environment file.

Build a keyless image:

```sh
docker build -t my-gods-eye-view .
```

To enable browser providers, pass only the three intentionally public tokens
as build arguments: `GOOGLE_MAPS_API_KEY`, `CESIUM_ION_TOKEN` and
`MAPILLARY_CLIENT_TOKEN`. Rebuild the image whenever one changes. Private keys
and `GEV_ACCESS_PASSWORD` must never be supplied as build arguments.

Run behind your host's HTTPS endpoint with `GEV_PUBLIC_ORIGIN`, a strong
`GEV_ACCESS_PASSWORD`, and optional provider keys set in the runtime environment.
The container listens on port `10000` by default; `PORT` can override it. Keep
the underlying HTTP port private behind the HTTPS proxy. The health check uses
`/healthz`. Persistent storage is optional for caches, but mounting a directory
alone does not make in-memory ship history or camera sessions durable.

The native Render Blueprint does not use Docker. The
container is an alternative for hosts that already support it; it does not
provision a hosting account, TLS endpoint, domain or provider subscriptions.
