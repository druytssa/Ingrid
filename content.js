function findChapters(root = document) {
  const nodes = [...root.querySelectorAll('h1, h2, h3')];
  return nodes.map((h, i) => {
    let end = null;
    for (let n = h.nextElementSibling; n; n = n.nextElementSibling) {
      if (/^H[123]$/.test(n.tagName)) break;
      end = n;
    }
    const wrapper = document.createElement('section');
    wrapper.className = 'ai-tts-chapter';
    wrapper.dataset.chapterIndex = String(i);
    h.before(wrapper);
    wrapper.appendChild(h);
    let walker = h.nextElementSibling;
    while (walker && walker !== (end?.nextElementSibling || null)) {
      const next = walker.nextElementSibling;
      wrapper.appendChild(walker);
      walker = next;
    }
    return wrapper;
  });
}

function injectControls(chapterEl) {
  if (chapterEl.querySelector('.ai-tts-controls')) return;
  const bar = document.createElement('div');
  bar.className = 'ai-tts-controls';
  bar.innerHTML = `
    <button class="ai-tts-play">▶</button>
    <button class="ai-tts-pause" disabled>⏸</button>
    <button class="ai-tts-replay" title="Replay 10s" disabled>↺10s</button>
    <button class="ai-tts-bookmark" title="Bookmark">★</button>
    <div class="ai-tts-progress" aria-hidden="true">
      <div class="ai-tts-progress__bar" style="width:0%"></div>
    </div>
  `;
  chapterEl.insertBefore(bar, chapterEl.children[1]);
}

function prepareChapters() {
  const chapters = findChapters();
  chapters.forEach(injectControls);
  wireControlEvents();
}

function wireControlEvents() {
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('button'); 
    if (!btn) return;
    const chapter = btn.closest('.ai-tts-chapter'); 
    if (!chapter) return;
    const idx = Number(chapter.dataset.chapterIndex);

    if (btn.classList.contains('ai-tts-play')) {
      chrome.runtime.sendMessage({ type: 'CH_PLAY', idx, text: getChapterText(chapter) });
    }
    if (btn.classList.contains('ai-tts-pause')) {
      chrome.runtime.sendMessage({ type: 'CH_PAUSE', idx });
    }
    if (btn.classList.contains('ai-tts-replay')) {
      chrome.runtime.sendMessage({ type: 'CH_REPLAY', idx, seconds: 10 });
    }
    if (btn.classList.contains('ai-tts-bookmark')) {
      chrome.runtime.sendMessage({ type: 'CH_BOOKMARK', idx });
    }
  });
}

function getChapterText(ch) {
  const clone = ch.cloneNode(true);
  clone.querySelectorAll('.ai-tts-controls').forEach(n => n.remove());
  return clone.innerText.trim();
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'CH_ACTIVE') {
    document.querySelectorAll('.ai-tts-chapter.active').forEach(el => el.classList.remove('active'));
    const target = document.querySelector(`.ai-tts-chapter[data-chapter-index="${msg.idx}"]`);
    if (target) {
      target.classList.add('active');
      target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      const bar = target.querySelector('.ai-tts-controls');
      if (bar) {
        const playBtn = bar.querySelector('.ai-tts-play');
        const pauseBtn = bar.querySelector('.ai-tts-pause');
        const replayBtn = bar.querySelector('.ai-tts-replay');
        if (playBtn) playBtn.toggleAttribute('disabled', msg.state === 'playing');
        if (pauseBtn) pauseBtn.toggleAttribute('disabled', msg.state !== 'playing');
        if (replayBtn) replayBtn.toggleAttribute('disabled', msg.state !== 'playing');
      }
    }
  }
  if (msg.type === 'CH_PROGRESS') {
    const target = document.querySelector(`.ai-tts-chapter[data-chapter-index="${msg.idx}"]`);
    if (target) {
      const bar = target.querySelector('.ai-tts-progress__bar');
      if (bar) bar.style.width = `${Math.max(0, Math.min(100, msg.percent || 0))}%`;
    }
  }
  if (msg.type === 'SHOW_TOAST') {
    showAiToast(msg.text || '');
  }
  if (msg.type === 'GET_SELECTION') {
    const selection = window.getSelection()?.toString() || '';
    chrome.runtime.sendMessage({ type: 'SELECTION_TEXT', text: selection });
  }
});

