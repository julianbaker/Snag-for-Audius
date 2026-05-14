// audiusApi.js
// Thin client over the Audius REST API (https://api.audius.co/v1).

const AUDIUS_API_HOST = 'https://api.audius.co';

self.AudiusApiService = class {
    constructor() {
        this.defaultLimit = 50;
        this.appName = 'snag_chrome_extension';
    }

    static getInstance() {
        if (!AudiusApiService.instance) {
            AudiusApiService.instance = new AudiusApiService();
        }
        return AudiusApiService.instance;
    }

    async fetchApi(endpoint, params = {}) {
        const url = new URL(`${AUDIUS_API_HOST}${endpoint}`);
        url.searchParams.append('app_name', this.appName);
        for (const [key, value] of Object.entries(params)) {
            if (value === undefined || value === null) continue;
            url.searchParams.append(key, String(value));
        }

        const response = await fetch(url.toString(), { headers: { 'Accept': 'application/json' } });
        if (!response.ok) {
            const errorText = await response.text().catch(() => '');
            throw new Error(`Audius API ${response.status} ${response.statusText} for ${endpoint}: ${errorText.slice(0, 200)}`);
        }

        const body = await response.json();
        if (body?.data === undefined) {
            throw new Error(`Audius API: missing "data" wrapper for ${endpoint}`);
        }
        return body.data;
    }

    async getUserByHandle(handle) {
        const user = await this.fetchApi(`/v1/users/handle/${encodeURIComponent(handle)}`);
        if (!user || !user.id) {
            throw new Error(`Artist with handle ${handle} not found`);
        }
        return user;
    }

    async getArtistData(handle) {
        const user = await this.getUserByHandle(handle);
        return this.fetchApi(`/v1/users/${user.id}`);
    }

    async getArtistTracks(handle, params = {}) {
        const user = await this.getUserByHandle(handle);
        return this.fetchApi(`/v1/users/${user.id}/tracks`, {
            limit: params.limit ?? this.defaultLimit,
            offset: params.offset ?? 0,
            sort: params.sort ?? 'date'
        });
    }

    async getArtistPlaylists(handle, params = {}) {
        const user = await this.getUserByHandle(handle);
        return this.fetchApi(`/v1/users/${user.id}/playlists`, {
            limit: params.limit ?? this.defaultLimit,
            offset: params.offset ?? 0
        });
    }

    // Single round-trip from handle: /v1/users/handle/{handle} now returns the
    // full user record, so we can skip the second /v1/users/{id} call.
    async getFullArtistData(handle) {
        const user = await this.getUserByHandle(handle);
        const [tracks, playlists] = await Promise.all([
            this.fetchApi(`/v1/users/${user.id}/tracks`, { limit: 100, offset: 0, sort: 'date' }),
            this.fetchApi(`/v1/users/${user.id}/playlists`, { limit: 100, offset: 0 })
        ]);
        return {
            profile: user,
            tracks: tracks || [],
            playlists: playlists || []
        };
    }

    // permalink: "artist-handle/track-slug" (no leading slash)
    async getTrackByPermalink(permalink) {
        const results = await this.fetchApi('/v1/tracks', { permalink: `/${permalink}` });
        if (Array.isArray(results) && results.length > 0) return results[0];
        // Fall back to /v1/resolve, which still works for older slugs.
        const resolved = await this.fetchApi('/v1/resolve', { url: `https://audius.co/${permalink}` });
        if (!resolved?.id) throw new Error(`Could not resolve track: ${permalink}`);
        return this.fetchApi(`/v1/tracks/${resolved.id}`);
    }

    async getTrackById(trackId) {
        return this.fetchApi(`/v1/tracks/${trackId}`);
    }

    // permalink: "artist-handle/album/slug" or "artist-handle/playlist/slug"
    async getPlaylistByPermalink(permalink) {
        const parts = permalink.split('/');
        if (parts.length !== 3) {
            throw new Error(`Invalid playlist permalink format: ${permalink}`);
        }
        const [artist, , slug] = parts;
        const results = await this.fetchApi(`/v1/playlists/by_permalink/${encodeURIComponent(artist)}/${encodeURIComponent(slug)}`);
        if (!Array.isArray(results) || results.length === 0) {
            throw new Error(`Could not find playlist: ${permalink}`);
        }
        return results[0];
    }

    async getPlaylistById(playlistId) {
        const results = await this.fetchApi(`/v1/playlists/${playlistId}`);
        if (Array.isArray(results)) return results[0];
        return results;
    }

    async getPlaylistTracks(playlistId) {
        const tracks = await this.fetchApi(`/v1/playlists/${playlistId}/tracks`);
        return Array.isArray(tracks) ? tracks : [];
    }
};
