// src/popup/popup.js
import { StorageService } from '../services/storage.js';
import { formatTimeAgo, formatDate, extractDomain } from '../utils/helpers.js';

// ===== Dark Mode =====
let darkModeEnabled = false;

async function loadDarkModePreference() {
    return new Promise((resolve) => {
        chrome.storage.local.get(['darkMode'], (result) => {
            darkModeEnabled = result.darkMode || false;
            applyDarkMode(darkModeEnabled);
            resolve();
        });
    });
}

function applyDarkMode(enabled) {
    if (enabled) {
        document.body.classList.add('dark-mode');
        document.getElementById('darkIcon').textContent = '☀️';
    } else {
        document.body.classList.remove('dark-mode');
        document.getElementById('darkIcon').textContent = '🌙';
    }
    darkModeEnabled = enabled;
}

async function toggleDarkMode() {
    darkModeEnabled = !darkModeEnabled;
    applyDarkMode(darkModeEnabled);
    chrome.storage.local.set({ darkMode: darkModeEnabled });
}

// ===== Semantic Search Preference =====
let useSemanticSearch = true; // default

async function loadSemanticSearchPreference() {
    return new Promise((resolve) => {
        chrome.storage.local.get(['semanticSearch'], (result) => {
            useSemanticSearch = result.semanticSearch !== undefined ? result.semanticSearch : true;
            resolve();
        });
    });
}

function saveSemanticSearchPreference(value) {
    chrome.storage.local.set({ semanticSearch: value });
}

// ===== State =====
const state = {
    pages: [],
    filteredPages: [],
    searchQuery: '',
    currentView: 'search',
    selectedPage: null,
    isLoading: true,
};

// ===== DOM References =====
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const searchInput = $('#searchInput');
const pageList = $('#pageList');
const statsSection = $('#statsSection');
const timelineList = $('#timelineList');
const settingsContent = $('#settingsContent');
const detailModal = $('#detailModal');
const detailContent = $('#detailContent');
const modalClose = $('#modalClose');
const pageCountBadge = $('#pageCount');

// ===== Storage =====
const storage = new StorageService();

// ===== Render Functions =====

function renderStats(pages) {
    if (pages.length === 0) {
        statsSection.innerHTML = `
      <div class="empty-state">
        <div class="icon">🧠</div>
        <div class="text">Start browsing to build your memory</div>
      </div>
    `;
        return;
    }

    const total = pages.length;
    const today = pages.filter(p => new Date(p.visitedAt).toDateString() === new Date().toDateString()).length;
    const domains = new Set(pages.map(p => extractDomain(p.url))).size;

    statsSection.innerHTML = `
    <div class="stats-section">
      <div class="stat-card">
        <div class="stat-number">${total}</div>
        <div class="stat-label">Total Pages</div>
      </div>
      <div class="stat-card">
        <div class="stat-number">${today}</div>
        <div class="stat-label">Today</div>
      </div>
      <div class="stat-card">
        <div class="stat-number">${domains}</div>
        <div class="stat-label">Sites</div>
      </div>
    </div>
  `;
}

function renderPageList(pages) {
    if (!pages || pages.length === 0) {
        pageList.innerHTML = `
      <div class="empty-state">
        <div class="icon">🔍</div>
        <div class="text">${state.searchQuery ? 'No results found' : 'No pages saved yet'}</div>
      </div>
    `;
        return;
    }

    let html = '';
    pages.forEach(page => {
        const domain = extractDomain(page.url);
        const tag = page.tags && page.tags.length > 0 ? page.tags[0] : '';
        html += `
      <div class="page-item" data-id="${page.id}">
        <div class="page-title">
          ${page.title || 'Untitled'}
          ${tag ? `<span class="tag">${tag}</span>` : ''}
        </div>
        <div class="page-url">${page.url}</div>
        <div class="page-meta">
          <span class="source">${domain}</span>
          <span class="dot">•</span>
          <span>${formatTimeAgo(page.visitedAt)}</span>
          ${page.readingTime ? `<span class="dot">•</span><span>${page.readingTime} min read</span>` : ''}
        </div>
      </div>
    `;
    });

    pageList.innerHTML = html;

    pageList.querySelectorAll('.page-item').forEach(el => {
        el.addEventListener('click', () => {
            const id = el.dataset.id;
            const page = state.pages.find(p => p.id === id);
            if (page) openDetail(page);
        });
    });
}

