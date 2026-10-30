# Context Reader adaptation of the OpenAI Sign-in DevKit

Upstream source files in `upstream/` are unmodified and pinned in UPSTREAM.json. Their upstream noncommercial license and notices are retained. This integration is for the user's personal local reading app.

`scripts/build-auth.mjs` adds one privileged method, `acquireAccessToken(expectedProfileId)`, to the local runtime. It calls the existing authenticated refresh/identity path, verifies the expected active profile, and returns only its access token to the extension service worker through an origin-restricted loopback endpoint. No ID token or refresh token is sent to the browser. The access token is used only in worker memory, never browser storage or renderer messages. Responses/model requests go directly from the extension worker to OpenAI.

Windows credential encryption uses DPAPI CurrentUser. Registration, identity, refresh, nonce, PKCE, callback checks, atomic encrypted storage, interprocess locking and revocation retain the upstream implementation. The helper has no inference endpoint, invokes no Codex CLI, and does not import the Codex SDK.
