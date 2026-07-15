// src/content/content.js
console.log('MemoryTab content script loaded');

// Listen for messages from background
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'extractContent') {
        sendResponse({ content: extractPageContent() });
    }
    return true;
});

function extractPageContent() {
    try {
        const body = document.body;
        if (!body) return '';

        // Try to get main content
        const main = document.querySelector('article, main, [role="main"]');
        let content = '';

        if (main) {
            content = main.textContent || '';
        } else {
            const clone = body.cloneNode(true);
            const exclude = clone.querySelectorAll('script, style, noscript, nav, header, footer, aside, .ad, .banner');
            exclude.forEach(el => el.remove());
            content = clone.innerText || '';
        }

        return content.replace(/\s+/g, ' ').trim().substring(0, 50000);
    } catch (e) {
        return '';
    }
}