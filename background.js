chrome.runtime.onInstalled.addListener(function (object) {
    let internalUrl = chrome.runtime.getURL("index.html");

    if (object.reason === chrome.runtime.OnInstalledReason.INSTALL) {
        chrome.tabs.create({ url: internalUrl });
    }
});

chrome.action.onClicked.addListener(function(tab) {
    chrome.tabs.create({ url: chrome.runtime.getURL('index.html'), selected: true });
});