function renderTimeline(pages) {
    if (!pages || pages.length === 0) {
        timelineList.innerHTML = `
      <div class="empty-state">
        <div class="icon">⏱️</div>
        <div class="text">No timeline data</div>
      </div>
    `;
        return;
    }

    const groups = {};
    pages.forEach(p => {
        const date = new Date(p.visitedAt).toDateString();
        if (!groups[date]) groups[date] = [];
        groups[date].push(p);
    });

    let html = '';
    for (const [date, items] of Object.entries(groups)) {
        const dateObj = new Date(date);
        const isToday = dateObj.toDateString() === new Date().toDateString();
        const isYesterday = dateObj.toDateString() === new Date(Date.now() - 86400000).toDateString();

        let label = date;
        if (isToday) label = 'Today';
        else if (isYesterday) label = 'Yesterday';
        else label = dateObj.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

        html += `<div class="timeline-day">`;
        html += `<div class="timeline-day-title">${label} <span class="count">(${items.length} pages)</span></div>`;

        items.forEach(p => {
            const time = new Date(p.visitedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
            html += `
        <div class="timeline-item" data-id="${p.id}">
          <div class="page-title">${p.title || 'Untitled'}</div>
          <div class="time">${time} · ${extractDomain(p.url)}</div>
        </div>
      `;
        });
        html += `</div>`;
    }

    timelineList.innerHTML = html;

    timelineList.querySelectorAll('.timeline-item').forEach(el => {
        el.addEventListener('click', () => {
            const id = el.dataset.id;
            const page = state.pages.find(p => p.id === id);
            if (page) openDetail(page);
        });
    });
}

function renderSettings() {
    settingsContent.innerHTML = `
    <div class="settings-section">
      <div class="settings-section-title">🧠 Memory</div>
      <div class="settings-item">
        <div>
          <div class="settings-item-label">Capture Open Tabs</div>
          <div class="settings-item-desc">Automatically save pages you visit</div>
        </div>
        <div class="toggle active" data-setting="captureTabs">
          <div class="toggle-knob"></div>
        </div>
      </div>
      <div class="settings-item">
        <div>
          <div class="settings-item-label">Capture Screenshots</div>
          <div class="settings-item-desc">Take screenshots of pages</div>
        </div>
        <div class="toggle" data-setting="captureScreenshots">
          <div class="toggle-knob"></div>
        </div>
      </div>
      <div class="settings-item">
        <div>
          <div class="settings-item-label">AI Summaries</div>
          <div class="settings-item-desc">Generate AI summaries for pages</div>
        </div>
        <div class="toggle" data-setting="aiSummaries">
          <div class="toggle-knob"></div>
        </div>
      </div>
    </div>

    <div class="settings-section">
      <div class="settings-section-title">🧠 AI Search</div>
      <div class="settings-item">
        <div>
          <div class="settings-item-label">Semantic Search</div>
          <div class="settings-item-desc">Find pages by meaning, not just keywords</div>
        </div>
        <div class="toggle ${useSemanticSearch ? 'active' : ''}" id="semanticToggle">
          <div class="toggle-knob"></div>
        </div>
      </div>
    </div>

    <div class="settings-section">
      <div class="settings-section-title">🎨 Appearance</div>
      <div class="settings-item">
        <div>
          <div class="settings-item-label">Default View</div>
          <div class="settings-item-desc">Which tab to show on open</div>
        </div>
        <select class="settings-select" data-setting="defaultView">
          <option value="search">Search</option>
          <option value="timeline">Timeline</option>
          <option value="settings">Settings</option>
        </select>
      </div>
    </div>

    <div class="settings-section">
      <div class="settings-section-title">💾 Data</div>
      <div class="settings-item">
        <div>
          <div class="settings-item-label">Export Data</div>
          <div class="settings-item-desc">Download all your saved pages</div>
        </div>
        <button class="detail-btn primary" id="exportBtn" style="width:auto;padding:8px 16px;">Export</button>
      </div>
      <div class="settings-item">
        <div>
          <div class="settings-item-label">Clear All Data</div>
          <div class="settings-item-desc">Permanently delete all saved pages</div>
        </div>
        <button class="detail-btn secondary" id="clearBtn" style="width:auto;padding:8px 16px;color:#e53e3e;">Clear</button>
      </div>
    </div>

    <div class="settings-section">
      <div class="settings-section-title">ℹ️ About</div>
      <div style="font-size:13px;color:#718096;line-height:1.6;">
        MemoryTab PRO v1.0.0<br />
        Your browser remembers everything, so you don't have to.<br />
        <span style="font-size:11px;color:#a0aec0;">All data stays on your device. Privacy first.</span>
      </div>
    </div>
  `;

    // Toggle handlers for regular toggles
    settingsContent.querySelectorAll('.toggle').forEach(el => {
        el.addEventListener('click', () => {
            el.classList.toggle('active');
        });
    });

    // Semantic toggle specific
    const semanticToggle = settingsContent.querySelector('#semanticToggle');
    if (semanticToggle) {
        semanticToggle.addEventListener('click', () => {
            semanticToggle.classList.toggle('active');
            useSemanticSearch = semanticToggle.classList.contains('active');
            saveSemanticSearchPreference(useSemanticSearch);
            console.log('Semantic search:', useSemanticSearch ? 'ON' : 'OFF');
        });
    }

    // Export
    settingsContent.querySelector('#exportBtn')?.addEventListener('click', async () => {
        try {
            const data = await storage.getAllPages();
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `memorytab-export-${Date.now()}.json`;
            a.click();
            URL.revokeObjectURL(url);
        } catch (e) {
            console.error('Export failed:', e);
        }
    });

    // Clear
    settingsContent.querySelector('#clearBtn')?.addEventListener('click', async () => {
        if (confirm('Are you sure you want to delete all data?')) {
            await storage.clearAll();
            await loadData();
            alert('All data cleared');
        }
    });
}

// ===== Detail Modal =====

function openDetail(page) {
    const domain = extractDomain(page.url);
    const tags = page.tags || ['Go', 'Concurrency', 'Worker Pool'];

    detailContent.innerHTML = `
    <div class="detail-title">${page.title || 'Untitled'}</div>
    <div class="detail-url">${domain} · ${formatTimeAgo(page.visitedAt)}</div>
    
    <div class="detail-summary">
      ${page.summary || 'This page explains core concepts and provides practical examples for implementing efficient worker pools.'}
    </div>
    
    <div class="detail-tags">
      ${tags.map(t => `<span class="detail-tag">${t}</span>`).join('')}
    </div>
    
    <div class="detail-actions">
      <button class="detail-btn primary" id="detailOpen">📖 Open Again</button>
      <button class="detail-btn secondary" id="detailCopy">📋 Copy Link</button>
      <button class="detail-btn secondary" id="detailCollection">📁 Add to Collection</button>
    </div>
  `;

    detailModal.style.display = 'block';

    detailContent.querySelector('#detailOpen')?.addEventListener('click', () => {
        if (page.url) chrome.tabs.create({ url: page.url });
        closeDetail();
    });

    detailContent.querySelector('#detailCopy')?.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(page.url);
            alert('Link copied!');
        } catch (e) {
            console.error('Copy failed:', e);
        }
    });

    detailContent.querySelector('#detailCollection')?.addEventListener('click', () => {
        alert('Add to collection feature coming soon!');
    });
}

