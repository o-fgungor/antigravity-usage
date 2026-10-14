# Antigravity Usage Monitor (GNOME Shell extension)

A GNOME Shell panel indicator that shows your Google Antigravity / Gemini subscription
tier and live usage limits. It reuses the OAuth token that the Antigravity CLI (`agy`)
already stores on disk (`~/.gemini/antigravity-cli/antigravity-oauth-token` or
`~/.gemini/oauth_creds.json`), requiring no separate login.

## Layout

The shipped extension lives in `src/`; everything else (this file, the README,
the LICENSE, `build.sh`, `tools/`) is repo tooling that stays out of the bundle.

- `src/extension.js` — panel indicator + dropdown UI (ESM, GNOME Shell 45+ style).
  `ProfileView` holds everything specific to one Antigravity profile (its `UsageClient`,
  panel block, and popup section); `AgyUsageIndicator` owns one `ProfileView` per
  configured profile, plus the shared panel icon, poll timer, and countdown.
  The panel shows the Antigravity icon once, then one block per profile: `[profile divider]
  [chip] [tier icon] [tier label] [lead divider]`, then `PanelGroup`s, each
  `[window divider] gauges… [reset countdown]`. There is one `PanelGauge` (tag,
  ring/bar, percentage) per usage window selected by `panel-windows`.
  - Dynamically renders quota windows for `Gemini Models` and `Claude and GPT models`.
  - Supports rate projection, burn rate warnings, and live reset countdowns.
  - Tier icons: `src/icons/tier-<name>-symbolic.svg`. Recolored by GNOME Shell in
    the blue accent color (`#4fa0ff`).
- `src/prefs.js` — Adwaita preferences (element toggles, "Panel reflects" window
  switches, refresh interval, and the "Antigravity profiles" list), bound to GSettings,
  on the "General" tab, plus one tab per entry of `UI_PAGES` ("Shared UI",
  "Top-Bar UI", "Popup UI") built by `lib/uiStylePage.js`. Each profile row displays
  CLI credential file status and guidance.
- `src/schemas/` — GSettings schema (`org.gnome.shell.extensions.agy-usage`).
  Keys: `show-icon`, `show-percentage`, `show-tier`, `show-tier-icon`, `show-reset`,
  `panel-gauge`, `panel-windows`, `panel-divider`, `panel-lead-divider`,
  `poll-seconds`, `panel-position`, `panel-index`, `toggle-menu`, `profiles`,
  `show-profile-chip`, `ui-style`, `profiles-initialized`.
- `src/lib/usageClient.js` — pure GI module: discovers credentials from
  `~/.gemini/antigravity-cli/antigravity-oauth-token` or `~/.gemini/oauth_creds.json`,
  and calls Google internal Cloud Code endpoints with `User-Agent: antigravity-cli`.
  Exports `antigravityCredentialsAvailable()`, `defaultConfigDir()`, and `discoverConfigDirs()`.
- `src/lib/profiles.js` — profile list management (`loadProfiles`/`saveProfiles`/
  `ensureProfiles`). Shell-import-free.
- `src/lib/uiStyle.js` — declarative table (`UI_STYLE_GROUPS`) covering every
  configurable styling property across "Shared UI", "Top-Bar UI", and "Popup UI"
  tabs. Pure Node/GJS testable without GI.
- `src/lib/uiStylePage.js` — GTK4 / Adwaita preferences page generator for UI styling.
- `src/lib/oauth.js` — shared endpoint URLs, user agent, and text codecs.
- `src/lib/usageModel.js` — pure data-shaping: parses `groups` and `buckets` from
  `retrieveUserQuotaSummary`, normalizing `remainingFraction` or `percent` into
  utilization percentages.
- `src/stylesheet.css` — CSS classes (`cu-*`) and theme defaults.
- `src/icons/` — panel icon (`agy-panel.svg`), popup mascot (`agy-mascot.png`),
  and symbolic tier SVGs (`tier-*-symbolic.svg`).
- `build.sh` — packages the extension into `dist/<uuid>.shell-extension.zip`.
- `tools/poll.js` — standalone CLI tool to poll the live Antigravity endpoint: `gjs -m tools/poll.js`.
- `tools/test-usageModel.mjs` — unit tests for data normalization under plain Node.
- `tools/test-readonly-credentials.js` — tests credentials loading and token expiry.
- `tools/test-uiStyle.mjs` — unit tests for styling definitions under plain Node.
- `tools/test-uiStylePage.js` — GTK4 in-memory tests for preferences under GJS.
- `tools/compile-schemas.sh` — compiles GSettings schemas for development.

## Data sources

- Credentials: `~/.gemini/antigravity-cli/antigravity-oauth-token` (`token.access_token`)
  or `~/.gemini/oauth_creds.json` (`access_token`).
- Usage Summary: `POST https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary`.
  Returns `groups[]` with `buckets[]` containing `remainingFraction` and `resetTime`.
  **CRITICAL**: Requires `User-Agent: antigravity-cli` on all requests to `cloudcode-pa.googleapis.com`.
  Requests without this header are rejected with `HTTP 403 PERMISSION_DENIED (license #3501)`.
- Tier Information: `POST https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist`.
- Refresh: When an access token expires or is within 5 minutes of expiring, `UsageClient` automatically refreshes it via Google's OAuth token endpoint (`TOKEN_URL`) using the stored `refresh_token` and updates the credential file in place, preventing session-expired errors on startup.

## Conventions

- All file I/O uses async variants (`_async`) to avoid blocking the GNOME Shell main loop.
- `usageClient.js` and `usageModel.js` remain free of `resource:///org/gnome/shell`
  imports so they can run under plain `gjs` and `node`.
- Never pin a GI version (`import Soup from 'gi://Soup'`).
- Teardown rules: use `connectObject(..., this)`, destroy widgets explicitly, and null references.

## Install (development)

```sh
ln -s "$PWD/src" ~/.local/share/gnome-shell/extensions/agy-usage@o-fgungor.github.io
git config core.hooksPath tools/git-hooks
./tools/compile-schemas.sh
gnome-extensions enable agy-usage@o-fgungor.github.io
```

## Release

`./build.sh` packs `src/` into `dist/<uuid>.shell-extension.zip` for upload to extensions.gnome.org.
