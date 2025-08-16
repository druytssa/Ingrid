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
    if (!t) {
      log('relay.error', { reason: 'no-active-chat-tab' });
      return false;
    }
    chrome.tabs.sendMessage(t.id, payload);
    return true;
  } catch (e) {
    log('relay.error', { error: String(e?.message || e) });
    return false;
  }
}

// --- Command handling ---
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

// --- Message handling ---
chrome.runtime.onMessage.addListener(async (msg, sender, sendResponse) => {
  // Store tabId from content script
  if (sender.tab?.id) state.tabId = sender.tab.id;
  log('message.received', { type: msg.type });

  // Map popup/content events to the page content engine
  if (msg.type === 'CH_PLAY')    await relayToActiveTab({ type: 'CH_PLAY', idx: msg.idx, text: msg.text });
  if (msg.type === 'CH_TOGGLE')  await relayToActiveTab({ type: 'CH_TOGGLE' });
  if (msg.type === 'CH_PAUSE')   await relayToActiveTab({ type: 'CH_PAUSE' });
  if (msg.type === 'CH_REPLAY')  await relayToActiveTab({ type: 'CH_REPLAY', seconds: msg.seconds ?? 10 });
  if (msg.type === 'CH_SKIP')    await relayToActiveTab({ type: 'CH_SKIP', seconds: msg.seconds ?? 10 });
  if (msg.type === 'SET_RATE')   await relayToActiveTab({ type: 'SET_RATE', rate: msg.rate });
  if (msg.type === 'SET_VOICE')  await relayToActiveTab({ type: 'SET_VOICE', voiceName: msg.voiceName });

  // Back-compat with earlier popup button:
  if (msg.type === 'play-stored-audio') await relayToActiveTab({ type: 'CH_TOGGLE' });

  // OpenAI TTS
  if (msg.type === 'OA_PLAY' && msg.text) {
    log('tts.request', { idx: msg.idx, chars: msg.text.length });
    try {
      const { useOpenAi, openai_api_key, openai_voice } = await getSettings();
      if (!useOpenAi) {
        log('tts.error', { reason: 'openai-disabled' });
        sendResponse?.({ ok: false, error: 'OpenAI TTS is disabled' });
        return;
      }
      if (!openai_api_key) {
        log('tts.error', { reason: 'missing-api-key' });
        sendResponse?.({ ok: false, error: 'Missing OpenAI API key' });
        return;
      }

      const cacheKey = `${msg.idx}|${hash(msg.text)}|${openai_voice||'alloy'}`;
      let blob = state.blobs.get(cacheKey);
      if (!blob) {
        log('tts.fetch.start');
        blob = await openAiTtsToBlob(msg.text, openai_api_key, openai_voice || 'alloy');
        log('tts.fetch.complete', { size: blob.size });
        state.blobs.set(cacheKey, blob);
      }
      const url = URL.createObjectURL(blob);
      await relayToActiveTab({ type: 'OA_PLAY_URL', idx: msg.idx, url });
      sendResponse?.({ ok: true });
    } catch (e) {
      log('tts.error', { error: String(e?.message || e) });
      sendResponse?.({ ok: false, error: String(e?.message || e) });
    }
  }

  // Send immediate response for other messages
  if (sendResponse) sendResponse({ ok: true });
  return true; // keep channel open for async
});

// --- Logging ---
function log(evt, meta = {}) {
  const entry = { ts: Date.now(), ctx: 'bg', evt, meta };
  chrome.storage.local.get(['ingridLog'], ({ ingridLog = [] }) => {
    ingridLog.push(entry);
    if (ingridLog.length > 500) ingridLog.splice(0, ingridLog.length - 500);
    chrome.storage.local.set({ ingridLog });
    chrome.runtime.sendMessage({ type: 'LOG', text: `[${evt}] ${JSON.stringify(meta)}` });
  });
}

// --- Settings ---
async function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['useOpenAi','openai_api_key','openai_voice'], (s) => resolve(s || {}));
  });
}

// --- OpenAI TTS ---
async function openAiTtsToBlob(text, apiKey, voice) {
  const resp = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'tts-1',
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