let aiToastTimer = null;
function showAiToast(text) {
  const root = document.body;
  let toast = document.getElementById('ai-tts-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'ai-tts-toast';
    toast.className = 'ai-tts-toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    root.appendChild(toast);
  }
  toast.textContent = text;
  toast.classList.add('show');
  clearTimeout(aiToastTimer);
  aiToastTimer = setTimeout(() => toast.classList.remove('show'), 1800);
}
const style = document.createElement('style');
style.textContent = `
.ai-tts-chapter { position: relative; padding-top: 0.5rem; }
.ai-tts-chapter.active { outline: 3px solid rgba(255, 239, 159, 0.7); outline-offset: 6px; }
.ai-tts-controls { display: inline-flex; gap: 6px; align-items: center;
  position: sticky; top: 0; background: var(--bg, #fff); padding: 6px 8px; border-radius: 8px;
  box-shadow: 0 2px 6px rgba(0,0,0,0.08); z-index: 10; }
.ai-tts-controls button { cursor: pointer; font-size: 14px; padding: 4px 8px; }
`;
document.documentElement.appendChild(style);

const ready = () => prepareChapters();
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', ready);
} else {
  ready();
}
new MutationObserver(() => prepareChapters())
  .observe(document.body, { childList: true, subtree: true });

// --- tiny logger (content side) ---
function log(evt, meta = {}) {
  const entry = { ts: Date.now(), ctx: 'content', evt, meta };
  chrome.storage.local.get(['ingridLog'], ({ ingridLog = [] }) => {
    ingridLog.push(entry);
    if (ingridLog.length > 500) ingridLog.splice(0, ingridLog.length - 500);
    chrome.storage.local.set({ ingridLog });
    chrome.runtime.sendMessage({ type: 'LOG_EVENT', entry });
  });
}

chrome.runtime.onMessage.addListener((msg) => {
  log('rx.message', { type: msg.type });
  if (msg.type === 'CH_ACTIVE') {
    document.querySelectorAll('.ai-tts-chapter.active').forEach(el => el.classList.remove('active'));
    const target = document.querySelector(`.ai-tts-chapter[data-chapter-index="${msg.idx}"]`);
    if (target) {
      target.classList.add('active');
      target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      const bar = target.querySelector('.ai-tts-controls');
      if (bar) {
        const playBtn = bar.querySelector('.ai-tts-play');
        const pauseBtn = bar.querySelector('.ai-tts-pause');
        const replayBtn = bar.querySelector('.ai-tts-replay');
        if (playBtn) playBtn.toggleAttribute('disabled', msg.state === 'playing');
        if (pauseBtn) pauseBtn.toggleAttribute('disabled', msg.state !== 'playing');
        if (replayBtn) replayBtn.toggleAttribute('disabled', msg.state !== 'playing');
      }
    }
  }
  if (msg.type === 'CH_PROGRESS') {
    const target = document.querySelector(`.ai-tts-chapter[data-chapter-index="${msg.idx}"]`);
    if (target) {
      const bar = target.querySelector('.ai-tts-progress__bar');
      if (bar) bar.style.width = `${Math.max(0, Math.min(100, msg.percent || 0))}%`;
    }
  }
  if (msg.type === 'SHOW_TOAST') {
    showAiToast(msg.text || '');
  }
  if (msg.type === 'GET_SELECTION') {
    const selection = window.getSelection()?.toString() || '';
    chrome.runtime.sendMessage({ type: 'SELECTION_TEXT', text: selection });
  }
});

