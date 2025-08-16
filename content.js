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
