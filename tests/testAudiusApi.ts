import { AudiusApiService } from '../services/audiusApi';

async function testAudiusApi() {
    const audiusApi = AudiusApiService.getInstance();

    try {
        // Test artist data
        console.log('Testing artist data for reapernoises:');
        const reaperData = await audiusApi.getFullArtistData('reapernoises');
        console.log(JSON.stringify(reaperData, null, 2));

        // Test tracks for cooprecsmusic
        console.log('\nTesting tracks for cooprecsmusic:');
        const cooprecsTracks = await audiusApi.getArtistTracks('cooprecsmusic');
        console.log(JSON.stringify(cooprecsTracks, null, 2));

        // Test playlists for roqario
        console.log('\nTesting playlists for roqario:');
        const roqarioPlaylists = await audiusApi.getArtistPlaylists('roqario');
        console.log(JSON.stringify(roqarioPlaylists, null, 2));

        // Test artist data for samharadev
        console.log('\nTesting artist data for samharadev:');
        const samharadevData = await audiusApi.getFullArtistData('samharadev');
        console.log(JSON.stringify(samharadevData, null, 2));

    } catch (error) {
        console.error('Error testing Audius API:', error);
    }
}

testAudiusApi(); 