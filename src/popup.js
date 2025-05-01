// Get current tab to check if we're on an artist page
async function getCurrentTab() {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab) {
            throw new Error('No active tab found');
        }
        return tab;
    } catch (error) {
        console.error('Error getting current tab:', error);
        throw new Error('Failed to get current tab');
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
                console.error('Error getting URL info:', chrome.runtime.lastError);
                reject(new Error(`Failed to get page information: ${chrome.runtime.lastError.message}`));
                return;
            }
            if (!response || !response.success) {
                console.error('Invalid response:', response);
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
    } catch (error) {
        console.error('Error extracting artist from track URL:', error);
    }
    return null;
}

// Update status display
function updateStatus(message, type = 'loading') {
    try {
        const statusEl = document.getElementById('status');
        if (!statusEl) {
            console.error('Status element not found');
            return;
        }
        statusEl.textContent = message;
        statusEl.className = type;
    } catch (error) {
        console.error('Error updating status:', error);
    }
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
        console.log('URL parsing details:', urlInfo);

        if (!urlInfo) {
            throw new Error('Failed to parse page information');
        }

        updateStatus('Snagging assets...');

        // For track pages, we need both the artist handle and track info
        let artistId = urlInfo.artistHandle;
        if (urlInfo.isContentPage && urlInfo.contentType === 'track') {
            artistId = getArtistFromTrackUrl(tab.url);
            console.log('Extracted artist ID from track URL:', artistId);
        }

        // Send download request to background script
        chrome.runtime.sendMessage({
            type: urlInfo.isContentPage ? 'DOWNLOAD_CONTENT' : 'DOWNLOAD_ARTIST',
            contentId: urlInfo.contentId,
            contentType: urlInfo.contentType,
            artistId: artistId
        }, (response) => {
            if (chrome.runtime.lastError) {
                console.error('Message sending error:', chrome.runtime.lastError);
                updateStatus('Failed to start download', 'error');
            } else if (response && response.success) {
                updateStatus('Download started!', 'success');
            } else {
                updateStatus(response?.error || 'Download failed', 'error');
            }
            // Close popup after a short delay to show status
            setTimeout(() => window.close(), 2000);
        });

    } catch (error) {
        console.error('Download error:', error);
        updateStatus(error.message || 'Download failed', 'error');
        setTimeout(() => window.close(), 2000);
    }
}

// Start download when popup opens
document.addEventListener('DOMContentLoaded', handleDownload); 