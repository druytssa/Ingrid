// background.js — Plan A (Local Web Speech TTS; no audio downloads)

let state = {
  tabId: null,
  currentIdx: null,
  utterance: null,
  fullText: "",
  tokens: [],
  tokenToCharIdx: [],
  startWordIdx: 0,
  wordIndex: 0,
  bookmarks: new Map(),
  selectedVoiceName: null,
  preferLocal: true,
  rate: 1.0
};

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "read-selection",
    title: "Read selection with Ingrid",
    contexts: ["selection"]
  });
});

chrome.runtime.onMessage.addListener(async (msg, sender) => {
  if (sender.tab?.id) state.tabId = sender.tab.id;

  if (msg.type === 'CH_PLAY') {
    playChapter(msg.idx, msg.text, state.tabId);
  }
  if (msg.type === 'CH_PAUSE') {
    pauseChapter(state.tabId);
  }
  if (msg.type === 'CH_REPLAY') {
    replaySeconds(msg.seconds ?? 10, state.tabId);
  }
  if (msg.type === 'CH_SKIP') {
    skipSeconds(10, state.tabId);
  }
  if (msg.type === 'CH_BOOKMARK') {
    bookmarkHere(state.tabId);
  }
  if (msg.type === 'SET_RATE') {
    state.rate = msg.rate || 1.0;
    if (state.utterance) state.utterance.rate = state.rate;
  }
  if (msg.type === 'SET_VOICE') {
    state.selectedVoiceName = msg.voiceName || null;
  }
  if (msg.type === 'PREF_LOCAL') {
    state.preferLocal = !!msg.value;
  }
});

chrome.commands.onCommand.addListener((command) => {
  // Use last known tabId and currentIdx
  const tabId = state.tabId;
  const idx = state.currentIdx;
  if (!tabId) return;
  switch (command) {
    case "play-pause":
      if (state.utterance) {
        pauseChapter(tabId);
      } else if (idx != null && state.fullText) {
        playChapter(idx, state.fullText, tabId);
      }
      break;
    case "replay-10s":
      replaySeconds(10, tabId);
      break;
    case "skip-10s":
      skipSeconds(10, tabId);
      break;
  }
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "read-selection" && info.selectionText) {
    playText(info.selectionText, tab.id);
  }
});

function skipSeconds(s, tabId) {
  // Approximate words per second at current rate (tweakable)
  const wordsPerSecondAt1x = 2;
  const deltaWords = Math.max(1, Math.round((s * wordsPerSecondAt1x) * state.rate));
  const newStart = Math.min(state.tokens.length - 1, state.startWordIdx + state.wordIndex + deltaWords);
  restartFrom(newStart, tabId);
  toast(tabId, 'Skipped 10s');
  sendProgress(tabId); // immediate visual update
}

function playChapter(idx, text, tabId) {
  state.currentIdx = idx;
  startPlayback(text, 0, tabId);
}

function pauseChapter(tabId) {
  try { speechSynthesis.pause(); } catch {}
  notify(tabId, 'paused');
  toast(tabId, 'Paused');
}

function replaySeconds(s, tabId) {
  // Approximate words per second at current rate (tweakable)
  const wordsPerSecondAt1x = 2; // heuristic
  const deltaWords = Math.max(1, Math.round((s * wordsPerSecondAt1x) * state.rate));
  const newStart = Math.max(0, state.startWordIdx + state.wordIndex - deltaWords);
  restartFrom(newStart, tabId);
  toast(tabId, 'Rewound 10s');
  sendProgress(tabId); // immediate visual update
}

function bookmarkHere(tabId) {
  const absoluteWord = state.startWordIdx + state.wordIndex;
  if (state.currentIdx == null) return;
  state.bookmarks.set(state.currentIdx, absoluteWord);
  chrome.storage.local.set({ aiTtsBookmarks: [...state.bookmarks.entries()] });
  notify(tabId, 'playing');
  toast(tabId, 'Bookmarked');
}

