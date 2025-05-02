// background.js
// Load dependencies in correct order
importScripts('./lib/jszip.min.js');
importScripts('./services/audiusApi.js');

// Initialize API hosts
const API_HOSTS = [
    'https://api.audius.co'
];

// Initialize services
const audiusApi = new AudiusApiService();

// Wait for service worker initialization
self.addEventListener('install', function (event) {
    event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', function (event) {
    event.waitUntil(self.clients.claim());
});

// Expose necessary objects to global scope
self.JSZip = JSZip;
self.AudiusApiService = AudiusApiService;

// URL parsing utilities
function isArtistPage(url) {
    try {
        const urlObj = new URL(url);
        const pathParts = urlObj.pathname.split('/').filter(Boolean);
        return pathParts.length === 1 && !['trending', 'explore', 'feed', 'notifications'].includes(pathParts[0]);
    } catch {
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
    } catch {
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
    } catch {
        return null;
    }
}

function extractContentId(url) {
    try {
        const urlObj = new URL(url);
        const pathParts = urlObj.pathname.split('/').filter(Boolean);

        // Validate URL structure
        if (pathParts.length < 2 || pathParts.length > 3) {
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
    } catch {
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
    } catch {
        return null;
    }
}

// State management
const state = {
    activeTabs: [],
    selectedArtists: [],
    downloadStatus: {}
};

// Utility: exponential backoff retry
async function withRetry(operation, maxRetries = 3, baseDelay = 1000) {
    let lastError = null;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await operation();
        } catch (error) {
            lastError = error;
            if (attempt < maxRetries) {
                const delay = baseDelay * Math.pow(2, attempt - 1);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }
    throw lastError;
}

// Service worker initialization
const SW_VERSION = '1.0.2'; // Increment this to force update

// Icon state management
async function updateIconState(tabId, url) {
    try {
        const isAudiusUrl = url?.includes('audius.co');

        // Update icon with absolute paths
        await chrome.action.setIcon({
            tabId: tabId,
            path: {
                "16": isAudiusUrl ? "/icons/icon16.png" : "/icons/disabled/icon16.png",
                "48": isAudiusUrl ? "/icons/icon48.png" : "/icons/disabled/icon48.png",
                "128": isAudiusUrl ? "/icons/icon128.png" : "/icons/disabled/icon128.png"
            }
        });

        // Update tooltip
        await chrome.action.setTitle({
            tabId: tabId,
            title: isAudiusUrl ? "Snag (for Audius)" : "Snag (for Audius) - Not available on this page"
        });

        // Enable/disable popup
        await chrome.action.setPopup({
            tabId: tabId,
            popup: isAudiusUrl ? "popup.html" : ""
        });
    } catch (error) {
        // Log once with context
        console.error('Icon state error:', {
            tabId,
            error: error.message
        });
        // Try to recover by setting a default state
        try {
            await chrome.action.setIcon({
                tabId: tabId,
                path: {
                    "16": "/icons/disabled/icon16.png",
                    "48": "/icons/disabled/icon48.png",
                    "128": "/icons/disabled/icon128.png"
                }
            });
            await chrome.action.setTitle({
                tabId: tabId,
                title: "Snag (for Audius) - Error"
            });
            await chrome.action.setPopup({
                tabId: tabId,
                popup: ""
            });
        } catch (recoveryError) {
            console.error('Failed to recover icon state:', recoveryError);
        }
    }
}

// Initialize icon states for all open tabs
async function initializeIconStates() {
    try {
        const tabs = await chrome.tabs.query({});
        for (const tab of tabs) {
            if (tab.id) {
                await updateIconState(tab.id, tab.url);
            }
        }
    } catch (error) {
        console.error('Error initializing icon states:', error);
    }
}

// Update tab listeners to include icon state management
chrome.tabs.onUpdated.addListener(async function (tabId, changeInfo, tab) {
    // Update icon state
    await updateIconState(tabId, tab.url);

    if (changeInfo.status === 'complete' && tab.url?.includes('audius.co')) {
        if (isArtistPage(tab.url)) {
            await updateTabInfo(tabId, tab.url);
        } else if (isContentPage(tab.url)) {
            const contentId = extractContentId(tab.url);
            const contentType = getContentType(tab.url);
            if (contentId && contentType) {
                state.activeTabs.push({
                    tabId,
                    url: tab.url,
                    contentId,
                    contentType,
                    status: 'ready'
                });
            }
        }
    }
});

// Handle tab activation
chrome.tabs.onActivated.addListener(async (activeInfo) => {
    try {
        const tab = await chrome.tabs.get(activeInfo.tabId);
        await updateIconState(activeInfo.tabId, tab.url);
    } catch (error) {
        console.error('Error handling tab activation:', error);
    }
});

// Listen for tab removal
chrome.tabs.onRemoved.addListener(function (tabId) {
    state.activeTabs = state.activeTabs.filter(tab => tab.tabId !== tabId);
});

// Listen for messages
chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    console.log('Received message:', message);

    // Handle URL parsing request
    if (message.type === 'PARSE_URL') {
        chrome.tabs.get(message.tabId, (tab) => {
            if (chrome.runtime.lastError) {
                console.error('Error getting tab:', chrome.runtime.lastError);
                sendResponse({ success: false, error: 'Failed to get tab information' });
                return;
            }

            try {
                const url = tab.url;
                const urlInfo = {
                    isArtistPage: isArtistPage(url),
                    isContentPage: isContentPage(url),
                    artistHandle: extractArtistHandle(url),
                    contentId: extractContentId(url),
                    contentType: getContentType(url)
                };

                // Validate the URL info
                if (!urlInfo.isArtistPage && !urlInfo.isContentPage) {
                    sendResponse({ success: false, error: 'Nothing to snag here' });
                    return;
                }

                if (urlInfo.isContentPage && (!urlInfo.contentId || !urlInfo.contentType)) {
                    sendResponse({ success: false, error: 'Invalid content page URL' });
                    return;
                }

                if (urlInfo.isArtistPage && !urlInfo.artistHandle) {
                    sendResponse({ success: false, error: 'Invalid artist page URL' });
                    return;
                }

                console.log('URL info parsed successfully:', urlInfo);
                sendResponse({ success: true, data: urlInfo });
            } catch (error) {
                console.error('Error parsing URL:', error);
                sendResponse({ success: false, error: error.message || 'Failed to parse URL' });
            }
        });
        return true; // Keep the message channel open for async response
    }

    // Handle content script ready notification
    if (message.type === 'CONTENT_SCRIPT_READY') {
        console.log('Content script ready:', message.urlInfo);
        sendResponse({ success: true });
        return true;
    }

    // Handle download requests
    if (message.type === 'DOWNLOAD_ARTIST' || message.type === 'DOWNLOAD_CONTENT') {
        console.log('Starting download process:', message);

        // Start the download process
        const downloadPromise = message.type === 'DOWNLOAD_ARTIST'
            ? handleArtistDownload(message.artistId)
            : handleContentDownload(message.contentId, message.contentType, message.artistId);

        downloadPromise
            .then(async (zipBlob) => {
                // Convert blob to base64
                const reader = new FileReader();
                reader.onload = function () {
                    const base64data = reader.result.split(',')[1];

                    // Create a data URL from the base64 data
                    const dataUrl = `data:application/zip;base64,${base64data}`;

                    // Start download using chrome.downloads API
                    chrome.downloads.download({
                        url: dataUrl,
                        filename: formatDownloadFilename({
                            data: {
                                contentId: message.contentId,
                                artistId: message.artistId
                            }
                        }, {
                            isArtistPage: message.type === 'DOWNLOAD_ARTIST',
                            isContentPage: message.type === 'DOWNLOAD_CONTENT',
                            contentType: message.contentType,
                            artistHandle: message.artistId
                        }),
                        saveAs: false
                    }, (downloadId) => {
                        if (chrome.runtime.lastError) {
                            console.error('Download error:', chrome.runtime.lastError);
                            sendResponse({
                                success: false,
                                error: 'Failed to start download'
                            });
                        } else {
                            console.log('Download started with ID:', downloadId);
                            sendResponse({
                                success: true
                            });
                        }
                    });
                };
                reader.onerror = function (error) {
                    console.error('Error converting blob to base64:', error);
                    sendResponse({
                        success: false,
                        error: 'Failed to process download data'
                    });
                };
                reader.readAsDataURL(zipBlob);
            })
            .catch(error => {
                console.error('Download error:', error);
                sendResponse({
                    success: false,
                    error: error.message || 'Download failed'
                });
            });

        return true; // Keep the message channel open for async response
    }

    // Handle other message types
    console.warn('Unknown message type:', message.type);
    sendResponse({ success: false, error: 'Unknown message type' });
    return true;
});

