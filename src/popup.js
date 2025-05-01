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

// Convert base64 to blob
function base64ToBlob(base64, type) {
    try {
        const binaryString = window.atob(base64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return new Blob([bytes], { type: type });
    } catch (error) {
        console.error('Error converting base64 to blob:', error);
        throw new Error('Failed to process download data');
    }
}

// Format download filename based on content type
function formatDownloadFilename(response, urlInfo) {
    // Extract the last part of the path for content name
    const getNameFromPath = (path) => {
        const parts = path.split('/');
        return parts[parts.length - 1];
    };

    if (urlInfo.isArtistPage) {
        return `${urlInfo.artistHandle} - Profile Assets (Audius).zip`;
    }

    const contentName = getNameFromPath(response.data.contentId);

    switch (urlInfo.contentType) {
        case 'track':
            return `${contentName} - Track Assets (Audius).zip`;
        case 'playlist':
            return `${contentName} - Playlist Assets (Audius).zip`;
        case 'album':
            return `${contentName} - Album Assets (Audius).zip`;
        default:
            return `${contentName} - Assets (Audius).zip`;
    }
}

// Main download handler
async function handleDownload() {
    console.log('TEST MESSAGE - This should be visible in console');
    try {
        updateStatus('TESTING - Please wait...');

        const tab = await getCurrentTab();
        console.log('Current tab URL:', tab.url);

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

        // Get data from background script
        const response = await new Promise((resolve, reject) => {
            const message = {
                type: urlInfo.isContentPage ? 'DOWNLOAD_CONTENT' : 'DOWNLOAD_ARTIST',
                contentId: urlInfo.contentId,
                contentType: urlInfo.contentType,
                artistId: artistId
            };
            console.log('Sending download message:', message);

            // Set a timeout to handle cases where the background script doesn't respond
            const timeout = setTimeout(() => {
                reject(new Error('Download timed out - please try again'));
            }, 30000); // 30 second timeout

            chrome.runtime.sendMessage(message, (response) => {
                clearTimeout(timeout);
                if (chrome.runtime.lastError) {
                    console.error('Message sending error:', chrome.runtime.lastError);
                    reject(new Error('Failed to communicate with background script'));
                } else {
                    resolve(response);
                }
            });
        });

        console.log('Received download response:', response);

        if (!response) {
            throw new Error('No response received from background script');
        }

        if (response.success && response.data) {
            // Convert base64 back to blob
            const blob = base64ToBlob(response.data.base64, response.data.type);

            if (!blob || blob.size === 0) {
                throw new Error('Invalid download data received');
            }

            // Create download URL
            const url = URL.createObjectURL(blob);
            let downloadId = null;

            try {
                // Trigger download and wait for it to start
                downloadId = await new Promise((resolve, reject) => {
                    chrome.downloads.download({
                        url: url,
                        filename: formatDownloadFilename(response, urlInfo),
                        saveAs: false  // Automatically download without prompt
                    }, (downloadId) => {
                        if (chrome.runtime.lastError) {
                            reject(chrome.runtime.lastError);
                        } else {
                            resolve(downloadId);
                        }
                    });
                });

                // Wait for download to complete or fail
                await new Promise((resolve, reject) => {
                    const listener = (downloadDelta) => {
                        if (downloadDelta.id === downloadId) {
                            if (downloadDelta.state &&
                                (downloadDelta.state.current === 'complete' ||
                                    downloadDelta.state.current === 'interrupted')) {
                                chrome.downloads.onChanged.removeListener(listener);
                                if (downloadDelta.state.current === 'complete') {
                                    resolve();
                                } else {
                                    reject(new Error('Download was interrupted'));
                                }
                            }
                        }
                    };
                    chrome.downloads.onChanged.addListener(listener);
                });

                updateStatus('Snagged!', 'success');
            } finally {
                // Clean up the blob URL after download is complete or failed
                URL.revokeObjectURL(url);
            }

            // Give user time to see success message
            setTimeout(() => window.close(), 2000);
        } else {
            throw new Error(response?.error || 'Download failed');
        }
    } catch (error) {
        console.error('Download error:', error);
        updateStatus(error.message || 'Download failed', 'error');
        setTimeout(() => window.close(), 2000);
    }
}

// Start download when popup opens
document.addEventListener('DOMContentLoaded', handleDownload); 