// Background runs as MV3 service worker (no DOM, no Web Speech here).
// It fetches OpenAI TTS audio when requested and relays player commands.
let state = { tabId: null, blobs: new Map() };

// Create context menu on install
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "read-selection-ingrid",
    title: "Read selection with Ingrid",
    contexts: ["selection"],
    documentUrlPatterns: ["https://chat.openai.com/*"]
  });
});

// Handle context menu click
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "read-selection-ingrid") {
    if (!info.selectionText || !info.selectionText.trim()) {
      chrome.tabs.sendMessage(tab.id, { type: "SHOW_TOAST", text: "No text selected." });
      return;
    }
    chrome.storage.sync.get(["useOpenAi"], (s) => {
      if (s.useOpenAi) {
        chrome.tabs.sendMessage(tab.id, { type: "OA_PLAY", idx: null, text: info.selectionText });
      } else {
        chrome.tabs.sendMessage(tab.id, { type: "CH_PLAY", idx: null, text: info.selectionText });
      }
    });
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

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.tab?.id) state.tabId = sender.tab.id;
  log('rx.message', { type: msg.type, from: sender?.url ? 'content' : 'popup/bg' });

  // Relay simple messages to content.js
  if (state.tabId && /^CH_|^SET_|^PREF_/.test(msg.type)) {
    chrome.tabs.sendMessage(state.tabId, msg);
    // acknowledge to avoid popup "lastError"
    sendResponse?.({ ok: true });
    log('tx.to-content', { type: msg.type, tabId: state.tabId });
    return true;
  }

  // OpenAI TTS flow (fetch -> send URL to content script)
  if (msg.type === 'OA_PLAY' && msg.text) {
    log('oa.play.request', { idx: msg.idx, chars: msg.text.length });
    (async () => {
      try {
        const { useOpenAi, openai_api_key, openai_voice } = await getSettings();
        log('settings.loaded', { useOpenAi: !!useOpenAi, voice: openai_voice ? String(openai_voice) : null, hasKey: !!openai_api_key });
        if (!useOpenAi) { log('oa.play.denied', { reason: 'mode-off' }); sendResponse?.({ ok:false, err:'OpenAI mode off' }); return; }
        if (!openai_api_key) { log('oa.play.denied', { reason: 'missing-key' }); sendResponse?.({ ok:false, err:'Missing API key' }); return; }

        const cacheKey = `${msg.idx}|${hash(msg.text)}|${openai_voice||'alloy'}`;
        let blob = state.blobs.get(cacheKey);
        if (!blob) {
          log('oa.fetch.start', { model: 'gpt-4o-mini-tts', voice: openai_voice || 'alloy' });
          blob = await openAiTtsToBlob(msg.text, openai_api_key, openai_voice || 'alloy');
          log('oa.fetch.ok', { size: blob.size });
          state.blobs.set(cacheKey, blob);
        }
        const url = URL.createObjectURL(blob);
        chrome.tabs.sendMessage(state.tabId, { type: 'OA_PLAY_URL', idx: msg.idx, url });
        log('tx.to-content', { type: 'OA_PLAY_URL', idx: msg.idx });
        sendResponse?.({ ok: true });
      } catch (e) {
        log('oa.fetch.err', { message: String(e?.message || e) });
        sendResponse?.({ ok:false, err: String(e?.message || e) });
      }
    })();
    return true; // async
  }

  if (msg.type === 'OA_PAUSE') {
    chrome.tabs.sendMessage(state.tabId, { type: 'OA_PAUSE' }); sendResponse?.({ok:true}); return true;
  }
  if (msg.type === 'OA_REPLAY') {
    chrome.tabs.sendMessage(state.tabId, { type: 'OA_REPLAY', seconds: msg.seconds ?? 10 }); sendResponse?.({ok:true}); return true;
  }
  if (msg.type === 'OA_SKIP') {
    chrome.tabs.sendMessage(state.tabId, { type: 'OA_SKIP', seconds: msg.seconds ?? 10 }); sendResponse?.({ok:true}); return true;
  }
});

// Keyboard shortcuts (MV3 "commands") → forward to active tab
chrome.commands?.onCommand.addListener((command) => {
  chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
    const tabId = tabs?.[0]?.id;
    if (!tabId) return;
    log('kbd', { command, tabId });
    if (command === 'toggle-play-pause') chrome.tabs.sendMessage(tabId, { type: 'KBD_TOGGLE' });
    if (command === 'replay-10s')       chrome.tabs.sendMessage(tabId, { type: 'KBD_REPLAY', seconds: 10 });
    if (command === 'skip-10s')         chrome.tabs.sendMessage(tabId, { type: 'KBD_SKIP',   seconds: 10 });
  });
});

// --- Helpers ---
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
