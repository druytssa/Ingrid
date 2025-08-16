const spinner = document.getElementById('spinner');
const playBtn = document.getElementById('playBtn');
const pauseBtn = document.getElementById('pauseBtn');

// Create and insert a "Now Playing" banner element
const statusText = document.createElement('div');
statusText.style.marginTop = '5px';
statusText.style.fontSize = '12px';
statusText.style.color = '#ccc';
statusText.textContent = '';
document.body.appendChild(statusText);

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "audio-ready") {
    console.log("[popup] Received 'audio-ready' message");
    statusText.textContent = "Audio ready 🎧";
  }
});

playBtn?.addEventListener('click', () => {
  console.log("[popup] Play button clicked");
  spinner.style.display = 'block';
  playBtn.disabled = true;
  statusText.textContent = 'Playing...';

  // Send play request to background, but don't expect a reply
  chrome.runtime.sendMessage({ type: "play-stored-audio" }, (res) => {
    if (chrome.runtime.lastError) {
      console.warn(chrome.runtime.lastError.message);
      spinner.style.display = 'none';
      playBtn.disabled = false;
      statusText.textContent = 'No ChatGPT tab found';
      return;
    }
    spinner.style.display = 'none';
    playBtn.disabled = false;
    statusText.textContent = res?.status === 'ok' ? 'Now playing 🔊' : 'Sent ▶';
  });
});

pauseBtn?.addEventListener('click', () => {
  console.log("[popup] Pause button clicked");
  alert("Pause only works during direct popup playback. Background audio can’t be paused yet.");
});

// Load settings on popup open
chrome.storage.sync.get(['rate', 'voice', 'preferLocal','useOpenAi','openai_api_key','openai_voice'], (settings) => {
  const r = document.getElementById('rateInput');
  const v = document.getElementById('voiceSelect');
  const c = document.getElementById('preferLocalCheckbox');
  const use = document.getElementById('useOpenAi');
  const key = document.getElementById('apiKey');
  const ova = document.getElementById('oaVoice');
  if (r) r.value = settings.rate ?? 1.0;
  if (v) v.value = settings.voice ?? '';
  if (c) c.checked = !!settings.preferLocal;
  if (use) use.checked = !!settings.useOpenAi;
  if (key && settings.openai_api_key) key.value = settings.openai_api_key;
  if (ova && settings.openai_voice) ova.value = settings.openai_voice;
});

// Save settings when changed
const saveSettings = () => {
  const r = document.getElementById('rateInput');
  const v = document.getElementById('voiceSelect');
  const c = document.getElementById('preferLocalCheckbox');
  const use = document.getElementById('useOpenAi');
  const key = document.getElementById('apiKey');
  const ova = document.getElementById('oaVoice');
  const rate = r ? parseFloat(r.value) : undefined;
  const voice = v ? v.value : undefined;
  const preferLocal = c ? c.checked : undefined;
  const useOpenAi = use ? use.checked : undefined;
  const openai_api_key = key ? key.value.trim() : undefined;
  const openai_voice = ova ? ova.value : undefined;
  chrome.storage.sync.set({ rate, voice, preferLocal, useOpenAi, openai_api_key, openai_voice });
};

document.getElementById('rateInput')?.addEventListener('change', saveSettings);
document.getElementById('voiceSelect')?.addEventListener('change', saveSettings);
document.getElementById('preferLocalCheckbox')?.addEventListener('change', saveSettings);
document.getElementById('useOpenAi')?.addEventListener('change', saveSettings);
document.getElementById('apiKey')?.addEventListener('input', saveSettings);
document.getElementById('oaVoice')?.addEventListener('change', saveSettings);
