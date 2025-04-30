# Snag (for Audius)

Audius doesn’t make it easy to grab images from a page.
Sometimes you need to. That’s why I made Snag — a tiny Chrome extension that lets you quickly grab assets from Audius artist profiles, tracks, playlists, and albums.

Just click, and you’ve got a zip of everything you need.

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
├── manifest.json        # Extension configuration
├── background.js        # Service worker for background tasks
├── content.js          # Content script for page interaction
├── popup.js           # Popup UI logic
├── popup.html         # Popup UI structure
├── services/          # API and service implementations
│   ├── audiusApi.js   # Audius API integration
├── lib/               # External libraries
└── icons/            # Extension icons
```

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


## License

MIT License

Copyright (c) 2024 Julian Baker

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Acknowledgments

- Powered by the [Audius](https://audius.co) API
- Uses [JSZip](https://stuk.github.io/jszip/) for ZIP file creation
