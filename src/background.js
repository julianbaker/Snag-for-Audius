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
    console.log('Service Worker installing...');
    event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', function (event) {
    console.log('Service Worker activating...');
    event.waitUntil(self.clients.claim());
});

// Add a message to indicate the service worker is ready
console.log('Service Worker initialized and ready');

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
    } catch (error) {
        console.error('URL parsing error:', error);
        return null;
    }
}

function extractContentId(url) {
    try {
        const urlObj = new URL(url);
        const pathParts = urlObj.pathname.split('/').filter(Boolean);
        console.log('Extracting content ID from path parts:', pathParts);

        // Validate URL structure
        if (pathParts.length < 2 || pathParts.length > 3) {
            console.log('Invalid URL structure - expected 2 or 3 path parts');
            return null;
        }

        // Validate artist handle (first part)
        const artistHandle = pathParts[0];
        if (!artistHandle || artistHandle.length < 1) {
            console.log('Invalid artist handle');
            return null;
        }

        // Handle track URLs (artist/track-name)
        if (pathParts.length === 2) {
            const trackName = pathParts[1];
            if (!trackName || trackName.length < 1) {
                console.log('Invalid track name');
                return null;
            }

            // For tracks, we need to use the full permalink as the ID
            // since the API requires the artist/track-name format
            console.log('Found track URL pattern, returning permalink:', `${artistHandle}/${trackName}`);
            return `${artistHandle}/${trackName}`;
        }

        // Handle album/playlist URLs (artist/album/album-id or artist/playlist/playlist-id)
        if (pathParts.length === 3) {
            const [artist, type, slug] = pathParts;

            // Validate content type
            if (type !== 'album' && type !== 'playlist') {
                console.log('Invalid content type:', type);
                return null;
            }

            // Validate slug
            if (!slug || slug.length < 1) {
                console.log('Invalid slug');
                return null;
            }

            console.log('Found album/playlist URL pattern:', { artist, type, slug });

            // For albums/playlists, we need to use the full permalink format
            // This matches how the API expects to receive playlist/album IDs
            const permalink = `${artist}/${type}/${slug}`;
            console.log('Using full permalink as ID:', permalink);
            return permalink;
        }

        console.log('No matching URL pattern found');
        return null;
    } catch (error) {
        console.error('Error extracting content ID:', error);
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
        console.error('Error determining content type:', error);
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

// Listen for tab updates
chrome.tabs.onUpdated.addListener(async function (tabId, changeInfo, tab) {
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
                    sendResponse({ success: false, error: 'Not a valid Audius page' });
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
                    sendResponse({
                        success: true,
                        data: {
                            base64: base64data,
                            type: 'application/zip',
                            contentId: message.contentId,
                            artistId: message.artistId
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

        // Return true to indicate we'll send a response asynchronously
        return true;
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
        zip.file(`${profile.handle} Details.md`, markdown);
        console.log(`Added markdown (${(markdown.length / 1024).toFixed(1)} KB)`);

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
                                await zip.file(`${profile.handle}_avatar.jpg`, blob, { binary: true });
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
                                await zip.file(`${profile.handle}_cover.jpg`, blob, { binary: true });
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

function generateMarkdown(artistData) {
    const profile = artistData.profile;
    if (!profile) {
        throw new Error('Missing artist profile data');
    }

    let md = [];

    // Header with verification status
    const verifiedBadge = profile.is_verified ? ' ✓' : '';
    md.push(`# ${profile.name || profile.handle}${verifiedBadge}`);
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
        try {
            const date = new Date(profile.created_at);
            if (!isNaN(date.getTime())) {
                md.push(`Created: ${date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`);
            }
        } catch (e) {
            console.error('Error parsing date:', e);
        }
    }
    if (profile.is_deactivated) md.push('Status: Deactivated');
    if (!profile.is_available) md.push('Status: Unavailable');

    return md.join('\n');
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
        zip.file(`${contentName} Details.md`, markdown);
        console.log(`Added markdown (${(markdown.length / 1024).toFixed(1)} KB)`);

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
                                    await zip.file(`${track.title}_artwork.jpg`, blob, { binary: true });
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
        } else if (contentData.playlists.length === 1) {
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
                                    await zip.file(`${playlist.playlist_name}_artwork.jpg`, blob, { binary: true });
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
        md.push(`# ${track.title || 'Untitled Track'}`);
        md.push(`**By ${profile.name || profile.handle}**\n`);

        // Track Info
        md.push('## Track Information');
        md.push(`- Artist: ${profile.name || profile.handle} (@${profile.handle})`);
        md.push(`- Genre: ${track.genre || 'N/A'}`);
        md.push(`- Mood: ${track.mood || 'N/A'}`);
        md.push(`- Release Date: ${track.release_date || 'N/A'}`);
        md.push(`- Duration: ${formatDuration(track.duration || 0)}\n`);

        // Stats
        md.push('## Stats');
        md.push(`- Plays: ${track.play_count?.toLocaleString() || '0'}`);
        md.push(`- Reposts: ${track.repost_count?.toLocaleString() || '0'}`);
        md.push(`- Favorites: ${track.favorite_count?.toLocaleString() || '0'}\n`);

        // Links
        md.push('## Links');
        md.push(`- [Audius Link](https://audius.co${track.permalink || ''})`);
    } else if (contentData.playlists.length === 1) {
        // Playlist/Album
        const playlist = contentData.playlists[0];
        md.push(`# ${playlist.playlist_name || 'Untitled Playlist'}`);
        md.push(`**By ${profile.name || profile.handle}**\n`);

        // Playlist Info
        md.push('## Playlist Information');
        md.push(`- Type: ${playlist.is_album ? 'Album' : 'Playlist'}`);
        md.push(`- Artist: ${profile.name || profile.handle} (@${profile.handle})`);
        md.push(`- Track Count: ${playlist.track_count?.toLocaleString() || '0'}`);
        md.push(`- Description: ${playlist.description || 'No description available'}\n`);

        // Stats
        md.push('## Stats');
        md.push(`- Plays: ${playlist.total_play_count?.toLocaleString() || '0'}`);
        md.push(`- Reposts: ${playlist.repost_count?.toLocaleString() || '0'}`);
        md.push(`- Favorites: ${playlist.favorite_count?.toLocaleString() || '0'}\n`);

        // Links
        md.push('## Links');
        md.push(`- [Audius Link](https://audius.co${playlist.permalink || ''})`);

        // Track List
        if (contentData.tracks.length > 0) {
            md.push('\n## Track List');
            contentData.tracks.forEach((track, index) => {
                md.push(`${index + 1}. ${track.title} (${formatDuration(track.duration || 0)})`);
            });
        }
    }

    return md.join('\n');
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