async function updateTabInfo(tabId, url) {
    const artistHandle = extractArtistHandle(url);
    if (!artistHandle) return;

    const tabInfo = {
        tabId,
        url,
        artistId: artistHandle,
        status: 'loading'
    };

    const existingIndex = state.activeTabs.findIndex(tab => tab.tabId === tabId);
    if (existingIndex >= 0) {
        state.activeTabs[existingIndex] = tabInfo;
    } else {
        state.activeTabs.push(tabInfo);
    }
}

async function handleArtistDownload(artistId) {
    try {
        const artistData = await audiusApi.getFullArtistData(artistId);
        const zipBlob = await createArtistArchive(artistData);
        return zipBlob;
    } catch (error) {
        console.error('Error processing artist data:', error);
        throw error;
    }
}

// Utility: fetch with timeout
async function fetchWithTimeout(resource, options = {}) {
    const { timeout = 10000 } = options;
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    try {
        const response = await fetch(resource, {
            ...options,
            signal: controller.signal,
            headers: {
                'Accept': 'image/*, application/json',
                'User-Agent': 'Chrome Extension - Snag (for Audius)'
            }
        });
        clearTimeout(id);
        return response;
    } catch (error) {
        clearTimeout(id);
        throw error;
    }
}

// Utility function for notifications
function showNotification(message) {
    chrome.notifications.create({
        type: 'basic',
        iconUrl: '/icons/icon128.png',
        title: 'Snag (for Audius)',
        message: message
    });
}

