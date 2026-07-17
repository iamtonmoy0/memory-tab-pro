// src/services/storage.js

export class StorageService {
    constructor() {
        this.db = null;
        this.dbName = 'MemoryTabDB';
        this.storeName = 'pages';
        this.version = 1; // Keep version 1 – we only add a new field, no schema change
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
                    // No index for embedding – we'll scan and compute similarity
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

    /**
     * Add or update a page. If `embedding` is provided (Float32Array or Array),
     * it will be stored as an Array in IndexedDB.
     */
    async addPage(page) {
        if (!this.db) await this.init();
        const id = `${page.url}_${Date.now()}`;
        const tx = this.db.transaction(this.storeName, 'readwrite');
        const store = tx.objectStore(this.storeName);

        // Convert Float32Array to Array for storage, if provided
        const embedding = page.embedding
            ? Array.from(page.embedding)
            : null;

        return new Promise((resolve, reject) => {
            const req = store.put({
                ...page,
                id,
                visitedAt: page.visitedAt || Date.now(),
                embedding // store as array
            });
            req.onsuccess = () => resolve(id);
            req.onerror = () => reject(req.error);
        });
    }

    /**
     * Get the most recent pages (without embeddings for performance).
     */
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
                    // Optionally strip embedding to reduce payload
                    const { embedding, ...page } = cursor.value;
                    results.push(page);
                    cursor.continue();
                } else {
                    resolve(results);
                }
            };

            req.onerror = () => reject(req.error);
        });
    }

    /**
     * Keyword search (fallback).
     */
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

    /**
     * Get a single page by id (with embedding if present).
     */
    async getPage(id) {
        if (!this.db) await this.init();
        const tx = this.db.transaction(this.storeName, 'readonly');
        const store = tx.objectStore(this.storeName);

        return new Promise((resolve, reject) => {
            const req = store.get(id);
            req.onsuccess = () => {
                const page = req.result;
                // Convert embedding back to Float32Array if needed (optional)
                if (page && page.embedding) {
                    page.embedding = new Float32Array(page.embedding);
                }
                resolve(page);
            };
            req.onerror = () => reject(req.error);
        });
    }

    /**
     * Get all pages (with embeddings) – mainly for export.
     */
    async getAllPages() {
        if (!this.db) await this.init();
        const tx = this.db.transaction(this.storeName, 'readonly');
        const store = tx.objectStore(this.storeName);

        return new Promise((resolve, reject) => {
            const req = store.getAll();
            req.onsuccess = () => {
                const pages = req.result;
                // Convert embeddings back to Float32Array for easier use
                pages.forEach(p => {
                    if (p.embedding) p.embedding = new Float32Array(p.embedding);
                });
                resolve(pages);
            };
            req.onerror = () => reject(req.error);
        });
    }

    /**
     * Clear all data.
     */
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

    /**
     * Delete a page by id.
     */
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

    // ==================== AI / Semantic Search Methods ====================

    /**
     * Get recent pages that have embeddings (up to `limit`).
     * Returns pages with embedding as Float32Array.
     */
    async getPagesWithEmbeddings(limit = 100) {
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
                    const page = cursor.value;
                    // Only include pages that have an embedding
                    if (page.embedding && page.embedding.length > 0) {
                        results.push({
                            ...page,
                            embedding: new Float32Array(page.embedding)
                        });
                    }
                    cursor.continue();
                } else {
                    resolve(results);
                }
            };
            req.onerror = () => reject(req.error);
        });
    }

    /**
     * Compute cosine similarity between two Float32Arrays.
     */
    cosineSimilarity(a, b) {
        if (a.length !== b.length) return 0;
        let dot = 0, normA = 0, normB = 0;
        for (let i = 0; i < a.length; i++) {
            dot += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }
        if (normA === 0 || normB === 0) return 0;
        return dot / (Math.sqrt(normA) * Math.sqrt(normB));
    }

    /**
     * Find pages similar to the given query embedding.
     * Returns top `limit` pages sorted by similarity (descending).
     * The returned pages do NOT include the embedding field to reduce payload.
     */
    async findSimilarPages(queryEmbedding, limit = 10) {
        const pages = await this.getPagesWithEmbeddings(200); // compare with last 200 pages
        if (pages.length === 0) return [];

        const scored = pages.map(p => {
            const score = this.cosineSimilarity(queryEmbedding, p.embedding);
            return { ...p, score };
        });

        scored.sort((a, b) => b.score - a.score);

        // Return top results without embedding
        return scored.slice(0, limit).map(p => {
            const { embedding, ...rest } = p;
            return rest;
        });
    }
}