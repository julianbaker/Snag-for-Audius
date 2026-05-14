// urlParser.js
// Shared URL parsing for Audius page URLs. Loaded by background.js (importScripts)
// and content.js (declared in manifest content_scripts).

(function (root) {
    const RESERVED_PATHS = ['trending', 'explore', 'feed', 'notifications', 'signup', 'signin', 'settings', 'messages', 'upload', 'search', 'live'];

    function safeUrl(url) {
        try {
            return new URL(url);
        } catch {
            return null;
        }
    }

    function pathParts(url) {
        const u = safeUrl(url);
        if (!u) return null;
        return u.pathname.split('/').filter(Boolean);
    }

    function isArtistPage(url) {
        const parts = pathParts(url);
        return !!parts && parts.length === 1 && !RESERVED_PATHS.includes(parts[0]);
    }

    function isContentPage(url) {
        const parts = pathParts(url);
        if (!parts) return false;
        if (parts.length === 2) {
            return !RESERVED_PATHS.includes(parts[0]);
        }
        if (parts.length === 3) {
            return !RESERVED_PATHS.includes(parts[0]) && (parts[1] === 'album' || parts[1] === 'playlist');
        }
        return false;
    }

    function extractArtistHandle(url) {
        const parts = pathParts(url);
        if (!parts) return null;
        if (parts.length === 2 || parts.length === 3) return parts[0];
        if (parts.length === 1 && !RESERVED_PATHS.includes(parts[0])) return parts[0];
        return null;
    }

    function extractContentId(url) {
        const parts = pathParts(url);
        if (!parts || parts.length < 2 || parts.length > 3) return null;
        if (parts.length === 2) return `${parts[0]}/${parts[1]}`;
        if (parts[1] === 'album' || parts[1] === 'playlist') return `${parts[0]}/${parts[1]}/${parts[2]}`;
        return null;
    }

    function getContentType(url) {
        const parts = pathParts(url);
        if (!parts) return null;
        if (parts.length === 1) return 'artist';
        if (parts.length === 2) return 'track';
        if (parts.length === 3 && (parts[1] === 'album' || parts[1] === 'playlist')) return parts[1];
        return null;
    }

    function parseUrlInfo(url) {
        const info = {
            isArtistPage: isArtistPage(url),
            isContentPage: isContentPage(url),
            artistHandle: extractArtistHandle(url),
            contentId: extractContentId(url),
            contentType: getContentType(url)
        };
        if (!info.isArtistPage && !info.isContentPage) return null;
        if (info.isContentPage && (!info.contentId || !info.contentType)) return null;
        if (info.isArtistPage && !info.artistHandle) return null;
        return info;
    }

    const api = { isArtistPage, isContentPage, extractArtistHandle, extractContentId, getContentType, parseUrlInfo };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        root.AudiusUrlParser = api;
    }
})(typeof self !== 'undefined' ? self : globalThis);
