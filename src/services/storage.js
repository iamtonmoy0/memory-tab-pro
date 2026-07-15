// src/services/storage.js

export class StorageService {
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