function closeDetail() {
    detailModal.style.display = 'none';
}

// ===== Tab Navigation =====

function switchTab(tabName) {
    state.currentView = tabName;

    document.querySelectorAll('.tab').forEach(t => {
        t.classList.toggle('active', t.dataset.tab === tabName);
    });

    document.querySelectorAll('.view').forEach(v => {
        v.style.display = v.id === `${tabName}View` ? 'block' : 'none';
    });

    if (tabName === 'search') renderSearch();
    else if (tabName === 'timeline') renderTimeline(state.pages);
    else if (tabName === 'settings') renderSettings();
}

function renderSearch() {
    renderStats(state.pages);
    renderPageList(state.filteredPages.length > 0 || state.searchQuery ? state.filteredPages : state.pages);
}

// ===== Load Data =====

async function loadData() {
    state.isLoading = true;
    try {
        const pages = await storage.getRecentPages(100);
        state.pages = pages;
        state.filteredPages = pages;
        pageCountBadge.textContent = `${pages.length} pages`;
        renderSearch();
    } catch (e) {
        console.error('Failed to load pages:', e);
    } finally {
        state.isLoading = false;
    }
}

// ===== Search =====

async function handleSearch(query) {
    state.searchQuery = query;
    if (!query.trim()) {
        state.filteredPages = state.pages;
        renderSearch();
        return;
    }

    try {
        let results;
        if (useSemanticSearch) {
            // Use semantic search via background
            const response = await chrome.runtime.sendMessage({
                action: 'semanticSearch',
                query: query.trim()
            });
            results = response.pages || [];
        } else {
            // Fallback to keyword search
            results = await storage.searchPages(query);
        }
        state.filteredPages = results;
        renderSearch();
    } catch (e) {
        console.error('Search failed:', e);
        // Fallback to keyword search
        const results = await storage.searchPages(query);
        state.filteredPages = results;
        renderSearch();
    }
}

