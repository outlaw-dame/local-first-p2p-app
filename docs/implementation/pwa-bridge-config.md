# PWA bridge config boundary

The PWA has a guarded bridge configuration boundary for future sync transport work. This boundary parses configuration state and can prepare a transport object behind explicit guards. It can also attach a development-only bearer value to bridge requests when manually enabled.

The bridge service now also exposes an optional server-side HTTP bearer-auth boundary for delivery and inbound-read handlers. That boundary is still a shared-token development/testing gate, not production credential issuance, device-bound authorization, revocation, or abuse protection.

This still does not add automatic outbox delivery, inbound pulls, service worker sync, background sync, push delivery, production credential storage, production authorization, rate limiting, or token lifecycle management.

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
  - Optional development-only bridge auth value used by the PWA transport wrapper.
  - Accepted only when `import.meta.env.DEV === true`.
  - Rejected outside true Vite dev runtime, even when `MODE=development`.
  - The PWA parser rejects whitespace/control characters and values longer than 4096 characters.
  - For bridge-service compatibility, use printable ASCII non-space values only.

## Bridge-service HTTP auth boundary

Bridge-service HTTP handlers accept an optional `BridgeHttpHandlerOptions` argument. Build this option only after resolving the server-side secret value:

```ts
const bridgeAuthToken = process.env.LFP2P_BRIDGE_AUTH_BEARER_TOKEN;
const bridgeHandlerOptions =
  bridgeAuthToken === undefined
    ? {}
    : { auth: { scheme: 'bearer' as const, token: bridgeAuthToken } };

await handleBridgeDeliveryRequest(service, request, now, bridgeHandlerOptions);
await handleBridgeInboundReadRequest(service, request, now, bridgeHandlerOptions);
```

When auth is configured:

- `Authorization: Bearer <token>` is required for `POST` delivery and inbound-read requests.
- The authorization scheme is accepted case-insensitively.
- Missing, malformed, unsafe, or incorrect credentials return `401` before JSON body parsing.
- Invalid server-side auth configuration returns `503` with a generic reason.
- Response bodies do not echo the configured token or presented token.
- The token must be non-empty, printable ASCII only, contain no spaces/control/non-ASCII characters, and be no longer than 4096 characters.
- For equal-length tokens, the comparison avoids early content exit across token bytes; unequal byte lengths fail before the comparison loop.
- The shared token itself is still only a development/testing boundary.

When auth is omitted, handlers preserve existing local/dev behavior and remain unauthenticated. Do not expose an unauthenticated bridge service beyond local development.

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
- Server-side shared-token auth is not a substitute for production issuance, rotation, revocation, device-bound grants, request budgets, or abuse controls.

## Future transport requirements

Before production bridge transport is enabled, the implementation must add production authorization, token issuance/rotation/revocation, client delivery budgets, rate limits, retry/error surfaces, privacy boundaries, and observability. Outbox delivery and inbound pull should remain separate from this parser so configuration validation can stay small, deterministic, and independently tested.
