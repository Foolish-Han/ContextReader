# Third-party licenses and scope

The root MIT license covers independently authored Context Reader code and documentation. It does not relicense the separately licensed materials below.

## ChatGPT sign-in component: noncommercial

`vendor/siwc-local/` contains the OpenAI Sign-in with ChatGPT DevKit, pinned at commit `0a36fefeb913055c8c7a1a29b63d82b96b2e841a`.

- Original source, license, attribution, provenance and change notices are retained in that directory.
- The DevKit and the browser OAuth adaptation in `src/background/oauth.mjs` are governed by the [Sign-in with ChatGPT DevKit Noncommercial License v1.0](vendor/siwc-local/LICENSE).
- The former Node helper, DPAPI adapter and injected `acquireAccessToken` runtime have been removed. The browser adaptation retains OAuth protocol and identity checks with an encrypted extension-origin IndexedDB vault and callback observation.
- Independently authored extension UI, API Key integration and task/sync code remain under the root MIT license.
- The complete distribution includes this noncommercial component. **Do not interpret the repository's MIT license as commercial-use permission for the DevKit or complete bundled distribution.** Commercial use of that component requires separate permission under its license.

The authentication component and its changes are documented in [MODIFICATIONS.md](vendor/siwc-local/MODIFICATIONS.md). The license grants no service access or trademark rights.

## Other dependencies

| Material | License | Preserved notice |
| --- | --- | --- |
| OpenAI JavaScript SDK | Apache-2.0 | `dist/licenses/openai-APACHE-2.0.txt` after build |
| Radix Colors | MIT | `dist/licenses/radix-colors-MIT.txt` after build |
| Lucide icons, including the book mark | ISC | `dist/licenses/lucide-ISC.txt` after build |
| Geist, Inter, Literata, Noto Sans SC, Noto Serif SC | SIL Open Font License | `dist/fonts/*-LICENSE` after build |
| jose, proper-lockfile, fflate (development ZIP tooling) and transitive npm dependencies | Their package licenses | Installed with the pinned `package-lock.json`; notices travel with the npm packages |
| PM skills | MIT | `.agents/vendor/pm-skills-LICENSE` |
| Frontend design skill | Apache-2.0 | `.agents/skills/frontend-design/LICENSE.txt` |

Do not remove font or runtime notices from a release. `dist/` is a generated build and is distributed through GitHub Releases rather than committed to the source repository.

## Brand and article material

`extension/icons/chatgpt.svg` is a ChatGPT sign-in brand asset. Its separate terms are described in [CHATGPT-BRAND-NOTICE.txt](extension/icons/CHATGPT-BRAND-NOTICE.txt); the root MIT license does not grant trademark rights.

Short reading examples in browser fixtures reference [Troubleshooting, The Autodidacts](https://www.autodidacts.io/troubleshooting/). Article excerpts retain their authors' copyright and are not relicensed by this project. Screenshots used in the README display synthetic model responses and accounts, not private user knowledge.
