// popup.js
// Get current tab to check if we're on an artist page
async function getCurrentTab() {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab) {
            throw new Error('No active tab found');
        }
        return tab;
    } catch (error) {
        // Log once with context
        console.error('Tab retrieval error:', error.message);
        throw error;
    }
}

// Get URL info from background script
async function getUrlInfo(tabId) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
            type: 'PARSE_URL',
            tabId: tabId
        }, response => {
            if (chrome.runtime.lastError) {
                reject(new Error(`Failed to get page information: ${chrome.runtime.lastError.message}`));
                return;
            }
            if (!response || !response.success) {
                reject(new Error(response?.error || 'Failed to parse URL information'));
                return;
            }
            resolve(response.data);
        });
    });
}

// Extract artist handle from track URL
function getArtistFromTrackUrl(url) {
    try {
        const urlObj = new URL(url);
        const pathParts = urlObj.pathname.split('/').filter(Boolean);
        if (pathParts.length === 2) {
            return pathParts[0]; // First part is the artist handle
        }
    } catch {
        // Silently fail - this is expected for non-track URLs
    }
    return null;
}

// Update status display
function updateStatus(message, type = 'loading') {
    const statusEl = document.getElementById('status');
    if (!statusEl) return; // Silently fail for UI errors
    statusEl.textContent = message;
    statusEl.className = type;
}

// Main download handler
async function handleDownload() {
    try {
        updateStatus('Initializing download...');

        const tab = await getCurrentTab();

        if (!tab.url || !tab.url.includes('audius.co')) {
            throw new Error('Run this on an Audius profile, track, album, or playlist page.');
        }

        // Get URL info from content script
        const urlInfo = await getUrlInfo(tab.id);

        if (!urlInfo) {
            throw new Error('Failed to parse page information');
        }

        updateStatus('Snagging assets...');

        // For track pages, we need both the artist handle and track info
        let artistId = urlInfo.artistHandle;
        if (urlInfo.isContentPage && urlInfo.contentType === 'track') {
            artistId = getArtistFromTrackUrl(tab.url);
        }

        // Send download request to background script
        chrome.runtime.sendMessage({
            type: urlInfo.isContentPage ? 'DOWNLOAD_CONTENT' : 'DOWNLOAD_ARTIST',
            contentId: urlInfo.contentId,
            contentType: urlInfo.contentType,
            artistId: artistId
        }, (response) => {
            if (chrome.runtime.lastError) {
                updateStatus('Failed to start download', 'error');
            } else if (response && response.success) {
                updateStatus('Snagged!', 'success');
            } else {
                updateStatus(response?.error || 'Download failed', 'error');
            }
            // Close popup after a short delay to show status
            setTimeout(() => window.close(), 2000);
        });

    } catch (error) {
        updateStatus(error.message || 'Download failed', 'error');
        setTimeout(() => window.close(), 2000);
    }
}

// Start download when popup opens
document.addEventListener('DOMContentLoaded', handleDownload); 