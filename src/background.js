// background.js
importScripts('./lib/jszip.min.js');
importScripts('./services/urlParser.js');
importScripts('./services/audiusApi.js');

const audiusApi = new AudiusApiService();
const {
    isArtistPage,
    isContentPage,
    extractArtistHandle,
    extractContentId,
    getContentType,
    parseUrlInfo
} = self.AudiusUrlParser;

self.addEventListener('install', (event) => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// ---------- Icon state ----------

async function updateIconState(tabId, url) {
    const isAudiusUrl = !!url && url.includes('audius.co');
    const iconDir = isAudiusUrl ? '/icons' : '/icons/disabled';
    try {
        await chrome.action.setIcon({
            tabId,
            path: {
                '16': `${iconDir}/icon16.png`,
                '48': `${iconDir}/icon48.png`,
                '128': `${iconDir}/icon128.png`
            }
        });
        await chrome.action.setTitle({
            tabId,
            title: isAudiusUrl ? 'Snag (for Audius)' : 'Snag (for Audius) — Not available on this page'
        });
        await chrome.action.setPopup({ tabId, popup: isAudiusUrl ? 'popup.html' : '' });
    } catch (error) {
        console.error('Icon state error:', { tabId, error: error.message });
    }
}

async function initializeIconStates() {
    const tabs = await chrome.tabs.query({});
    await Promise.all(tabs.map((t) => t.id && updateIconState(t.id, t.url)));
}

chrome.tabs.onUpdated.addListener((tabId, _changeInfo, tab) => updateIconState(tabId, tab.url));
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
    try {
        const tab = await chrome.tabs.get(tabId);
        await updateIconState(tabId, tab.url);
    } catch (error) {
        console.error('Tab activation error:', error.message);
    }
});
chrome.runtime.onStartup.addListener(initializeIconStates);
chrome.runtime.onInstalled.addListener(initializeIconStates);

// ---------- Message routing ----------

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message.type !== 'string') {
        sendResponse({ success: false, error: 'Invalid message' });
        return false;
    }

    switch (message.type) {
        case 'PARSE_URL':
            handleParseUrl(message, sendResponse);
            return true;
        case 'CONTENT_SCRIPT_READY':
            sendResponse({ success: true });
            return false;
        case 'DOWNLOAD_ARTIST':
        case 'DOWNLOAD_CONTENT':
            handleDownloadMessage(message, sendResponse);
            return true;
        default:
            sendResponse({ success: false, error: `Unknown message type: ${message.type}` });
            return false;
    }
});

function handleParseUrl(message, sendResponse) {
    chrome.tabs.get(message.tabId, (tab) => {
        if (chrome.runtime.lastError) {
            sendResponse({ success: false, error: 'Failed to get tab information' });
            return;
        }
        const info = parseUrlInfo(tab.url);
        if (!info) {
            sendResponse({ success: false, error: 'Nothing to snag here' });
            return;
        }
        sendResponse({ success: true, data: info });
    });
}

function handleDownloadMessage(message, sendResponse) {
    const job = message.type === 'DOWNLOAD_ARTIST'
        ? handleArtistDownload(message.artistId)
        : handleContentDownload(message.contentId, message.contentType);

    job.then((zipBlob) => {
        const filename = formatDownloadFilename(message);
        const url = URL.createObjectURL(zipBlob);
        chrome.downloads.download({ url, filename, saveAs: false }, (downloadId) => {
            if (chrome.runtime.lastError) {
                URL.revokeObjectURL(url);
                sendResponse({ success: false, error: chrome.runtime.lastError.message });
                return;
            }
            const cleanup = (delta) => {
                if (delta.id !== downloadId) return;
                if (delta.state?.current === 'complete' || delta.state?.current === 'interrupted') {
                    URL.revokeObjectURL(url);
                    chrome.downloads.onChanged.removeListener(cleanup);
                }
            };
            chrome.downloads.onChanged.addListener(cleanup);
            sendResponse({ success: true });
        });
    }).catch((error) => {
        console.error('Download error:', error);
        sendResponse({ success: false, error: error.message || 'Download failed' });
    });
}

