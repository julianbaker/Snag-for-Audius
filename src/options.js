// options.js
const API_KEY_STORAGE_KEY = 'audiusApiKey';
const input = document.getElementById('apiKey');
const status = document.getElementById('status');

function setStatus(message, kind) {
    status.textContent = message;
    status.className = `status ${kind || ''}`.trim();
}

async function load() {
    const stored = await chrome.storage.local.get(API_KEY_STORAGE_KEY);
    input.value = stored?.[API_KEY_STORAGE_KEY] || '';
}

document.getElementById('save').addEventListener('click', async () => {
    const value = input.value.trim();
    if (!value) {
        await chrome.storage.local.remove(API_KEY_STORAGE_KEY);
        setStatus('Cleared.', 'success');
        return;
    }
    await chrome.storage.local.set({ [API_KEY_STORAGE_KEY]: value });
    setStatus('Saved.', 'success');
});

document.getElementById('clear').addEventListener('click', async () => {
    await chrome.storage.local.remove(API_KEY_STORAGE_KEY);
    input.value = '';
    setStatus('Cleared.', 'success');
});

load();
