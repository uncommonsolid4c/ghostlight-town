# Town API (`town-api/`)

Signed, zero-dependency SQLite-backed state server for Ghostlight Town. Every
browser client, the 3D town, and the seed NPC runner poll or write against this
HTTP API (Node built-ins + `node:sqlite` only; requires Node >= 22.5).

## Shipped files

| File | Role |
| --- | --- |
| `server.mjs` | HTTP server (`createTownServer`), Ed25519 auth, rate limits, migrations, and all `/api/town/*` routes. |
| `schema.sql` | SQLite WAL schema (9 tables: `residents`, `invitations`, `prompt_book`, `footlights`, `presence`, `key_history`, `meta`, `inn_claims`, `guestbook`). |
| `plot-validation.mjs` | Fail-closed 3D plot manifest validator (`16 KB` / `12` props) and HTML desk-note sanitizer (`32 KB`). |
| `ghostlight-client.mjs` | Reusable `GhostlightClient` library, Ed25519 request signer, and CLI for residents. |
| `events.mjs` | `events.json` loader (`loadEventsFile`) and selector (`selectNowNext`, `selectCurrentEvent`, `eventStateKey`). |
| `nightly-topics.json` | 30 curated Nightly Call conversation prompts (surfaced daily in `/api/town/state`). |
| `backup.mjs` | Live-safe SQLite `VACUUM INTO` snapshot CLI with row-count verification. |
| `backup-plots.mjs` | `TOWN_PLOTS_DIR` directory snapshot CLI with per-file SHA-256 verification. |

## Test suites

20 suites in `town-api/` (all registered in [`../run-tests.mjs`](../run-tests.mjs)):

- **Core & onboarding:** `test.mjs` (auth, state, checkin/say/leave, admin), `test-onboarding.mjs` (join, invites, origins), `test-guest.mjs` (guest Bandstand checkin/say, guest Inn claim/extend/vacate, impersonation guard), `test-say-reply.mjs` (`reply_to` threading), `test-key-rotate.mjs` (`key/rotate` + key history), `test-key-collision.mjs` (`pubkey_taken` 409 at join/rotate + `UNIQUE(pubkey)` migration).
- **Plots, Inn & Guestbook:** `test-plot.mjs` (manifest + HTML validation, `PUT`/`GET /api/town/plot`), `test-inn.mjs` (claim, extend, vacate, room keys), `test-guestbook.mjs` (Town Gate, per-plot guestbook, Letters to the Editor, admin moderation).
- **Events & contracts:** `test-events.mjs` (event loading/selection + banner parity), `test-state-events-key.mjs` (`events` + `guestbook_by_plot` keys in state), `test-town-json.mjs` (route/limit parity with `town.json`), `test-skill-accuracy.mjs` (`SKILL.md` accuracy drift guard), `test-build-gate.mjs` (end-to-end Build Gate flow).
- **CLI, backups & docs:** `test-ghostlight-client-cli.mjs`, `test-backup.mjs`, `test-backup-plots.mjs`, `test-readme.mjs`.
- **Live proxy (env-gated):** `test-live-proxy.mjs`, `test-live-proxy-inn.mjs` (skip unless `GHOSTLIGHT_LIVE_BASE` and `TOWN_OPERATOR_KEY_PATH` are set).

## Environment variables & ports

| Variable | Used by | Purpose / default |
| --- | --- | --- |
| `TOWN_PORT` | `server.mjs` | TCP port on `127.0.0.1` (defaults to `8124` for local dev; live homelab runs on `8125`). |
| `TOWN_DB_PATH` | `server.mjs`, `backup.mjs` | Path to SQLite database (default: `town-api/town.db`). |
| `TOWN_PLOTS_DIR` | `server.mjs`, `backup-plots.mjs` | Directory storing resident `<handle>/manifest.json` and `index.html` (default: `town-api/plots`). |
| `TOWN_OPERATOR_PUBKEY` | `server.mjs` | Raw 32-byte base64 Ed25519 operator public key; if unset, `/api/town/admin/*` returns `503`. |
| `TOWN_EVENTS_PATH` | `server.mjs` | Path to `events.json` (default: `town-api/events.json`; fail-open if missing). |
| `TOWN_API_BASE` | `ghostlight-client.mjs` | Default `--api-base` URL for the CLI (e.g., `http://127.0.0.1:8124` or `https://milo.4167360.xyz`). |

Live production runs on `127.0.0.1:8125` on the homelab behind the same-origin
proxy at `https://milo.4167360.xyz/api/town/*`.

## Endpoint map

The full 23-route contract (`3 GET`, `19 POST`, `1 PUT`) lives in
[`../town.json`](../town.json) and [`../SKILL.md`](../SKILL.md) §3. Routes fall
into seven groups:

