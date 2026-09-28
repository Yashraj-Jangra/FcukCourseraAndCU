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

    if (request.action === "inject_main_world_speed") {
        const targetTabId = request.tabId || (sender && sender.tab ? sender.tab.id : null);
        const speed = parseFloat(request.speed) || 16.0;
        if (!targetTabId) {
            sendResponse({ status: "error", message: "No tab ID" });
            return true;
        }

        chrome.scripting.executeScript({
            target: { tabId: targetTabId },
            world: 'MAIN',
            func: function(targetSpeed) {
                try {
                    window.__fcukLinkedInTargetSpeed = targetSpeed;
                    window.__fcukLinkedInSpeedActive = true;

                    // 1. Override HTMLMediaElement.prototype.playbackRate
                    if (!window.__fcukPlaybackRatePatched) {
                        window.__fcukPlaybackRatePatched = true;
                        const originalDesc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'playbackRate');
                        window.__fcukOriginalPlaybackDesc = originalDesc;

                        Object.defineProperty(HTMLMediaElement.prototype, 'playbackRate', {
                            get: function() {
                                if (window.__fcukLinkedInSpeedActive && window.__fcukLinkedInTargetSpeed) {
                                    return window.__fcukLinkedInTargetSpeed;
                                }
                                return originalDesc ? originalDesc.get.call(this) : 1.0;
                            },
                            set: function(val) {
                                const effective = (window.__fcukLinkedInSpeedActive && window.__fcukLinkedInTargetSpeed)
                                    ? window.__fcukLinkedInTargetSpeed
                                    : val;
                                if (originalDesc) {
                                    return originalDesc.set.call(this, effective);
                                }
                            },
                            configurable: true,
                            enumerable: true
                        });
                    }

                    // 2. Override HTMLMediaElement.prototype.defaultPlaybackRate
                    if (!window.__fcukDefaultPlaybackRatePatched) {
                        window.__fcukDefaultPlaybackRatePatched = true;
                        const origDefaultDesc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'defaultPlaybackRate');
                        if (origDefaultDesc) {
                            Object.defineProperty(HTMLMediaElement.prototype, 'defaultPlaybackRate', {
                                get: function() {
                                    return window.__fcukLinkedInSpeedActive ? window.__fcukLinkedInTargetSpeed : origDefaultDesc.get.call(this);
                                },
                                set: function(val) {
                                    const effective = window.__fcukLinkedInSpeedActive ? window.__fcukLinkedInTargetSpeed : val;
                                    return origDefaultDesc.set.call(this, effective);
                                },
                                configurable: true,
                                enumerable: true
                            });
                        }
                    }

                    // 3. Helper to enforce high-speed playback and mute on video element
                    const enforceOnVideo = (v) => {
                        if (!v || !window.__fcukLinkedInSpeedActive) return;
                        try {
                            v.muted = true;
                            v.defaultMuted = true;
                            v.volume = 0;
                            if (window.__fcukOriginalPlaybackDesc) {
                                window.__fcukOriginalPlaybackDesc.set.call(v, window.__fcukLinkedInTargetSpeed);
                            } else {
                                v.playbackRate = window.__fcukLinkedInTargetSpeed;
                            }
                            if (v.paused && !v.ended && v.readyState >= 2) {
                                v.play().catch(() => {});
                            }
                        } catch(e) {}
                    };

                    document.querySelectorAll('video').forEach(enforceOnVideo);

                    if (!window.__fcukSpeedInterval) {
                        window.__fcukSpeedInterval = setInterval(() => {
                            if (!window.__fcukLinkedInSpeedActive) return;
                            document.querySelectorAll('video').forEach(enforceOnVideo);
                        }, 250);
                    }
                } catch(e) {
                    console.log("[FcukCoursera] MAIN world speed override error:", e);
                }
            },
            args: [speed]
        }).then(() => {
            sendResponse({ status: "injected", speed: speed });
        }).catch(err => {
            sendResponse({ status: "error", error: err.message });
        });

        return true;
    }

    if (request.action === "reset_main_world_speed") {
        const targetTabId = request.tabId || (sender && sender.tab ? sender.tab.id : null);
        if (targetTabId) {
            chrome.scripting.executeScript({
                target: { tabId: targetTabId },
                world: 'MAIN',
                func: function() {
                    window.__fcukLinkedInSpeedActive = false;
                    window.__fcukLinkedInTargetSpeed = 1.0;
                    document.querySelectorAll('video').forEach(v => {
                        v.muted = false;
                        if (window.__fcukOriginalPlaybackDesc) {
                            window.__fcukOriginalPlaybackDesc.set.call(v, 1.0);
                        } else {
                            v.playbackRate = 1.0;
                        }
                    });
                }
            }).catch(() => {});
        }
        sendResponse({ status: "reset" });
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
