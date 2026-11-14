# AI_USAGE.md — Quantum Tip Jar

How AI was used to build this project, what the AI generated, and what the
human did. Written for the QoreChain Developer Fest "Build Before Q-Day",
Best AI-Native Build award.

## The project

**Quantum Tip Jar** — a small web dApp on the QoreChain testnet
(`qorechain-diana`, EVM 9800) that lets anyone send a QOR tip to any
`qor1…` address, with a public tipper leaderboard. Every tip is a
hybrid-signed transaction (classical secp256k1 + ML-DSA-87). Quantum Pass
category, solo builder.

- Repo: https://github.com/agusher21/quantum-tip-jar
- Live demo: https://quantum-tip-jar.vercel.app
- Fest page: https://build.qorechain.io/p/quantum-tip-jar
- Built in one day: 14 November 2026 (idea ~15:01 WIB, demo live ~16:40 WIB,
  first verified on-chain tip ~16:46 WIB, video up ~17:16 WIB).

## The AI: what it is and how it worked

The AI is **Muse**, a personal AI agent (Meta). It worked in a chat
conversation with the human builder: the human gave short directions in
Indonesian, the AI did the research, wrote the code, ran the checks, and
reported back with receipts. The loop was: human directs → AI builds and
verifies → human reviews the live result → next direction. No step was
fully autonomous; every deploy was checked live before moving on.

The AI's working method for this project:

1. **Read the docs first.** The AI read the QoreChain docs before writing
   code: the SDK quickstart (`docs.qorechain.io/sdk/quickstart`), the QoreX
   integrations guide, and the QoreX overview. Key facts it took from the
   docs: `createClient` defaults to testnet `qorechain-diana`; every native
   QOR transfer must carry a hybrid secp256k1 + ML-DSA-87 signature; QoreX
   adds the ML-DSA-87 layer through `signAndBroadcast` (`signDirect` does
   not — so the app never uses it); the ML-DSA-87 key registers on chain
   with the first transaction, so a plain tip transfer IS the required
   hybrid-signed transaction and no custom smart contract is needed.
2. **Scaffold, then write the app.** Scaffolded with
   `create-qorechain-dapp` v0.14.0 (`fullstack-web` template: Vite + React
   + TypeScript) and `@qorechain/sdk` ^0.14.0.
3. **Verify everything it claimed.** Typecheck + production build
   (`tsc --noEmit && vite build`), live demo checks after every deploy,
   and on-chain verification of the first real tip (see below).

## What the AI generated

All application code in this repo was written by the AI:

- **`src/App.tsx`** — the whole UI: QoreX connect, tip form (up to 10
  recipients), amount + memo input, leaderboard, recent-tips feed.
- **`src/qore.ts`** — the QoreChain helpers: QoreX provider detection,
  `qorexSignAndBroadcast` send flow, balance reads through the `/lcd`
  proxy, explorer links, the `Quantum Tip Jar` memo tag.
- **`src/main.tsx`, `src/index.css`, `vite.config.ts`, `vercel.json`** —
  app entry, styling, and the Vercel `/lcd` rewrite proxy (the public
  QoreChain REST API sends no CORS headers, so reads go through the
  same-origin proxy).
- **`README.md`** — project description, how it uses QoreChain, how to run
  it. The AI also drafted the fest project page text (About / How it's
  made) from the same material.

Features the AI added across the day's commits (all in `git log`):

- `0a0234d` Initial commit: tip sending + leaderboard.
- `920c507` Vercel `/lcd` rewrite proxy for testnet REST reads.
- `9702b98` Cover-art hero banner + UI polish (gradient theme, pills,
  leaderboard medals).
- `05baa3b` Batch tipping: one hybrid-signed transaction to up to 10
  recipients, one QoreX approval.
- `44240cb` Cosmic background (deep-space gradient, glowing orbs,
  twinkling stars).
- `748f8c6` Mock-wallet fix: route REST through the `/lcd` proxy so the
  `?mock=1` demo mode stops hitting CORS-blocked
  `api-testnet.qore.host`.
- `e2c59d5` Demo video hosted at `/demo-video.mp4` for the fest video
  link.

Media the AI produced:

- **Cover art** (2048×1152, 16:9) — AI-generated image, uploaded as the
  fest project's featured image (a copy lives at `public/cover.jpg`).
- **Demo video** (46 seconds) — produced as part of the AI-assisted
  workflow, showing the live demo; hosted at `/demo-video.mp4` and linked
  on the fest project page.

Verification the AI performed (and can be re-checked):

- Production build passes (`tsc --noEmit && vite build`).
- First real tip verified on chain: **0.5 QOR** from
  `qor1ntpfg4zpxxkpwzwrh0uwdqqyz36lqnmp8nmpz0` to
  `qor1s0mtlalftaf92tttxlhhesgh2qpg0q0v36j3sj`, tx
  `E8E744FF667CA84228428366811CD7845A4972D4B6BE299DF02FC4576F874DD8`,
  block 10066421, recipient balance exactly 0.5 QOR afterwards; the app
  reported "Tip sent, hybrid-signed!" with shield `shielded`.

## What the human did

The human builder is **Toni (@agusher21)**. His contributions, without
which the project could not exist:

- **The idea.** The AI presented several app ideas; the human picked #3 —
  "send testnet QOR tips to any qor1 address + tipper leaderboard" — and
  set the direction for it.
- **The wallet and the keys.** The human installed QoreX, holds the
  24-word phrase, and claimed the faucet himself (100 QOR + 1000 fUSD +
  0.5 fETH + 0.02 fBTC). The AI never saw, held, or asked for any private
  key or seed phrase.
- **Every signature.** The AI cannot sign. Every hybrid-signed transaction
  — including the first verified 0.5 QOR tip — was approved by the human
  in QoreX. The AI only prepared what to sign.
- **Deployment.** The human did the Vercel import himself and connected
  the repo to Vercel.
- **The fest submission.** The human signed in to build.qorechain.io as
  @agusher21 and created the project page from his own signed-in session.
  (The fest form does not save drafts, so the fields were filled and
  submitted in one session.)
- **Direction and review.** The human directed the iterations in chat
  (batch tipping, UI polish, cosmic background, video link) and reviewed
  each deploy live on the demo URL before the next step.

## What the AI did NOT do

- Never held, saw, or stored private keys, seed phrases, or wallet
  credentials.
- Never signed a transaction, claimed a faucet, or submitted a form on the
  human's behalf — those are all human taps.
- Never invented a result: every on-chain claim in this file was checked
  against the testnet (transaction hash and block above) before it was
  reported.

## Summary

AI wrote ~100% of the code, docs, cover art, and demo video, and ran the
build and on-chain verification. The human chose the idea, owned the
wallet and every signature, deployed the demo, submitted the fest project,
and directed and reviewed each iteration. The project is a genuine
human–AI collaboration: the AI did the typing, the human made the
decisions and the signatures.
