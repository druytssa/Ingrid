// Background runs as MV3 service worker (no DOM, no Web Speech here).
// It fetches OpenAI TTS audio when requested and relays player commands.
let state = { tabId: null, blobs: new Map() };

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.tab?.id) state.tabId = sender.tab.id;

  // Relay simple messages to content.js
  if (state.tabId && /^CH_|^SET_|^PREF_/.test(msg.type)) {
    chrome.tabs.sendMessage(state.tabId, msg);
    // acknowledge to avoid popup "lastError"
    sendResponse?.({ ok: true });
    return true;
  }

  // OpenAI TTS flow (fetch -> send URL to content script)
  if (msg.type === 'OA_PLAY' && msg.text) {
    (async () => {
      try {
        const { useOpenAi, openai_api_key, openai_voice } = await getSettings();
        if (!useOpenAi) { sendResponse?.({ ok:false, err:'OpenAI mode off' }); return; }
        if (!openai_api_key) { sendResponse?.({ ok:false, err:'Missing API key' }); return; }

        const cacheKey = `${msg.idx}|${hash(msg.text)}|${openai_voice||'alloy'}`;
        let blob = state.blobs.get(cacheKey);
        if (!blob) {
          blob = await openAiTtsToBlob(msg.text, openai_api_key, openai_voice || 'alloy');
          state.blobs.set(cacheKey, blob);
        }
        const url = URL.createObjectURL(blob);
        chrome.tabs.sendMessage(state.tabId, { type: 'OA_PLAY_URL', idx: msg.idx, url });
        sendResponse?.({ ok: true });
      } catch (e) {
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
  if (!resp.ok) throw new Error(`OpenAI TTS ${resp.status}`);
  const buf = await resp.arrayBuffer();
  return new Blob([buf], { type: 'audio/mpeg' });
}

function hash(s) {
  let h = 0; for (let i=0;i<s.length;i++) { h = (h*31 + s.charCodeAt(i))|0; } return String(h>>>0);
}
