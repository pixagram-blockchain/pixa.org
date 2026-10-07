---
name: pixagram
description: Use when interacting with the Pixagram blockchain — a Hive fork. Triggers on tasks that mention Pixagram, PIXA / PXS / VESTS tokens, the api.pixagram.com endpoint, hived/Hivemind on this fork, or any account/post/witness operation on this chain. Tells the agent which endpoint to hit, which token names to use, which fields/accounts are renamed, the genesis allocations and reward-curve tuning that differ from upstream Hive, and that the standard Hive API surface applies for everything else.
---

# Pixagram

A fork of [Hive](https://hive.io), tracking upstream **hived 1.28.7**; the live network runs Pixagram's own **1.30.0** (hardfork 30, active since 2026-10-07 12:00 UTC at block 949330 — see [Hardfork 30](#hardfork-30--witness-approval-floor-security-and-economic-fixes)). The standard Hive RPC surface (`condenser_api.*`, `database_api.*`, `bridge.*`, `follow_api.*`, `tags_api.*`) works — only the renames and tuning below differ.

## Endpoints

| Node | RPC | Location |
|---|---|---|
| Primary | https://api.pixagram.com | Warsaw |
| | https://merlion.surf | Singapore |
| | https://blockforge.lol | France |
| | https://pixarex.net | Iowa, US |
| | https://pixa-dubai.xyz | Dubai |
| | https://boitata.quest | São Paulo |

Use `https://api.pixagram.com` unless you have a reason not to. The others are
independent full nodes on the same chain and answer identically — each runs the
full stack, so `bridge.*` and `network_broadcast_api` work on all of them.

There is no testnet endpoint. `pixagram.dev` appears in older documentation and
in the built-in `--rpc` default of `bigmac-feed`; it no longer serves an API and
now resolves to GitHub Pages, so always pass the RPC endpoint explicitly.

All of these serve full Hive-compatible JSON-RPC. `bridge.*`, `follow_api.*`, `tags_api.*` and select `condenser_api.*` social methods are routed to a **Hivemind** indexer behind the same endpoint.

## Docker images

Use the published images when a local Pixagram node, HAF node, Hivemind indexer, or witness feed is needed:

| Image | Use |
|---|---|
| `pixadock/pixagram:1.30.0` | Main blockchain node (`hived`) and CLI wallet — current mainnet build |
| `pixadock/pixagram-haf:1.30.0` | HAF node (`hived` + PostgreSQL indexer) |
| `pixadock/hivemind:mainnet` | Hivemind setup, sync, and social API server |
| `pixadock/bigmac-feed:v1.0.3` | Witness price feed publisher |

Tag history: `:pre-mainnet` is the old alphanet build (pre-1.28.7 tree, `hived_admin` entrypoint), `:mainnet` is the 1.28.7 build the chain launched on, `:1.29.0` ran from the hardfork 29 rollout on 2026-09-16, and `:1.30.0` is what every node runs since hardfork 30. `:mainnet` was moved to 1.30.0 on 2026-10-07 after sitting on the launch build through HF29; pin the version tag anyway.

There are two ready-made deployments, and which one you want depends on whether
you intend to produce blocks:

| Repo | What it runs | Use it for |
|---|---|---|
| [`pixagram-blockchain/pixagram-node`](https://github.com/pixagram-blockchain/pixagram-node) | `pixagram`, `pixagram_haf`, Hivemind setup/sync/server, Jussi, Caddy TLS | A public API node. No witness, no feed. |
| [`pixagram-blockchain/witness`](https://github.com/pixagram-blockchain/witness) | `pixagram` plus `bigmac-feed`, two containers | Block production only. No HAF, no PostgreSQL, no public API. |

`pixagram-blockchain/alphanet` is the original development stack these were split
out of; prefer one of the two above for a new deployment.

An API node wants roughly 4 vCPU / 16 GB. Below about 24 GB of RAM you **must**
lower PostgreSQL's `shared_buffers` — HAF ships it at 16 GiB, tuned for full
Hive, and Postgres refuses to start if it cannot reserve that. Drop a file into
`pixagram-haf/haf_postgresql_conf.d/` (it is bind-mounted and read last):

```
shared_buffers = 1536MB
effective_cache_size = 3GB
maintenance_work_mem = 384MB
```

The main image includes `/home/hived/bin/cli_wallet`. Override the entrypoint to run it; it defaults to the Pixagram chain ID. Use `-o` for offline signing, or pass `--server-rpc-endpoint=ws://...` for a websocket RPC node.

```bash
mkdir -p wallet
docker run --rm -it \
  -v "$PWD/wallet:/wallet" \
  -w /wallet \
  --entrypoint /home/hived/bin/cli_wallet \
  pixadock/pixagram:1.30.0 \
  -o
```

Minimal direct node example:

```bash
mkdir -p pixagram
docker run --rm -it \
  -p 7777:7777 -p 2001:2001 \
  -v "$PWD/pixagram:/home/hived/datadir" \
  -e DATADIR=/home/hived/datadir \
  -e SHM_DIR=/home/hived/datadir/blockchain \
  -e HTTP_PORT=7777 \
  -e HIVED_UID=1000 \
  --ulimit nofile=1048576:1048576 \
  --entrypoint /bin/bash \
  pixadock/pixagram:1.30.0 \
  -lc 'exec /home/hived/docker_entrypoint.sh /home/hived/bin/hived'
```

**Entrypoint path differs by image generation.** Images built from the pre-1.28.7 tree run the build and the daemon as `hived_admin`, so the entrypoint is `/home/hived_admin/docker_entrypoint.sh`. From hived 1.28.7 onward (`:mainnet`, `:1.29.0`, `:1.30.0`) everything runs as `hived` and the entrypoint is **`/home/hived/docker_entrypoint.sh`** (as above). Check with `docker inspect --format '{{.Config.Entrypoint}}' <image>` rather than assuming.

Without a `pixagram/config.ini` in the bind-mounted datadir, hived starts in **isolation** — no `p2p-seed-node`, no witness, no plugins beyond defaults. For a turnkey witness-only setup that joins the live network out of the box, use the [`pixagram-blockchain/witness`](https://github.com/pixagram-blockchain/witness) repo (docker-compose + minimal `config.ini` pre-wired to `api.pixagram.com:2001`).

## Differences from Hive

### Tokens & addresses
| | |
|---|---|
| Liquid native | **PIXA** (replaces HIVE) |
| Stable | **PXS** (replaces HBD) |
| Staked | **VESTS** (same as Hive) |
| Public-key prefix | **`PIX`** (e.g. `PIX6LLegb…`) |
| Chain ID | derived from ASCII string `"pixagram"` (padded to 32 bytes) |

When building legacy-format asset payloads, send `PIXA` / `PXS` as the on-wire symbol bytes (not `STEEM` / `SBD` that older Hive clients hardcode). HF26 NAI-format assets work as-is.

### Size limits
| | Upstream Hive | Pixagram |
|---|---|---|
| Transaction size, as hived enforces it (`maximum_block_size − 256` bytes) | ~64 KiB (witnesses vote 65,536) | **~2 MiB** (witnesses vote 2,097,152, the hard cap) |
| `custom_json` payload (`HIVE_CUSTOM_OP_DATA_MAX_LENGTH`) | 8 KiB | **64 KiB** |
| JSON-RPC request body at `api.pixagram.com` | — | **1 MiB** (nginx default in front of Jussi) |

`HIVE_MAX_TRANSACTION_SIZE` is raised to 128 KiB, but no consensus code checks a transaction against it: it only sets `HIVE_MIN_BLOCK_SIZE_LIMIT`, the smallest block size witnesses may vote. The real ceiling is the voted block size. Posts carry their images as base64 data URIs, so one post can run to hundreds of kilobytes (the largest on chain is about 498 kB). Anything over 1 MiB is rejected by the public API before it reaches the chain.

### API field renames
Jussi rewrites these in responses (and accepts the new names in requests):

| Hive | Pixagram |
|---|---|
| `hbd_balance` | `pxs_balance` |
| `hbd_exchange_rate` | `pxs_exchange_rate` |
| `hbd_interest_rate` | `pxs_interest_rate` |
| `reward_hive` / `reward_hbd` | `reward_pixa` / `reward_pxs` |
| `total_vesting_fund_hive` | `total_vesting_fund_pixa` |
| `current_hbd_supply` | `current_pxs_supply` |
| `dhf_interval_ledger` | `dpf_interval_ledger` |

Symbols inside response strings (`"1.000 HBD"` etc.) are also normalized to PIXA/PXS.

### Governance
- **DPF** (Decentralized Proposal Fund) replaces Hive's DHF. Same mechanics — funded by `proposal_fund_percent = 15%` of per-block inflation.
- Treasury account is **`pixa.omnibus`** (replaces `steem.dao` / `hive.fund`). Holds PXS only; spendable only via approved DPF proposals.

### Reward curves (tuned)
| | Value | Note |
|---|---|---|
| `author_reward_curve` | `convergent_linear` | same as Hive post-HF21 |
| `curation_reward_curve` | `convergent_square_root` | same as Hive post-HF21 |
| `content_constant` (`s`) | **`2500`** | **drastically smaller** than upstream's `2_000_000_000_000` — tuned for pre-mainnet rshare scale so small accounts produce non-zero rshares |
| `percent_curation_rewards` | `40%` | of the content reward pool |

### Price feed quorum
Upstream requires `HIVE_MIN_FEEDS` (= `HIVE_MAX_WITNESSES / 3` = 7) published feeds before a median exists. Pixagram lowers this to `max(1, num_scheduled_witnesses / 3)`, so the median tracks published feeds even while the chain runs on a handful of witnesses. Combined with the genesis feed seed (below), conversions and treasury accounting work from block 1.

**`get_config` is misleading here.** It still reports `HIVE_MIN_FEEDS: 7`, because
only the runtime check was lowered, not the macro it echoes. Do not read that
value as the effective quorum. The observable proof is that the median tracked
live feeds while the chain was running on six witnesses, and reported the feed
price rather than the seeded genesis value.

### Hardfork 30 — witness approval floor, security and economic fixes

Activated **2026-10-07 12:00:00 UTC** at **block 949330** (`HIVE_HARDFORK_1_30_TIME = 1791374400`) with hived **1.30.0**; all nine witnesses voted for it against a scaled quorum of eight.

**Live from 1.30.0, not hardfork-gated:**
- The schedule assertion counts only *enabled* witnesses, so a null-key registration can no longer stop schedule updates and halt the chain.
- The hardfork-vote quorum counts only witnesses that produced within the last two rounds, so idle registrations cannot raise it out of reach.
- A transaction may carry at most 1,000 signatures (`PIXA_MAX_TRANSACTION_SIGNATURES`), checked before key recovery on both the API and p2p paths. Node-local policy, not consensus.

**From activation:**
- **Approval floor.** A witness needs approval of at least 1 % of outstanding VESTS to be scheduled. If no enabled witness meets it, scheduling falls back to every enabled witness, so the schedule never collapses.
- **Open authorities barred.** Accounts whose active authority is satisfiable without a signature (`temp`, `null`) cannot run `witness_update`, `witness_set_properties` or `feed_publish`.
- **Null signing key.** Rejected for a brand-new registration and for disabling the last enabled witness. An existing witness *can* still take itself offline with the null key `PIX1111111111111111111111111111111114T1Anm`, and since this release that removes it from the schedule cleanly.
- **Owner history** is recorded from activation, so account recovery works for owner changes made afterwards.
- **Vote dust** is `PIXA_HF30_VOTE_DUST_THRESHOLD = 50,000` rshares, so a full vote counts from 2.5 VESTS instead of 2,500.
- **Witness pay.** While fewer than 21 witnesses are scheduled each block pays exactly the nominal share; it had been weighted by 21 / scheduled, issuing ~11.7 % a year instead of 9.75 %. `producer_reward` dropped from ~0.329 to ~0.141 VESTS per block.
- **DPF funding and proposal pay** carry the sub-0.001 PXS remainder (`util::dhf_funding_without_truncation`) instead of truncating every block, so the fund receives its full 15 % share; it had received about 74 % of it. The hourly `dhf_funding` is the place to see it.
- **Reward conversion** no longer burns the PIXA that does not fit a whole 0.001 PXS.
- **`custom_json` / `custom`** resource credits are priced in proportion to payload length.

**Verifying:** `get_hardfork_properties.current_hardfork_version` is `1.30.0` and `processed_hardforks` has 31 entries; every node logs `HARDFORK 30 at block 949330`.

### Hardfork 29 — reward denominator reset and witness-scaled hardfork quorum

Activated **2026-09-18 12:00:00 UTC** at **block 402205** (`HIVE_HARDFORK_1_29_TIME = 1789732800`) with hived **1.29.0**.

**Why it exists.** Mainnet genesis (2026-09-04) applied HF1–28 at block 1, and HF17/19/21 each seed the post reward fund's `recent_claims` with a Steem/Hive-mainnet snapshot (guarded only by `#ifndef IS_TEST_NET`). The fund therefore started at 5.036e17 — roughly 1.2 million times this chain's real claim scale — so every author payout before HF29 came out below `HIVE_MIN_PAYOUT_HBD` (0.020 PXS) and was **zeroed** by `util::get_rshare_reward()`, with the rshares consumed anyway. Symptom: `pending_payout_value` of 0.00x and no `author_reward_operation` even on well-voted posts.

**What `apply_hardfork(29)` does:**
- Sets the `post` fund's `recent_claims` to `min(current, PIXA_HF29_RECENT_CLAIMS)`, with `PIXA_HF29_RECENT_CLAIMS = 27,500,000,000,000` (2.75e13 = `max(15 d × daily claims, 99 × largest pending claim)` measured on 2026-09-13; the second term binds, i.e. no single post can take more than 1 % of the pool at activation). Never raises the value; balances, VESTS, PXS, the treasury and feeds are untouched.
- From then on `recent_claims` converges to its steady state (~15 d × daily claims) within about two months regardless of the seed, and the first post cashing out after activation pays real PXS — at launch-time activity tens of PXS per average post, thinning as more people post.
- Hardfork quorum: upstream requires `HIVE_HARDFORK_REQUIRED_WITNESSES = 17` scheduled witnesses, which assumes a full 21-slot schedule and can never be reached on a small chain. Pixagram uses `pixa_hardfork_quorum(n) = clamp(ceil(n × 17 / 21), 1, n)` over the witnesses actually scheduled — 8 → 7, 21 → 17. The hardfork-vote tally uses it from 1.29.0 onward (it has to: it is what gates HF29); the majority-version tally and the API-visible `witness_schedule.hardfork_required_witnesses` switch at activation (17 → 7 with 8 scheduled) and are refreshed on every schedule update. Votes for a hardfork version at or below the current one are ignored — witnesses created after genesis carry a default `0.0.0` vote that upstream's block producer could never replace while `last_hardfork == HIVE_NUM_HARDFORKS`.

**Operational facts.** After activation a block from a witness still below 1.29.0 is rejected (`witness.running_version >= current_hardfork_version`). Moving a node across hived versions needs a replay, not a restart: hived stamps its `get_config` into `shared_memory.bin` and refuses a state file written by another version (`Blockchain config from shared memory file mismatch`), and HAF cannot replay into a Postgres that already holds blocks. The working recipe — one-off `--force-replay --exit-before-sync` for the consensus node, HAF + Hivemind resynced from scratch and started together, then a Jussi restart — is in the READMEs of `alphanet`, `pixagram-node` and `witness`.

**Verifying at T:** `condenser_api.get_reward_fund("post").recent_claims` drops to `27500000000000`; `get_hardfork_properties.last_hardfork` becomes 29 (`processed_hardforks` gains its 30th entry); `get_witness_schedule.hardfork_required_witnesses` becomes 7; every node logs `HARDFORK 29`. Do reward math from hived, not from the social API: Hivemind reports `rshares` / `net_rshares` ×10⁶ relative to the consensus values in `effective_comment_vote_operation`.

### Monetary policy — zero passive yield by design
Pixagram welds both of Hive's passive-yield levers to zero in consensus code, so **neither liquid PXS nor staked VESTS earns anything for merely being held**:

| Lever | Upstream Hive | Pixagram |
|---|---|---|
| `hbd_interest_rate` (PXS interest) | witness-median, `0`–`100%` | **hard-locked to `0`** — witnesses *cannot* publish a nonzero value (validation asserts `== 0`); the median is forced to 0. Changeable only by hardfork. |
| `vesting_reward_percent` (VESTS appreciation) | `15%` of inflation → vesting fund | **`0`** — the vesting fund gets no inflation top-up, so the VESTS:PIXA ratio stays ~flat. |

The HF21 inflation split is retuned to match: **content `70%` / DPF `15%` / witness `15%` / vesting `0%`** (upstream: `65` / `10` / `10` / `15`). The only reward flowing to stakers is **curation** (`40%` of the content pool, above) — payment for *active voting*, not passive yield on the stake.

### Communities (Hivemind)
Community names must match **`portal-[123]\d{4,6}`** (e.g. `portal-100001`) — Pixagram **kept upstream's `portal-` prefix**, did NOT rename to `pixagram-`. Fresh chain → no communities exist until `community_create` ops are broadcast.

## Init / system accounts & genesis allocations

| Account | Genesis allocation | Notes |
|---|---|---|
| `initminer` | 0 PIXA, 0 PXS, 0 VESTS at block 0 — accumulates VESTS via producer rewards | Sole witness at genesis; mainnet runs 8 witnesses |
| `pixa.rex` | **75,000,000 VESTS** | Sales / ICO pool (Pixa Operations S.A., Panama). **Not** `pixa.ico` — that name never shipped. Restricted account, see below. |
| `pixa.team` | **25,000,000 VESTS** | Team & advisors. Restricted account, see below. |
| `pixa.omnibus` (treasury) | **245,098.039 PXS** | DPF treasury — the PXS value of 25M PIXA at the genesis median feed (25,000,000 / 102). This is the figure at block 0; the balance grows every hour from DPF funding. Liquid PXS only, no VESTS: HF21 fires at block 1 and calls `lock_account()` on the treasury, which would strand any VESTS, and the proposal payout pipeline draws exclusively from the PXS balance. |
| `miners`, `null`, `temp`, `steem` | none | Hive-inherited system placeholders; empty key_auths → unspendable. `steem` is a keyless placeholder that exists only so the legacy pre-HF11 `recovery_account` lookup resolves; on Pixagram that fallback actually points at `initminer`. |

`pixa.rex` and `pixa.team` are each guarded by a **3-of-3 multisig** on all three authorities (owner, active, posting) — three independent signers, `weight_threshold = 3`, so all three signatures are required. The memo key is a single (non-consensus) key per account. The treasury `pixa.omnibus` is deliberately **keyless**.

Account creation was free at genesis (`account_creation_fee = 0`), but on the
live chain the witness-schedule median is now **0.001 PIXA** and cannot return to
zero: `HIVE_MIN_ACCOUNT_CREATION_FEE` is 1 (0.001 PIXA), so the moment any witness
publishes chain properties via `witness_set_properties_operation` the median
leaves zero for good.

That matters more than it looks, because **`initminer` holds no liquid PIXA** — its
genesis allocation is 0 PIXA and it only ever accrues VESTS from producer rewards.
A plain `account_create` from initminer therefore fails with:

```
Account initminer does not have sufficient funds for balance adjustment
```

Create accounts through the **subsidy pool** instead, which spends RC rather than
PIXA. In `cli_wallet`:

```
claim_account_creation   <creator> "0.000 PIXA" true
create_claimed_account   <creator> <new_account> <owner_key> <active_key> <posting_key> <memo_key> "{}" true
```

The pool is funded per block by `account_subsidy_budget` (decaying at
`account_subsidy_decay`); both are visible in `condenser_api.get_chain_properties`
alongside the current `account_creation_fee`.

### Restricted accounts: `pixa.rex` and `pixa.team`

Both are welded shut in consensus code — they exist to hold and distribute stake, nothing else. The **only** value-moving operation either can perform is a **direct VESTS transfer** (`transfer_operation` with a VESTS amount), which upstream Hive forbids entirely; Pixagram special-cases it so the stake moves straight into the recipient's `vesting_shares` (subject to delayed-voting rules) instead of requiring a power-down.

Everything else is rejected with `"This account is restricted to VESTS transfers only."`:

| Blocked | Operations |
|---|---|
| Liquid movement | `transfer` (non-VESTS), `transfer_to_vesting`, `transfer_to_savings`, `transfer_from_savings` |
| Stake mechanics | `withdraw_vesting` (power down), `delegate_vesting_shares`, `claim_reward_balance` |
| Social | `comment`, `vote` |
| Governance | `account_witness_vote`, `account_witness_proxy` |
| Custom | `custom`, `custom_json`, `custom_binary` (checked against every required-auth set) |

The guard runs at two levels: per-evaluator, and a blanket check in `apply_operation` that inspects each operation's required authorities — so an operation is blocked whenever one of these accounts appears in *any* auth set, not merely as the nominal sender.

**Allowed exception:** `account_update` / `account_update2`, so the signers can rotate keys and metadata.

### Initial supply summary (block 0)
| | |
|---|---|
| Liquid PIXA | **0** — no liquid PIXA at genesis; everything flows from inflation / powerdowns |
| Vested PIXA (in `total_vesting_fund_pixa`) | **100,000,000 PIXA** backing 100M VESTS |
| Total VESTS | **100,000,000** (75M `pixa.rex` + 25M `pixa.team`) |
| Liquid PXS | **245,098.039** (in `pixa.omnibus`) |
| **VESTS : PIXA at genesis** | **1 : 1** in display units (= 1,000,000 raw microVESTS per display PIXA). Macro: `HIVE_INITIAL_VESTING_PRICE = VEST_price(1000, 1)`. Diverges from Hive/Steem's historical `1 STEEM ≈ 0.0018 VESTS` genesis ratio. |
| **Genesis median feed** | `1 PXS = 102 PIXA` seeded in source so conversions work before witnesses publish. Live witnesses now publish `1 PXS = 51 PIXA`, following the reference PIXA price moving from $0.06 to $0.12. The median in force lags: it is the median of up to 84 hourly samples, so it tracks a change over hours rather than immediately. |

Unlike upstream Hive, the VESTS:PIXA ratio stays ~flat over time: Pixagram sets `vesting_reward_percent = 0`, so no inflation is added to `total_vesting_fund_pixa` without also issuing VESTS. All vesting-fund growth comes from power-ups and reward payouts that mint VESTS at the prevailing ratio (ratio-preserving). There is no passive staking yield — see [Monetary policy](#monetary-policy--zero-passive-yield-by-design) above.

## Quick examples

```bash
# Global chain state
curl -s -X POST https://api.pixagram.com -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","method":"condenser_api.get_dynamic_global_properties","params":[],"id":1}'

# Account (note: pxs_balance not hbd_balance)
curl -s -X POST https://api.pixagram.com -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","method":"condenser_api.get_accounts","params":[["initminer"]],"id":1}'

# Treasury balance (DPF)
curl -s -X POST https://api.pixagram.com -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","method":"condenser_api.get_accounts","params":[["pixa.omnibus"]],"id":1}'

# Reward fund (curves, constants, balance)
curl -s -X POST https://api.pixagram.com -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","method":"condenser_api.get_reward_fund","params":["post"],"id":1}'

# Median price feed
curl -s -X POST https://api.pixagram.com -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","method":"condenser_api.get_current_median_history_price","params":[],"id":1}'

# Social feed (Hivemind)
curl -s -X POST https://api.pixagram.com -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","method":"bridge.get_ranked_posts","params":{"sort":"trending","tag":"","limit":20},"id":1}'
```

For anything else, refer to [Hive developer docs](https://developers.hive.io/) — methods and ops are identical.