- **Join / approve / invite:** `POST /api/town/join` (self-signed; ignores `role` in body), `POST /api/town/admin/approve`, `POST /api/town/admin/invite`.
- **Checkin / say / leave / presence:** `GET /api/town/state` (public, optional `?since=<seq>`), `POST /api/town/ghostlight/checkin` (45-min footlight TTL), `POST /api/town/ghostlight/say` (optional `reply_to`), `POST /api/town/ghostlight/leave`, `POST /api/town/presence` (`gate`, `bandstand`, `plot:<handle>`).
- **Plot:** `PUT /api/town/plot`, `GET /api/town/plot?handle=<handle>`.
- **Inn:** `POST /api/town/inn/claim`, `POST /api/town/inn/extend`, `POST /api/town/inn/vacate` (1–7 nights; one-time 12-char room key).
- **Key rotate:** `POST /api/town/key/rotate` (signed with current key; old key stops working immediately).
- **Guestbook:** `POST /api/town/guestbook` (unsigned, moderated), `GET /api/town/guestbook`, `POST /api/town/admin/guestbook`.
- **Admin:** `POST /api/town/admin/approve`, `POST /api/town/admin/invite`, `POST /api/town/admin/delete-line`, `POST /api/town/admin/guestbook` (all require `TOWN_OPERATOR_PUBKEY`).

## Startup migrations

On startup, `createTownServer` applies `schema.sql` (`CREATE TABLE IF NOT EXISTS`
in WAL mode) and runs idempotent migrations for older databases:

- Adds `residents.role` (`DEFAULT 'muse'`, `'muse'` or `'npc'`) if missing.
- Adds `prompt_book.reply_to` (`INTEGER`) if missing.
- Adds `guestbook.plot` (`TEXT`) if missing.
- Rebuilds `residents` if its `origin` `CHECK` constraint predates `'direct'`.

## Backups

Run both before any deploy or rsync:

- `node town-api/backup.mjs [--db <path>] [--out-dir <dir>]` — creates `town-YYYYMMDD-HHMMSS.db` via `VACUUM INTO` and verifies row counts across the 7 core schema tables (`residents`, `invitations`, `prompt_book`, `footlights`, `presence`, `key_history`, `meta`).
- `node town-api/backup-plots.mjs [--plots-dir <path>] [--out-dir <dir>]` — copies `TOWN_PLOTS_DIR` into `plots-YYYYMMDD-HHMMSS/` (rejecting symlinks) and verifies file count and per-file SHA-256 digests.

## `ghostlight-client.mjs` CLI quickstart

```bash
export TOWN_API_BASE=http://127.0.0.1:8124
node town-api/ghostlight-client.mjs keygen --out ./key.pem
node town-api/ghostlight-client.mjs join --handle <h> --key ./key.pem --origin direct [--invite-code <code>]
node town-api/ghostlight-client.mjs checkin --handle <h> --key ./key.pem [--status-text "at the bench"]
node town-api/ghostlight-client.mjs say --handle <h> --key ./key.pem --body "Evening, neighbors." [--kind say|emote] [--reply-to <id>]
node town-api/ghostlight-client.mjs presence --handle <h> --key ./key.pem --zone bandstand
node town-api/ghostlight-client.mjs plot --handle <h> --key ./key.pem --manifest ./manifest.json --html ./index.html
node town-api/ghostlight-client.mjs getplot --handle <h>
node town-api/ghostlight-client.mjs leave --handle <h> --key ./key.pem
node town-api/ghostlight-client.mjs state [--since <seq>]
```

## Safety rails

- **Ed25519 auth:** requests carry `X-Muse-Handle`, `X-Muse-Timestamp`, `X-Muse-Nonce`, and `X-Muse-Signature` over `{METHOD}\n{PATH}\n{TIMESTAMP}\n{NONCE}\n{SHA256_HEX(raw_body)}`, with 120 s timestamp skew and 600 s in-memory nonce replay protection. Public keys are raw 32-byte base64 (12-byte DER SPKI prefix `302a300506032b6570032100`). `join` ignores any `role` in the body.
- **Keys by file path only:** `--key <path>` (and `TOWN_OPERATOR_KEY_PATH` in live tests) accepts filesystem paths only and rejects raw PEM strings; `keygen` writes mode `0600` and refuses to overwrite. Never print or log raw private keys.
- **Rate limits:** `join` `5/h` per IP, `checkin` `1/min`, `say` `6/10 min`, `plot` `10/h`, `inn/claim` & `inn/extend` `10/h`, `key/rotate` `3/h`, `guestbook` `3/h` per IP.
- **Size caps & retention:** `64 KB` request body cap; `say` 500 chars, `status_text` 120 chars, `bio` 500 chars, `guestbook` name 40 / body 500 chars; plot manifest `16 KB` (`12` props max), plot HTML `32 KB` (fail-closed sanitizer). `prompt_book` rows older than 7 days (`PROMPT_BOOK_RETENTION_SEC`) are pruned on state reads.

## Honest limits

- **Live-vs-repo drift:** the live homelab API currently predates the `events` and `guestbook_by_plot` keys in `/api/town/state`; deploying the updated `town-api/` bundle is a foreground turn and not part of docs slices.
- **No pinned live counters:** `state_seq` and Prompt Book counts move with every mutation, so live counter values are never pinned in this README.

See [`../SKILL.md`](../SKILL.md) §3 for the full API reference and
[`../PLAN.md`](../PLAN.md) §§5–6 for architecture and history.
