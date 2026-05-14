// content.js
// Runs on Audius pages. Uses AudiusUrlParser injected by manifest.

(function () {
    'use strict';

    const { parseUrlInfo } = self.AudiusUrlParser || {};
    if (!parseUrlInfo) return;

    function notify(type, extra) {
        try {
            const info = parseUrlInfo(window.location.href);
            chrome.runtime.sendMessage({ type, urlInfo: info, ...extra }).catch((error) => {
                if (!error?.message?.includes('receiving end does not exist')) {
                    console.error('Content script message error:', error);
                }
            });
        } catch (error) {
            console.error('Content script notify error:', error);
        }
    }

    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (message?.type === 'GET_URL_INFO') {
            const info = parseUrlInfo(window.location.href);
            if (info) sendResponse({ success: true, data: info });
            else sendResponse({ success: false, error: 'Nothing to snag here' });
            return false;
        }
    });

    // SPA navigation detection — patch history methods instead of polling DOM.
    let lastUrl = window.location.href;
    const emitIfChanged = () => {
        if (window.location.href === lastUrl) return;
        lastUrl = window.location.href;
        notify('URL_CHANGED');
    };
    for (const method of ['pushState', 'replaceState']) {
        const original = history[method];
        history[method] = function (...args) {
            const result = original.apply(this, args);
            queueMicrotask(emitIfChanged);
            return result;
        };
    }
    window.addEventListener('popstate', emitIfChanged);
    window.addEventListener('hashchange', emitIfChanged);

    const ready = () => notify('CONTENT_SCRIPT_READY');
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', ready, { once: true });
    } else {
        ready();
    }
})();
