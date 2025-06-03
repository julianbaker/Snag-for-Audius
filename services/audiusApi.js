// audiusApi.js
// List of available API hosts
const AUDIUS_API_HOSTS = [
    'https://api.audius.co'
];

// Define the service in the global scope
self.AudiusApiService = class {
    constructor() {
        this.defaultLimit = 50;
        this.currentHost = AUDIUS_API_HOSTS[0];
        this.appName = 'snag_chrome_extension';
    }

    static getInstance() {
        if (!AudiusApiService.instance) {
            AudiusApiService.instance = new AudiusApiService();
        }
        return AudiusApiService.instance;
    }

    async fetchApi(endpoint, params = {}) {
        const url = new URL(`${this.currentHost}${endpoint}`);
        url.searchParams.append('app_name', this.appName);
        // Add all provided parameters
        Object.entries(params).forEach(([key, value]) => {
            url.searchParams.append(key, value.toString());
        });

        console.log('Making API request to:', url.toString());

        try {
            const response = await fetch(url.toString());
            console.log('API Response status:', response.status, response.statusText);

            if (!response.ok) {
                const errorText = await response.text();
                console.error('API Error Response:', {
                    status: response.status,
                    statusText: response.statusText,
                    body: errorText
                });
                throw new Error(`API request failed: ${response.status} ${response.statusText} - ${errorText}`);
            }

            const data = await response.json();
            if (!data.data) {
                console.error('Invalid API response format:', data);
                throw new Error('Invalid API response format: missing data wrapper');
            }
            return data.data;
        }
        catch (error) {
            console.error('Audius API Error:', {
                url: url.toString(),
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    }

    async getArtistData(handle) {
        // First get the user ID from the handle
        const userSearch = await this.fetchApi(`/v1/users/handle/${handle}`);
        if (!userSearch || !userSearch.id) {
            throw new Error(`Artist with handle ${handle} not found`);
        }
        // Then get the full user data using the ID
        const userData = await this.fetchApi(`/v1/users/${userSearch.id}`);
        return userData;
    }

    async getArtistTracks(handle, params = {}) {
        const userSearch = await this.fetchApi(`/v1/users/handle/${handle}`);
        if (!userSearch || !userSearch.id) {
            throw new Error(`Artist with handle ${handle} not found`);
        }
        const tracks = await this.fetchApi(`/v1/users/${userSearch.id}/tracks`, {
            limit: params.limit || this.defaultLimit,
            offset: params.offset || 0,
            sort: params.sort || 'date'
        });
        return tracks;
    }

    async getArtistPlaylists(handle, params = {}) {
        const userSearch = await this.fetchApi(`/v1/users/handle/${handle}`);
        if (!userSearch || !userSearch.id) {
            throw new Error(`Artist with handle ${handle} not found`);
        }
        const playlists = await this.fetchApi(`/v1/users/${userSearch.id}/playlists`, {
            limit: params.limit || this.defaultLimit,
            offset: params.offset || 0
        });
        return playlists;
    }

    async getFullArtistData(handle) {
        const userData = await this.getArtistData(handle);
        // Get tracks and playlists
        const [tracks, playlists] = await Promise.all([
            this.getArtistTracks(handle, { limit: 100 }),
            this.getArtistPlaylists(handle, { limit: 100 })
        ]);
        return {
            profile: {
                id: userData.id,
                handle: userData.handle,
                name: userData.name,
                bio: userData.bio || '',
                location: userData.location || '',
                profile_picture: userData.profile_picture,
                cover_photo: userData.cover_photo,
                follower_count: userData.follower_count,
                followee_count: userData.followee_count,
                track_count: userData.track_count,
                playlist_count: userData.playlist_count,
                album_count: userData.album_count,
                repost_count: userData.repost_count,
                supporter_count: userData.supporter_count,
                supporting_count: userData.supporting_count,
                is_verified: userData.is_verified,
                is_deactivated: userData.is_deactivated,
                is_available: userData.is_available,
                created_at: userData.created_at,
                twitter_handle: userData.twitter_handle,
                instagram_handle: userData.instagram_handle,
                tiktok_handle: userData.tiktok_handle,
                website: userData.website,
                donation: userData.donation,
                erc_wallet: userData.erc_wallet,
                spl_wallet: userData.spl_wallet,
                spl_usdc_payout_wallet: userData.spl_usdc_payout_wallet
            },
            tracks: tracks,
            playlists: playlists
        };
    }

    async getTrackData(permalink) {
        try {
            console.log('Getting track data for:', permalink);

            // First try direct lookup if it's a numeric ID
            if (permalink.match(/^[A-Za-z0-9]+$/)) {
                try {
                    console.log('Attempting direct lookup for:', permalink);
                    const directResult = await this.fetchApi(`/v1/tracks/${permalink}`);
                    console.log('Direct lookup successful:', directResult);
                    return directResult;
                } catch (error) {
                    console.log('Direct lookup failed:', error);
                }
            }

            // Try to resolve the permalink to get the track ID
            console.log('Attempting to resolve permalink:', permalink);
            const resolveResult = await this.fetchApi('/v1/resolve', {
                url: `https://audius.co/${permalink}`
            });

            if (!resolveResult?.id) {
                throw new Error(`Could not resolve track: ${permalink}`);
            }

            // Now get the track data using the resolved ID
            console.log('Got track ID, fetching track data:', resolveResult.id);
            const trackData = await this.fetchApi(`/v1/tracks/${resolveResult.id}`);
            return trackData;
        } catch (error) {
            console.error('Error getting track data:', error);
            throw error;
        }
    }

    async getPlaylistData(playlistId) {
        try {
            console.log('Searching for playlist/album:', playlistId);

            // First try direct lookup if it's a numeric ID
            if (playlistId.match(/^[A-Za-z0-9]+$/)) {
                try {
                    console.log('Attempting direct lookup for:', playlistId);
                    const directResult = await this.fetchApi(`/v1/playlists/${playlistId}`);
                    console.log('Direct lookup successful:', directResult);
                    return { data: [directResult] };
                } catch (error) {
                    console.log('Direct lookup failed:', error);
                }
            }

            // Extract artist and playlist name from the permalink
            const parts = playlistId.split('/');
            if (parts.length !== 3) {
                throw new Error(`Invalid playlist permalink format: ${playlistId}`);
            }
            const [artist, , playlistName] = parts;

            // Try to get playlist by permalink
            console.log('Attempting to get playlist by permalink:', `${artist}/${playlistName}`);
            const playlistData = await this.fetchApi(`/v1/playlists/by_permalink/${artist}/${playlistName}`);

            if (!playlistData?.length) {
                console.error('Invalid playlist data:', playlistData);
                throw new Error(`Could not find playlist: ${playlistId}`);
            }

            console.log('Successfully retrieved playlist data');
            return { data: playlistData };
        } catch (error) {
            console.error('Error in getPlaylistData:', error);
            throw error;
        }
    }

    async getPlaylistTracks(playlistId) {
        try {
            console.log('Starting getPlaylistTracks for:', playlistId);

            const playlist = await this.getPlaylistData(playlistId);
            console.log('Got playlist data:', playlist);

            if (!playlist) {
                console.error('Invalid playlist data structure:', playlist);
                throw new Error('Invalid playlist data structure');
            }

            const playlistData = playlist;
            console.log('Processing playlist data:', playlistData);

            // Get the playlist ID for fetching tracks
            const playlistIdToFetch = playlistData.data[0].id || playlistId;
            console.log('Using playlist ID for tracks:', playlistIdToFetch);

            // Fetch tracks using the playlist ID
            console.log('Fetching tracks for playlist:', playlistIdToFetch);
            const tracks = await this.fetchApi(`/v1/playlists/${playlistIdToFetch}/tracks`);
            console.log('Fetched tracks:', tracks);

            if (!tracks?.length) {
                console.error('No tracks found for playlist:', playlistIdToFetch);
                throw new Error('No tracks found in playlist');
            }

            // Return in the format expected by ContentDownloadService
            console.log('Returning tracks response');
            return { tracks };
        } catch (error) {
            console.error('Error in getPlaylistTracks:', error);
            throw error;
        }
    }

    async getTracksByHandle(handle) {
        const userSearch = await this.fetchApi(`/v1/users/handle/${handle}`);
        if (!userSearch || !userSearch.id) {
            throw new Error(`Artist with handle ${handle} not found`);
        }
        return this.fetchApi(`/v1/users/${userSearch.id}/tracks`);
    }

    async getPlaylistsByHandle(handle) {
        const userSearch = await this.fetchApi(`/v1/users/handle/${handle}`);
        if (!userSearch || !userSearch.id) {
            throw new Error(`Artist with handle ${handle} not found`);
        }
        return this.fetchApi(`/v1/users/${userSearch.id}/playlists`);
    }

    async getArtistProfile(handle) {
        const userSearch = await this.fetchApi(`/v1/users/handle/${handle}`);
        if (!userSearch || !userSearch.id) {
            throw new Error(`Artist with handle ${handle} not found`);
        }
        const userData = await this.fetchApi(`/v1/users/${userSearch.id}`);
        return {
            name: userData.name,
            handle: userData.handle,
            bio: userData.bio || '',
            location: userData.location || '',
            profilePicture: userData.profile_picture,
            coverPhoto: userData.cover_photo,
            followers: userData.follower_count,
            following: userData.followee_count
        };
    }
}
