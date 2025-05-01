"use strict";
// This script runs on Audius pages to detect artist information

// URL parsing utilities
function isArtistPage(url) {
    try {
        const urlObj = new URL(url);
        const pathParts = urlObj.pathname.split('/').filter(Boolean);
        return pathParts.length === 1 && !['trending', 'explore', 'feed', 'notifications'].includes(pathParts[0]);
    } catch (error) {
        console.error('Error in isArtistPage:', error);
        return false;
    }
}

function isContentPage(url) {
    try {
        const urlObj = new URL(url);
        const pathParts = urlObj.pathname.split('/').filter(Boolean);

        // Check for tracks (2 parts) or albums/playlists (3 parts)
        if (pathParts.length === 2) {
            return !['trending', 'explore', 'feed', 'notifications'].includes(pathParts[0]);
        }

        if (pathParts.length === 3) {
            const [artist, type] = pathParts;
            return !['trending', 'explore', 'feed', 'notifications'].includes(artist) &&
                (type === 'album' || type === 'playlist');
        }

        return false;
    } catch (error) {
        console.error('Error in isContentPage:', error);
        return false;
    }
}

function extractArtistHandle(url) {
    try {
        const urlObj = new URL(url);
        const pathParts = urlObj.pathname.split('/').filter(Boolean);

        // Handle track URLs (artist/track-name)
        if (pathParts.length === 2) {
            return pathParts[0];
        }

        // Handle artist profile URLs
        if (pathParts.length === 1) {
            const reservedPaths = ['trending', 'explore', 'feed', 'notifications'];
            if (!reservedPaths.includes(pathParts[0])) {
                return pathParts[0];
            }
        }

        return null;
    } catch (error) {
        console.error('Error in extractArtistHandle:', error);
        return null;
    }
}

function extractContentId(url) {
    try {
        const urlObj = new URL(url);
        const pathParts = urlObj.pathname.split('/').filter(Boolean);

        // Validate URL structure
        if (pathParts.length < 2 || pathParts.length > 3) {
            console.log('Invalid URL structure:', pathParts);
            return null;
        }

        // Handle track URLs (artist/track-name)
        if (pathParts.length === 2) {
            return `${pathParts[0]}/${pathParts[1]}`;
        }

        // Handle album/playlist URLs (artist/album/album-id or artist/playlist/playlist-id)
        if (pathParts.length === 3) {
            const [artist, type, slug] = pathParts;
            if (type === 'album' || type === 'playlist') {
                return `${artist}/${type}/${slug}`;
            }
        }

        return null;
    } catch (error) {
        console.error('Error in extractContentId:', error);
        return null;
    }
}

function getContentType(url) {
    try {
        const urlObj = new URL(url);
        const pathParts = urlObj.pathname.split('/').filter(Boolean);

        if (pathParts.length === 2) {
            return 'track';
        }

        if (pathParts.length === 3) {
            const [artist, type, id] = pathParts;
            if (type === 'playlist' || type === 'album') {
                return type;
            }
        }

        if (pathParts.length === 1) {
            return 'artist';
        }

        return null;
    } catch (error) {
        console.error('Error in getContentType:', error);
        return null;
    }
}

// Parse URL and get info
function getUrlInfo(url) {
    try {
        if (!url || typeof url !== 'string') {
            throw new Error('Invalid URL provided');
        }

        const urlInfo = {
            isArtistPage: isArtistPage(url),
            isContentPage: isContentPage(url),
            artistHandle: extractArtistHandle(url),
            contentId: extractContentId(url),
            contentType: getContentType(url)
        };

        // Validate the URL info
        if (!urlInfo.isArtistPage && !urlInfo.isContentPage) {
            throw new Error('Not a valid Audius page');
        }

        if (urlInfo.isContentPage && (!urlInfo.contentId || !urlInfo.contentType)) {
            throw new Error('Invalid content page URL');
        }

        if (urlInfo.isArtistPage && !urlInfo.artistHandle) {
            throw new Error('Invalid artist page URL');
        }

        console.log('URL info parsed successfully:', urlInfo);
        return urlInfo;
    } catch (error) {
        console.error('Error in getUrlInfo:', error);
        throw error;
    }
}

// Listen for messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('Content script received message:', message);

    if (message.type === 'GET_URL_INFO') {
        try {
            const urlInfo = getUrlInfo(window.location.href);
            console.log('Sending URL info to popup:', urlInfo);
            sendResponse({ success: true, data: urlInfo });
        } catch (error) {
            console.error('Error processing GET_URL_INFO:', error);
            sendResponse({
                success: false,
                error: error.message || 'Failed to parse URL information'
            });
        }
        return true; // Keep the message channel open
    }
});

// Listen for URL changes (for single-page app navigation)
let lastUrl = window.location.href;
new MutationObserver(async () => {
    const url = window.location.href;
    if (url !== lastUrl) {
        lastUrl = url;
        try {
            const urlInfo = getUrlInfo(url);
            // Notify the popup if it's open
            chrome.runtime.sendMessage({
                type: 'URL_CHANGED',
                urlInfo
            }).catch(error => {
                // Ignore errors when popup is not open
                if (!error.message.includes('receiving end does not exist')) {
                    console.error('Error sending URL change message:', error);
                }
            });
        } catch (error) {
            console.error('Error handling URL change:', error);
        }
    }
}).observe(document, { subtree: true, childList: true });

// Add ready state check
function isDocumentReady() {
    return document.readyState === 'complete' || document.readyState === 'interactive';
}

// Initialize content script
function initializeContentScript() {
    if (!isDocumentReady()) {
        document.addEventListener('DOMContentLoaded', initializeContentScript);
        return;
    }

    try {
        const urlInfo = getUrlInfo(window.location.href);
        console.log('Content script initialized with URL info:', urlInfo);

        // Notify background script that content script is ready
        chrome.runtime.sendMessage({
            type: 'CONTENT_SCRIPT_READY',
            urlInfo
        }).catch(error => {
            if (!error.message.includes('receiving end does not exist')) {
                console.error('Error sending ready message:', error);
            }
        });
    } catch (error) {
        console.error('Error during content script initialization:', error);
    }
}

// Initialize on load
initializeContentScript();
