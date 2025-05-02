# Snag (for Audius)

Audius doesn't make it easy to grab images from a page.
Sometimes you need to. That's why I made Snag, a lightweight Chrome extension that lets you quickly grab assets from Audius artist profiles, tracks, playlists, and albums.

Just click, and you'll have a zip of everything you need.

[<img src="badgeAudius@2x.png" alt="Powered by Audius" width="240"/>](https://audius.co)

## Usage

1. Visit any Audius page:
   - Artist profile
   - Track page
   - Playlist
   - Album

2. Click the extension icon in your Chrome toolbar

3. The extension will automatically:
   - Detect the type of content
   - Snag relevant information and assets
   - Create and download a ZIP file 


## Development

### Project Structure
```
├── src/               # Core extension files
│   ├── popup.html     # Popup UI structure
│   ├── popup.js       # Popup UI logic
│   ├── background.js  # Service worker for background tasks
│   └── content.js     # Content script for page interaction
├── services/          # API and service implementations
│   └── audiusApi.js   # Audius API integration
├── types/            # TypeScript type definitions (currently empty)
├── docs/             # Documentation files (currently empty)
├── tests/            # Test files (currently empty)
├── lib/              # External libraries
├── icons/            # Extension icons
├── manifest.json     # Extension configuration
├── package.json      # Node.js dependencies and scripts
├── package-lock.json # Locked dependency versions
├── tsconfig.json     # TypeScript configuration
└── build.sh         # Build script
```

### Development Setup
The project uses TypeScript and Node.js for development. Key configuration files:
- `package.json`: Defines project dependencies and scripts
- `tsconfig.json`: Configures TypeScript compilation settings
- `build.sh`: Handles the build process

### Building
The project uses a simple bash script for building:
```bash
./build.sh
```
This script:
- Cleans the `dist` directory
- Copies necessary files
- Prepares the extension for loading


### API Integration
The extension integrates with the Audius API to fetch:
- Artist profiles and metadata
- Track information and artwork
- Playlist and album details
- High-quality images


## Acknowledgments

- Powered by the [Audius](https://audius.co) API
- Uses [JSZip](https://stuk.github.io/jszip/) for ZIP file creation
