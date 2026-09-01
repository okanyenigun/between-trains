// Waiting-room webview script. Vanilla JS, loaded with a CSP nonce.
// It renders session info + the selected mode pushed from the extension host,
// hosts the in-panel mode picker, and reports user actions back. It holds no
// secrets and never touches workspace content. All text is rendered via
// textContent (never innerHTML) so nothing from the host is interpreted as markup.
(function () {
  "use strict";

  const vscode = acquireVsCodeApi();
  const byId = (id) => document.getElementById(id);

  // Emoji + product-facing group label per category (product brief §11.3).
  // The single source of category display strings on the webview side; kept in
  // sync with CATEGORY_LABEL in src/modes/ModeSelector.ts.
  const CATEGORY = {
    ambient: { emoji: "🌊", label: "Ambient Zen" },
    microgame: { emoji: "🎮", label: "Micro-Games" },
    learning: { emoji: "🧠", label: "Learning Cards" },
    physical: { emoji: "🧘", label: "Physical Break" },
    media: { emoji: "🎬", label: "Media" },
    news: { emoji: "📰", label: "News" },
  };

  let visible = true;
  let modesList = [];
  let currentModeId = null;
  let currentGame = null;
  const gameStats = {}; // gameId → { best, plays }, cached from the host

  function stopGame() {
    if (currentGame) {
      currentGame.destroy();
      currentGame = null;
    }
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) {
      node.className = className;
    }
    if (text != null) {
      node.textContent = text;
    }
    return node;
  }

  const GAME_HINTS = {
    "microgame.meteorDodge": "← → or mouse to dodge · Space or click to fire. Break meteors and survive.",
    "microgame.tinyBasketball": "Drag back from the ball and release to shoot.",
  };

  /** Find the engine (games, ambient, …) that renders this mode id. */
  function engineFor(id) {
    if (window.BTGames && window.BTGames.has(id)) {
      return { engine: window.BTGames, hint: GAME_HINTS[id] || null, isGame: true };
    }
    if (window.BTAmbient && window.BTAmbient.has(id)) {
      return { engine: window.BTAmbient, hint: null, isGame: false };
    }
    if (window.BTPhysical && window.BTPhysical.has(id)) {
      return { engine: window.BTPhysical, hint: null, isGame: false };
    }
    return null;
  }

  function renderExperience(mode, found) {
    stopGame();
    currentModeId = mode.id;
    const wrap = el("div", "bt-game");
    const host = el("div", "bt-game-host");
    wrap.appendChild(host);
    if (found.hint) {
      wrap.appendChild(el("p", "bt-game-hint", found.hint));
    }
    byId("bt-content").replaceChildren(wrap);
    currentGame = found.engine.create(mode.id, host, {
      started: (gameId) => vscode.postMessage({ type: "game/started", gameId }),
      completed: (gameId, score) => vscode.postMessage({ type: "game/completed", gameId, score }),
      initialStats: gameStats[mode.id] || null,
    });
    if (!visible) {
      currentGame.setVisible(false);
    }
    if (found.isGame) {
      vscode.postMessage({ type: "game/statsRequest", gameId: mode.id });
    }
  }

  function renderMode(mode) {
    if (!mode || typeof mode.id !== "string") {
      return;
    }
    stopGame();
    currentModeId = mode.id;
    const cat = CATEGORY[mode.category] || { emoji: "🚉", label: String(mode.category || "") };

    const card = el("div", "bt-mode-card");
    card.appendChild(el("div", "bt-mode-emoji", cat.emoji));
    card.appendChild(el("div", "bt-mode-badge", cat.label));
    card.appendChild(el("h2", "bt-mode-title", mode.title || mode.id));
    if (mode.description) {
      card.appendChild(el("p", "bt-mode-desc", mode.description));
    }

    const chips = el("div", "bt-chips");
    if (mode.requiresBrain) {
      chips.appendChild(el("span", "bt-chip", "Needs Ollama"));
    }
    if (mode.requiresNetwork) {
      chips.appendChild(el("span", "bt-chip", "Networked"));
    }
    if (chips.childNodes.length) {
      card.appendChild(chips);
    }

    card.appendChild(
      el("p", "bt-mode-note", "Preview — the full experience lands in an upcoming stop.")
    );

    byId("bt-content").replaceChildren(card);
  }

  // --- global config --------------------------------------------------------

  function selectRow(labelText, options, currentValue, onChange, disabledText) {
    const row = el("div", "bt-config-row");
    row.appendChild(el("label", "bt-config-label", labelText));
    const select = document.createElement("select");
    select.className = "bt-select";
    if (!options.length) {
      const opt = document.createElement("option");
      opt.textContent = disabledText || "None available";
      opt.disabled = true;
      opt.selected = true;
      select.appendChild(opt);
      select.disabled = true;
    } else {
      options.forEach((o) => {
        const opt = document.createElement("option");
        opt.value = o.value;
        opt.textContent = o.label;
        if (o.value === currentValue) {
          opt.selected = true;
        }
        select.appendChild(opt);
      });
      select.addEventListener("change", () => onChange(select.value));
    }
    row.appendChild(select);
    return row;
  }

  function renderConfig(cfg) {
    stopGame();
    cfg = cfg || {};
    const wrap = el("div", "bt-config");
    wrap.appendChild(el("h2", "bt-config-title", "Global configuration"));
    wrap.appendChild(
      el("p", "bt-config-sub", "Shared by every mode and remembered across sessions.")
    );

    const providerOptions = (cfg.providers || []).map((p) => ({ value: p.id, label: p.label }));
    wrap.appendChild(
      selectRow("Provider", providerOptions, cfg.provider, (value) =>
        vscode.postMessage({ type: "config/setProvider", value })
      )
    );

    const models = (cfg.models || []).slice();
    if (cfg.model && models.indexOf(cfg.model) === -1) {
      models.unshift(cfg.model);
    }
    const modelOptions = models.map((m) => ({ value: m, label: m }));
    wrap.appendChild(
      selectRow(
        "Model",
        modelOptions,
        cfg.model,
        (value) => vscode.postMessage({ type: "config/setModel", value }),
        "No models found"
      )
    );

    if (cfg.note) {
      wrap.appendChild(el("p", "bt-config-note", cfg.note));
    }

    // News search provider + API key (key entry uses a native secure prompt).
    wrap.appendChild(el("h3", "bt-config-heading", "News search"));
    const newsProviderOptions = (cfg.newsProviders || []).map((p) => ({
      value: p.id,
      label: p.label,
    }));
    wrap.appendChild(
      selectRow("Provider", newsProviderOptions, cfg.newsProvider, (value) =>
        vscode.postMessage({ type: "config/setNewsProvider", value })
      )
    );
    const keyRow = el("div", "bt-config-row");
    keyRow.appendChild(el("label", "bt-config-label", "API key"));
    const keyStatus = el(
      "span",
      "bt-config-keystatus",
      cfg.newsKeySet ? "✓ set" : "not set"
    );
    keyRow.appendChild(keyStatus);
    const setKey = el("button", "bt-btn", cfg.newsKeySet ? "Change" : "Set key");
    setKey.type = "button";
    setKey.addEventListener("click", () => vscode.postMessage({ type: "config/setNewsApiKey" }));
    keyRow.appendChild(setKey);
    if (cfg.newsKeySet) {
      const clearKey = el("button", "bt-btn", "Clear");
      clearKey.type = "button";
      clearKey.addEventListener("click", () =>
        vscode.postMessage({ type: "config/clearNewsApiKey" })
      );
      keyRow.appendChild(clearKey);
    }
    wrap.appendChild(keyRow);

    // Keyboard shortcut — opens VS Code's Keyboard Shortcuts editor, where the
    // toggle binding can be viewed and remapped.
    wrap.appendChild(el("h3", "bt-config-heading", "Keyboard shortcut"));
    const shortcutRow = el("div", "bt-config-row");
    shortcutRow.appendChild(el("label", "bt-config-label", "Open / close"));
    shortcutRow.appendChild(el("span", "bt-config-keystatus", "Ctrl + Q"));
    const changeShortcut = el("button", "bt-btn", "Change…");
    changeShortcut.type = "button";
    changeShortcut.addEventListener("click", () =>
      vscode.postMessage({ type: "config/openKeybindings" })
    );
    shortcutRow.appendChild(changeShortcut);
    wrap.appendChild(shortcutRow);

    // Usage & data.
    wrap.appendChild(el("h3", "bt-config-heading", "Usage & data"));
    const dataRow = el("div", "bt-config-actions");
    const statsBtn = el("button", "bt-btn", "📊 Usage stats");
    statsBtn.type = "button";
    statsBtn.addEventListener("click", () => vscode.postMessage({ type: "config/openStats" }));
    const folderBtn = el("button", "bt-btn", "📂 Open records folder");
    folderBtn.type = "button";
    folderBtn.addEventListener("click", () => vscode.postMessage({ type: "config/openStorage" }));
    dataRow.appendChild(statsBtn);
    dataRow.appendChild(folderBtn);
    wrap.appendChild(dataRow);

    const actions = el("div", "bt-config-actions");
    const refresh = el("button", "bt-btn", "↻ Refresh models");
    refresh.type = "button";
    refresh.addEventListener("click", () => vscode.postMessage({ type: "config/refreshModels" }));
    const back = el("button", "bt-btn bt-btn-stop", "← Back");
    back.type = "button";
    back.addEventListener("click", () => vscode.postMessage({ type: "config/close" }));
    actions.appendChild(refresh);
    actions.appendChild(back);
    wrap.appendChild(actions);

    byId("bt-content").replaceChildren(wrap);
  }

  // --- usage stats ----------------------------------------------------------

  function statTile(label, value) {
    const tile = el("div", "bt-stat-tile");
    tile.appendChild(el("div", "bt-stat-value", value));
    tile.appendChild(el("div", "bt-stat-label", label));
    return tile;
  }

  function formatDuration(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    if (h > 0) {
      return h + "h " + m + "m";
    }
    if (m > 0) {
      return m + "m";
    }
    return total + "s";
  }

  function shortDate(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) {
      return String(iso).slice(0, 10);
    }
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }

  function renderStats(stats) {
    stopGame();
    const s = stats || {};
    const wrap = el("div", "bt-stats");

    const header = el("div", "bt-video-header");
    const back = el("button", "bt-btn", "← Back");
    back.addEventListener("click", () => vscode.postMessage({ type: "config/open" }));
    header.appendChild(back);
    header.appendChild(el("span", "bt-video-liked-title", "Usage stats"));
    wrap.appendChild(header);

    if (!s.enabled) {
      wrap.appendChild(
        el(
          "p",
          "bt-config-note",
          "Local metadata is off — little is being recorded. Turn it on in settings to track usage."
        )
      );
    }
    if (!s.events) {
      wrap.appendChild(el("p", "bt-meme-empty", "No activity recorded yet."));
      byId("bt-content").replaceChildren(wrap);
      return;
    }

    const tiles = el("div", "bt-stats-tiles");
    tiles.appendChild(statTile("Sessions", String(s.sessions || 0)));
    tiles.appendChild(statTile("Time in room", formatDuration(s.totalActiveMs || 0)));
    tiles.appendChild(statTile("Events logged", String(s.events || 0)));
    wrap.appendChild(tiles);

    if (s.firstAt) {
      wrap.appendChild(
        el(
          "p",
          "bt-stats-range",
          "Since " + shortDate(s.firstAt) + (s.lastAt ? " · last active " + shortDate(s.lastAt) : "")
        )
      );
    }

    const modes = Array.isArray(s.topModes) ? s.topModes : [];
    if (modes.length) {
      wrap.appendChild(el("h3", "bt-config-heading", "Most-used modes"));
      const max = modes[0].count || 1;
      const bars = el("div", "bt-stats-bars");
      modes.forEach((m) => {
        const row = el("div", "bt-stats-bar");
        row.appendChild(el("span", "bt-stats-bar-label", m.label));
        const track = el("div", "bt-stats-bar-track");
        const fill = el("div", "bt-stats-bar-fill");
        fill.style.width = Math.max(6, Math.round((m.count / max) * 100)) + "%";
        track.appendChild(fill);
        row.appendChild(track);
        row.appendChild(el("span", "bt-stats-bar-count", String(m.count)));
        bars.appendChild(row);
      });
      wrap.appendChild(bars);
    }

    wrap.appendChild(el("h3", "bt-config-heading", "Content"));
    const content = el("div", "bt-stats-tiles");
    content.appendChild(statTile("Memes kept", String((s.memes || {}).liked || 0)));
    content.appendChild(statTile("Videos liked", String((s.videos || {}).liked || 0)));
    content.appendChild(statTile("News opened", String((s.news || {}).opened || 0)));
    content.appendChild(statTile("Cards learned", String((s.learning || {}).known || 0)));
    wrap.appendChild(content);

    const games = Array.isArray(s.games) ? s.games : [];
    if (games.length) {
      wrap.appendChild(el("h3", "bt-config-heading", "Games"));
      const glist = el("div", "bt-video-list");
      games.forEach((g) => {
        const item = el("div", "bt-learn-lib-item");
        const head = el("div", "bt-learn-lib-head");
        head.appendChild(el("div", "bt-video-item-title", g.label));
        head.appendChild(el("span", "bt-stats-badge", "best " + g.best));
        item.appendChild(head);
        item.appendChild(
          el("div", "bt-video-item-channel", g.plays + (g.plays === 1 ? " play" : " plays"))
        );
        glist.appendChild(item);
      });
      wrap.appendChild(glist);
    }

    byId("bt-content").replaceChildren(wrap);
  }

  // --- news cards -----------------------------------------------------------

  const NEWS_MODE_IDS = ["news.technology", "news.world", "news.business", "news.science"];
  const isNewsModeId = (id) => NEWS_MODE_IDS.indexOf(id) !== -1;
  let newsState = null;
  let newsView = "card"; // "card" | "library"

  function renderNewsShell(modeId) {
    stopGame();
    currentModeId = modeId;
    newsView = "card";
    const wrap = el("div", "bt-news");
    wrap.appendChild(el("p", "bt-meme-empty", "Loading news…"));
    byId("bt-content").replaceChildren(wrap);
  }

  // A branded accent colour per category, like a news site's section colour.
  const NEWS_ACCENTS = {
    technology: "#3b82f6",
    world: "#10b981",
    business: "#f59e0b",
    science: "#8b5cf6",
  };
  function newsAccent(category) {
    return NEWS_ACCENTS[category] || "#3b82f6";
  }

  function newsStatusText(s) {
    let text = s.total + (s.total === 1 ? " card" : " cards");
    if (s.fetching) {
      text += " · fetching " + (s.savedThisRun || 0) + "…";
    } else if (s.lastFetch && !s.lastFetch.ok && s.lastFetch.error !== "no-api-key") {
      text += " · last fetch failed";
    }
    return text;
  }

  function renderNewsState(state) {
    newsState = state || {};
    const s = newsState;
    if (newsView === "library") {
      renderNewsLibrary(s);
      return;
    }
    const wrap = el("div", "bt-news");

    if (!s.hasApiKey) {
      const box = el("div", "bt-meme-empty-box");
      box.appendChild(el("div", "bt-mode-emoji", "🔑"));
      box.appendChild(
        el(
          "p",
          "bt-meme-empty",
          "Add a " + (s.provider || "search") + " API key in Global config (⚙) to load news."
        )
      );
      wrap.appendChild(box);
      byId("bt-content").replaceChildren(wrap);
      return;
    }

    if (s.card) {
      const openArticle = () => vscode.postMessage({ type: "news/openLink", id: s.card.id });
      const card = el("div", "bt-news-card");
      card.style.setProperty("--news-accent", newsAccent(s.category));

      card.appendChild(el("div", "bt-news-kicker", s.category));

      const headline = el("h2", "bt-news-headline", s.card.headline);
      if (s.card.url) {
        headline.classList.add("is-link");
        headline.addEventListener("click", openArticle);
      }
      card.appendChild(headline);

      card.appendChild(el("p", "bt-news-summary", s.card.summary));

      const foot = el("div", "bt-news-foot");
      const src = el("div", "bt-news-src");
      const initial = (s.card.source || "?").trim().charAt(0).toUpperCase() || "?";
      src.appendChild(el("div", "bt-news-avatar", initial));
      const srcText = el("div", "bt-news-src-text");
      srcText.appendChild(el("span", "bt-news-source", s.card.source || "Source"));
      if (s.card.publishedAt) {
        srcText.appendChild(el("span", "bt-news-date", s.card.publishedAt));
      }
      src.appendChild(srcText);
      foot.appendChild(src);
      if (s.card.url) {
        const read = el("button", "bt-news-read", "Read ↗");
        read.type = "button";
        read.addEventListener("click", openArticle);
        foot.appendChild(read);
      }
      card.appendChild(foot);

      wrap.appendChild(card);

      const nav = el("div", "bt-news-nav");
      const prev = el("button", "bt-btn", "← Prev");
      prev.type = "button";
      prev.disabled = s.index <= 0;
      prev.addEventListener("click", () => vscode.postMessage({ type: "news/prev" }));
      const pos = el("span", "bt-news-pos", s.index + 1 + " / " + s.total);
      const next = el("button", "bt-btn", "Next →");
      next.type = "button";
      next.disabled = s.index >= s.total - 1;
      next.addEventListener("click", () => vscode.postMessage({ type: "news/next" }));
      nav.appendChild(prev);
      nav.appendChild(pos);
      nav.appendChild(next);
      wrap.appendChild(nav);
    } else {
      const box = el("div", "bt-meme-empty-box");
      if (s.fetching) {
        box.appendChild(el("div", "bt-spinner"));
        box.appendChild(el("p", "bt-meme-empty", "The agent is fetching news…"));
      } else {
        box.appendChild(el("div", "bt-mode-emoji", "📰"));
        box.appendChild(el("p", "bt-meme-empty", "No news yet. Press Refresh to fetch."));
      }
      wrap.appendChild(box);
    }

    // config strip
    const config = el("div", "bt-meme-config");
    const autoLabel = el("label", "bt-meme-auto-label");
    const auto = document.createElement("input");
    auto.type = "checkbox";
    auto.checked = !!s.autoFetch;
    auto.addEventListener("change", () =>
      vscode.postMessage({ type: "news/setAutoFetch", value: auto.checked })
    );
    autoLabel.appendChild(auto);
    autoLabel.appendChild(document.createTextNode(" Auto-fetch on open"));
    const refresh = el("button", "bt-btn", "↻ Refresh");
    refresh.disabled = !!s.fetching;
    refresh.addEventListener("click", () => vscode.postMessage({ type: "news/refresh" }));
    const libBtn = el("button", "bt-btn", "🗂 Library (" + (s.total || 0) + ")");
    libBtn.addEventListener("click", () => {
      newsView = "library";
      renderNewsState(newsState);
    });
    const status = el("span", "bt-meme-status", newsStatusText(s));
    config.appendChild(autoLabel);
    config.appendChild(refresh);
    config.appendChild(libBtn);
    config.appendChild(status);
    wrap.appendChild(config);

    byId("bt-content").replaceChildren(wrap);
  }

  function renderNewsLibrary(s) {
    const wrap = el("div", "bt-news");

    const header = el("div", "bt-video-header");
    const back = el("button", "bt-btn", "← Back");
    back.addEventListener("click", () => {
      newsView = "card";
      renderNewsState(newsState);
    });
    header.appendChild(back);
    const cat = s.category ? s.category.charAt(0).toUpperCase() + s.category.slice(1) : "News";
    header.appendChild(el("span", "bt-video-liked-title", cat + " library"));
    const items = Array.isArray(s.libraryList) ? s.libraryList : [];
    const clear = el("button", "bt-btn bt-btn-danger", "🗑 Clear");
    clear.disabled = items.length === 0;
    clear.addEventListener("click", () => vscode.postMessage({ type: "news/clearLibrary" }));
    header.appendChild(clear);
    wrap.appendChild(header);

    const list = el("div", "bt-video-list");
    if (items.length === 0) {
      list.appendChild(el("p", "bt-meme-empty", "No saved news cards yet."));
    } else {
      items.forEach((c) => {
        const item = el("button", "bt-video-item");
        const meta = el("div", "bt-video-item-meta");
        meta.appendChild(el("div", "bt-video-item-title", c.headline));
        meta.appendChild(
          el("div", "bt-video-item-channel", c.source + (c.publishedAt ? " · " + c.publishedAt : ""))
        );
        item.appendChild(meta);
        if (c.url) {
          item.addEventListener("click", () =>
            vscode.postMessage({ type: "news/openLink", id: c.id })
          );
        }
        list.appendChild(item);
      });
    }
    wrap.appendChild(list);
    byId("bt-content").replaceChildren(wrap);
  }

  // --- meme swipe deck ------------------------------------------------------

  const MEME_MODE_ID = "media.memeGifs";
  let memeGif = null; // gif currently on the card
  let memeBusy = false; // true while a card is flying out
  let memeState = null;
  let memeView = "deck"; // "deck" | "kept"

  function renderMemeShell() {
    stopGame();
    currentModeId = MEME_MODE_ID;
    memeView = "deck";
    const wrap = el("div", "bt-meme");
    wrap.appendChild(el("p", "bt-meme-empty", "Loading your meme deck…"));
    byId("bt-content").replaceChildren(wrap);
  }

  function renderMemeState(state) {
    memeState = state || {};
    renderMemeView();
  }

  function renderMemeView() {
    const s = memeState || {};
    if (memeView === "kept") {
      renderMemeGrid("Kept memes", s.keptList, false);
    } else if (memeView === "library") {
      renderMemeGrid("Library", s.libraryList, true);
    } else {
      renderMemeDeck(s);
    }
  }

  function memeStatusText(s) {
    let text = (s.available || 0) + " in library · " + (s.liked || 0) + " kept";
    if (s.fetching) {
      text += " · fetching " + (s.savedThisRun || 0) + "/" + (s.fetchCount || 0) + "…";
    } else if (s.lastFetch && !s.lastFetch.ok) {
      text += " · last fetch failed";
    }
    return text;
  }

  function memeConfig(s) {
    const config = el("div", "bt-meme-config");
    const autoLabel = el("label", "bt-meme-auto-label");
    const auto = document.createElement("input");
    auto.type = "checkbox";
    auto.checked = !!s.autoFetch;
    auto.addEventListener("change", () => {
      vscode.postMessage({ type: "meme/setAutoFetch", value: auto.checked });
    });
    autoLabel.appendChild(auto);
    autoLabel.appendChild(document.createTextNode(" Auto-fetch on open"));
    const fetchBtn = el("button", "bt-btn", "↓ Fetch now");
    fetchBtn.disabled = !!s.fetching;
    fetchBtn.addEventListener("click", () => vscode.postMessage({ type: "meme/fetchNow" }));
    const status = el("span", "bt-meme-status", memeStatusText(s));
    config.appendChild(autoLabel);
    config.appendChild(fetchBtn);
    config.appendChild(status);
    return config;
  }

  function renderMemeDeck(s) {
    const wrap = el("div", "bt-meme");

    const header = el("div", "bt-video-header");
    const keptBtn = el("button", "bt-btn", "♥ Kept (" + (s.liked || 0) + ")");
    keptBtn.disabled = !(s.liked > 0);
    keptBtn.addEventListener("click", () => {
      memeView = "kept";
      renderMemeView();
    });
    const libBtn = el("button", "bt-btn", "🗂 Library (" + (s.available || 0) + ")");
    libBtn.disabled = !(s.available > 0);
    libBtn.addEventListener("click", () => {
      memeView = "library";
      renderMemeView();
    });
    header.appendChild(keptBtn);
    header.appendChild(libBtn);
    wrap.appendChild(header);

    const stage = el("div", "bt-meme-stage");
    memeGif = s.gif || null;
    memeBusy = false;
    if (memeGif) {
      stage.appendChild(buildMemeCard(memeGif));
    } else if (s.fetching) {
      const box = el("div", "bt-meme-empty-box");
      box.appendChild(el("div", "bt-spinner"));
      box.appendChild(el("p", "bt-meme-empty", "The agent is fetching memes…"));
      stage.appendChild(box);
    } else {
      const box = el("div", "bt-meme-empty-box");
      box.appendChild(el("div", "bt-mode-emoji", "🎬"));
      box.appendChild(
        el(
          "p",
          "bt-meme-empty",
          "No memes in the library yet. Press “Fetch now” to send the agent out" +
            (s.liked > 0 ? ", or open your kept list." : ".")
        )
      );
      stage.appendChild(box);
    }
    wrap.appendChild(stage);

    const actions = el("div", "bt-meme-actions");
    const skip = el("button", "bt-btn bt-meme-btn", "✕ Skip");
    skip.addEventListener("click", () => flyOut(false));
    const keep = el("button", "bt-btn bt-btn-stop bt-meme-btn", "♥ Keep");
    keep.addEventListener("click", () => flyOut(true));
    actions.appendChild(skip);
    actions.appendChild(keep);
    wrap.appendChild(actions);

    wrap.appendChild(memeConfig(s));
    byId("bt-content").replaceChildren(wrap);
  }

  // Shared grid view for the Kept and Library lists.
  function renderMemeGrid(title, list, withClear) {
    const wrap = el("div", "bt-meme");

    const header = el("div", "bt-video-header");
    const back = el("button", "bt-btn", "← Back");
    back.addEventListener("click", () => {
      memeView = "deck";
      renderMemeView();
    });
    header.appendChild(back);
    header.appendChild(el("span", "bt-video-liked-title", title));
    const items = Array.isArray(list) ? list : [];
    if (withClear) {
      const clear = el("button", "bt-btn bt-btn-danger", "🗑 Clear");
      clear.disabled = items.length === 0;
      clear.addEventListener("click", () => vscode.postMessage({ type: "meme/clearLibrary" }));
      header.appendChild(clear);
    }
    wrap.appendChild(header);

    if (items.length === 0) {
      wrap.appendChild(el("p", "bt-meme-empty", "Nothing here yet."));
    } else {
      const grid = el("div", "bt-meme-kept-grid");
      items.forEach((g) => {
        const item = el("button", "bt-meme-kept-item");
        item.title = (g.title || "meme") + " · " + g.source;
        const img = document.createElement("img");
        img.className = "bt-meme-kept-thumb";
        img.src = g.uri;
        img.alt = g.title || "meme";
        img.loading = "lazy";
        img.draggable = false;
        item.appendChild(img);
        item.addEventListener("click", () => openMemeLightbox(g));
        grid.appendChild(item);
      });
      wrap.appendChild(grid);
    }
    byId("bt-content").replaceChildren(wrap);
  }

  // Show one kept GIF large, in a dismissable overlay.
  function openMemeLightbox(g) {
    const overlay = el("div", "bt-lightbox");
    const img = document.createElement("img");
    img.className = "bt-lightbox-img";
    img.src = g.uri;
    img.alt = g.title || "meme";
    overlay.appendChild(img);
    overlay.appendChild(el("div", "bt-lightbox-cap", (g.title || "meme") + " · " + g.source));
    const close = el("button", "bt-lightbox-close", "✕");
    close.setAttribute("aria-label", "Close");
    close.addEventListener("click", () => overlay.remove());
    overlay.appendChild(close);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) {
        overlay.remove();
      }
    });
    byId("bt-content").appendChild(overlay);
  }

  function buildMemeCard(gif) {
    const card = el("div", "bt-meme-card");

    const like = el("div", "bt-meme-badge bt-meme-badge-like", "KEEP");
    const nope = el("div", "bt-meme-badge bt-meme-badge-nope", "SKIP");
    card.appendChild(like);
    card.appendChild(nope);

    const img = document.createElement("img");
    img.className = "bt-meme-img";
    img.src = gif.uri;
    img.alt = gif.title || "meme";
    img.draggable = false;
    card.appendChild(img);

    card.appendChild(el("div", "bt-meme-caption", (gif.title || "meme") + " · " + gif.source));

    let drag = null;
    card.addEventListener("pointerdown", (e) => {
      if (memeBusy) {
        return;
      }
      drag = { x0: e.clientX, dx: 0 };
      card.setPointerCapture(e.pointerId);
      card.classList.add("is-dragging");
    });
    card.addEventListener("pointermove", (e) => {
      if (!drag) {
        return;
      }
      drag.dx = e.clientX - drag.x0;
      card.style.transform = "translateX(" + drag.dx + "px) rotate(" + drag.dx / 18 + "deg)";
      like.style.opacity = String(Math.max(0, Math.min(1, drag.dx / 90)));
      nope.style.opacity = String(Math.max(0, Math.min(1, -drag.dx / 90)));
    });
    const endDrag = () => {
      if (!drag) {
        return;
      }
      const dx = drag.dx;
      drag = null;
      card.classList.remove("is-dragging");
      if (Math.abs(dx) > 90) {
        flyOut(dx > 0);
      } else {
        card.style.transform = "";
        like.style.opacity = "0";
        nope.style.opacity = "0";
      }
    };
    card.addEventListener("pointerup", endDrag);
    card.addEventListener("pointercancel", endDrag);

    return card;
  }

  /** Animate the card off-screen, then report the rating to the host. */
  function flyOut(liked) {
    if (!memeGif || memeBusy) {
      return;
    }
    memeBusy = true;
    const id = memeGif.id;
    const card = document.querySelector(".bt-meme-card");
    if (card) {
      card.classList.add(liked ? "fly-right" : "fly-left");
    }
    setTimeout(() => {
      vscode.postMessage({ type: "meme/rate", id, liked });
    }, 220);
  }

  // --- video mode -----------------------------------------------------------

  const VIDEO_MODE_IDS = ["media.videoRandom", "media.videoProgramming"];
  const isVideoModeId = (id) => VIDEO_MODE_IDS.indexOf(id) !== -1;
  let videoState = null;
  let videoView = "deck"; // "deck" | "liked"
  let displayedVideoId = null; // videoId currently rendered in the deck

  function videoCaption(video) {
    const cap = el("div", "bt-video-caption");
    cap.appendChild(el("span", "bt-video-caption-text", video.title + " · " + video.channel));
    const open = document.createElement("a");
    open.className = "bt-video-open";
    open.href = "#";
    open.textContent = "↗ YouTube";
    open.title = "Open on YouTube if the embed won't play";
    open.addEventListener("click", (e) => {
      e.preventDefault();
      vscode.postMessage({ type: "video/openExternal", videoId: video.videoId });
    });
    cap.appendChild(open);
    return cap;
  }

  function renderVideoShell(modeId) {
    stopGame();
    currentModeId = modeId;
    videoView = "deck";
    displayedVideoId = null;
    const wrap = el("div", "bt-video");
    wrap.appendChild(el("p", "bt-meme-empty", "Loading your video deck…"));
    byId("bt-content").replaceChildren(wrap);
  }

  function renderVideoView() {
    const s = videoState || {};
    if (videoView === "liked") {
      renderVideoLiked(s);
    } else if (videoView === "library") {
      renderVideoLibrary(s);
    } else {
      renderVideoDeck(s);
    }
  }

  function renderVideoDeck(s) {
    const wrap = el("div", "bt-video");

    const header = el("div", "bt-video-header");
    const likedBtn = el("button", "bt-btn", "♥ Liked (" + (s.likedCount || 0) + ")");
    likedBtn.id = "bt-video-liked-btn";
    likedBtn.disabled = !(s.likedCount > 0);
    likedBtn.addEventListener("click", () => {
      videoView = "liked";
      renderVideoView();
    });
    const libBtn = el("button", "bt-btn", "🗂 Library (" + (s.total || 0) + ")");
    libBtn.disabled = !(s.total > 0);
    libBtn.addEventListener("click", () => {
      videoView = "library";
      renderVideoView();
    });
    header.appendChild(likedBtn);
    header.appendChild(libBtn);
    wrap.appendChild(header);

    const stage = el("div", "bt-video-stage");
    if (s.current) {
      const poster = el("div", "bt-video-poster");
      const img = document.createElement("img");
      img.className = "bt-video-poster-img";
      img.src =
        "https://i.ytimg.com/vi/" + encodeURIComponent(s.current.videoId) + "/hqdefault.jpg";
      img.alt = s.current.title || "";
      poster.appendChild(img);
      const play = el("button", "bt-video-play", "▶");
      play.setAttribute("aria-label", "Watch on YouTube");
      play.title = "Watch on YouTube";
      play.addEventListener("click", () =>
        vscode.postMessage({ type: "video/openExternal", videoId: s.current.videoId })
      );
      poster.appendChild(play);
      stage.appendChild(poster);
      displayedVideoId = s.current.videoId;
      wrap.appendChild(stage);
      wrap.appendChild(videoCaption(s.current));

      const actions = el("div", "bt-meme-actions");
      const dislike = el("button", "bt-btn bt-meme-btn", "✕ Dislike");
      dislike.addEventListener("click", () => vscode.postMessage({ type: "video/rate", id: s.current.id, liked: false }));
      const like = el("button", "bt-btn bt-btn-stop bt-meme-btn", "♥ Like");
      like.addEventListener("click", () => vscode.postMessage({ type: "video/rate", id: s.current.id, liked: true }));
      const skip = el("button", "bt-btn bt-meme-btn", "Skip →");
      skip.addEventListener("click", () => vscode.postMessage({ type: "video/next" }));
      actions.appendChild(dislike);
      actions.appendChild(like);
      actions.appendChild(skip);
      wrap.appendChild(actions);
    } else {
      displayedVideoId = null;
      const box = el("div", "bt-meme-empty-box");
      if (s.fetching) {
        box.appendChild(el("div", "bt-spinner"));
        box.appendChild(el("p", "bt-meme-empty", "The agent is fetching videos…"));
      } else {
        box.appendChild(el("div", "bt-mode-emoji", "🎬"));
        box.appendChild(
          el(
            "p",
            "bt-meme-empty",
            (s.total > 0 ? "You've seen every saved video. " : "No videos yet. ") +
              "Press “Fetch now” to send the agent out" +
              (s.likedCount > 0 ? ", or open your liked list." : ".")
          )
        );
      }
      stage.appendChild(box);
      wrap.appendChild(stage);
    }

    wrap.appendChild(videoConfig(s));
    byId("bt-content").replaceChildren(wrap);
  }

  function renderVideoLiked(s) {
    displayedVideoId = null;
    const wrap = el("div", "bt-video");

    const header = el("div", "bt-video-header");
    const back = el("button", "bt-btn", "← Back");
    back.addEventListener("click", () => {
      videoView = "deck";
      renderVideoView();
    });
    header.appendChild(back);
    header.appendChild(el("span", "bt-video-liked-title", "Liked videos"));
    wrap.appendChild(header);

    const list = el("div", "bt-video-list");
    const liked = Array.isArray(s.liked) ? s.liked : [];
    if (liked.length === 0) {
      list.appendChild(el("p", "bt-meme-empty", "No liked videos yet."));
    } else {
      liked.forEach((v) => {
        const item = el("button", "bt-video-item");
        const thumb = document.createElement("img");
        thumb.className = "bt-video-thumb";
        thumb.src = "https://i.ytimg.com/vi/" + encodeURIComponent(v.videoId) + "/mqdefault.jpg";
        thumb.alt = "";
        item.appendChild(thumb);
        const meta = el("div", "bt-video-item-meta");
        meta.appendChild(el("div", "bt-video-item-title", v.title));
        meta.appendChild(el("div", "bt-video-item-channel", v.channel));
        item.appendChild(meta);
        item.addEventListener("click", () => {
          vscode.postMessage({ type: "video/replay", id: v.id });
          vscode.postMessage({ type: "video/openExternal", videoId: v.videoId });
        });
        list.appendChild(item);
      });
    }
    wrap.appendChild(list);
    byId("bt-content").replaceChildren(wrap);
  }

  function renderVideoLibrary(s) {
    displayedVideoId = null;
    const wrap = el("div", "bt-video");

    const header = el("div", "bt-video-header");
    const back = el("button", "bt-btn", "← Back");
    back.addEventListener("click", () => {
      videoView = "deck";
      renderVideoView();
    });
    header.appendChild(back);
    header.appendChild(el("span", "bt-video-liked-title", "Library"));
    const library = Array.isArray(s.library) ? s.library : [];
    const clear = el("button", "bt-btn bt-btn-danger", "🗑 Clear");
    clear.disabled = library.length === 0;
    clear.addEventListener("click", () => vscode.postMessage({ type: "video/clearLibrary" }));
    header.appendChild(clear);
    wrap.appendChild(header);

    const list = el("div", "bt-video-list");
    if (library.length === 0) {
      list.appendChild(el("p", "bt-meme-empty", "No saved videos yet."));
    } else {
      library.forEach((v) => {
        const item = el("button", "bt-video-item");
        const thumb = document.createElement("img");
        thumb.className = "bt-video-thumb";
        thumb.src = "https://i.ytimg.com/vi/" + encodeURIComponent(v.videoId) + "/mqdefault.jpg";
        thumb.alt = "";
        item.appendChild(thumb);
        const meta = el("div", "bt-video-item-meta");
        meta.appendChild(el("div", "bt-video-item-title", v.title));
        meta.appendChild(el("div", "bt-video-item-channel", v.channel));
        item.appendChild(meta);
        item.addEventListener("click", () =>
          vscode.postMessage({ type: "video/openExternal", videoId: v.videoId })
        );
        list.appendChild(item);
      });
    }
    wrap.appendChild(list);
    byId("bt-content").replaceChildren(wrap);
  }

  function videoConfig(s) {
    const config = el("div", "bt-meme-config");
    const autoLabel = el("label", "bt-meme-auto-label");
    const auto = document.createElement("input");
    auto.type = "checkbox";
    auto.checked = !!s.autoFetch;
    auto.addEventListener("change", () => {
      vscode.postMessage({ type: "video/setAutoFetch", value: auto.checked });
    });
    autoLabel.appendChild(auto);
    autoLabel.appendChild(document.createTextNode(" Auto-fetch on open"));
    const fetchBtn = el("button", "bt-btn", "↓ Fetch now");
    fetchBtn.id = "bt-video-fetch";
    fetchBtn.disabled = !!s.fetching;
    fetchBtn.addEventListener("click", () => vscode.postMessage({ type: "video/fetchNow" }));
    const status = el("span", "bt-meme-status", videoStatusText(s));
    status.id = "bt-video-status";
    config.appendChild(autoLabel);
    config.appendChild(fetchBtn);
    config.appendChild(status);
    return config;
  }

  function videoStatusText(s) {
    let text = (s.unseen || 0) + " to watch · " + (s.likedCount || 0) + " liked";
    if (s.fetching) {
      text += " · fetching " + (s.savedThisRun || 0) + "/" + (s.fetchCount || 0) + "…";
    } else if (s.lastFetch && !s.lastFetch.ok) {
      text += " · last fetch failed";
    }
    return text;
  }

  function renderVideoState(state) {
    videoState = state || {};
    if (videoView === "deck") {
      const cur = videoState.current;
      // Same video: update chrome only, don't rebuild (keeps any inline iframe).
      if (cur && cur.videoId === displayedVideoId) {
        const likedBtn = byId("bt-video-liked-btn");
        if (likedBtn) {
          likedBtn.textContent = "♥ Liked (" + (videoState.likedCount || 0) + ")";
          likedBtn.disabled = !(videoState.likedCount > 0);
        }
        const status = byId("bt-video-status");
        if (status) {
          status.textContent = videoStatusText(videoState);
        }
        const fetchBtn = byId("bt-video-fetch");
        if (fetchBtn) {
          fetchBtn.disabled = !!videoState.fetching;
        }
        return;
      }
    }
    renderVideoView();
  }

  // --- learning mode --------------------------------------------------------

  const LEARNING_MANAGE_ID = "learning.topics";
  const isLearningTopicId = (id) => typeof id === "string" && id.indexOf("learning.topic.") === 0;
  let learningState = null;
  let learningView = "cards"; // "cards" | "library"

  function renderLearningShell(kind, modeId) {
    stopGame();
    currentModeId = modeId || LEARNING_MANAGE_ID;
    learningView = "cards";
    const wrap = el("div", "bt-news");
    wrap.appendChild(
      el("p", "bt-meme-empty", kind === "manage" ? "Loading topics…" : "Loading cards…")
    );
    byId("bt-content").replaceChildren(wrap);
  }

  function renderLearningManage(view) {
    const v = view || {};
    const wrap = el("div", "bt-learn-manage");
    wrap.appendChild(el("h2", "bt-learn-title", "Learning topics"));
    wrap.appendChild(
      el("p", "bt-config-sub", "Add a tech topic and a level — the agent writes cards for it.")
    );
    const add = el("button", "bt-btn bt-btn-stop", "＋ Add topic");
    add.addEventListener("click", () => vscode.postMessage({ type: "learning/addTopic" }));
    wrap.appendChild(add);

    const topics = Array.isArray(v.topics) ? v.topics : [];
    if (topics.length === 0) {
      wrap.appendChild(el("p", "bt-meme-empty", "No topics yet. Add one to get started."));
    } else {
      const list = el("div", "bt-video-list");
      topics.forEach((t) => {
        const item = el("div", "bt-learn-topic");
        const open = el("button", "bt-learn-topic-open");
        open.appendChild(el("span", "bt-learn-topic-title", t.title));
        open.appendChild(el("span", "bt-learn-level", t.level));
        open.addEventListener("click", () =>
          vscode.postMessage({ type: "mode/select", id: "learning.topic." + t.id })
        );
        item.appendChild(open);
        const rm = el("button", "bt-btn bt-btn-danger bt-learn-remove", "🗑");
        rm.title = "Remove topic";
        rm.addEventListener("click", () =>
          vscode.postMessage({ type: "learning/removeTopic", id: t.id })
        );
        item.appendChild(rm);
        list.appendChild(item);
      });
      wrap.appendChild(list);
    }
    byId("bt-content").replaceChildren(wrap);
  }

  function learningStatusText(s) {
    let text = (s.total || 0) + " to review";
    if (s.generating) {
      text += " · generating " + (s.savedThisRun || 0) + "…";
    } else if (s.lastResult && !s.lastResult.ok) {
      if (s.lastResult.error === "no-brain") {
        text += " · Ollama not reachable";
      } else if (s.lastResult.error === "failed") {
        text += " · last run failed";
      }
    }
    return text;
  }

  function renderLearningState(state) {
    learningState = state || {};
    const s = learningState;
    if (learningView === "library") {
      renderLearningLibrary(s);
      return;
    }
    const wrap = el("div", "bt-news");

    if (!s.hasBrain) {
      const box = el("div", "bt-meme-empty-box");
      box.appendChild(el("div", "bt-mode-emoji", "🧠"));
      box.appendChild(
        el(
          "p",
          "bt-meme-empty",
          "Enable the Ollama brain (Global config ⚙, or the Ollama setting) to generate learning cards."
        )
      );
      wrap.appendChild(box);
      byId("bt-content").replaceChildren(wrap);
      return;
    }

    if (s.card) {
      const card = el("div", "bt-learn-card");
      const top = el("div", "bt-news-top");
      top.appendChild(el("span", "bt-news-kicker", s.topicTitle));
      top.appendChild(el("span", "bt-learn-level", s.level));
      card.appendChild(top);
      card.appendChild(el("h2", "bt-learn-card-title", s.card.title));
      card.appendChild(el("p", "bt-learn-card-body", s.card.body));
      if (s.card.example) {
        const pre = el("pre", "bt-learn-code");
        pre.appendChild(el("code", null, s.card.example));
        card.appendChild(pre);
      }
      wrap.appendChild(card);

      const rate = el("div", "bt-learn-rate");
      const cardId = s.card.id;
      const didnt = el("button", "bt-btn bt-learn-rate-new", "💡 Didn't know");
      didnt.addEventListener("click", () =>
        vscode.postMessage({ type: "learning/rate", id: cardId, known: false })
      );
      const knew = el("button", "bt-btn bt-learn-rate-knew", "✓ Knew it");
      knew.addEventListener("click", () =>
        vscode.postMessage({ type: "learning/rate", id: cardId, known: true })
      );
      rate.appendChild(didnt);
      rate.appendChild(knew);
      wrap.appendChild(rate);

      const nav = el("div", "bt-news-nav");
      const prev = el("button", "bt-btn", "← Prev");
      prev.disabled = s.index <= 0;
      prev.addEventListener("click", () => vscode.postMessage({ type: "learning/prev" }));
      const pos = el("span", "bt-news-pos", s.index + 1 + " / " + s.total);
      const next = el("button", "bt-btn", "Next →");
      next.disabled = s.index >= s.total - 1;
      next.addEventListener("click", () => vscode.postMessage({ type: "learning/next" }));
      nav.appendChild(prev);
      nav.appendChild(pos);
      nav.appendChild(next);
      wrap.appendChild(nav);
    } else {
      const reviewed = (s.libraryList || []).length > 0;
      const box = el("div", "bt-meme-empty-box");
      if (s.generating) {
        box.appendChild(el("div", "bt-spinner"));
        box.appendChild(el("p", "bt-meme-empty", "The agent is writing " + s.topicTitle + " cards…"));
      } else {
        const err = s.lastResult && !s.lastResult.ok ? s.lastResult.error : null;
        if (err === "no-brain") {
          box.appendChild(el("div", "bt-mode-emoji", "🔌"));
          box.appendChild(
            el(
              "p",
              "bt-meme-empty",
              'Ollama isn\'t reachable, or no model is installed. Start Ollama and pull a model — e.g. run "ollama pull llama3.2" — then press Generate. Run "Between Trains: Test Ollama Connection" to check.'
            )
          );
        } else if (err === "failed") {
          box.appendChild(el("div", "bt-mode-emoji", "⚠️"));
          box.appendChild(
            el(
              "p",
              "bt-meme-empty",
              "The last generation failed. Make sure Ollama is running with a model installed, then press Generate again."
            )
          );
        } else {
          box.appendChild(el("div", "bt-mode-emoji", reviewed ? "🎉" : "🧠"));
          box.appendChild(
            el(
              "p",
              "bt-meme-empty",
              reviewed
                ? "You've reviewed every card. Press Generate for more — it'll focus on what you didn't know."
                : "No cards yet. Press Generate to create some."
            )
          );
        }
      }
      wrap.appendChild(box);
    }

    const config = el("div", "bt-meme-config");
    const autoLabel = el("label", "bt-meme-auto-label");
    const auto = document.createElement("input");
    auto.type = "checkbox";
    auto.checked = !!s.autoFetch;
    auto.addEventListener("change", () =>
      vscode.postMessage({ type: "learning/setAutoFetch", value: auto.checked })
    );
    autoLabel.appendChild(auto);
    autoLabel.appendChild(document.createTextNode(" Auto-generate on open"));
    const gen = el("button", "bt-btn", "✨ Generate");
    gen.disabled = !!s.generating;
    gen.addEventListener("click", () => vscode.postMessage({ type: "learning/generate" }));
    const libBtn = el("button", "bt-btn", "🗂 Library (" + (s.libraryList || []).length + ")");
    libBtn.addEventListener("click", () => {
      learningView = "library";
      renderLearningState(learningState);
    });
    const status = el("span", "bt-meme-status", learningStatusText(s));
    config.appendChild(autoLabel);
    config.appendChild(gen);
    config.appendChild(libBtn);
    config.appendChild(status);
    wrap.appendChild(config);

    byId("bt-content").replaceChildren(wrap);
  }

  function renderLearningLibrary(s) {
    const wrap = el("div", "bt-news");
    const header = el("div", "bt-video-header");
    const back = el("button", "bt-btn", "← Back");
    back.addEventListener("click", () => {
      learningView = "cards";
      renderLearningState(learningState);
    });
    header.appendChild(back);
    header.appendChild(el("span", "bt-video-liked-title", (s.topicTitle || "Topic") + " library"));
    const items = Array.isArray(s.libraryList) ? s.libraryList : [];
    const clear = el("button", "bt-btn bt-btn-danger", "🗑 Clear");
    clear.disabled = items.length === 0;
    clear.addEventListener("click", () => vscode.postMessage({ type: "learning/clearLibrary" }));
    header.appendChild(clear);
    wrap.appendChild(header);

    const list = el("div", "bt-video-list");
    if (items.length === 0) {
      list.appendChild(el("p", "bt-meme-empty", "No cards yet."));
    } else {
      items.forEach((c) => {
        const item = el("div", "bt-learn-lib-item");
        const head = el("div", "bt-learn-lib-head");
        head.appendChild(el("div", "bt-video-item-title", c.title));
        if (c.rating === "known") {
          head.appendChild(el("span", "bt-learn-tag bt-learn-tag-knew", "knew it"));
        } else if (c.rating === "unknown") {
          head.appendChild(el("span", "bt-learn-tag bt-learn-tag-new", "learned"));
        }
        item.appendChild(head);
        item.appendChild(el("div", "bt-video-item-channel", c.body));
        list.appendChild(item);
      });
    }
    wrap.appendChild(list);
    byId("bt-content").replaceChildren(wrap);
  }

  // --- top navigation (modes → sub-modes) -----------------------------------

  function categoriesInOrder() {
    const order = [];
    modesList.forEach((m) => {
      if (order.indexOf(m.category) === -1) {
        order.push(m.category);
      }
    });
    return order;
  }

  function currentMode() {
    return modesList.find((m) => m.id === currentModeId) || null;
  }

  function navTab(label, opts) {
    opts = opts || {};
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "bt-tab" + (opts.active ? " is-active" : "");
    if (opts.emoji != null) {
      btn.appendChild(el("span", "bt-tab-emoji", opts.emoji));
    }
    btn.appendChild(el("span", "bt-tab-label", label));
    if (opts.onClick) {
      btn.addEventListener("click", opts.onClick);
    }
    return btn;
  }

  // Primary row = top-level modes (categories); secondary row = the active
  // mode's sub-modes. Selecting a top-level mode opens its first sub-mode.
  function renderNav() {
    const primary = byId("bt-nav-primary");
    const secondary = byId("bt-nav-secondary");
    // Rebuilding the nav drops DOM focus. If the user was navigating the tabs,
    // remember which row so we can land focus back on the selected tab.
    const focused = document.activeElement;
    const keepFocus = primary.contains(focused)
      ? primary
      : secondary.contains(focused)
        ? secondary
        : null;
    primary.replaceChildren();
    secondary.replaceChildren();
    if (!modesList.length) {
      return;
    }

    const active = currentMode();
    const activeGroup = active ? active.category : null;

    categoriesInOrder().forEach((cat) => {
      const meta = CATEGORY[cat] || { emoji: "🚉" };
      primary.appendChild(
        navTab(meta.label || cat, {
          emoji: meta.emoji,
          active: cat === activeGroup,
          onClick: () => {
            if (cat === activeGroup) {
              return;
            }
            const first = modesList.find((m) => m.category === cat);
            if (first) {
              vscode.postMessage({ type: "mode/select", id: first.id });
            }
          },
        })
      );
    });

    if (activeGroup) {
      modesList
        .filter((m) => m.category === activeGroup)
        .forEach((mode) => {
          secondary.appendChild(
            navTab(mode.title || mode.id, {
              active: mode.id === currentModeId,
              onClick: () => vscode.postMessage({ type: "mode/select", id: mode.id }),
            })
          );
        });
    }

    // Return focus to the selected tab in the row the user was using.
    if (keepFocus) {
      const activeTab = keepFocus.querySelector(".bt-tab.is-active");
      if (activeTab) {
        activeTab.focus();
      }
    }
  }

  // --- message handling -----------------------------------------------------

  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (!msg || typeof msg.type !== "string") {
      return;
    }
    switch (msg.type) {
      case "session/update":
        break;
      case "mode/render": {
        if (msg.mode && msg.mode.id === MEME_MODE_ID) {
          renderMemeShell();
          renderNav();
          break;
        }
        if (msg.mode && isVideoModeId(msg.mode.id)) {
          renderVideoShell(msg.mode.id);
          renderNav();
          break;
        }
        if (msg.mode && isNewsModeId(msg.mode.id)) {
          renderNewsShell(msg.mode.id);
          renderNav();
          break;
        }
        if (msg.mode && msg.mode.id === LEARNING_MANAGE_ID) {
          renderLearningShell("manage", msg.mode.id);
          renderNav();
          break;
        }
        if (msg.mode && isLearningTopicId(msg.mode.id)) {
          renderLearningShell("cards", msg.mode.id);
          renderNav();
          break;
        }
        const found = msg.mode ? engineFor(msg.mode.id) : null;
        if (found) {
          renderExperience(msg.mode, found);
        } else {
          renderMode(msg.mode);
        }
        renderNav();
        break;
      }
      case "config/show":
        renderConfig(msg.config);
        break;
      case "stats/show":
        renderStats(msg.stats);
        break;
      case "game/stats":
        if (typeof msg.gameId === "string") {
          gameStats[msg.gameId] = { best: msg.best, plays: msg.plays };
          if (currentModeId === msg.gameId && currentGame && currentGame.setStats) {
            currentGame.setStats(gameStats[msg.gameId]);
          }
        }
        break;
      case "meme/state":
        if (currentModeId === MEME_MODE_ID) {
          renderMemeState(msg.state);
        }
        break;
      case "video/state":
        if (isVideoModeId(currentModeId)) {
          renderVideoState(msg.state);
        }
        break;
      case "news/state":
        if (isNewsModeId(currentModeId)) {
          renderNewsState(msg.state);
        }
        break;
      case "learning/topics":
        if (currentModeId === LEARNING_MANAGE_ID) {
          renderLearningManage(msg.view);
        }
        break;
      case "learning/state":
        if (isLearningTopicId(currentModeId)) {
          renderLearningState(msg.state);
        }
        break;
      case "modes/list":
        modesList = Array.isArray(msg.modes) ? msg.modes : [];
        if (typeof msg.currentId === "string") {
          currentModeId = msg.currentId;
        }
        renderNav();
        break;
      case "panel/visibility":
        visible = !!msg.visible;
        if (currentGame) {
          currentGame.setVisible(visible);
        }
        break;
    }
  });

  byId("bt-config").addEventListener("click", () => {
    vscode.postMessage({ type: "config/open" });
  });

  vscode.postMessage({ type: "panel/ready" });
})();
