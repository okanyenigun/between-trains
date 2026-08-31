# Between Trains

**A waiting room for agentic development.**

Modern developers increasingly work in a loop: `prompt → agent works → wait → review → steer → repeat`. During the *agent works* phase the wait is too short and fragmented for deep work, but it repeats all day. **Between Trains** turns those idle intervals into short, low-commitment moments for learning, play, or calm — then gets out of the way the instant you return to coding.

The name is the metaphor: you are standing on a platform between passing trains. Each train is an agent iteration. You are not starting a new journey — you are waiting for the next one to arrive.

> Status: v0.1.0 — first public release.

## What it is (and isn't)

Between Trains is a **local-first VS Code extension**. Waiting is treated as a first-class UX state: the extension appears only when useful, offers experiences that satisfy even in 20 seconds, and disappears immediately when you start typing again.

It is **not** a Copilot replacement, a general coding assistant, an entertainment platform, a productivity dashboard, a wellness app, or a telemetry/surveillance layer.

## Quick start

```bash
npm install
npm run compile
```

Press **F5** in VS Code to launch an Extension Development Host, then open the Command Palette and run **Between Trains: Start Waiting Room**.

## Commands

| Command | ID |
|---|---|
| Between Trains: Start Waiting Room | `betweenTrains.startManualSession` |
| Between Trains: Stop Waiting Room | `betweenTrains.stopSession` |
| Between Trains: Open Waiting Room | `betweenTrains.openWaitingRoom` |
| Between Trains: Toggle Waiting Room | `betweenTrains.toggleWaitingRoom` |
| Between Trains: Select Mode | `betweenTrains.selectMode` |
| Between Trains: Open Settings | `betweenTrains.openSettings` |
| Between Trains: Test Ollama Connection | `betweenTrains.testOllamaConnection` |
| Between Trains: Fetch New Memes | `betweenTrains.fetchMemes` |
| Between Trains: Fetch New Videos | `betweenTrains.fetchVideos` |
| Between Trains: Set News Search API Key | `betweenTrains.setNewsApiKey` |
| Between Trains: Show Local Metadata Location | `betweenTrains.showLocalMetadata` |
| Between Trains: Export Local Metadata | `betweenTrains.exportLocalMetadata` |
| Between Trains: Clear Session History | `betweenTrains.clearSessionHistory` |
| Between Trains: Reset Personalization | `betweenTrains.resetPersonalization` |
| Between Trains: Clear Generated Content Cache | `betweenTrains.clearGeneratedContentCache` |
| Between Trains: Clear All Local Metadata | `betweenTrains.clearLocalMetadata` |

## Settings

| Setting | Default | Description |
|---|---|---|
| `betweenTrains.enabled` | `true` | Master on/off switch. |
| `betweenTrains.autoOpen.enabled` | `false` | Auto-open the waiting room when an agent is detected. Off by default; the MVP is manual-first. |
| `betweenTrains.defaultMode` | `lastUsed` | Which mode opens with a session. |
| `betweenTrains.brain.enabled` | `true` | Use the local Ollama brain to curate content and generate learning cards (off = deterministic fallback; learning cards need the brain). |
| `betweenTrains.brain.provider` | `ollama` | LLM backend for the brain. Editable from the panel's Global config. |
| `betweenTrains.brain.workspaceContext.enabled` | `false` | Allow small, safe workspace hints (e.g. active language). Never sends source. |
| `betweenTrains.ollama.baseUrl` | `http://localhost:11434` | Local Ollama server. |
| `betweenTrains.ollama.model` | `llama3.2` | Ollama model. |
| `betweenTrains.ollama.timeoutMs` | `30000` | Timeout before falling back. |
| `betweenTrains.memes.autoFetch` | `false` | Automatically fetch new memes/GIFs on entering the mode. |
| `betweenTrains.memes.fetchCount` | `20` | How many new memes to fetch per run. |
| `betweenTrains.videos.autoFetch` | `false` | Automatically fetch new videos on entering the mode. |
| `betweenTrains.videos.fetchCount` | `15` | How many new videos to fetch per run. |
| `betweenTrains.news.provider` | `tavily` | News search provider (`tavily`, `brave`, or `serper`). Needs an API key. |
| `betweenTrains.news.autoFetch` | `false` | Automatically fetch news on entering the mode. |
| `betweenTrains.news.fetchCount` | `10` | How many news cards to fetch per run. |
| `betweenTrains.learning.autoFetch` | `false` | Automatically generate learning cards when the deck runs low. |
| `betweenTrains.learning.cardCount` | `8` | How many learning cards to generate per run. |
| `betweenTrains.autoFetch.cooldownMinutes` | `30` | Minimum minutes between automatic fetches per stream. |
| `betweenTrains.metadata.enabled` | `true` | Store local personalization metadata on this machine. |
| `betweenTrains.metadata.retentionDays` | `30` | Days of raw session history to keep. |

## Privacy

Between Trains is local-first. No workspace content leaves your machine unless you explicitly enable a networked feature. The Ollama integration talks to a local server by default, and there is no telemetry.

Session metadata is stored on your machine in VS Code's per-extension global storage as append-only JSONL traces (`sessions/`) plus aggregate stats (`profile/`). These records contain only interaction patterns — session start/end, chosen mode, durations — never source code or prompts. You can inspect, export, or clear them at any time:

- **Show Local Metadata Location** opens the storage folder.
- **Export Local Metadata** saves everything to a JSON file.
- **Clear Session History / Reset Personalization / Clear Generated Content Cache** remove data granularly; **Clear All Local Metadata** removes everything.

Set `betweenTrains.metadata.enabled` to `false` to stop all metadata writing, and `betweenTrains.metadata.retentionDays` to control how long raw session history is kept (older files are pruned on startup).

## Requirements

- VS Code `^1.101.0`
- (Optional) A running [Ollama](https://ollama.com) server. It powers the Learning Cards mode and improves content curation for the meme/video/news modes; those three fall back to a no-LLM fetcher when it is absent, and games/ambient/physical modes need nothing.
- (Optional) A news search API key (Tavily, Brave, or Serper) for the News mode.

## Development

```bash
npm install        # install dependencies
npm run compile    # type-check + bundle with esbuild
npm run watch      # rebuild on change (used by F5)
npm run lint       # eslint
npm test           # VS Code integration tests
```

See [CHANGELOG.md](CHANGELOG.md) for release notes.

## License

[MIT](LICENSE)
