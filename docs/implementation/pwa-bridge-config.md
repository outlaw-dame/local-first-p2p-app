# PWA bridge config boundary

The PWA has a guarded bridge configuration boundary for future sync transport work. This boundary parses configuration state and can prepare a transport object behind explicit guards. It can also attach a development-only bearer value to bridge requests when manually enabled.

This still does not add automatic outbox delivery, inbound pulls, service worker sync, background sync, push delivery, production credential storage, or server-side authorization enforcement.

## Environment variables

- `VITE_LFP2P_BRIDGE_SYNC_ENABLED`
  - Must be explicitly `true`, `1`, or `yes` before any bridge endpoint is considered.
  - Any other value keeps the boundary disabled.
- `VITE_LFP2P_BRIDGE_ENDPOINT`
  - Required only when bridge sync is explicitly enabled.
  - Must be an absolute `https:` URL, except local development may use `http://localhost`, `http://127.0.0.1`, or `http://[::1]`.
  - Must not include username, password, query string, or fragment.
- `VITE_LFP2P_BRIDGE_TARGET`
  - Optional. Defaults to `bridge:development`.
  - Limited to letters, numbers, colon, dot, underscore, and dash. Must start with a letter or number.
- `VITE_LFP2P_BRIDGE_TIMEOUT_MS`
  - Optional. Defaults to `10000`.
  - Must be a positive integer no greater than `60000`.
- `VITE_LFP2P_BRIDGE_AUTH_BEARER_TOKEN`
  - Optional development-only bridge auth value.
  - Accepted only when `import.meta.env.DEV === true`.
  - Rejected outside true Vite dev runtime, even when `MODE=development`.
  - Must not contain whitespace or control characters.
  - Must be 4096 characters or fewer.

## Safety boundaries

- Configuration parsing and transport preparation are not automatic delivery wiring.
- The resolved config reports `transportWired: false` when configured.
- Secrets must not be placed in endpoint URLs.
- Query strings and fragments are rejected to avoid accidental leakage.
- Insecure remote HTTP endpoints are rejected.
- The UI only displays a redacted host-level status and never displays the bearer value.
- The bearer value is attached only as a request header during explicit transport sends.
- Fetch still uses `credentials: 'omit'`; cookies are not introduced.
- Client-side Vite env values are not production secrets. This boundary is for local/dev bridge validation only.

## Future transport requirements

Before production bridge transport is enabled, the implementation must add server-side authorization checks, token issuance/rotation/revocation, client delivery budgets, rate limits, retry/error surfaces, privacy boundaries, and observability. Outbox delivery and inbound pull should remain separate from this parser so configuration validation can stay small, deterministic, and independently tested.
