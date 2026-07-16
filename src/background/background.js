
class StorageService {
    constructor() {
        this.db = null;
        this.dbName = 'MemoryTabDB';
        this.storeName = 'pages';
        this.version = 1;
    }

    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.version);

            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(this.storeName)) {
                    const store = db.createObjectStore(this.storeName, { keyPath: 'id' });
                    store.createIndex('url', 'url', { unique: false });
                    store.createIndex('visitedAt', 'visitedAt', { unique: false });
                    store.createIndex('title', 'title', { unique: false });
                }
            };

            request.onsuccess = (e) => {
                this.db = e.target.result;
                resolve(this.db);
            };

            request.onerror = (e) => {
                reject(e.target.error);
            };
        });
    }

    async addPage(page) {
        if (!this.db) await this.init();
        const id = `${page.url}_${Date.now()}`;
        const tx = this.db.transaction(this.storeName, 'readwrite');
        const store = tx.objectStore(this.storeName);

        return new Promise((resolve, reject) => {
            const req = store.put({ ...page, id, visitedAt: page.visitedAt || Date.now() });
            req.onsuccess = () => resolve(id);
            req.onerror = () => reject(req.error);
        });
    }

    async getRecentPages(limit = 50) {
        if (!this.db) await this.init();
        const tx = this.db.transaction(this.storeName, 'readonly');
        const store = tx.objectStore(this.storeName);
        const index = store.index('visitedAt');

        return new Promise((resolve, reject) => {
            const results = [];
            const req = index.openCursor(null, 'prev');

            req.onsuccess = (e) => {
                const cursor = e.target.result;
                if (cursor && results.length < limit) {
                    results.push(cursor.value);
                    cursor.continue();
                } else {
                    resolve(results);
                }
            };

            req.onerror = () => reject(req.error);
        });
    }

    async searchPages(query) {
        if (!this.db) await this.init();
        const all = await this.getRecentPages(200);
        const lower = query.toLowerCase();

        return all.filter(p =>
            p.title.toLowerCase().includes(lower) ||
            (p.text && p.text.toLowerCase().includes(lower)) ||
            p.url.toLowerCase().includes(lower)
        ).slice(0, 20);
    }

    async getPage(id) {
        if (!this.db) await this.init();
        const tx = this.db.transaction(this.storeName, 'readonly');
        const store = tx.objectStore(this.storeName);

        return new Promise((resolve, reject) => {
            const req = store.get(id);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    async getAllPages() {
        if (!this.db) await this.init();
        const tx = this.db.transaction(this.storeName, 'readonly');
        const store = tx.objectStore(this.storeName);

        return new Promise((resolve, reject) => {
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    async clearAll() {
        if (!this.db) await this.init();
        const tx = this.db.transaction(this.storeName, 'readwrite');
        const store = tx.objectStore(this.storeName);

        return new Promise((resolve, reject) => {
            const req = store.clear();
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    }

    async deletePage(id) {
        if (!this.db) await this.init();
        const tx = this.db.transaction(this.storeName, 'readwrite');
        const store = tx.objectStore(this.storeName);

        return new Promise((resolve, reject) => {
            const req = store.delete(id);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    }
}

// ===== Initialize Storage =====
const storage = new StorageService();
storage.init();

// ===== Helper Functions =====
function extractDomain(url) {
    try {
        const parsed = new URL(url);
        return parsed.hostname.replace('www.', '');
    } catch {
        return 'unknown';
    }
}

async function generateTags(title, content) {
    const tags = [];
    const words = (title + ' ' + content).toLowerCase().split(/\s+/);
    const common = ['go', 'docker', 'redis', 'kubernetes', 'react', 'javascript', 'python', 'git', 'api', 'database'];
    common.forEach(tag => {
        if (words.some(w => w.includes(tag))) tags.push(tag.charAt(0).toUpperCase() + tag.slice(1));
    });
    return tags.slice(0, 5);
}

async function generateSummary(title, content) {
    if (!content || content.length < 50) return 'No summary available';
    const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 20);
    return sentences.slice(0, 3).join('. ').substring(0, 200) + '...';
}

// ===== Listen for page navigation =====
chrome.webNavigation.onCompleted.addListener(async (details) => {
    if (details.frameId !== 0) return;

    try {
        const tab = await chrome.tabs.get(details.tabId);
        if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('edge://')) return;

        const recent = await storage.getRecentPages(10);
        const existing = recent.find(p =>
            p.url === tab.url && Math.abs(p.visitedAt - Date.now()) < 5000
        );
        if (existing) return;

        let content = '';
        try {
            const results = await chrome.scripting.executeScript({
                target: { tabId: details.tabId },
                func: () => {
                    const body = document.body;
                    if (!body) return '';
                    const clone = body.cloneNode(true);
                    const scripts = clone.querySelectorAll('script, style, noscript, nav, header, footer, aside');
                    scripts.forEach(el => el.remove());
                    return clone.innerText.replace(/\s+/g, ' ').trim();
                }
            });
            content = results[0]?.result || '';
        } catch (e) {
            console.log('Content extraction skipped');
        }

        const page = {
            url: tab.url,
            title: tab.title || 'Untitled',
            text: content.substring(0, 10000),
            visitedAt: Date.now(),
            readingTime: Math.max(1, Math.round(content.split(/\s+/).length / 200)),
            domain: extractDomain(tab.url),
            tags: await generateTags(tab.title, content),
            summary: await generateSummary(tab.title, content),
        };

        await storage.addPage(page);
        console.log('Page saved:', tab.title);

    } catch (e) {
        console.error('Error saving page:', e);
    }
});

// ===== Clean up old data =====
chrome.alarms.create('cleanup', { periodInMinutes: 60 });
chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === 'cleanup') {
        const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
        const all = await storage.getAllPages();
        for (const page of all) {
            if (page.visitedAt < cutoff) {
                await storage.deletePage(page.id);
            }
        }
    }
});

// ===== Handle messages from popup =====
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'getRecentPages') {
        storage.getRecentPages(100).then(pages => sendResponse({ pages }));
        return true;
    } else if (message.action === 'searchPages') {
        storage.searchPages(message.query).then(pages => sendResponse({ pages }));
        return true;
    } else if (message.action === 'getPage') {
        storage.getPage(message.id).then(page => sendResponse({ page }));
        return true;
    } else if (message.action === 'exportData') {
        storage.getAllPages().then(pages => sendResponse({ data: pages }));
        return true;
    } else if (message.action === 'clearData') {
        storage.clearAll().then(() => sendResponse({ success: true }));
        return true;
    }
});

console.log('MemoryTab background service worker started');