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

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.tab?.id) state.tabId = sender.tab.id;
  log('rx.message', { type: msg.type, from: sender?.url ? 'content' : 'popup/bg' });

  // Relay TTS commands to content.js
  if (state.tabId && (
    msg.type === 'CH_PLAY' ||
    msg.type === 'CH_PAUSE' ||
    msg.type === 'CH_REPLAY' ||
    msg.type === 'CH_SKIP' ||
    msg.type === 'CH_BOOKMARK' ||
    msg.type === 'SET_RATE' ||
    msg.type === 'SET_VOICE' ||
    msg.type === 'PREF_LOCAL'
  )) {
    chrome.tabs.sendMessage(state.tabId, msg);
    sendResponse?.({ ok: true });
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
async function relayToActiveTab(payload) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  chrome.tabs.sendMessage(tab.id, payload);
}

chrome.commands.onCommand.addListener((cmd) => {
  if (cmd === 'replay-10s') relayToActiveTab({ type: 'CH_REPLAY', seconds: 10 });
  if (cmd === 'skip-10s')   relayToActiveTab({ type: 'CH_SKIP', seconds: 10 });
  if (cmd === 'toggle-play-pause') relayToActiveTab({ type: 'CH_TOGGLE' });
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'CH_PLAY') relayToActiveTab({ type: 'CH_PLAY', idx: msg.idx, text: msg.text });
  if (msg.type === 'CH_PAUSE') relayToActiveTab({ type: 'CH_PAUSE' });
  if (msg.type === 'SET_RATE') relayToActiveTab({ type: 'SET_RATE', rate: msg.rate });
  if (msg.type === 'SET_VOICE') relayToActiveTab({ type: 'SET_VOICE', voiceName: msg.voiceName });
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
