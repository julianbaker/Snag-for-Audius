// Smoke test for services/audiusApi.js against the live API.
// Not a real test suite — run manually under a Node environment with `fetch`.

import { AudiusApiService } from '../services/audiusApi';

async function testAudiusApi() {
    const audius = AudiusApiService.getInstance();
    try {
        const skrillex = await audius.getFullArtistData('skrillex');
        console.log('Full artist data shape:', {
            id: skrillex.profile.id,
            handle: skrillex.profile.handle,
            trackCount: skrillex.tracks.length,
            playlistCount: skrillex.playlists.length,
            hasMirrorsOnAvatar: Array.isArray(skrillex.profile.profile_picture?.mirrors),
            hasMirrorsOnCover: Array.isArray(skrillex.profile.cover_photo?.mirrors)
        });

        const track = await audius.getTrackByPermalink('skrillex/kliptown-empyrean-98562');
        console.log('Track by permalink:', { id: track.id, title: track.title });
    } catch (error) {
        console.error('Audius API smoke test failed:', error);
    }
}

testAudiusApi();
