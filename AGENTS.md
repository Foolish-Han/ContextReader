# Context Reader contributor instructions

## Product contract

- The product helps readers regain understanding of English articles while retaining optional learning and contextual history.
- Match/hover/history actions read saved knowledge and never infer. Explicit explain/regenerate actions may call the selected model.
- Ordinary HTTP/HTTPS sites start enabled. Per-origin opt-outs persist and update all matching tabs; never overwrite them when saving model settings.
- Known, collected or hovered does not mean mastered. Separate common meanings, current context and historical contexts.
- New context adds history. Regeneration bypasses cache and replaces the selected context only after success; preserve previous content on failure and preserve human edits.
- Background jobs are persisted before dispatch, concurrency is two, quick explanations take priority and at most one learning request runs. Closing a page is not cancellation. Never silently replay an unconfirmed request after worker/browser termination.

## Boundaries

- UI: `src/ui/`; page matching/anchoring: `src/content/`; inference/tasks/sync: `src/background/`; knowledge persistence/merge: `src/shared/`.
- `dist/`, generated auth runtimes, browser profiles, test-results and release archives are ignored build/runtime artifacts.
- Use the root `dist` for daily development. Run `npm run build`, reload the extension, and refresh articles. Do not copy builds into historical release folders.
- Keep `extension/public-key.json` stable: it fixes extension ID `hndhiknbifkbmpebjflifdecfpcliddd` and its storage/OAuth origins. A public extension key and Google client ID are application identifiers, not secrets.
- Google appDataFolder sync excludes credentials, tasks, appearance and site settings. Never claim a successful upload before Google acknowledges it.
- Content scripts may request only appearance through `CR_APPEARANCE`; do not relax `TRUSTED_CONTEXTS` access to credential storage.
- ChatGPT token plaintext stays in worker memory. Persist credentials only as AES-GCM ciphertext in the extension-origin IndexedDB vault with its nonextractable Web Crypto key; keep this vault separate from knowledge, exports and sync. Pending authorization stays in TRUSTED_CONTEXTS-restricted chrome.storage.session. Resume valid login across browser restarts; do not replay an uncertain refresh. No native helper, inference forwarding, Codex use or credential logging.
- Do not initiate, revoke or reset a real person's authorization for tests. Live tests are manual, optional and outside CI.

## UI

- Use Radix color scales and Lucide; keep four text sizes (14/16/20/44px), 0.5px borders and a shared component vocabulary.
- Literata is the English word face, Noto Serif SC the Chinese reading face; Inter handles IPA and Geist/Noto Sans SC controls.
- The article card has exactly one body scroll area. Keep header dismissal visible, preserve expanded cards on resize and preserve drafts/focus/scroll on background updates.
- Keep learning details initially open. Show British/American IPA separately; never relabel one old IPA as both accents.
- Respect reduced motion/transparency, support keyboard focus/tabs and avoid theme-transition contrast flashes.
- Skip DOM replacement for unchanged reading markup: background notifications must not detach a pressed submit button or reset manually collapsed details.
- No decorative gradients, repeated marketing copy, or middle-dot separators.

## Delivery

- Read `docs/development.md`, `CONTRIBUTING.md` and the relevant source before changing behavior.
- Prefer existing dependencies. Keep vendored skill source/provenance/licenses unchanged.
- The root MIT license does not relicense the noncommercial DevKit or modifications incorporated into its runtime. Preserve all notices and document adaptation changes.
- Run the narrow checks the change needs; then the required CI gates. Browser tests use isolated profiles and synthetic services. Keep human-confirmed service behavior separate from mocks.
- Run `npm run verify:repo` before publication. Never stage private discovery notes, historical personal screenshots, credentials, browser profiles or exports.
- GitHub Releases are built from clean tracked source plus generated distribution files, with a checksum and version/client-ID checks. Never upload a historical local ZIP without re-auditing it.