// ---------- Download orchestration ----------

async function handleArtistDownload(handle) {
    const artistData = await audiusApi.getFullArtistData(handle);
    return createArtistArchive(artistData);
}

async function handleContentDownload(contentId, contentType) {
    if (!contentId) throw new Error(`Invalid content ID for ${contentType}`);

    if (contentType === 'track') {
        const track = await audiusApi.getTrackByPermalink(contentId);
        return createContentArchive({ kind: 'track', track, profile: track.user });
    }
    if (contentType === 'playlist' || contentType === 'album') {
        const playlist = await audiusApi.getPlaylistByPermalink(contentId);
        const tracks = await audiusApi.getPlaylistTracks(playlist.id);
        return createContentArchive({ kind: contentType, playlist, tracks, profile: playlist.user });
    }
    throw new Error(`Invalid content type: ${contentType}`);
}

// ---------- Image download with mirror fallback ----------

// Audius image objects look like:
//   { "150x150": "https://host-a/..../150x150.jpg",
//     "480x480": "...", "1000x1000": "...",
//     "mirrors": ["https://host-b", "https://host-c", ...] }
// Falls back across the size variants AND across mirror hosts.
const SIZE_PRIORITIES = ['2000x', '1000x1000', '640x', '480x480', '150x150'];

function selectImageVariants(imageObj) {
    if (!imageObj) return [];
    if (typeof imageObj === 'string') return [imageObj];

    const sizedUrls = [];
    for (const size of SIZE_PRIORITIES) {
        const url = imageObj[size];
        if (typeof url === 'string') sizedUrls.push(url);
    }
    if (sizedUrls.length === 0) return [];

    const primary = sizedUrls[0];
    const candidates = new Set([primary]);

    // Mirror hosts: swap the origin on the primary URL.
    const mirrors = Array.isArray(imageObj.mirrors) ? imageObj.mirrors : [];
    for (const mirror of mirrors) {
        try {
            const mirrorOrigin = new URL(mirror).origin;
            const primaryUrl = new URL(primary);
            candidates.add(`${mirrorOrigin}${primaryUrl.pathname}${primaryUrl.search}`);
        } catch {
            // skip malformed mirror
        }
    }

    // Fall back to smaller sizes on the primary host last.
    for (const url of sizedUrls.slice(1)) candidates.add(url);

    return Array.from(candidates);
}

async function downloadImage(imageObj) {
    const candidates = selectImageVariants(imageObj);
    if (candidates.length === 0) return null;

    for (const url of candidates) {
        try {
            const response = await fetch(url);
            if (!response.ok) continue;
            const contentType = response.headers.get('content-type') || '';
            if (!contentType.startsWith('image/')) continue;
            const blob = await response.blob();
            if (blob.size === 0) continue;
            return blob;
        } catch (error) {
            // try next candidate
            console.warn(`Image fetch failed for ${url}: ${error.message}`);
        }
    }
    console.error('All image candidates failed', candidates);
    return null;
}

// ---------- Filename helpers ----------

