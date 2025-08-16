// Background runs as MV3 service worker (no DOM, no Web Speech here).
// It simply relays commands to the active tab's content script.
let state = { tabId: null };

chrome.runtime.onMessage.addListener(async (msg, sender, sendResponse) => {
  if (sender.tab?.id) state.tabId = sender.tab.id;

  if (msg.type === 'play-stored-audio') {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      const tabId = tabs?.[0]?.id;
      if (!tabId) { sendResponse({ status: 'no-tab' }); return; }
      chrome.tabs.sendMessage(tabId, { type: 'KBD_TOGGLE' }, () => {
        sendResponse({ status: 'ok' });
      });
    });
    return true;
  }

  // Relay any CH_* or SETTINGS messages to the tab (handled in content.js)
  if (state.tabId && /^CH_|^SET_|^PREF_/.test(msg.type)) {
    chrome.tabs.sendMessage(state.tabId, msg);
  }
});

// Keyboard shortcuts (MV3 "commands") → forward to active tab
chrome.commands?.onCommand.addListener((command) => {
  chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
    const tabId = tabs?.[0]?.id;
    if (!tabId) return;
    if (command === 'toggle-play-pause') chrome.tabs.sendMessage(tabId, { type: 'KBD_TOGGLE' });
    if (command === 'replay-10s')       chrome.tabs.sendMessage(tabId, { type: 'KBD_REPLAY', seconds: 10 });
    if (command === 'skip-10s')         chrome.tabs.sendMessage(tabId, { type: 'KBD_SKIP',   seconds: 10 });
  });
});
