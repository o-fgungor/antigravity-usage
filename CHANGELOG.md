# Changelog

All notable changes to Antigravity Usage Monitor are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

## 1.0.0 - 2026-10-14

Initial release of Antigravity Usage Monitor, adapted from Claude Code Usage Monitor for Google Antigravity CLI and Google AI subscriptions.

### Added
- Panel indicator with a custom Antigravity icon, usage gauge (circular ring, horizontal bar, or none), usage percentage, time-until-reset countdown, and subscription tier badge (`Google AI Pro`, `Ultra`, etc.).
- Dropdown menu showing reported rolling quota windows for Gemini Models and Claude/GPT models, reset countdowns, rate projection, and account details.
- Integration with Google Cloud Code internal quota endpoint (`retrieveUserQuotaSummary`) with proper `User-Agent: antigravity-cli` routing.
- Credential discovery reading Antigravity CLI credentials from `~/.gemini/antigravity-cli/antigravity-oauth-token` or `~/.gemini/oauth_creds.json`.
- Multiple profile support to track multiple Antigravity configurations side by side.
- Comprehensive UI customization with "Shared UI", "Top-Bar UI", and "Popup UI" tabs in preferences to customize colors, font sizes, gauge geometry, padding, and dividers.
- Standalone validation tooling (`tools/poll.js`, `tools/test-usageModel.mjs`, `tools/test-readonly-credentials.js`, `tools/test-uiStyle.mjs`, `tools/test-uiStylePage.js`).
