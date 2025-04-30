// ContentDownloadService implementation
if (!self.ContentDownloadService) {
    self.ContentDownloadService = class {
        constructor() {
            this.audiusApi = self.AudiusApiService.getInstance();
        }
        async createContentArchive(contentData) {
            console.log('Starting createContentArchive with:', contentData);
            if (!contentData || !contentData.data) {
                console.error('Invalid content data structure:', contentData);
                throw new Error('Invalid content data structure');
            }

            const zip = new JSZip();
            // Basic metadata
            const metadata = {
                type: Array.isArray(contentData.data) ? 'playlist' : 'track',
                content: contentData.data,
                artist: Array.isArray(contentData.data) ? contentData.data[0]?.user : contentData.data?.user,
                timestamp: new Date().toISOString()
            };
            console.log('Creating metadata:', metadata);
            zip.file('metadata.json', JSON.stringify(metadata, null, 2));

            // Content-specific files
            if (Array.isArray(contentData.data)) {
                console.log('Processing playlist data');
                await this.addPlaylistFiles(zip, contentData.data[0]);
            }
            else {
                console.log('Processing track data');
                await this.addTrackFiles(zip, contentData.data);
            }

            console.log('Generating ZIP archive');
            return zip.generateAsync({ type: 'blob' });
        }
        async addTrackFiles(zip, trackData) {
            // Track metadata
            const trackInfo = {
                ...trackData,
                user: trackData.user || null
            };
            zip.file('track_info.md', this.generateTrackMarkdown(trackInfo));
            // Download artwork
            await this.downloadAndAddImage(zip, trackData.artwork, 'artwork');
        }
        async addPlaylistFiles(zip, playlistData) {
            console.log('Starting addPlaylistFiles with:', playlistData);

            // Playlist/Album metadata
            const playlistInfo = {
                ...playlistData,
                user: playlistData.user || null
            };
            console.log('Creating playlist info:', playlistInfo);
            zip.file('playlist_info.md', this.generatePlaylistMarkdown(playlistInfo));

            // Download artwork
            console.log('Downloading artwork');
            await this.downloadAndAddImage(zip, playlistData.artwork, 'artwork');

            // Add tracks
            console.log('Fetching playlist tracks');
            const tracksResponse = await this.audiusApi.getPlaylistTracks(playlistData.id);
            console.log('Got tracks response:', tracksResponse);

            const tracksFolder = zip.folder('tracks');
            if (tracksFolder) {
                console.log('Processing tracks');
                for (const track of tracksResponse.tracks) {
                    console.log('Processing track:', track);
                    const fullTrackData = await this.audiusApi.getTrackData(track.id);
                    await this.addTrackFiles(tracksFolder, fullTrackData);
                }
            }
            console.log('Finished processing playlist');
        }
        generateTrackMarkdown(trackInfo) {
            const artistName = trackInfo.user?.name || 'Unknown Artist';
            const artistHandle = trackInfo.user?.handle || 'unknown';

            return `# ${trackInfo.title || 'Untitled Track'}

## Basic Information
- Artist: ${artistName} (@${artistHandle})
- Genre: ${trackInfo.genre || 'N/A'}
- Mood: ${trackInfo.mood || 'N/A'}
- Release Date: ${trackInfo.release_date || 'N/A'}
- Duration: ${this.formatDuration(trackInfo.duration || 0)}

## Stats
- Plays: ${trackInfo.play_count || 0}
- Reposts: ${trackInfo.repost_count || 0}
- Favorites: ${trackInfo.favorite_count || 0}

## Links
- [Audius Link](https://audius.co${trackInfo.permalink || ''})`;
        }
        generatePlaylistMarkdown(playlistInfo) {
            const artistName = playlistInfo.user?.name || 'Unknown Artist';
            const artistHandle = playlistInfo.user?.handle || 'unknown';

            return `# ${playlistInfo.playlist_name || 'Untitled Playlist'}

## Basic Information
- Type: ${playlistInfo.is_album ? 'Album' : 'Playlist'}
- Artist: ${artistName} (@${artistHandle})
- Track Count: ${playlistInfo.track_count || 0}
- Description: ${playlistInfo.description || 'No description available'}

## Stats
- Plays: ${playlistInfo.total_play_count || 0}
- Reposts: ${playlistInfo.repost_count || 0}
- Favorites: ${playlistInfo.favorite_count || 0}

## Links
- [Audius Link](https://audius.co${playlistInfo.permalink || ''})`;
        }
        formatDuration(seconds) {
            const minutes = Math.floor(seconds / 60);
            const remainingSeconds = Math.floor(seconds % 60);
            return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
        }
        async downloadAndAddImage(zip, imageObj, prefix) {
            const highestQualityUrl = this.getHighestQualityUrl(imageObj);
            if (highestQualityUrl) {
                try {
                    const response = await fetch(highestQualityUrl);
                    const blob = await response.blob();
                    zip.file(`${prefix}.jpg`, blob);
                }
                catch (error) {
                    console.error(`Failed to download ${prefix}:`, error);
                }
            }
        }
        getHighestQualityUrl(imageObj) {
            if (!imageObj)
                return null;
            // Try to get the highest quality version
            if (imageObj["1000x1000"])
                return imageObj["1000x1000"];
            if (imageObj["480x480"])
                return imageObj["480x480"];
            if (imageObj["150x150"])
                return imageObj["150x150"];
            return null;
        }
    };
}
