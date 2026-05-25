# PWA bridge config boundary

The PWA has a guarded bridge configuration boundary for future sync transport work. This slice only parses and displays configuration state. It does not send pending outbox entries, pull inbound records, create a bridge transport, or attach credentials.

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
  - Limited to letters, numbers, colon, dot, underscore, and dash.
- `VITE_LFP2P_BRIDGE_TIMEOUT_MS`
  - Optional. Defaults to `10000`.
  - Must be a positive integer no greater than `60000`.

## Safety boundaries

- Configuration parsing is not transport wiring.
- The resolved config reports `transportWired: false` when configured.
- Secrets must not be placed in endpoint URLs.
- Query strings and fragments are rejected to avoid accidental token leakage.
- Insecure remote HTTP endpoints are rejected.
- The UI only displays a redacted host-level status for configured endpoints.

## Future transport requirements

Before actual bridge transport is enabled, the implementation must add explicit authentication, rate-limit, retry, error-surface, and privacy boundaries. Outbox delivery and inbound pull should remain separate from this parser so configuration validation can stay small, deterministic, and independently tested.
