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

playBtn.addEventListener('click', () => {
  console.log("[popup] Play button clicked");
  spinner.style.display = 'block';
  playBtn.disabled = true;
  statusText.textContent = 'Playing...';

  // Send play request to background, but don't expect a reply
  chrome.runtime.sendMessage({ type: "play-stored-audio" }, () => {
    // This callback may run even if background doesn't respond
    spinner.style.display = 'none';
    playBtn.disabled = false;
    statusText.textContent = 'Now playing 🔊';
  });
});

pauseBtn.addEventListener('click', () => {
  console.log("[popup] Pause button clicked");
  alert("Pause only works during direct popup playback. Background audio can’t be paused yet.");
});