let aiToastTimer = null;
function showAiToast(text) {
  const root = document.body;
  let toast = document.getElementById('ai-tts-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'ai-tts-toast';
    toast.className = 'ai-tts-toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    root.appendChild(toast);
  }
  toast.textContent = text;
  toast.classList.add('show');
  clearTimeout(aiToastTimer);
  aiToastTimer = setTimeout(() => toast.classList.remove('show'), 1800);
}
const style = document.createElement('style');
style.textContent = `
.ai-tts-chapter { position: relative; padding-top: 0.5rem; }
.ai-tts-chapter.active { outline: 3px solid rgba(255, 239, 159, 0.7); outline-offset: 6px; }
.ai-tts-controls { display: inline-flex; gap: 6px; align-items: center;
  position: sticky; top: 0; background: var(--bg, #fff); padding: 6px 8px; border-radius: 8px;
  box-shadow: 0 2px 6px rgba(0,0,0,0.08); z-index: 10; }
.ai-tts-controls button { cursor: pointer; font-size: 14px; padding: 4px 8px; }
`;
document.documentElement.appendChild(style);

const ready = () => prepareChapters();
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', ready);
} else {
  ready();
}
new MutationObserver(() => prepareChapters())
  .observe(document.body, { childList: true, subtree: true });

// --- Simple inline OpenAI audio player (chapter-level progress) ---
let oaAudio = null;
let oaIdx = null;
function ensureOaAudio() {
  if (oaAudio) return oaAudio;
  oaAudio = new Audio();
  oaAudio.preload = 'auto';
  oaAudio.addEventListener('ended', () => {
    if (oaIdx != null) sendChapterState(oaIdx, 'stopped');
    showAiToast('Finished');
    updateOaProgress(100);
    log('oa.audio.ended', { idx: oaIdx });
  });
  oaAudio.addEventListener('timeupdate', () => {
    updateOaProgress((oaAudio.currentTime / Math.max(1, oaAudio.duration)) * 100);
  });
  oaAudio.addEventListener('play', () => log('oa.audio.play', { idx: oaIdx }));
  oaAudio.addEventListener('pause', () => log('oa.audio.pause', { idx: oaIdx }));
  oaAudio.addEventListener('error', () => log('oa.audio.error', { idx: oaIdx, code: oaAudio.error?.code }));
  return oaAudio;
}

function oaPlayUrl(idx, url) {
  oaIdx = idx;
  const a = ensureOaAudio();
  a.src = url;
  a.currentTime = 0;
  a.play().catch(()=>{});
  sendChapterState(idx, 'playing');
  showAiToast('Playing');
  log('oa.audio.start', { idx, urlLen: url.length });
}

function oaSeekBy(sec) {
  const a = ensureOaAudio();
  if (!a.duration || Number.isNaN(a.duration)) return;
  a.currentTime = Math.max(0, Math.min(a.duration - 0.25, (a.currentTime || 0) + sec));
  if (sec > 0) showAiToast('Skipped 10s'); else showAiToast('Rewound 10s');
  log('oa.audio.seek', { by: sec, now: a.currentTime });
}

function sendChapterState(idx, state) {
  chrome.runtime.sendMessage({ type: 'CH_ACTIVE', idx, state });
}

