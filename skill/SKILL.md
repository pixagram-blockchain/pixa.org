---
name: pixagram
description: Use when interacting with the Pixagram blockchain — a Hive fork. Triggers on tasks that mention Pixagram, PIXA / PXS / VESTS tokens, the api.pixagram.com endpoint, hived/Hivemind on this fork, or any account/post/witness operation on this chain. Tells the agent which endpoint to hit, which token names to use, which fields/accounts are renamed, the genesis allocations and reward-curve tuning that differ from upstream Hive, and that the standard Hive API surface applies for everything else.
---

# Pixagram

A fork of [Hive](https://hive.io), tracking upstream **hived 1.28.7**. The standard Hive RPC surface (`condenser_api.*`, `database_api.*`, `bridge.*`, `follow_api.*`, `tags_api.*`) works — only the renames and tuning below differ.

## Endpoints

| Node | RPC | Location |
|---|---|---|
| Primary | https://api.pixagram.com | Warsaw |
| | https://merlion.surf | Singapore |
| | https://blockforge.lol | France |
| | https://pixarex.net | Iowa, US |

Use `https://api.pixagram.com` unless you have a reason not to. The others are
independent full nodes on the same chain and answer identically.

There is no testnet endpoint. `pixagram.dev` appears in older documentation and
in the built-in `--rpc` default of `bigmac-feed`; it no longer serves an API and
now resolves to GitHub Pages, so always pass the RPC endpoint explicitly.

All of these serve full Hive-compatible JSON-RPC. `bridge.*`, `follow_api.*`, `tags_api.*` and select `condenser_api.*` social methods are routed to a **Hivemind** indexer behind the same endpoint.

## Docker images

Use the published images when a local Pixagram node, HAF node, Hivemind indexer, or witness feed is needed:

| Image | Use |
|---|---|
| `pixadock/pixagram:mainnet` | Main blockchain node (`hived`) and CLI wallet |
| `pixadock/pixagram-haf:mainnet` | HAF node (`hived` + PostgreSQL indexer) |
| `pixadock/hivemind:mainnet` | Hivemind setup, sync, and social API server |
| `pixadock/bigmac-feed:v1.0.2` | Witness price feed publisher |

For a working full stack, prefer the Pixagram alphanet Docker Compose setup (`pixagram-blockchain/alphanet`). It wires together `pixagram`, `pixagram_haf`, Hivemind setup/sync/server, Jussi, TLS, and `bigmac-feed`.

The main image includes `/home/hived/bin/cli_wallet`. Override the entrypoint to run it; it defaults to the Pixagram chain ID. Use `-o` for offline signing, or pass `--server-rpc-endpoint=ws://...` for a websocket RPC node.

```bash
mkdir -p wallet
docker run --rm -it \
  -v "$PWD/wallet:/wallet" \
  -w /wallet \
  --entrypoint /home/hived/bin/cli_wallet \
  pixadock/pixagram:mainnet \
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
  pixadock/pixagram:mainnet \
  -lc 'exec /home/hived_admin/docker_entrypoint.sh /home/hived/bin/hived'
```

**Entrypoint path differs by image generation.** Images built from the pre-1.28.7 tree run the build and the daemon as `hived_admin`, so the entrypoint is `/home/hived_admin/docker_entrypoint.sh` (as above). From hived 1.28.7 onward everything runs as `hived` and the entrypoint is **`/home/hived/docker_entrypoint.sh`**. Check with `docker inspect --format '{{.Config.Entrypoint}}' <image>` rather than assuming.

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

### Raised limits
| | Upstream Hive | Pixagram |
|---|---|---|
| `HIVE_MAX_TRANSACTION_SIZE` | 64 KiB | **128 KiB** |
| `HIVE_CUSTOM_OP_DATA_MAX_LENGTH` (`custom_json` payload) | 8 KiB | **64 KiB** |

`HIVE_MIN_BLOCK_SIZE_LIMIT` tracks the transaction size, so it doubles too; `HIVE_MAX_BLOCK_SIZE` stays at 2 MiB.

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
| `initminer` | 0 PIXA, 0 PXS, 0 VESTS at block 0 — accumulates VESTS via producer rewards | Sole witness at genesis; mainnet now runs several |
| `pixa.rex` | **75,000,000 VESTS** | Sales / ICO pool (Pixa Operations S.A., Panama). **Not** `pixa.ico` — that name never shipped. Restricted account, see below. |
| `pixa.team` | **25,000,000 VESTS** | Team & advisors. Restricted account, see below. |
| `pixa.omnibus` (treasury) | **245,098.039 PXS** | DPF treasury — the PXS value of 25M PIXA at the genesis median feed (25,000,000 / 102). This is the figure at block 0; the balance grows every hour from DPF funding. Liquid PXS only, no VESTS: HF21 fires at block 1 and calls `lock_account()` on the treasury, which would strand any VESTS, and the proposal payout pipeline draws exclusively from the PXS balance. |
| `miners`, `null`, `temp`, `steem` | none | Hive-inherited system placeholders; empty key_auths → unspendable. `steem` is a keyless placeholder that exists only so the legacy pre-HF11 `recovery_account` lookup resolves; on Pixagram that fallback actually points at `initminer`. |

`pixa.rex` and `pixa.team` are each guarded by a **3-of-3 multisig** on all three authorities (owner, active, posting) — three independent signers, `weight_threshold = 3`, so all three signatures are required. The memo key is a single (non-consensus) key per account. The treasury `pixa.omnibus` is deliberately **keyless**.

Account creation is **free at genesis** (`account_creation_fee = 0` on the initminer witness and in the seeded witness-schedule median) so the network can bootstrap. Once real witnesses publish properties via `witness_set_properties_operation`, any fee they set must satisfy `HIVE_MIN_ACCOUNT_CREATION_FEE` as usual.

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
