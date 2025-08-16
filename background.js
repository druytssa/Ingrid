// Background runs as MV3 service worker (no DOM, no Web Speech here).
// It fetches OpenAI TTS audio when requested and relays player commands.
let state = { tabId: null, blobs: new Map() };

// Create context menu on install
chrome.runtime.onInstalled.addListener(() => {
  try {
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({
        id: 'ingrid-read-selection',
        title: 'Read selection with Ingrid',
        contexts: ['selection', 'page']
      });
    });
  } catch {}
});

// Handle context menu click
chrome.contextMenus.onClicked?.addListener(async (info, tab) => {
  if (info.menuItemId !== 'ingrid-read-selection' || !tab?.id) return;
  state.tabId = tab.id;
  try {
    // get the selected text in the page without injecting our content script globally
    const [{ result: selectionText } = {}] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => (window.getSelection?.().toString?.() || '').trim()
    });
    const text = (selectionText || info.selectionText || '').trim();
    log('ctxmenu.selection', { length: text.length });
    if (!text) {
      chrome.tabs.sendMessage(tab.id, { type: 'SHOW_TOAST', text: 'No text selected' });
      return;
    }
    const { useOpenAi } = await getSettings();
    if (useOpenAi) {
      chrome.runtime.sendMessage({ type: 'OA_PLAY', idx: -1, text });
    } else {
      chrome.runtime.sendMessage({ type: 'CH_PLAY', idx: -1, text });
    }
  } catch (e) {
    log('ctxmenu.error', { message: String(e?.message || e) });
  }
});

// --- tiny logger ---
function log(evt, meta = {}) {
  const entry = { ts: Date.now(), ctx: 'bg', evt, meta };
  chrome.storage.local.get(['ingridLog'], ({ ingridLog = [] }) => {
    ingridLog.push(entry);
    if (ingridLog.length > 500) ingridLog.splice(0, ingridLog.length - 500);
    chrome.storage.local.set({ ingridLog });
    chrome.runtime.sendMessage({ type: 'LOG_EVENT', entry });
  });
}

// --- Relay helpers (avoid sending to non-ChatGPT tabs) ---
async function getActiveChatTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const t = tabs[0];
  if (!t?.id || !/^https:\/\/chat\.openai\.com\b/.test(t.url || '')) return null;
  return t;
}
async function relayToActiveTab(payload) {
  try {
    const t = await getActiveChatTab();
    if (!t) return;
    chrome.tabs.sendMessage(t.id, payload);
  } catch {}
}

chrome.commands.onCommand.addListener((command) => {
  switch (command) {
    case 'play-pause':      // must match manifest.json
      relayToActiveTab({ type: 'CH_TOGGLE' });
      break;
    case 'replay-10s':
      relayToActiveTab({ type: 'CH_REPLAY', seconds: 10 });
      break;
    case 'skip-10s':
      relayToActiveTab({ type: 'CH_SKIP', seconds: 10 });
      break;
  }
});

chrome.runtime.onMessage.addListener(async (msg, sender) => {
  // Map popup/content events to the page content engine
  if (msg.type === 'CH_PLAY')    relayToActiveTab({ type: 'CH_PLAY', idx: msg.idx, text: msg.text });
  if (msg.type === 'CH_TOGGLE')  relayToActiveTab({ type: 'CH_TOGGLE' });
  if (msg.type === 'CH_PAUSE')   relayToActiveTab({ type: 'CH_PAUSE' });
  if (msg.type === 'CH_REPLAY')  relayToActiveTab({ type: 'CH_REPLAY', seconds: msg.seconds ?? 10 });
  if (msg.type === 'CH_SKIP')    relayToActiveTab({ type: 'CH_SKIP', seconds: msg.seconds ?? 10 });
  if (msg.type === 'SET_RATE')   relayToActiveTab({ type: 'SET_RATE', rate: msg.rate });
  if (msg.type === 'SET_VOICE')  relayToActiveTab({ type: 'SET_VOICE', voiceName: msg.voiceName });
  if (msg.type === 'PREF_LOCAL') relayToActiveTab({ type: 'PREF_LOCAL', value: !!msg.value });

  // Back-compat with earlier popup button:
  if (msg.type === 'play-stored-audio') relayToActiveTab({ type: 'CH_TOGGLE' });
});

// --- OpenAI TTS functionality ---
async function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['useOpenAi','openai_api_key','openai_voice'], (s) => resolve(s || {}));
  });
}

async function openAiTtsToBlob(text, apiKey, voice) {
  const resp = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini-tts',
      voice: voice || 'alloy',
      input: text,
      format: 'mp3'
    })
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`OpenAI TTS ${resp.status} ${body?.slice(0,200)}`);
  }
  const buf = await resp.arrayBuffer();
  return new Blob([buf], { type: 'audio/mpeg' });
}

function hash(s) {
  let h = 0; for (let i=0;i<s.length;i++) { h = (h*31 + s.charCodeAt(i))|0; } return String(h>>>0);
}