const INVALID_FILENAME_CHARS = /[\/\\:*?"<>|\x00-\x1f]/g;

function sanitizeFilename(name) {
    if (!name) return 'unknown';
    return String(name)
        .replace(INVALID_FILENAME_CHARS, '_')
        .replace(/\./g, '_')
        .replace(/\s+/g, ' ')
        .replace(/^[. _-]+|[. _-]+$/g, '')
        .slice(0, 120) || 'unknown';
}

function formatDownloadFilename(message) {
    if (message.type === 'DOWNLOAD_ARTIST') {
        return `${sanitizeFilename(message.artistId)} - profile assets [snagged from audius].zip`;
    }
    const lastSegment = (message.contentId || '').split('/').pop();
    const base = sanitizeFilename(lastSegment);
    const label = message.contentType || 'content';
    return `${base} - ${label} assets [snagged from audius].zip`;
}

// ---------- HTML escaping ----------

function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function isSafeHref(url) {
    if (!url || typeof url !== 'string') return false;
    return /^(https?:\/\/|mailto:|\/)/i.test(url.trim());
}

function safeHref(url) {
    return isSafeHref(url) ? escapeHtml(url) : '#';
}

function externalLink(href, label) {
    return `<a href="${safeHref(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
}

// Convert track/playlist/profile descriptions to HTML paragraphs with
// escaped content and clickable URLs (autolinking only — no markdown interp).
function descriptionToHtml(description) {
    if (!description) return '';
    return description.split(/\r?\n/).map((line) => {
        const escaped = escapeHtml(line);
        const linked = escaped.replace(/(https?:\/\/[^\s<]+)/g, (match) => externalLink(match, match));
        return `<p>${linked || '&nbsp;'}</p>`;
    }).join('\n');
}

// ---------- Archive: artist ----------

async function createArtistArchive(artistData) {
    const profile = artistData?.profile;
    if (!profile) throw new Error('Missing artist profile data');

    const zip = new JSZip();
    const baseName = sanitizeFilename(profile.handle);

    zip.file(`${baseName}_details.html`, generateArtistHTML(artistData));

    const imageJobs = [];
    if (profile.profile_picture) {
        imageJobs.push(downloadImage(profile.profile_picture).then((blob) => {
            if (blob) zip.file(`${baseName}_avatar.jpg`, blob, { binary: true });
        }));
    }
    if (profile.cover_photo) {
        imageJobs.push(downloadImage(profile.cover_photo).then((blob) => {
            if (blob) zip.file(`${baseName}_cover.jpg`, blob, { binary: true });
        }));
    }
    await Promise.all(imageJobs);

    const zipBlob = await zip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 }
    });
    if (zipBlob.size === 0) throw new Error('Generated ZIP file is empty');
    return zipBlob;
}

// ---------- Archive: track / playlist / album ----------

async function createContentArchive(content) {
    const { kind, profile } = content;
    if (!profile) throw new Error('Invalid content data structure');

    const zip = new JSZip();
    let baseName;
    let imageObj;

    if (kind === 'track') {
        baseName = sanitizeFilename(content.track.title || 'track');
        imageObj = content.track.artwork;
        zip.file(`${baseName}_details.html`, generateTrackHTML(content.track));
    } else {
        baseName = sanitizeFilename(content.playlist.playlist_name || kind);
        imageObj = content.playlist.artwork;
        zip.file(`${baseName}_details.html`, generatePlaylistHTML(content.playlist, content.tracks));
    }

    if (imageObj) {
        const blob = await downloadImage(imageObj);
        if (blob) zip.file(`${baseName}_artwork.jpg`, blob, { binary: true });
    }

    const zipBlob = await zip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 }
    });
    if (zipBlob.size === 0) throw new Error('Generated ZIP file is empty');
    return zipBlob;
}

// ---------- HTML generation ----------

const SHARED_CSS = `
    body { font-family: system-ui, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; line-height: 1.6; color: #333; }
    img { max-width: 100%; height: auto; }
    ul, ol { padding-left: 20px; margin: 1em 0; }
    li { margin: 0.5em 0; font-size: 1rem; }
    p { margin: 1em 0; font-size: 1rem; }
    a { color: #7E1BCC; text-decoration: none; }
    a:hover { text-decoration: underline; }
    h1, h2, h3 { margin: 1em 0 0.5em 0; color: #000; }
    h1 { font-size: 2em; } h2 { font-size: 1.5em; } h3 { font-size: 1.2em; }
    hr { border: none; border-top: 1px solid #e0e0e0; margin: 2em 0; }
    .footer { color: #888; font-size: 0.85rem; margin-top: 3em; }
`;

function htmlDocument(title, body) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<style>${SHARED_CSS}</style>
</head>
<body>
${body}
<p class="footer">Generated with ${externalLink('https://github.com/julianbaker/snag-for-audius', 'Snag (for Audius)')} — an extension that makes it easy to download images and metadata from Audius Music.</p>
</body>
</html>`;
}

function formatDate(dateString) {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) return 'N/A';
    return date.toLocaleString('en-US', {
        year: 'numeric', month: 'long', day: 'numeric',
        hour: 'numeric', minute: 'numeric', timeZoneName: 'short'
    });
}

function formatDuration(seconds) {
    const total = Number(seconds) || 0;
    const minutes = Math.floor(total / 60);
    const remaining = Math.floor(total % 60);
    return `${minutes}:${String(remaining).padStart(2, '0')}`;
}

function formatNumber(n) {
    return (Number(n) || 0).toLocaleString();
}

function statRow(label, value) {
    return `<li><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</li>`;
}

function generateArtistHTML(artistData) {
    const profile = artistData.profile;
    const artistUrl = `https://audius.co/${encodeURIComponent(profile.handle)}`;
    const verifiedBadge = profile.is_verified ? ' ✓' : '';
    const title = `${profile.name || profile.handle} - Artist Profile`;

    const sections = [];
    sections.push(`<h1>${externalLink(artistUrl, profile.name || profile.handle)}${verifiedBadge}</h1>`);
    sections.push(`<p><strong>@${escapeHtml(profile.handle)}</strong></p>`);
    sections.push(`<p><strong>User ID:</strong> ${escapeHtml(profile.id)}</p>`);
    sections.push('<hr>');

    if (profile.bio) {
        sections.push('<h2>Bio</h2>');
        sections.push(descriptionToHtml(profile.bio));
        sections.push('<hr>');
    }
    if (profile.location) {
        sections.push('<h2>Location</h2>');
        sections.push(`<p>${escapeHtml(profile.location)}</p>`);
        sections.push('<hr>');
    }

    sections.push('<h2>Stats</h2>');
    sections.push('<ul>');
    sections.push(statRow('Followers', formatNumber(profile.follower_count)));
    sections.push(statRow('Following', formatNumber(profile.followee_count)));
    sections.push(statRow('Tracks', formatNumber(profile.track_count)));
    sections.push(statRow('Playlists', formatNumber(profile.playlist_count)));
    sections.push(statRow('Albums', formatNumber(profile.album_count)));
    sections.push(statRow('Reposts', formatNumber(profile.repost_count)));
    sections.push(statRow('Supporters', formatNumber(profile.supporter_count)));
    sections.push(statRow('Supporting', formatNumber(profile.supporting_count)));
    sections.push('</ul>');
    sections.push('<hr>');

    const socials = [];
    if (profile.twitter_handle) socials.push(`<li><strong>Twitter:</strong> ${externalLink(`https://twitter.com/${profile.twitter_handle}`, '@' + profile.twitter_handle)}</li>`);
    if (profile.instagram_handle) socials.push(`<li><strong>Instagram:</strong> ${externalLink(`https://instagram.com/${profile.instagram_handle}`, '@' + profile.instagram_handle)}</li>`);
    if (profile.tiktok_handle) socials.push(`<li><strong>TikTok:</strong> ${externalLink(`https://tiktok.com/@${profile.tiktok_handle}`, '@' + profile.tiktok_handle)}</li>`);
    if (profile.website) socials.push(`<li><strong>Website:</strong> ${externalLink(profile.website, profile.website)}</li>`);
    if (profile.donation) socials.push(`<li><strong>Donation:</strong> ${externalLink(profile.donation, profile.donation)}</li>`);
    if (socials.length > 0) {
        sections.push('<h2>Social Links</h2>');
        sections.push(`<ul>${socials.join('\n')}</ul>`);
        sections.push('<hr>');
    }

    const wallets = [];
    if (profile.erc_wallet) wallets.push(statRow('ERC', profile.erc_wallet));
    if (profile.spl_wallet) wallets.push(statRow('SPL', profile.spl_wallet));
    if (profile.spl_usdc_payout_wallet) wallets.push(statRow('SPL USDC', profile.spl_usdc_payout_wallet));
    if (wallets.length > 0) {
        sections.push('<h2>Wallets</h2>');
        sections.push(`<ul>${wallets.join('\n')}</ul>`);
        sections.push('<hr>');
    }

    return htmlDocument(title, sections.join('\n'));
}

function generateTrackHTML(track) {
    const profile = track.user || {};
    const trackUrl = track.permalink ? `https://audius.co${track.permalink}` : '#';
    const artistUrl = `https://audius.co/${encodeURIComponent(profile.handle || '')}`;
    const title = `${track.title || 'Untitled Track'} - ${profile.name || profile.handle || ''}`;

    const sections = [];
    sections.push(`<h1>${externalLink(trackUrl, track.title || 'Untitled Track')}</h1>`);
    sections.push(`<p><strong>By ${externalLink(artistUrl, profile.name || profile.handle || 'Unknown')}</strong></p>`);
    sections.push('<hr>');

    sections.push('<h2>Track Information</h2>');
    sections.push('<ul>');
    sections.push(statRow('Genre', track.genre || 'N/A'));
    sections.push(statRow('Mood', track.mood || 'N/A'));
    sections.push(statRow('Release Date', formatDate(track.release_date)));
    sections.push(statRow('Duration', formatDuration(track.duration)));
    sections.push('</ul>');
    sections.push('<hr>');

    if (track.description) {
        sections.push('<h2>Description</h2>');
        sections.push(descriptionToHtml(track.description));
        sections.push('<hr>');
    }

    sections.push('<h2>Stats</h2>');
    sections.push('<ul>');
    sections.push(statRow('Plays', formatNumber(track.play_count)));
    sections.push(statRow('Reposts', formatNumber(track.repost_count)));
    sections.push(statRow('Favorites', formatNumber(track.favorite_count)));
    sections.push('</ul>');
    sections.push('<hr>');

    return htmlDocument(title, sections.join('\n'));
}

function generatePlaylistHTML(playlist, tracks) {
    const profile = playlist.user || {};
    const playlistUrl = playlist.permalink ? `https://audius.co${playlist.permalink}` : '#';
    const artistUrl = `https://audius.co/${encodeURIComponent(profile.handle || '')}`;
    const title = `${playlist.playlist_name || 'Untitled Playlist'} - ${profile.name || profile.handle || ''}`;

    const sections = [];
    sections.push(`<h1>${externalLink(playlistUrl, playlist.playlist_name || 'Untitled Playlist')}</h1>`);
    sections.push(`<p><strong>By ${externalLink(artistUrl, profile.name || profile.handle || 'Unknown')}</strong></p>`);
    sections.push(`<p>@${escapeHtml(profile.handle || '')}</p>`);
    sections.push('<hr>');

    if (playlist.description) {
        sections.push('<h2>Description</h2>');
        sections.push(descriptionToHtml(playlist.description));
        sections.push('<hr>');
    }

    sections.push('<h2>Stats</h2>');
    sections.push('<ul>');
    sections.push(statRow('Reposts', formatNumber(playlist.repost_count)));
    sections.push(statRow('Favorites', formatNumber(playlist.favorite_count)));
    sections.push('</ul>');
    sections.push('<hr>');

    const trackCount = Number(playlist.track_count ?? tracks.length) || tracks.length;
    sections.push(`<h2>Track List (${escapeHtml(formatNumber(trackCount))})</h2>`);
    if (tracks.length === 0) {
        sections.push('<p><em>No tracks in this playlist.</em></p>');
    } else {
        sections.push('<ol>');
        for (const track of tracks) {
            const tUser = track.user || {};
            const tUrl = track.permalink ? `https://audius.co${track.permalink}` : '#';
            const tArtistUrl = `https://audius.co/${encodeURIComponent(tUser.handle || '')}`;
            sections.push(
                `<li>${externalLink(tUrl, track.title || 'Untitled')} by ${externalLink(tArtistUrl, tUser.name || tUser.handle || 'Unknown')} ` +
                `(${escapeHtml(formatDuration(track.duration))}) • ${escapeHtml(formatNumber(track.play_count))} plays</li>`
            );
        }
        sections.push('</ol>');
    }
    sections.push('<hr>');

    return htmlDocument(title, sections.join('\n'));
}