// Robust image download with retries and fallbacks
async function downloadImageWithFallback(url, maxRetries = 3) {
    if (!url || typeof url !== 'string' || !url.startsWith('http')) {
        console.error('Invalid URL provided for image download:', url);
        return null;
    }

    console.log(`Attempting to download image from: ${url}`);

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const contentType = response.headers.get('content-type');
            if (!contentType || !contentType.includes('image/')) {
                throw new Error(`Invalid content type: ${contentType}`);
            }

            const blob = await response.blob();
            if (blob.size === 0) {
                throw new Error('Downloaded image is empty');
            }

            console.log(`Successfully downloaded image (${(blob.size / 1024).toFixed(1)} KB)`);
            return blob;
        } catch (error) {
            console.error(`Download attempt ${attempt} failed:`, error);
            if (attempt === maxRetries) {
                return null;
            }
            await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt - 1)));
        }
    }
    return null;
}

// Update sanitizeFilename function
function sanitizeFilename(filename) {
    // Split by periods to handle file extension
    const parts = filename.split('.');
    if (parts.length > 1) {
        // Get the extension (last part)
        const extension = parts.pop();
        // Replace all periods in the remaining parts with underscores
        const name = parts.join('.').replace(/\./g, '_');
        return `${name}.${extension}`;
    }
    // If no extension, just replace all periods with underscores
    return filename.replace(/\./g, '_');
}

async function createArtistArchive(artistData) {
    if (!artistData) {
        throw new Error('Invalid artist data structure');
    }

    const profile = artistData.profile;
    if (!profile) {
        throw new Error('Missing artist profile data');
    }

    const zip = new JSZip();
    let imagesDownloaded = false;

    try {
        console.log('Creating archive for:', profile.handle);

        // Add markdown
        const markdown = generateMarkdown(artistData);
        zip.file(`${sanitizeFilename(profile.handle)}_details.md`, markdown);
        console.log(`Added markdown (${(markdown.length / 1024).toFixed(1)} KB)`);

        // Add HTML
        const html = generateArtistHTML(artistData);
        console.log('Generated HTML for artist:', html?.length || 0);
        if (html) {
            zip.file(`${sanitizeFilename(profile.handle)}_details.html`, html);
            console.log('Added HTML file to zip');
        } else {
            console.error('Failed to generate HTML for artist');
        }

        // Download and add images
        const imagePromises = [];

        // Handle profile picture
        if (profile.profile_picture) {
            console.log('Profile picture data:', profile.profile_picture);
            const profileUrl = getHighestQualityUrl(profile.profile_picture);
            console.log('Selected profile picture URL:', profileUrl);

            if (profileUrl) {
                imagePromises.push(
                    downloadImageWithFallback(profileUrl)
                        .then(async (blob) => {
                            if (blob) {
                                console.log(`Adding profile picture to ZIP (${(blob.size / 1024).toFixed(1)} KB)`);
                                await zip.file(`${sanitizeFilename(profile.handle)}_avatar.jpg`, blob, { binary: true });
                                imagesDownloaded = true;
                            } else {
                                console.error('Failed to download profile picture');
                            }
                        })
                        .catch(error => {
                            console.error('Error processing profile picture:', error);
                        })
                );
            }
        }

        // Handle cover photo
        if (profile.cover_photo) {
            console.log('Cover photo data:', profile.cover_photo);
            const coverUrl = getHighestQualityUrl(profile.cover_photo);
            console.log('Selected cover photo URL:', coverUrl);

            if (coverUrl) {
                imagePromises.push(
                    downloadImageWithFallback(coverUrl)
                        .then(async (blob) => {
                            if (blob) {
                                console.log(`Adding cover photo to ZIP (${(blob.size / 1024).toFixed(1)} KB)`);
                                await zip.file(`${sanitizeFilename(profile.handle)}_cover.jpg`, blob, { binary: true });
                                imagesDownloaded = true;
                            } else {
                                console.error('Failed to download cover photo');
                            }
                        })
                        .catch(error => {
                            console.error('Error processing cover photo:', error);
                        })
                );
            }
        }

        // Wait for all image downloads to complete
        console.log('Waiting for image downloads to complete...');
        await Promise.all(imagePromises);
        console.log('Image downloads completed. Images downloaded:', imagesDownloaded);

        // Generate ZIP with specific options
        console.log('Generating ZIP file...');
        const zipBlob = await zip.generateAsync({
            type: 'blob',
            compression: 'DEFLATE',
            compressionOptions: { level: 6 }
        });
        console.log(`ZIP file generated (${(zipBlob.size / 1024).toFixed(1)} KB)`);

        if (zipBlob.size === 0) {
            throw new Error('Generated ZIP file is empty');
        }

        return zipBlob;
    } catch (error) {
        console.error('Error creating archive:', error);
        error.imagesDownloaded = imagesDownloaded;
        throw error;
    }
}