function startPlayback(text, fromWordIndex, tabId) {
  stopPlayback();

  state.fullText = text;
  const tokenized = tokenize(text);
  state.tokens = tokenized.tokens;
  state.tokenToCharIdx = tokenized.tokenToCharIdx;

  state.startWordIdx = clamp(fromWordIndex, 0, Math.max(0, state.tokens.length - 1));
  state.wordIndex = 0;

  const sliceStartChar = state.tokenToCharIdx[state.startWordIdx] ?? 0;
  const speakText = state.fullText.slice(sliceStartChar);

  const u = new SpeechSynthesisUtterance(speakText);
  u.rate = state.rate;
  pickVoice(u);

  u.onstart = () => notify(tabId, 'playing');
  u.onerror = () => notify(tabId, 'stopped');
  u.onend = () => notify(tabId, 'stopped');

  u.onboundary = (e) => {
    if (e.name === 'word' || e.charLength > 0) {
      const absoluteWord = state.startWordIdx + state.wordIndex;
      sendWordHighlight(absoluteWord);
      state.wordIndex++;
    }
  };

  state.utterance = u;
  try { speechSynthesis.speak(u); } catch {}
  toast(tabId, 'Playing');
  sendProgress(tabId); // initial value from start index
}

function restartFrom(newWordIndex, tabId) {
  startPlayback(state.fullText, newWordIndex, tabId);
}

function stopPlayback() {
  if (state.utterance) {
    try { speechSynthesis.cancel(); } catch {}
  }
  state.utterance = null;
}

function pickVoice(u) {
  const voices = speechSynthesis.getVoices() || [];
  let list = voices;
  if (state.preferLocal) list = voices.filter(v => v.localService);
  if (state.selectedVoiceName) {
    const v = list.find(v => v.name === state.selectedVoiceName) || voices.find(v => v.name === state.selectedVoiceName);
    if (v) { u.voice = v; return; }
  }
  u.voice = list[0] || voices[0] || null;
}

function tokenize(text) {
  const parts = text.match(/\S+|\s+/g) || [];
  const tokens = [];
  const tokenToCharIdx = [];
  let charPos = 0;
  for (const p of parts) {
    if (/\s+/.test(p)) {
      charPos += p.length;
    } else {
      tokens.push(p);
      tokenToCharIdx.push(charPos);
      charPos += p.length;
    }
  }
  return { tokens, tokenToCharIdx };
}

function sendWordHighlight(absoluteWordIndex) {
  if (state.tabId == null) return;
  chrome.tabs.sendMessage(state.tabId, { type: 'HILITE_WORD', index: absoluteWordIndex });
}

function notify(tabId, stateStr) {
  if (tabId == null) return;
  chrome.tabs.sendMessage(tabId, { type: 'CH_ACTIVE', idx: state.currentIdx, state: stateStr });
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// Ensure voices are loaded (some browsers populate asynchronously)
if (typeof speechSynthesis !== "undefined" && speechSynthesis.onvoiceschanged !== undefined) {
  speechSynthesis.onvoiceschanged = () => {};
}

// Load settings on startup
chrome.storage.sync.get(['rate', 'voice', 'preferLocal'], (settings) => {
  state.rate = settings.rate || 1.0;
  state.selectedVoiceName = settings.voice || null;
  state.preferLocal = settings.preferLocal || true;
});

function toast(tabId, text) {
  if (tabId == null) return;
  chrome.tabs.sendMessage(tabId, { type: 'SHOW_TOAST', text });
}

function sendProgress(tabId, explicitPercent) {
  if (tabId == null || state.currentIdx == null || !state.tokens.length) return;
  const absoluteWord = state.startWordIdx + state.wordIndex;
  const pct = typeof explicitPercent === 'number'
    ? explicitPercent
    : Math.round(Math.min(100, Math.max(0, (absoluteWord / state.tokens.length) * 100)));
  chrome.tabs.sendMessage(tabId, { type: 'CH_PROGRESS', idx: state.currentIdx, percent: pct });
}

function playText(text, tabId) {
  // Reuse existing playback logic
  state.currentIdx = null; // No chapter index for ad-hoc text
  startPlayback(text, 0, tabId);
}
