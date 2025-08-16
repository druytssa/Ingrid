if (!window.__INGRID_POPUP_INIT__) {
  window.__INGRID_POPUP_INIT__ = true;

  // DOM elements
  const spinner = document.getElementById('spinner');
  const playBtn = document.getElementById('playBtn');
  const pauseBtn = document.getElementById('pauseBtn');
  const replayBtn = document.getElementById('replayBtn');
  const rateInput = document.getElementById('rateInput');
  const rateVal = document.getElementById('rateVal');
  const apiKeyInput = document.getElementById('apiKey');
  const oaVoiceSelect = document.getElementById('oaVoice');
  const statusText = document.getElementById('statusText');
  const logEl = document.getElementById('log');
  const copyLogBtn = document.getElementById('copyLogBtn');
  const clearLogBtn = document.getElementById('clearLogBtn');

  // Wait for background connection
  let bgReady = false;
  function waitForBackground() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'PING' }, (response) => {
        if (chrome.runtime.lastError) {
          console.warn('Background not ready:', chrome.runtime.lastError.message);
          setTimeout(() => waitForBackground().then(resolve), 100);
          return;
        }
        bgReady = true;
        resolve();
      });
    });
  }

  // Message helper (fire-and-forget with logging)
  function sendMessage(type, payload = {}) {
    if (!bgReady) {
      appendLog(`Message dropped (background not ready): ${type}`);
      return;
    }
    chrome.runtime.sendMessage({ type, ...payload }, (res) => {
      if (chrome.runtime.lastError) {
        console.warn(chrome.runtime.lastError.message);
        appendLog(`Error: ${chrome.runtime.lastError.message}`);
      }
    });
    appendLog(`Sent: ${type}`);
  }

  // Load settings
  chrome.storage.sync.get(['rate', 'openai_api_key', 'openai_voice'], (s) => {
    if (rateInput) {
      rateInput.value = s.rate ?? 1.0;
      if (rateVal) rateVal.textContent = `${(+rateInput.value).toFixed(1)}×`;
      sendMessage('SET_RATE', { rate: +rateInput.value });
    }
    if (apiKeyInput && s.openai_api_key) apiKeyInput.value = s.openai_api_key;
    if (oaVoiceSelect) oaVoiceSelect.value = s.openai_voice ?? 'alloy';
  });

  // Save settings
  function saveSettings() {
    const data = {
      rate: rateInput ? parseFloat(rateInput.value) : undefined,
      openai_api_key: apiKeyInput ? apiKeyInput.value.trim() : undefined,
      openai_voice: oaVoiceSelect ? oaVoiceSelect.value : undefined,
    };
    chrome.storage.sync.set(data);
  }

  // Event listeners
  rateInput?.addEventListener('input', () => {
    const r = parseFloat(rateInput.value || '1.0');
    if (rateVal) rateVal.textContent = `${r.toFixed(1)}×`;
    saveSettings();
    sendMessage('SET_RATE', { rate: r });
  });

  apiKeyInput?.addEventListener('input', saveSettings);
  oaVoiceSelect?.addEventListener('change', saveSettings);

  playBtn?.addEventListener('click', () => {
    spinner && (spinner.style.display = 'block');
    playBtn.disabled = true;
    statusText.textContent = 'Starting…';
    sendMessage('CH_TOGGLE');
    spinner && (spinner.style.display = 'none');
    playBtn.disabled = false;
    statusText.textContent = 'Now playing 🔊';
  });

  pauseBtn?.addEventListener('click', () => {
    sendMessage('CH_PAUSE');
    statusText.textContent = 'Paused ⏸';
  });

  replayBtn?.addEventListener('click', () => {
    sendMessage('CH_REPLAY', { seconds: 10 });
    statusText.textContent = 'Rewound 10s ↺';
  });

  // Logging
  function appendLog(text) {
    if (!logEl) return;
    const now = new Date().toLocaleTimeString();
    const line = document.createElement('div');
    line.textContent = `[${now}] ${text}`;
    logEl.appendChild(line);
    logEl.scrollTop = logEl.scrollHeight;
  }

  copyLogBtn?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(logEl?.textContent || '');
      statusText.textContent = 'Log copied';
      setTimeout(() => statusText.textContent = '', 1200);
    } catch (e) {
      console.error('Copy failed:', e);
    }
  });

  clearLogBtn?.addEventListener('click', () => {
    if (logEl) logEl.textContent = '';
  });

  // Message handling
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'audio-ready') {
      statusText.textContent = 'Audio ready 🎧';
      appendLog('Audio ready');
    }
    if (message.type === 'LOG') {
      appendLog(message.text);
    }
  });

  // Initialize
  waitForBackground().then(() => {
    appendLog('Background connected');
  });
}
