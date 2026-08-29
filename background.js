// FcukCoursera Background Service Worker
// Automatically tracks and cleans up external lab and tool tabs after LTI handshakes complete.

let appTabCloserActive = false;
let appTabCloserTimeout = null;
const TRACKED_TOOL_DOMAINS = [
    'cognitiveclass.ai',
    'skills.network',
    'vocareum.com',
    'coursera-apps.org',
    'qwiklabs.com',
    'cloudshare.com',
    'appspot.com',
    'run.app',
    'labs.',
    'jupyter',
    'rstudio',
    'ibm.com',
    'snlabs.codeengine.appdomain.cloud',
    'skillsnetwork.cn',
    'theiadocker'
];

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "arm_lab_tab_closer") {
        // Arm tab closer for the duration of the app launch cycle
        appTabCloserActive = true;
        if (appTabCloserTimeout) clearTimeout(appTabCloserTimeout);
        appTabCloserTimeout = setTimeout(() => {
            appTabCloserActive = false;
        }, request.durationMs || 35000);
        sendResponse({ status: "armed" });
        return true;
    }

    if (request.action === "close_tab_by_id" && request.tabId) {
        chrome.tabs.remove(request.tabId).catch(() => {});
        sendResponse({ status: "closed" });
        return true;
    }
});

// Listen for newly opened tabs
chrome.tabs.onCreated.addListener((newTab) => {
    if (!appTabCloserActive) return;

    const openerId = newTab.openerTabId;
    const tabId = newTab.id;

    // Schedule tab closure after 10 seconds (allowing LTI auth token handshakes and session init to finish on the external server)
    setTimeout(async () => {
        try {
            const currentTab = await chrome.tabs.get(tabId);
            if (!currentTab) return;

            const url = (currentTab.url || currentTab.pendingUrl || '').toLowerCase();
            const isToolTab = TRACKED_TOOL_DOMAINS.some(domain => url.includes(domain)) ||
                              url.includes('lti') ||
                              url.includes('launch') ||
                              url.includes('session');

            // If it's a tool tab or was opened while appTabCloser was active from a Coursera tab
            if (isToolTab || (openerId && !url.includes('coursera.org/learn'))) {
                console.log(`[Auto Tab Closer] Automatically closing finished lab tab (ID: ${tabId}, URL: ${url})`);
                await chrome.tabs.remove(tabId);
            }
        } catch (e) {
            // Tab already closed by user or navigation
        }
    }, 10000);
});

// Also track when an existing blank/loading tab navigates to a known tool domain
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (!appTabCloserActive) return;
    if (changeInfo.url) {
        const lowerUrl = changeInfo.url.toLowerCase();
        if (TRACKED_TOOL_DOMAINS.some(d => lowerUrl.includes(d))) {
            setTimeout(async () => {
                try {
                    await chrome.tabs.remove(tabId);
                    console.log(`[Auto Tab Closer] Closed tool tab: ${tabId}`);
                } catch (e) {}
            }, 10000);
        }
    }
});