function formatDate(dateString) {
    if (!dateString) return 'N/A';
    try {
        const date = new Date(dateString);
        if (isNaN(date.getTime())) return 'N/A';

        // Format the date in a more readable way
        const options = {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: 'numeric',
            minute: 'numeric',
            timeZoneName: 'short'
        };

        return date.toLocaleString('en-US', options);
    } catch (e) {
        console.error('Error formatting date:', e);
        return 'N/A';
    }
}

function generateMarkdown(artistData) {
    const profile = artistData.profile;
    if (!profile) {
        throw new Error('Missing artist profile data');
    }

    let md = [];

    // Header with verification status
    const verifiedBadge = profile.is_verified ? ' ✓' : '';
    const artistUrl = `https://audius.co/${profile.handle}`;
    md.push(`# [${profile.name || profile.handle}](${artistUrl})${verifiedBadge}`);
    md.push(`**@${profile.handle}**`);
    md.push(`User ID: \`${profile.id}\`\n`);

    // Basic Info
    if (profile.bio) {
        md.push('## Bio');
        md.push(profile.bio + '\n');
    }

    if (profile.location) {
        md.push('## Location');
        md.push(profile.location + '\n');
    }

    // Stats
    md.push('## Stats');
    md.push(`- Followers: ${profile.follower_count?.toLocaleString() || '0'}`);
    md.push(`- Following: ${profile.followee_count?.toLocaleString() || '0'}`);
    md.push(`- Tracks: ${profile.track_count?.toLocaleString() || '0'}`);
    md.push(`- Playlists: ${profile.playlist_count?.toLocaleString() || '0'}`);
    md.push(`- Albums: ${profile.album_count?.toLocaleString() || '0'}`);
    md.push(`- Reposts: ${profile.repost_count?.toLocaleString() || '0'}`);
    md.push(`- Supporters: ${profile.supporter_count?.toLocaleString() || '0'}`);
    md.push(`- Supporting: ${profile.supporting_count?.toLocaleString() || '0'}\n`);

    // Social Links
    const socialLinks = [];
    if (profile.twitter_handle) socialLinks.push(`- Twitter: [@${profile.twitter_handle}](https://twitter.com/${profile.twitter_handle})`);
    if (profile.instagram_handle) socialLinks.push(`- Instagram: [@${profile.instagram_handle}](https://instagram.com/${profile.instagram_handle})`);
    if (profile.tiktok_handle) socialLinks.push(`- TikTok: [@${profile.tiktok_handle}](https://tiktok.com/@${profile.tiktok_handle})`);
    if (profile.website) socialLinks.push(`- Website: [${profile.website}](${profile.website})`);
    if (profile.donation) socialLinks.push(`- Donation: [${profile.donation}](${profile.donation})`);

    if (socialLinks.length > 0) {
        md.push('## Social Links');
        md.push(socialLinks.join('\n') + '\n');
    }

    // Wallets
    md.push('## Wallets');
    if (profile.erc_wallet) md.push(`- ERC: \`${profile.erc_wallet}\``);
    if (profile.spl_wallet) md.push(`- SPL: \`${profile.spl_wallet}\``);
    if (profile.spl_usdc_payout_wallet) md.push(`- SPL USDC: \`${profile.spl_usdc_payout_wallet}\``);
    md.push('');

    // Account Status
    if (profile.created_at) {
        md.push(`Created: ${formatDate(profile.created_at)}`);
    }
    if (profile.is_deactivated) md.push('Status: Deactivated');
    if (!profile.is_available) md.push('Status: Unavailable');

    // Add footer
    md.push('');
    md.push('Generated with [Snag (for Audius)](https://github.com/julianbaker/snag-for-audius) — an extension that makes it easy to download images and metadata from Audius Music');

    return md.join('\n');
}

