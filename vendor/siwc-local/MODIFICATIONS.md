# Context Reader adaptation of the OpenAI Sign-in DevKit

Upstream source files in `upstream/` are unmodified and pinned in UPSTREAM.json. Their upstream noncommercial license and notices are retained. This integration is for the user's personal local reading app.

`scripts/build-auth.mjs` adds one privileged method, `acquireAccessToken(expectedProfileId)`, to the local runtime. It calls the existing authenticated refresh/identity path, verifies the expected active profile, and returns only its access token to the extension service worker through an origin-restricted loopback endpoint. No ID token or refresh token is sent to the browser. The access token is used only in worker memory, never browser storage or renderer messages. Responses/model requests go directly from the extension worker to OpenAI.

Windows credential encryption uses DPAPI CurrentUser. Registration, identity, refresh, nonce, PKCE, callback checks, atomic encrypted storage, interprocess locking and revocation retain the upstream implementation. The helper has no inference endpoint, invokes no Codex CLI, and does not import the Codex SDK.

## 2026-10-31: browser OAuth adaptation

The Node helper, Windows DPAPI adapter, `scripts/build-auth.mjs` and generated privileged runtime are no longer part of the product. The upstream files, provenance and licenses remain unchanged for audit and upstream tests. Historical adaptation notes above describe the removed implementation.

`src/background/oauth.mjs` adapts this OAuth flow for the Chrome extension and retains the same noncommercial license. It replaces the native callback listener with a `webRequest` observer restricted to the exact pending tab and loopback URL; retains state, PKCE, nonce, JWKS/signature, issuer/audience and selected-subject validation; saves issued registration before code exchange; and stores refresh/ID credentials only in TRUSTED_CONTEXTS-restricted `chrome.storage.session`. Access tokens remain in worker memory. Interrupted one-time exchanges/refreshes are never replayed. No native process, inference proxy, Codex credentials or CLI is used. Actual Chrome navigation is tested with synthetic OAuth/JWKS; real OpenAI authorization remains manual and unverified by these tests.

## 2026-10-31: persistent browser login

The browser adaptation now encrypts access/refresh/ID credentials in an extension-origin IndexedDB vault using AES-GCM and a nonextractable Web Crypto key. Token plaintext is used only in worker memory; no credentials enter knowledge exports, Drive, local/session storage or renderer RPCs. Prior session credentials migrate to this vault. Browser restart restores valid access without early refresh; expired access uses the retained rotating grant. A persisted refresh marker prevents uncertain replay, and a persisted encrypted successor permits identity-verification recovery without repeating a consumed grant. Sign-out clears credentials while retaining the account/client mapping. Pending sign-in still uses session storage. The native listener, scripts and credential helper remain removed. This adaptation retains the same noncommercial license; the upstream source and provenance are unchanged.