// ===== Local TTS engine logging hooks (add inside your TTS implementation) =====
// Example integration points (call log(...) where appropriate in your existing local TTS code):
// - log('tts.local.start', { idx, rate: TTS_SETTINGS.rate, voice: TTS_SETTINGS.voiceName });
// - log('tts.local.boundary', { word: startWordIdx + wordIndex });
// - log('tts.local.pause', {});
// - log('tts.local.resume', {});
// - log('tts.local.end', {});
const TTS = (() => {
  let utterance = null;
  let fullText = '';
  let tokens = [];
  let tokenToCharIdx = [];
  let startWordIdx = 0;
  let wordIndex = 0;
  let isPaused = false;
  let currentChapterIdx = null;
  let wpsHeur = 2; // words/sec fallback
  const deltas = [];

  function tokenize(text) {
    const parts = text.match(/\S+|\s+/g) || [];
    const toks = [], map = [];
    let pos = 0;
    for (const p of parts) {
      if (/\s+/.test(p)) { pos += p.length; continue; }
      toks.push(p); map.push(pos); pos += p.length;
    }
    return { toks, map };
  }

  function speakChapter(idx, text) {
    stop();
    currentChapterIdx = idx;
    fullText = text;
    const t = tokenize(text);
    tokens = t.toks; tokenToCharIdx = t.map;
    startWordIdx = 0; wordIndex = 0; deltas.length = 0;

    const startChar = tokenToCharIdx[startWordIdx] ?? 0;
    const speakText = fullText.slice(startChar);

    utterance = new SpeechSynthesisUtterance(speakText);
    utterance.onstart = () => { sendActive('playing'); log('tts.local.start', { idx: currentChapterIdx }); };
    utterance.onend   = () => { sendActive('stopped'); sendProgress(100); log('tts.local.end', { idx: currentChapterIdx }); };
    utterance.onerror = () => { sendActive('stopped'); sendProgress(100); };

    let lastBoundary = performance.now();
    utterance.onboundary = (e) => {
      if (e.name === 'word' || e.charLength > 0) {
        const now = performance.now();
        const dt = (now - lastBoundary) / 1000;
        lastBoundary = now;
        if (dt > 0 && dt < 2) { // keep sane values
          deltas.push(dt);
          if (deltas.length > 40) deltas.shift();
          const avg = deltas.reduce((a,b)=>a+b,0) / deltas.length;
          wpsHeur = Math.min(6, Math.max(1, 1/avg));
        }
        sendWordHighlight(startWordIdx + wordIndex);
        wordIndex++;
        sendProgress();
        log('tts.local.boundary', { word: startWordIdx + wordIndex });
      }
    };

    speechSynthesis.speak(utterance);
    showToast('Playing');
    sendProgress();
  }

  function pause() { speechSynthesis.pause(); isPaused = true; sendActive('paused'); showToast('Paused'); log('tts.local.pause', {}); }
  function resume() { speechSynthesis.resume(); isPaused = false; sendActive('playing'); showToast('Playing'); }

  function stop() { if (utterance) { speechSynthesis.cancel(); } utterance = null; isPaused = false; }

  function jumpSeconds(seconds, forward = false) {
    if (!tokens.length) return;
    const deltaWords = Math.max(1, Math.round((seconds * wpsHeur)));
    const newStart = forward
      ? Math.min(tokens.length - 1, startWordIdx + wordIndex + deltaWords)
      : Math.max(0, startWordIdx + wordIndex - deltaWords);
    restartFrom(newStart);
  }

  function restartFrom(newWordIndex) {
    if (!fullText) return;
    startWordIdx = Math.max(0, Math.min(tokens.length - 1, newWordIndex));
    wordIndex = 0;
    const startChar = tokenToCharIdx[startWordIdx] ?? 0;
    stop();
    utterance = new SpeechSynthesisUtterance(fullText.slice(startChar));
    utterance.onstart = () => sendActive('playing');
    utterance.onend   = () => { sendActive('stopped'); sendProgress(100); };
    utterance.onerror = () => { sendActive('stopped'); sendProgress(100); };
    utterance.onboundary = (e) => {
      if (e.name === 'word' || e.charLength > 0) {
        sendWordHighlight(startWordIdx + wordIndex);
        wordIndex++; sendProgress();
      }
    };
    speechSynthesis.speak(utterance);
  }

  // Messaging to existing UI hooks you already have:
  function sendActive(state) {
    chrome.runtime.sendMessage({ type: 'CH_ACTIVE', idx: currentChapterIdx, state });
  }
  function sendProgress(explicitPct) {
    const pct = typeof explicitPct === 'number'
      ? explicitPct
      : Math.round(((startWordIdx + wordIndex) / Math.max(1, tokens.length)) * 100);
    chrome.runtime.sendMessage({ type: 'CH_PROGRESS', idx: currentChapterIdx, percent: pct });
  }

  return {
    speakChapter, pause, resume,
    rewind10: () => { jumpSeconds(10, false); showToast('Rewound 10s'); },
    skip10:   () => { jumpSeconds(10, true);  showToast('Skipped 10s'); },
  };
})();

// Listen for messages from background/popup and drive local TTS
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'CH_PLAY')   { TTS.speakChapter(msg.idx, msg.text); }
  if (msg.type === 'CH_PAUSE')  { TTS.pause(); }
  if (msg.type === 'CH_REPLAY') { TTS.rewind10(); }
  if (msg.type === 'CH_SKIP')   { TTS.skip10(); }
});