function generateArtistHTML(artistData) {
    const profile = artistData.profile;
    if (!profile) {
        throw new Error('Missing artist profile data');
    }

    const markdown = generateMarkdown(artistData);
    const title = `${profile.name || profile.handle} - Artist Profile`;

    // Convert markdown to HTML
    let html = markdown
        .split('\n')
        .map(line => {
            // Skip empty lines
            if (!line.trim()) return '';

            // Handle headings with links (only if they start at the beginning of the line)
            if (line.trim().startsWith('# ')) {
                let content = line.trim().substring(2).trim();
                // Process links in headings
                content = content.replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank">$1</a>');
                return `<h1>${content}</h1>`;
            }
            if (line.trim().startsWith('## ')) {
                let content = line.trim().substring(3).trim();
                // Process links in headings
                content = content.replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank">$1</a>');
                return `<h2>${content}</h2>`;
            }
            if (line.trim().startsWith('### ')) {
                let content = line.trim().substring(4).trim();
                // Process links in headings
                content = content.replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank">$1</a>');
                return `<h3>${content}</h3>`;
            }
            // Handle dividers (horizontal rules)
            if (line.trim() === '---' || line.trim() === '***' || line.trim() === '___') {
                return '<hr>';
            }
            // Handle bullet points
            if (line.startsWith('- ')) {
                let content = line.substring(2);
                // Process links and bold text within the list item
                content = content.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
                content = content.replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank">$1</a>');
                return `<li class="bullet">${content}</li>`;
            }
            // Handle regular text (process links and bold text)
            line = line.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
            line = line.replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank">$1</a>');
            return `<p>${line}</p>`;
        })
        .filter(line => line !== '') // Remove empty lines
        .join('\n')
        // Handle lists with proper spacing
        .replace(/(<li class="bullet">.*?<\/li>\n?)+/g, '<ul class="bullet-list">$&</ul>')
        // Add spacing between sections
        .replace(/<\/h1>/g, '</h1>\n')
        .replace(/<\/h2>/g, '</h2>\n')
        .replace(/<\/h3>/g, '</h3>\n')
        .replace(/<\/ul>/g, '</ul>\n')
        .replace(/<\/p>/g, '</p>\n');

    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <style>
        body { 
            font-family: system-ui, sans-serif; 
            max-width: 800px; 
            margin: 0 auto; 
            padding: 20px;
            line-height: 1.6;
            color: #333;
        }
        img { max-width: 100%; height: auto; }
        ul, ol { 
            padding-left: 20px;
            margin: 1em 0;
        }
        .bullet-list {
            list-style-type: disc;
        }
        li {
            margin: 0.5em 0;
            font-size: 1rem;
        }
        p {
            margin: 1em 0;
            font-size: 1rem;
        }
        a { 
            color: #7E1BCC;
            text-decoration: none;
        }
        a:hover {
            text-decoration: underline;
        }
        h1, h2, h3 {
            margin: 1em 0 0.5em 0;
            color: #000;
        }
        h1 { font-size: 2em; }
        h2 { font-size: 1.5em; }
        h3 { font-size: 1.2em; }
        h1 a, h2 a, h3 a {
            color: #7E1BCC;
            text-decoration: none;
        }
        h1 a:hover, h2 a:hover, h3 a:hover {
            text-decoration: underline;
        }
        hr {
            border: none;
            border-top: 1px solid #e0e0e0;
            margin: 2em 0;
        }
    </style>
</head>
<body>
    ${html}
</body>
</html>`;
}

// Helper to get highest quality image URL
function getHighestQualityUrl(imageObj) {
    console.log('Getting highest quality URL from:', JSON.stringify(imageObj, null, 2));

    if (!imageObj) {
        console.log('No image object provided');
        return null;
    }

    // If it's a direct URL string
    if (typeof imageObj === 'string') {
        console.log('Direct URL found:', imageObj);
        return imageObj;
    }

    // Define size priorities from largest to smallest
    const sizePriorities = [
        '2000x',      // Cover photo max
        '1000x1000',  // Profile picture max
        '640x',       // Cover photo medium
        '480x480',    // Profile picture medium
        '150x150'     // Profile picture small
    ];

    // Check all sizes in order of priority
    for (const size of sizePriorities) {
        if (imageObj[size]) {
            const url = imageObj[size];
            if (url && typeof url === 'string') {
                console.log(`Using ${size} image:`, url);
                return url;
            }
        }
    }

    console.warn('No valid image URL found in object');
    return null;
}

// Simple notification handler for errors
chrome.notifications.onButtonClicked.addListener((notificationId) => {
    // Clear the notification when clicked
    chrome.notifications.clear(notificationId);
});

async function createContentArchive(contentData) {
    if (!contentData || !contentData.profile) {
        throw new Error('Invalid content data structure');
    }

    const zip = new JSZip();
    let imagesDownloaded = false;

    try {
        console.log('Creating content archive for:', contentData.profile.handle);

        // Add markdown
        const markdown = generateContentMarkdown(contentData);
        const contentName = contentData.tracks.length === 1 ?
            contentData.tracks[0].title :
            contentData.playlists[0].playlist_name;
        zip.file(`${sanitizeFilename(contentName)}_details.md`, markdown);
        console.log(`Added markdown (${(markdown.length / 1024).toFixed(1)} KB)`);

        // Add HTML
        const html = generateContentHTML(contentData);
        if (html) {
            zip.file(`${sanitizeFilename(contentName)}_details.html`, html);
            console.log('Added HTML file to zip');
        }

        // Download and add artwork
        const imagePromises = [];
        if (contentData.tracks.length === 1) {
            // Single track
            const track = contentData.tracks[0];
            if (track.artwork) {
                console.log('Track artwork data:', track.artwork);
                const artworkUrl = getHighestQualityUrl(track.artwork);
                console.log('Selected artwork URL:', artworkUrl);

                if (artworkUrl) {
                    imagePromises.push(
                        downloadImageWithFallback(artworkUrl)
                            .then(async (blob) => {
                                if (blob) {
                                    console.log(`Adding artwork to ZIP (${(blob.size / 1024).toFixed(1)} KB)`);
                                    await zip.file(`${sanitizeFilename(track.title)}_artwork.jpg`, blob, { binary: true });
                                    imagesDownloaded = true;
                                } else {
                                    console.error('Failed to download artwork');
                                }
                            })
                            .catch(error => {
                                console.error('Error processing artwork:', error);
                            })
                    );
                }
            }
        } else {
            // Playlist/Album
            const playlist = contentData.playlists[0];
            if (playlist.artwork) {
                console.log('Playlist artwork data:', playlist.artwork);
                const artworkUrl = getHighestQualityUrl(playlist.artwork);
                console.log('Selected artwork URL:', artworkUrl);

                if (artworkUrl) {
                    imagePromises.push(
                        downloadImageWithFallback(artworkUrl)
                            .then(async (blob) => {
                                if (blob) {
                                    console.log(`Adding artwork to ZIP (${(blob.size / 1024).toFixed(1)} KB)`);
                                    await zip.file(`${sanitizeFilename(playlist.playlist_name)}_artwork.jpg`, blob, { binary: true });
                                    imagesDownloaded = true;
                                } else {
                                    console.error('Failed to download artwork');
                                }
                            })
                            .catch(error => {
                                console.error('Error processing artwork:', error);
                            })
                    );
                }
            }
        }

        // Wait for all image downloads to complete
        console.log('Waiting for image downloads to complete...');
        await Promise.all(imagePromises);
        console.log('Image downloads completed. Images downloaded:', imagesDownloaded);

        // Generate ZIP with specific options
        console.log('Generating ZIP file...');
        const zipBlob = await zip.generateAsync({
            type: 'blob',
            compression: 'DEFLATE',
            compressionOptions: { level: 6 }
        });
        console.log(`ZIP file generated (${(zipBlob.size / 1024).toFixed(1)} KB)`);

        if (zipBlob.size === 0) {
            throw new Error('Generated ZIP file is empty');
        }

        return zipBlob;
    } catch (error) {
        console.error('Error creating content archive:', error);
        error.imagesDownloaded = imagesDownloaded;
        throw error;
    }
}

function generateContentMarkdown(contentData) {
    const profile = contentData.profile;
    if (!profile) {
        throw new Error('Missing profile data');
    }

    let md = [];

    if (contentData.tracks.length === 1) {
        // Single track
        const track = contentData.tracks[0];
        const trackUrl = `https://audius.co${track.permalink || ''}`;
        const artistUrl = `https://audius.co/${profile.handle}`;
        md.push(`# [${track.title || 'Untitled Track'}](${trackUrl})`);
        md.push(`**By [${profile.name || profile.handle}](${artistUrl})**\n`);

        // Track Info
        md.push('## Track Information');
        md.push(`- Genre: ${track.genre || 'N/A'}`);
        md.push(`- Mood: ${track.mood || 'N/A'}`);
        md.push(`- Release Date: ${formatDate(track.release_date)}`);
        md.push(`- Duration: ${formatDuration(track.duration || 0)}\n`);

        // Description
        if (track.description) {
            md.push('## Description');
            // Split description by newlines and preserve them
            const descriptionLines = track.description.split('\n');
            descriptionLines.forEach(line => {
                if (line.trim()) {
                    md.push(line);
                }
            });
            md.push(''); // Add extra newline after description
        }

        // Stats
        md.push('## Stats');
        md.push(`- Plays: ${track.play_count?.toLocaleString() || '0'}`);
        md.push(`- Reposts: ${track.repost_count?.toLocaleString() || '0'}`);
        md.push(`- Favorites: ${track.favorite_count?.toLocaleString() || '0'}\n`);
    } else if (contentData.playlists.length === 1) {
        // Playlist/Album
        const playlist = contentData.playlists[0];
        const playlistUrl = `https://audius.co${playlist.permalink || ''}`;
        const artistUrl = `https://audius.co/${profile.handle}`;
        md.push(`# [${playlist.playlist_name || 'Untitled Playlist'}](${playlistUrl})`);
        md.push(`**By [${profile.name || profile.handle}](${artistUrl})**\n`);
        md.push(`@${profile.handle}\n`);

        // Description
        if (playlist.description) {
            md.push('## Description');
            // Split description by newlines and preserve them
            const descriptionLines = playlist.description.split('\n');
            descriptionLines.forEach(line => {
                if (line.trim()) {
                    md.push(line);
                }
            });
            md.push(''); // Add extra newline after description
        }

        // Stats
        md.push('## Stats');
        md.push(`- Reposts: ${playlist.repost_count?.toLocaleString() || '0'}`);
        md.push(`- Favorites: ${playlist.favorite_count?.toLocaleString() || '0'}\n`);

        // Track List
        if (contentData.tracks.length > 0) {
            md.push(`\n## Track List (${playlist.track_count?.toLocaleString() || '0'})`);
            contentData.tracks.forEach((track, index) => {
                const trackUrl = `https://audius.co${track.permalink || ''}`;
                const artistUrl = `https://audius.co/${track.user.handle}`;
                md.push(`${index + 1}. [${track.title}](${trackUrl}) by [${track.user.name || track.user.handle}](${artistUrl}) (${formatDuration(track.duration || 0)}) • ${track.play_count?.toLocaleString() || '0'} plays`);
            });
        }
    }

    // Add footer
    md.push('');
    md.push('Generated with [Snag (for Audius)](https://github.com/julianbaker/snag-for-audius) — an extension that makes it easy to download images and metadata from Audius Music');

    return md.join('\n');
}

