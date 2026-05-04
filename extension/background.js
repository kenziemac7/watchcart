// Service worker for WatchCart MV3 extension

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') {
    chrome.action.setBadgeText({ text: 'NEW' });
    chrome.action.setBadgeBackgroundColor({ color: '#7c6af5' });
  }
});

// Clear the badge when the popup is opened
chrome.action.onClicked.addListener(() => {
  chrome.action.setBadgeText({ text: '' });
});

// Allow the popup to send messages to the service worker if needed in future
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'CLEAR_BADGE') {
    chrome.action.setBadgeText({ text: '' });
    sendResponse({ ok: true });
  }
  return false;
});