// ===== Event Listeners =====

searchInput.addEventListener('input', (e) => {
    handleSearch(e.target.value);
});

document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
        switchTab(tab.dataset.tab);
    });
});

modalClose.addEventListener('click', closeDetail);
detailModal.querySelector('.modal-overlay')?.addEventListener('click', closeDetail);

document.getElementById('darkModeToggle')?.addEventListener('click', toggleDarkMode);

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeDetail();
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        searchInput.focus();
    }
});

document.querySelectorAll('.hint').forEach(hint => {
    hint.addEventListener('click', () => {
        searchInput.value = hint.textContent.trim();
        handleSearch(searchInput.value);
    });
});

// ===== Init =====

(async function init() {
    await storage.init();
    await loadDarkModePreference();
    await loadSemanticSearchPreference();
    await loadData();

    if (state.pages.length === 0) {
        await loadMockData();
    }
})();

// ===== Mock Data =====

async function loadMockData() {
    const mockPages = [
        {
            id: '1',
            title: 'Go Worker Pools: Concurrency Pattern',
            url: 'https://medium.com/go-worker-pools',
            visitedAt: Date.now() - 3600000,
            readingTime: 8,
            tags: ['Go', 'Concurrency'],
            summary: 'This article explains the worker pool pattern in Go for managing goroutines efficiently. It covers implementation, use cases, and performance benefits.'
        },
        {
            id: '2',
            title: 'Docker Networking Explained (Video)',
            url: 'https://youtube.com/docker-networking',
            visitedAt: Date.now() - 7200000,
            readingTime: 15,
            tags: ['Docker', 'Networking'],
            summary: 'Complete walkthrough of Docker networking concepts including bridge, overlay, and macvlan networks.'
        },
        {
            id: '3',
            title: 'Understanding Redis Persistence',
            url: 'https://redis.io/persistence',
            visitedAt: Date.now() - 86400000,
            readingTime: 6,
            tags: ['Redis', 'Database'],
            summary: 'Deep dive into Redis persistence mechanisms including RDB snapshots and AOF logs.'
        },
        {
            id: '4',
            title: 'GitHub - golang/go: The Go Programming Language',
            url: 'https://github.com/golang/go',
            visitedAt: Date.now() - 86400000 - 3600000,
            readingTime: 3,
            tags: ['Go', 'Open Source'],
            summary: 'Official Go programming language repository with source code and documentation.'
        }
    ];

    for (const page of mockPages) {
        await storage.addPage(page);
    }
    await loadData();
}