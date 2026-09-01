# Changelog

All notable changes to Between Trains are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.1] - 2026-09-01

### Changed

- **Marketplace-oriented README** — product-forward intro, a hero shot, and a
  visual feature grid (Ambient Zen, Media, Learning Cards, Micro-Games).

### Fixed

- **Ollama model selection.** The `ollama.model` setting now defaults to **blank**
  and auto-selects the first model installed on your Ollama server (set a name to
  pin a specific one). It previously defaulted to `llama3.2`, which looked installed
  even when it wasn't — so Learning Cards silently did nothing on machines without
  that model pulled.
- **Learning Cards no longer fail silently.** When Ollama is enabled but unreachable
  or has no model installed, pressing **Generate** now shows a clear, actionable
  message (start Ollama / pull a model / run *Test Ollama Connection*) instead of
  nothing, and the status line notes "Ollama not reachable".
- **Clearer "Test Ollama Connection" messages** — accurate fallback wording (Learning
  Cards need Ollama; other modes fall back offline) and specific hints for a missing
  or blank model.

## [0.1.0] - 2026-08-28

First public release — a local-first waiting room for the gaps while an AI agent works.

### Waiting room

- A waiting-room panel that opens as a **tab in the active editor group** (next to
  your files) without stealing focus, plus a status-bar item reflecting the session
  state. Start it manually, or **toggle** it with `Ctrl+Q` (remappable in VS Code's
  Keyboard Shortcuts editor) — it opens when idle and closes when a session is live.
- **Two-level navigation**: a primary row of mode groups (Micro-Games, Ambient Zen,
  Learning Cards, Media, News, Physical Break) with each group's sub-modes below, and
  a ⚙ **Global config** view in the header.
- Built as a sandboxed webview locked down with a strict Content Security Policy and a
  per-render nonce; the extension host owns all logic and the panel owns only presentation.

### Modes

- **Micro-Games** — **Meteor Dodge** (dodge and shoot falling meteors; survival +
  break score) and **Tiny Basketball** (flick-shot physics). Canvas-based, theme-aware,
  fully local, with a persisted per-game **best score** shown in the HUD.
- **Ambient Zen** — **Rain on Window** (rain-on-glass with condensation and soft city
  bokeh) and **Breathing Orb** (a slow 9-second swell), each with optional ambient sound
  synthesized live via Web Audio (no files, no network) behind a 🔊 toggle.
- **Physical Break** — one small, optional reset at a time (neck, wrist, breathing, eye
  rest, posture), each with a gentle looping animation and an optional calm sound pad. No
  timer, no score, no nagging; honors reduced-motion and pauses when hidden.
- **Memes & GIFs** — a Tinder-style swipe deck curated by a local agent (Tenor/Giphy,
  no API key) with a deterministic fallback when the model is off. Keep/skip ratings feed
  the next fetch; kept GIFs live in a browsable **Kept** grid, and downloads are restricted
  to allowlisted media hosts with size caps.
- **Videos** — **Random** and **Programming** sub-modes curated by a local agent
  (YouTube via page parsing, no API key; the model can only save results it actually
  found). Each video is shown once; play opens it in your browser; liked videos live in a
  rewatchable list.
- **News** — **Technology / World / Business / Science** cards curated by a local agent
  through a pluggable search provider (**Tavily**, **Brave**, or **Serper**). The API key is
  entered via a native secure prompt and stored only in VS Code **SecretStorage**. Browse
  one card at a time; "Read ↗" opens the source in your browser (never automatically).
- **Learning Cards** — add any tech **topic** at a level (Beginner / Intermediate /
  Advanced); each becomes its own sub-mode. A local agent generates bite-sized concept
  cards (title, short explanation, optional snippet) you review one at a time. Rating a
  card **✓ Knew it** / **💡 Didn't know** marks it reviewed and steers the next batch to
  focus ~70% on the concepts you didn't know. Requires Ollama (no offline fallback).

### Local brain (Ollama)

- All content curation and card generation run through local LangChain agents on your
  configured **Ollama** model, with a **Test Ollama Connection** command and an in-panel
  **Global config** (provider + model, auto-populated from the server). The meme/video/news
  modes fall back to a deterministic no-LLM fetcher when Ollama is absent.

### Privacy & data

- **Local-first, no telemetry.** Nothing about your code or prompts leaves the machine.
- Session metadata is stored in VS Code's per-extension global storage as append-only
  JSONL traces plus aggregate stats — interaction patterns only, never source or prompts.
- A **📊 Usage stats** screen and **📂 Open records folder** button in Global config, plus
  commands to **show, export, clear, and reset** local data (destructive actions confirm first).
- Content libraries (memes, videos, news, learning cards) are saved locally per stream.
- **Auto-fetch with a per-stream cooldown** (default 30 min, configurable) so reopening a
  mode doesn't trigger an unnecessary fetch; manual fetches always run.
- **Workspace Trust** and **virtual-workspace** capabilities are declared: calm and game
  modes work anywhere; local-first and workspace-context features assume a trusted, local host.

### Settings

- Master switch, default mode, auto-open, the Ollama connection (base URL / model /
  timeout), per-mode auto-fetch and batch sizes, the news provider, the auto-fetch cooldown,
  and metadata storage + retention. See the README for the full table.
