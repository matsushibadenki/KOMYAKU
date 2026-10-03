# ChatGPT authentication

[Done] Preferences → AI provides **Continue with ChatGPT**, reconnecting saved accounts, cancellation, connection status, and sign-out. Japanese, English and Simplified Chinese are supported. A separate **AI writing** dialog sends the reviewed scene and request only when the user clicks **Send to ChatGPT**.

[Done] Explicit account/model selection, account-specific model catalog, serialized refresh-token rotation honoring `earliest_refresh_at`, grant checks, and scene assistance. Current connection status indicates a stored session, not guaranteed account eligibility or available usage allowance.

[Next] Selection-only requests and side-by-side revisions. Current suggestions append as a new paragraph and preserve the existing manuscript, dialogue sheets and canonical IDs.

[Later] OS credential-vault integration and Windows support. Current protected-file storage targets macOS/Unix. Tokens are not encrypted at rest; directory mode is 0700 and files 0600, and permissions are reapplied when opening them. Store is outside workspace files and backups.

## Flow and trust boundary

Rust starts an ephemeral IPv4 loopback listener at `http://127.0.0.1:<port>/auth/callback` before launching the system browser. Attempts use independent cryptographically random state, nonce and PKCE S256 verifier. Each installation persists an `urn:uuid:` host ID shared by new work windows. First authorization uses `dynamic_agent_client`; only the issued client ID is used for token exchange and subsequent sign-ins. Issued registrations remain available after a failed exchange. Saved registrations are keyed by issued client ID and verified subject, never email alone.

OIDC discovery is fetched from `https://auth.openai.com/.well-known/openid-configuration`; endpoint origins are pinned to HTTPS auth.openai.com and redirects are disabled. ID tokens must carry a valid RS256 signature from published JWKS, issuer, client audience, fresh expiry, issued-at time and attempt nonce. Reconnects must preserve the account subject. Multiple-audience tokens require matching `azp`. Unexpected state, duplicate callback parameters, a changed client ID, missing code, bootstrap client IDs, and malformed JWTs are rejected. Unrelated requests cannot consume the attempt. The listener stops on success, denial, cancellation, or a five-minute timeout.

Credentials and registration metadata live in `<Tauri app_data_dir>/chatgpt/session.json`, atomically replaced under an OS file lock. The file lock covers separate File → New processes. `STORY_GRAPH_AUTH_DIR` overrides this path for isolated development/QA. Do not point it at a workspace or a public directory. Access/refresh/ID tokens stay in Rust; IPC exposes account labels, registration IDs, grant status, expiry and fixed error codes only. Authentication errors do not include token responses or URLs. No token or authorization code is written to localStorage or story backups.

Sign-out revokes the refresh token (or access token when no refresh token was granted) using the discovery revocation endpoint before clearing secrets. Network failures retain the local session and show a retry message; successful sign-out retains host ID and registration/account mapping. A three-attempt bounded retry handles transient revocation failures. Revocation may block other credential-store readers briefly; it cannot race a credential-file replacement. Pending authentication must finish/cancel before sign-out.

## Verification

Automated tests cover callback state/registration binding, duplicate parameters, denied consent, PKCE URL construction, issuer/audience/nonce/expiry/subject checks, endpoint pinning, cancellation, stable host ID, private storage permissions, and absence of tokens in public status.

Assistance tests cover UTF-8 split across SSE chunks, CRLF framing, terminal completion, late usage-limit failure, incomplete/interrupted streams, output limits, supported stateless request fields, model visibility/order, append identity preservation, and changed-source rejection. Credential tests cover renewal scheduling, granted scope checks, terminal versus transient refresh errors, and serialization between independently opened credential stores.

Manual live verification requires the user's account: open Preferences → AI → Continue with ChatGPT, finish consent in the system browser, then confirm the account/grants in the app. Reconnect should reuse the registration ID; sign-out should remove the session while preserving registration metadata. Deny consent, cancel, leave the flow for five minutes, and disconnect the network to verify recovery. Live user authentication and account consent are not performed automatically during QA.

## Official references

- [Quickstart](https://developers.openai.com/siwc/quickstart)
- [Registration and sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)
- [Accounts and sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)
- [Token reference](https://developers.openai.com/siwc/token-sharing-open-source/token-reference)
- [Models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)
- [Preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)

## Writing requests

Rust owns each window's review snapshot, request lifecycle and result. The dialog shows the scene title for orientation; only scene plaintext (including actor names/dialogue) and the author's request are sent. Other scenes, notes, character profiles and the work title are excluded. Review context is limited to 128 KiB; output is limited to 64 KiB. The title is not sent. The selected account's catalog is retrieved from `/v1/models`, filtering `visibility: list` while preserving server order and labels. No model name is hard-coded. The catalog is checked again before inference.

Inference uses `POST https://api.openai.com/v1/responses`, `store:false`, `stream:true`, array `input`, and `instructions`. Unsupported sampling/length/conversation fields are omitted. Success requires `response.completed` with completed status. Cancellation drops the HTTP future; failed, incomplete, cancelled, empty, oversized or interrupted results cannot be applied. Requests have transport/time limits and no automatic generation retry, avoiding duplicate plan usage. Error messages distinguish account/grant restrictions, unavailable models and usage limits; a provider request ID is displayed when available.

The user can append a completed suggestion explicitly. Rust compares the current canonical scene to the reviewed snapshot before applying it through the existing revision-checked edit/history/save path. If the scene changed, the result remains available for reading but appending is rejected. Applying a result twice is rejected. Suggestions are held in memory until applied; closing the app discards them. Undo uses the ordinary editor history.

Refresh is performed before catalog/inference use when within 60 seconds of expiry and permitted by `earliest_refresh_at`. The credential file lock spans refresh and replacement, including other File → New processes. Requests use only the selected registration's issued client ID and credentials. Terminal refresh errors clear the unusable session while retaining registration mapping. Network/transient failures preserve credentials. Sign-out cancels active generation for that account in the current app process before revocation.

This implements the local open-source/personal application flow. Distribution/eligibility should be reviewed against the current official preview limitations; identity-only commercial clients use a different registration program.
