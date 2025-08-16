if (!window.__INGRID_POPUP_INIT__) {
  window.__INGRID_POPUP_INIT__ = true;

  const spinner = document.getElementById('spinner');
  const playBtn = document.getElementById('playBtn');
  const pauseBtn = document.getElementById('pauseBtn');

  const rateInput = document.getElementById('rateInput');
  const rateVal   = document.getElementById('rateVal');
  const voiceSelect = document.getElementById('voiceSelect');
  const preferLocalCheckbox = document.getElementById('preferLocalCheckbox');

  const useOpenAi = document.getElementById('useOpenAi');
  const apiKeyInput = document.getElementById('apiKey');
  const oaVoiceSelect = document.getElementById('oaVoice');

  // Ensure we have a status line to write to
  let statusText = document.getElementById('statusText');
  if (!statusText) {
    statusText = document.createElement('div');
    statusText.id = 'statusText';
    statusText.style.marginTop = '6px';
    statusText.style.fontSize = '12px';
    statusText.style.color = '#ccc';
    statusText.textContent = '';
    document.body.appendChild(statusText);
  }

  // --- Helper: safe ack to silence "message port closed" warnings ---
  function sendMessage(type, payload = {}, onDone) {
    chrome.runtime.sendMessage({ type, ...payload }, (res) => {
      if (chrome.runtime.lastError) {
        console.warn(chrome.runtime.lastError.message);
        onDone?.({ ok: false, reason: 'no-recipient' });
        return;
      }
      onDone?.(res || { ok: true });
    });
  }

  // --- Voices (local speechSynthesis) ---
  function populateLocalVoices() {
    if (!voiceSelect) return;
    let voices = (typeof speechSynthesis !== 'undefined') ? speechSynthesis.getVoices() : [];
    const preferLocal = !!preferLocalCheckbox?.checked;
    if (preferLocal) voices = voices.filter(v => v.localService);

    voices.sort((a, b) => (b.localService - a.localService) || a.name.localeCompare(b.name));

    const current = voiceSelect.value;
    voiceSelect.innerHTML = '';
    if (voices.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = '— no local voices detected —';
      voiceSelect.appendChild(opt);
    } else {
      voices.forEach(v => {
        const opt = document.createElement('option');
        opt.value = v.name;
        opt.textContent = `${v.name}${v.localService ? ' (local)' : ''}`;
        voiceSelect.appendChild(opt);
      });
    }
    if (current && [...voiceSelect.options].some(o => o.value === current)) {
      voiceSelect.value = current;
    }
  }

  if (typeof speechSynthesis !== 'undefined') {
    populateLocalVoices();
    speechSynthesis.onvoiceschanged = populateLocalVoices;
  }

  chrome.storage.sync.get(
    ['rate','voice','preferLocal','useOpenAi','openai_api_key','openai_voice'],
    (s) => {
      if (rateInput) {
        rateInput.value = s.rate ?? 1.0;
        if (rateVal) rateVal.textContent = `${(+rateInput.value).toFixed(1)}×`;
        sendMessage('SET_RATE', { rate: +rateInput.value });
      }
      if (voiceSelect) {
        voiceSelect.value = s.voice ?? '';
        sendMessage('SET_VOICE', { voiceName: voiceSelect.value });
      }
      if (preferLocalCheckbox) {
        preferLocalCheckbox.checked = !!s.preferLocal;
        populateLocalVoices();
        sendMessage('PREF_LOCAL', { value: preferLocalCheckbox.checked });
      }
      if (useOpenAi) useOpenAi.checked = !!s.useOpenAi;
      if (apiKeyInput && s.openai_api_key) apiKeyInput.value = s.openai_api_key;
      if (oaVoiceSelect) oaVoiceSelect.value = s.openai_voice ?? 'alloy';
    }
  );

  function saveSettings() {
    const data = {
      rate: rateInput ? parseFloat(rateInput.value) : undefined,
      voice: voiceSelect ? voiceSelect.value : undefined,
      preferLocal: preferLocalCheckbox ? !!preferLocalCheckbox.checked : undefined,
      useOpenAi: useOpenAi ? !!useOpenAi.checked : undefined,
      openai_api_key: apiKeyInput ? apiKeyInput.value.trim() : undefined,
      openai_voice: oaVoiceSelect ? oaVoiceSelect.value : undefined,
    };
    chrome.storage.sync.set(data);
  }

  rateInput?.addEventListener('input', () => {
    const r = parseFloat(rateInput.value || '1.0');
    if (rateVal) rateVal.textContent = `${r.toFixed(1)}×`;
    saveSettings();
    sendMessage('SET_RATE', { rate: r });
  });
  voiceSelect?.addEventListener('change', () => {
    saveSettings();
    sendMessage('SET_VOICE', { voiceName: voiceSelect.value });
  });
  preferLocalCheckbox?.addEventListener('change', () => {
    saveSettings();
    populateLocalVoices();
  });
  useOpenAi?.addEventListener('change', saveSettings);
  apiKeyInput?.addEventListener('input', saveSettings);
  oaVoiceSelect?.addEventListener('change', saveSettings);


  playBtn?.addEventListener('click', () => {
    spinner && (spinner.style.display = 'block');
    playBtn.disabled = true;
    statusText.textContent = 'Starting…';
    sendMessage('play-stored-audio'); // fire-and-forget
    spinner && (spinner.style.display = 'none');
    playBtn.disabled = false;
    statusText.textContent = 'Now playing 🔊';
  });

  pauseBtn?.addEventListener('click', () => {
    alert('Pause via keyboard (Ctrl+Shift+Space) or chapter controls on the page.');
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'audio-ready') {
      statusText.textContent = 'Audio ready 🎧';
    }
    if (message.type === 'LOG_EVENT') {
      appendLog(message.entry);
    }
  });

  // ---- Log UI ----
  const logView = document.getElementById('logView');
  const logRefreshBtn = document.getElementById('logRefresh');
  const logCopyBtn = document.getElementById('logCopy');
  const logClearBtn = document.getElementById('logClear');

  function fmtTs(ts) {
    const d = new Date(ts);
    return d.toLocaleTimeString(undefined, { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3,'0');
  }
  function renderLine(e) {
    const meta = e.meta ? ' ' + JSON.stringify(e.meta) : '';
    return `[${fmtTs(e.ts)}] ${e.ctx.toUpperCase()} ${e.evt}${meta}`;
  }
  function appendLog(entry) {
    if (!logView) return;
    const line = document.createElement('div');
    line.textContent = renderLine(entry);
    logView.appendChild(line);
    logView.scrollTop = logView.scrollHeight;
  }
  function loadLog() {
    if (!logView) return;
    chrome.storage.local.get(['ingridLog'], ({ ingridLog = [] }) => {
      logView.innerHTML = '';
      ingridLog.slice(-500).forEach(appendLog);
    });
  }
  logRefreshBtn?.addEventListener('click', loadLog);
  logClearBtn?.addEventListener('click', () => {
    chrome.storage.local.set({ ingridLog: [] }, loadLog);
  });
  logCopyBtn?.addEventListener('click', async () => {
    chrome.storage.local.get(['ingridLog'], ({ ingridLog = [] }) => {
      const text = ingridLog.map(renderLine).join('\n');
      navigator.clipboard?.writeText(text).then(()=> {
        statusText.textContent = 'Log copied to clipboard';
        setTimeout(()=> statusText.textContent = '', 1200);
      });
    });
  });

  // Initial load
  loadLog();
}
