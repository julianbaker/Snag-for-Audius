// popup.js
async function getCurrentTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) throw new Error('No active tab found');
    return tab;
}

async function getUrlInfo(tabId) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ type: 'PARSE_URL', tabId }, (response) => {
            if (chrome.runtime.lastError) {
                reject(new Error(`Failed to get page information: ${chrome.runtime.lastError.message}`));
                return;
            }
            if (!response?.success) {
                reject(new Error(response?.error || 'Failed to parse URL information'));
                return;
            }
            resolve(response.data);
        });
    });
}

function updateStatus(message, type = 'loading') {
    const el = document.getElementById('status');
    if (!el) return;
    el.textContent = message;
    el.className = type;
}

async function handleDownload() {
    try {
        updateStatus('Initializing download...');
        const tab = await getCurrentTab();

        if (!tab.url || !tab.url.includes('audius.co')) {
            throw new Error('Run this on an Audius profile, track, album, or playlist page.');
        }

        const urlInfo = await getUrlInfo(tab.id);
        updateStatus('Snagging assets...');

        chrome.runtime.sendMessage({
            type: urlInfo.isContentPage ? 'DOWNLOAD_CONTENT' : 'DOWNLOAD_ARTIST',
            contentId: urlInfo.contentId,
            contentType: urlInfo.contentType,
            artistId: urlInfo.artistHandle
        }, (response) => {
            if (chrome.runtime.lastError) {
                updateStatus('Failed to start download', 'error');
            } else if (response?.success) {
                updateStatus('Snagged!', 'success');
            } else {
                updateStatus(response?.error || 'Download failed', 'error');
            }
            setTimeout(() => window.close(), 2000);
        });
    } catch (error) {
        updateStatus(error.message || 'Download failed', 'error');
        setTimeout(() => window.close(), 2000);
    }
}

document.addEventListener('DOMContentLoaded', handleDownload);