function generateContentHTML(contentData) {
    const markdown = generateContentMarkdown(contentData);
    const profile = contentData.profile;
    const title = contentData.tracks.length === 1 ?
        `${contentData.tracks[0].title} - ${profile.name || profile.handle}` :
        `${contentData.playlists[0].playlist_name} - ${profile.name || profile.handle}`;

    // Convert markdown to HTML
    let html = markdown
        .split('\n')
        .map(line => {
            // Skip empty lines
            if (!line.trim()) return '';

            // Handle headings with links (only if they start at the beginning of the line)
            if (line.trim().startsWith('# ')) {
                let content = line.trim().substring(2).trim();
                // Process links in headings
                content = content.replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank">$1</a>');
                return `<h1>${content}</h1>`;
            }
            if (line.trim().startsWith('## ')) {
                let content = line.trim().substring(3).trim();
                // Process links in headings
                content = content.replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank">$1</a>');
                return `<h2>${content}</h2>`;
            }
            if (line.trim().startsWith('### ')) {
                let content = line.trim().substring(4).trim();
                // Process links in headings
                content = content.replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank">$1</a>');
                return `<h3>${content}</h3>`;
            }
            // Handle dividers (horizontal rules)
            if (line.trim() === '---' || line.trim() === '***' || line.trim() === '___') {
                return '<hr>';
            }
            // Handle numbered list items (track list)
            if (/^\d+\.\s/.test(line)) {
                let content = line.replace(/^\d+\.\s/, '');
                // Process links and bold text within the list item
                content = content.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
                content = content.replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank">$1</a>');
                return `<li class="track">${content}</li>`;
            }
            // Handle bullet points
            if (line.startsWith('- ')) {
                let content = line.substring(2);
                // Process links and bold text within the list item
                content = content.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
                content = content.replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank">$1</a>');
                return `<li class="bullet">${content}</li>`;
            }
            // Handle regular text (process links and bold text)
            line = line.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
            line = line.replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank">$1</a>');
            return `<p>${line}</p>`;
        })
        .filter(line => line !== '') // Remove empty lines
        .join('\n')
        // Handle lists with proper spacing
        .replace(/(<li class="track">.*?<\/li>\n?)+/g, '<ol class="track-list">$&</ol>')
        .replace(/(<li class="bullet">.*?<\/li>\n?)+/g, '<ul class="bullet-list">$&</ul>')
        // Add spacing between sections
        .replace(/<\/h1>/g, '</h1>\n')
        .replace(/<\/h2>/g, '</h2>\n')
        .replace(/<\/h3>/g, '</h3>\n')
        .replace(/<\/ol>/g, '</ol>\n')
        .replace(/<\/ul>/g, '</ul>\n')
        .replace(/<\/p>/g, '</p>\n');

    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <style>
        body { 
            font-family: system-ui, sans-serif; 
            max-width: 800px; 
            margin: 0 auto; 
            padding: 20px;
            line-height: 1.6;
            color: #333;
        }
        img { max-width: 100%; height: auto; }
        ul, ol { 
            padding-left: 20px;
            margin: 1em 0;
        }
        .track-list {
            list-style-type: decimal;
        }
        .bullet-list {
            list-style-type: disc;
        }
        li {
            margin: 0.5em 0;
            font-size: 1rem;
        }
        p {
            margin: 1em 0;
            font-size: 1rem;
        }
        a { 
            color: #7E1BCC;
            text-decoration: none;
        }
        a:hover {
            text-decoration: underline;
        }
        h1, h2, h3 {
            margin: 1em 0 0.5em 0;
            color: #000;
        }
        h1 { font-size: 2em; }
        h2 { font-size: 1.5em; }
        h3 { font-size: 1.2em; }
        h1 a, h2 a, h3 a {
            color: #7E1BCC;
            text-decoration: none;
        }
        h1 a:hover, h2 a:hover, h3 a:hover {
            text-decoration: underline;
        }
        hr {
            border: none;
            border-top: 1px solid #e0e0e0;
            margin: 2em 0;
        }
    </style>
</head>
<body>
    ${html}
</body>
</html>`;
}

function formatDuration(seconds) {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

async function handleContentDownload(contentId, contentType, artistId) {
    try {
        console.log('Starting handleContentDownload:', { contentId, contentType, artistId });

        if (!contentId) {
            console.error('Missing contentId');
            throw new Error(`Invalid content ID for ${contentType}`);
        }

        let contentData;
        if (contentType === 'track') {
            console.log('Processing track download');
            // If contentId is already a track ID, use it directly
            if (contentId.match(/^[A-Za-z0-9]+$/)) {
                const trackData = await audiusApi.fetchApi(`/v1/tracks/${contentId}`);
                contentData = {
                    profile: trackData.user,
                    tracks: [trackData],
                    playlists: []
                };
            } else {
                // Otherwise, it's a permalink that needs to be resolved
                const permalink = `${artistId}/${contentId}`;
                const trackData = await audiusApi.getTrackData(permalink);
                contentData = {
                    profile: trackData.user,
                    tracks: [trackData],
                    playlists: []
                };
            }
        } else if (contentType === 'playlist' || contentType === 'album') {
            console.log('Processing playlist/album download');
            const playlistData = await audiusApi.getPlaylistData(contentId);
            console.log('Received playlist data:', playlistData);

            if (!playlistData || !playlistData.data || !Array.isArray(playlistData.data)) {
                throw new Error('Invalid playlist data structure');
            }

            const playlist = playlistData.data[0];
            if (!playlist) {
                throw new Error('No playlist data found');
            }

            const tracksResponse = await audiusApi.getPlaylistTracks(playlist.id);
            console.log('Got tracks response:', tracksResponse);

            contentData = {
                profile: playlist.user,
                tracks: tracksResponse.tracks || [],
                playlists: [playlist]
            };
        } else {
            console.error('Invalid content type:', contentType);
            throw new Error(`Invalid content type: ${contentType}`);
        }

        // Ensure we have the data in the correct format
        if (!contentData || !contentData.profile) {
            console.error('Invalid content data structure:', contentData);
            throw new Error('Invalid content data structure');
        }

        console.log('Creating content archive with data:', contentData);
        return await createContentArchive(contentData);
    } catch (error) {
        console.error('Content download error:', error);
        throw error;
    }
}

// Update formatDownloadFilename function
function formatDownloadFilename(contentData, urlInfo) {
    // Extract the last part of the path for content name
    const getNameFromPath = (path) => {
        if (!path) return 'unknown';
        const parts = path.split('/');
        return sanitizeFilename(parts[parts.length - 1]);
    };

    let filename;
    if (urlInfo.isArtistPage) {
        filename = `${urlInfo.artistHandle} - profile assets [snagged from audius].zip`;
    } else {
        const contentName = getNameFromPath(contentData.data.contentId);
        switch (urlInfo.contentType) {
            case 'track':
                filename = `${contentName} - track assets [snagged from audius].zip`;
                break;
            case 'playlist':
                filename = `${contentName} - playlist assets [snagged from audius].zip`;
                break;
            case 'album':
                filename = `${contentName} - album assets [snagged from audius].zip`;
                break;
            default:
                filename = `${contentName} - assets [snagged from audius].zip`;
        }
    }

    // Sanitize the entire filename
    return sanitizeFilename(filename);
}

// Initialize icon states when extension starts
chrome.runtime.onStartup.addListener(initializeIconStates);
chrome.runtime.onInstalled.addListener(initializeIconStates); 