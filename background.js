// FcukCoursera Background Service Worker
// Automatically tracks and cleans up external lab and tool tabs after LTI handshakes complete.
// Orchestrates multi-tab parallel worker pools for LinkedIn Learning Paths with anti-pause visibility spoofing.

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

// =========================================================================
// LinkedIn Learning Path Multi-Tab Worker Orchestrator
// =========================================================================
let pathOrchestrator = {
    isRunning: false,
    pathTitle: "",
    pathUrl: "",
    courses: [], // Array of { id, index, title, url, status: 'queued'|'running'|'completed'|'failed', tabId: null, percent: 0, currentItem: '' }
    maxConcurrency: 3, // Default is 3
    targetSpeed: 16.0,
    activeWorkers: new Map(), // tabId -> courseId
    overviewTabId: null
};

function getSerializablePathState() {
    return {
        isRunning: pathOrchestrator.isRunning,
        pathTitle: pathOrchestrator.pathTitle,
        pathUrl: pathOrchestrator.pathUrl,
        courses: pathOrchestrator.courses,
        maxConcurrency: pathOrchestrator.maxConcurrency,
        targetSpeed: pathOrchestrator.targetSpeed,
        activeWorkerCount: pathOrchestrator.activeWorkers.size,
        totalCourses: pathOrchestrator.courses.length,
        completedCourses: pathOrchestrator.courses.filter(c => c.status === 'completed').length
    };
}

function savePathState() {
    chrome.storage.local.set({ linkedinPathState: getSerializablePathState() }).catch(() => {});
}

function broadcastPathProgress() {
    const state = getSerializablePathState();
    // 1. Send to extension views (popup)
    chrome.runtime.sendMessage({
        action: "path_progress_update",
        state: state
    }).catch(() => {});

    // 2. Send to overview tab if known
    if (pathOrchestrator.overviewTabId) {
        chrome.tabs.sendMessage(pathOrchestrator.overviewTabId, {
            action: "path_progress_update",
            state: state
        }).catch(() => {});
    }

    // 3. Broadcast to all active LinkedIn tabs so in-page floating HUD stays in sync
    chrome.tabs.query({ url: "*://*.linkedin.com/*" }, (tabs) => {
        if (chrome.runtime.lastError || !tabs) return;
        tabs.forEach(t => {
            chrome.tabs.sendMessage(t.id, {
                action: "path_progress_update",
                state: state
            }).catch(() => {});
        });
    });
}

// Restore saved settings & active queue on service worker wake
chrome.storage.local.get(['linkedinPathState', 'linkedinPathConcurrency'], (res) => {
    if (res.linkedinPathConcurrency) {
        pathOrchestrator.maxConcurrency = parseInt(res.linkedinPathConcurrency, 10) || 3;
    }
    if (res.linkedinPathState && res.linkedinPathState.isRunning) {
        pathOrchestrator.pathTitle = res.linkedinPathState.pathTitle || "";
        pathOrchestrator.pathUrl = res.linkedinPathState.pathUrl || "";
        pathOrchestrator.courses = res.linkedinPathState.courses || [];
        pathOrchestrator.targetSpeed = res.linkedinPathState.targetSpeed || 16.0;
        pathOrchestrator.isRunning = true;
        pathOrchestrator.activeWorkers = new Map();
        // Reset running to queued so they re-dispatch cleanly
        pathOrchestrator.courses.forEach(c => {
            if (c.status === 'running') {
                c.status = 'queued';
                c.tabId = null;
            }
        });
        dispatchNextPathWorkers();
    }
});

// MAIN World Anti-Pause & Speed Override Injector
function injectMainWorldAntiPauseAndSpeed(targetTabId, speed = 16.0) {
    if (!targetTabId) return Promise.reject(new Error("No tab ID provided"));

    // Prevent Chrome from discarding background tab
    chrome.tabs.update(targetTabId, { autoDiscardable: false }).catch(() => {});

    return chrome.scripting.executeScript({
        target: { tabId: targetTabId },
        world: 'MAIN',
        func: function(targetSpeed) {
            try {
                window.__fcukLinkedInTargetSpeed = targetSpeed;
                window.__fcukLinkedInSpeedActive = true;

                // 1. Anti-Pause: Spoof Page Visibility API so background tabs never pause
                if (!window.__fcukVisibilityPatched) {
                    window.__fcukVisibilityPatched = true;

                    try {
                        Object.defineProperty(document, 'visibilityState', {
                            get: () => 'visible',
                            configurable: true
                        });
                        Object.defineProperty(document, 'hidden', {
                            get: () => false,
                            configurable: true
                        });
                        Object.defineProperty(document, 'hasFocus', {
                            value: () => true,
                            configurable: true
                        });
                    } catch(e) {}

                    // Block visibilitychange & blur events from triggering player pause handlers
                    const stopImmediate = (e) => {
                        e.stopImmediatePropagation();
                    };
                    window.addEventListener('visibilitychange', stopImmediate, true);
                    document.addEventListener('visibilitychange', stopImmediate, true);
                    window.addEventListener('blur', stopImmediate, true);
                    document.addEventListener('blur', stopImmediate, true);
                    window.addEventListener('pagehide', stopImmediate, true);
                }

                // 2. Override HTMLMediaElement.prototype.playbackRate
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

                // 3. Override HTMLMediaElement.prototype.defaultPlaybackRate
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

                // 4. Helper to enforce high-speed playback, mute, and unpause on video elements
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
                console.log("[FcukCoursera] MAIN world speed & anti-pause override notice:", e);
            }
        },
        args: [speed]
    });
}

// Worker Tab Lifecycle & Persistence Tracker
async function trackWorkerTabId(tabId) {
    if (!tabId) return;
    try {
        const data = await chrome.storage.local.get(['linkedinWorkerTabIds']);
        const ids = new Set(data.linkedinWorkerTabIds || []);
        ids.add(tabId);
        await chrome.storage.local.set({ linkedinWorkerTabIds: Array.from(ids) });
    } catch(e) {}
}

async function untrackWorkerTabId(tabId) {
    if (!tabId) return;
    try {
        const data = await chrome.storage.local.get(['linkedinWorkerTabIds']);
        const ids = new Set(data.linkedinWorkerTabIds || []);
        ids.delete(tabId);
        await chrome.storage.local.set({ linkedinWorkerTabIds: Array.from(ids) });
    } catch(e) {}
}

async function closeAllOldWorkerTabs(excludeTabId = null) {
    try {
        // 1. Close any tabs saved from previous sessions/runs in chrome.storage.local
        const data = await chrome.storage.local.get(['linkedinWorkerTabIds']);
        const storedIds = data.linkedinWorkerTabIds || [];
        for (const tid of storedIds) {
            if (tid && tid !== excludeTabId) {
                chrome.tabs.remove(tid).catch(() => {});
            }
        }
        await chrome.storage.local.set({ linkedinWorkerTabIds: [] });
    } catch(e) {}

    // 2. Close any currently active workers in memory
    if (pathOrchestrator.activeWorkers && pathOrchestrator.activeWorkers.size > 0) {
        for (const [tid] of pathOrchestrator.activeWorkers) {
            if (tid && tid !== excludeTabId) {
                chrome.tabs.remove(tid).catch(() => {});
            }
        }
        pathOrchestrator.activeWorkers.clear();
    }
}

// Dispatcher: Opens up to maxConcurrency worker tabs in background (STRICT limit)
async function dispatchNextPathWorkers() {
    if (!pathOrchestrator.isRunning) return;

    // 1. Audit active workers: Remove any tabs that no longer exist in Chrome
    for (const [tabId, courseId] of Array.from(pathOrchestrator.activeWorkers.entries())) {
        try {
            await chrome.tabs.get(tabId);
        } catch (e) {
            // Tab was closed by user or crashed
            pathOrchestrator.activeWorkers.delete(tabId);
            untrackWorkerTabId(tabId);
            const course = pathOrchestrator.courses.find(c => c.id === courseId);
            if (course && course.status === 'running') {
                course.status = 'queued';
                course.tabId = null;
                course.currentItem = 'Queued';
            }
        }
    }

    // 2. Strict concurrency clamp: If active count exceeds maxConcurrency, close excess tabs immediately
    while (pathOrchestrator.activeWorkers.size > pathOrchestrator.maxConcurrency) {
        const [excessTabId, courseId] = Array.from(pathOrchestrator.activeWorkers.entries()).pop();
        pathOrchestrator.activeWorkers.delete(excessTabId);
        untrackWorkerTabId(excessTabId);
        chrome.tabs.remove(excessTabId).catch(() => {});
        const course = pathOrchestrator.courses.find(c => c.id === courseId);
        if (course && course.status === 'running') {
            course.status = 'queued';
            course.tabId = null;
            course.currentItem = 'Queued';
        }
    }

    const runningCount = pathOrchestrator.activeWorkers.size;
    const availableSlots = pathOrchestrator.maxConcurrency - runningCount;

    if (availableSlots <= 0) return;

    const queuedCourses = pathOrchestrator.courses.filter(c => c.status === 'queued');

    if (queuedCourses.length === 0 && runningCount === 0) {
        // Entire path completed!
        pathOrchestrator.isRunning = false;
        savePathState();
        chrome.runtime.sendMessage({ 
            action: "path_all_completed", 
            pathTitle: pathOrchestrator.pathTitle,
            state: getSerializablePathState()
        }).catch(() => {});
        return;
    }

    const toDispatch = queuedCourses.slice(0, availableSlots);
    for (const course of toDispatch) {
        course.status = 'running';
        course.percent = 0;
        course.currentItem = "Launching worker...";

        try {
            // Open worker tab in background without stealing focus!
            const tab = await chrome.tabs.create({ url: course.url, active: false });
            course.tabId = tab.id;
            pathOrchestrator.activeWorkers.set(tab.id, course.id);
            trackWorkerTabId(tab.id);

            // Prevent tab from being discarded by Chrome
            await chrome.tabs.update(tab.id, { autoDiscardable: false }).catch(() => {});
        } catch (e) {
            console.error("[Path Orchestrator] Failed to spawn worker tab:", e);
            course.status = 'failed';
            course.currentItem = "Failed to launch";
        }
    }

    savePathState();
    broadcastPathProgress();
}

// Runtime Message Router
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // 1. Coursera Lab Tab Closer
    if (request.action === "arm_lab_tab_closer") {
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

    // 2. MAIN World Speed & Anti-Pause Injection (Single Tab)
    if (request.action === "inject_main_world_speed") {
        const targetTabId = request.tabId || (sender && sender.tab ? sender.tab.id : null);
        const speed = parseFloat(request.speed) || 16.0;
        if (!targetTabId) {
            sendResponse({ status: "error", message: "No tab ID" });
            return true;
        }

        injectMainWorldAntiPauseAndSpeed(targetTabId, speed).then(() => {
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

    // 3. Learning Path Orchestrator Controls
    if (request.action === "start_learning_path") {
        const courses = (request.courses || []).map((c, idx) => ({
            id: c.id || `item_${idx}_${Date.now()}`,
            index: idx + 1,
            title: c.title || `Item ${idx + 1}`,
            url: c.url,
            itemType: c.itemType || 'course',
            duration: c.duration || '',
            status: c.isCompleted ? 'completed' : 'queued',
            tabId: null,
            percent: c.isCompleted ? 100 : 0,
            completedVideos: 0,
            totalVideos: 0,
            currentItem: c.isCompleted ? 'Already completed ✓' : 'Queued'
        }));

        const concurrency = Math.max(1, Math.min(5, parseInt(request.maxConcurrency, 10) || pathOrchestrator.maxConcurrency || 3));
        const speed = parseFloat(request.speed) || 16.0;
        const overviewTabId = (sender && sender.tab ? sender.tab.id : null) || request.overviewTabId || null;

        // Close ALL old worker tabs before initializing a new worker pool
        closeAllOldWorkerTabs(overviewTabId).then(() => {
            pathOrchestrator = {
                isRunning: true,
                pathTitle: request.pathTitle || "Learning Path",
                pathUrl: request.pathUrl || "",
                courses: courses,
                maxConcurrency: concurrency,
                targetSpeed: speed,
                activeWorkers: new Map(),
                overviewTabId: overviewTabId
            };

            savePathState();
            dispatchNextPathWorkers();
        });

        sendResponse({ status: "started", totalCourses: courses.length, maxConcurrency: concurrency });
        return true;
    }

    if (request.action === "get_learning_path_state") {
        sendResponse({ status: "ok", state: getSerializablePathState() });
        return true;
    }

    if (request.action === "set_path_concurrency") {
        const conc = Math.max(1, Math.min(5, parseInt(request.concurrency, 10) || 3));
        pathOrchestrator.maxConcurrency = conc;
        chrome.storage.local.set({ linkedinPathConcurrency: conc });

        // If currently open workers exceed new concurrency, close excess worker tabs immediately!
        while (pathOrchestrator.activeWorkers.size > conc) {
            const [excessTabId, courseId] = Array.from(pathOrchestrator.activeWorkers.entries()).pop();
            pathOrchestrator.activeWorkers.delete(excessTabId);
            untrackWorkerTabId(excessTabId);
            chrome.tabs.remove(excessTabId).catch(() => {});
            const course = pathOrchestrator.courses.find(c => c.id === courseId);
            if (course && course.status === 'running') {
                course.status = 'queued';
                course.tabId = null;
                course.currentItem = 'Queued';
            }
        }

        savePathState();
        broadcastPathProgress();
        if (pathOrchestrator.isRunning) {
            dispatchNextPathWorkers();
        }
        sendResponse({ status: "updated", concurrency: conc });
        return true;
    }

    if (request.action === "set_path_speed") {
        const speed = parseFloat(request.speed) || 16.0;
        pathOrchestrator.targetSpeed = speed;
        chrome.storage.local.set({ linkedinPathSpeed: speed });
        for (const [tabId] of pathOrchestrator.activeWorkers) {
            injectMainWorldAntiPauseAndSpeed(tabId, speed);
            sendTabMessageWithAutoInject(tabId, { action: "set_video_speed", speed: speed }, () => {});
        }
        savePathState();
        broadcastPathProgress();
        sendResponse({ status: "updated", speed: speed });
        return true;
    }

    if (request.action === "stop_learning_path") {
        pathOrchestrator.isRunning = false;
        // Close all active worker tabs and clean up
        closeAllOldWorkerTabs(pathOrchestrator.overviewTabId).then(() => {
            pathOrchestrator.courses.forEach(c => {
                if (c.status === 'running') {
                    c.status = 'queued';
                    c.tabId = null;
                    c.currentItem = 'Stopped';
                }
            });
            savePathState();
            broadcastPathProgress();
        });
        sendResponse({ status: "stopped" });
        return true;
    }

    // 4. Worker Tab Telemetry & Completion
    if (request.action === "path_worker_progress") {
        const course = pathOrchestrator.courses.find(c => c.id === request.courseId);
        if (course) {
            course.percent = request.percent || 0;
            course.currentItem = request.currentTitle || course.currentItem;
            course.completedVideos = request.completedVideos || course.completedVideos;
            course.totalVideos = request.totalVideos || course.totalVideos;
        }
        savePathState();
        broadcastPathProgress();
        sendResponse({ status: "ok" });
        return true;
    }

    if (request.action === "path_worker_course_completed") {
        const courseId = request.courseId;
        const workerTabId = (sender && sender.tab ? sender.tab.id : null) || request.tabId;

        const course = pathOrchestrator.courses.find(c => c.id === courseId);
        if (course) {
            course.status = 'completed';
            course.percent = 100;
            course.currentItem = "Completed ✓";
            course.tabId = null;
        }

        if (workerTabId) {
            pathOrchestrator.activeWorkers.delete(workerTabId);
            untrackWorkerTabId(workerTabId);
            // Automatically close completed course tab!
            chrome.tabs.remove(workerTabId).catch(() => {});
        }

        savePathState();
        broadcastPathProgress();

        // Dispatch next course in the queue!
        dispatchNextPathWorkers();

        sendResponse({ status: "acknowledged" });
        return true;
    }
});

// Track newly created tool tabs
chrome.tabs.onCreated.addListener((newTab) => {
    if (!appTabCloserActive) return;

    const openerId = newTab.openerTabId;
    const tabId = newTab.id;

    setTimeout(async () => {
        try {
            const currentTab = await chrome.tabs.get(tabId);
            if (!currentTab) return;

            const url = (currentTab.url || currentTab.pendingUrl || '').toLowerCase();
            const isToolTab = TRACKED_TOOL_DOMAINS.some(domain => url.includes(domain)) ||
                              url.includes('lti') ||
                              url.includes('launch') ||
                              url.includes('session');

            if (isToolTab || (openerId && !url.includes('coursera.org/learn'))) {
                console.log(`[Auto Tab Closer] Automatically closing finished lab tab (ID: ${tabId}, URL: ${url})`);
                await chrome.tabs.remove(tabId);
            }
        } catch (e) {}
    }, 10000);
});

// Track tab updates (Tool tabs & LinkedIn Learning Worker Tabs)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    // 1. Tool tab auto closer
    if (appTabCloserActive && changeInfo.url) {
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

    // 2. LinkedIn Learning Worker Tab initialization
    if (pathOrchestrator.isRunning && pathOrchestrator.activeWorkers.has(tabId)) {
        if (changeInfo.status === 'complete' || changeInfo.url) {
            const courseId = pathOrchestrator.activeWorkers.get(tabId);
            const course = pathOrchestrator.courses.find(c => c.id === courseId);
            if (!course) return;

            // Wait 1.0s for DOM / React hydration to settle, then inject & launch
            setTimeout(async () => {
                try {
                    // Inject Anti-Pause + Speed in MAIN world
                    await injectMainWorldAntiPauseAndSpeed(tabId, pathOrchestrator.targetSpeed);

                    // Send start message to worker tab
                    chrome.tabs.sendMessage(tabId, {
                        action: "start_linkedin_videos",
                        speed: pathOrchestrator.targetSpeed,
                        isWorkerTab: true,
                        itemType: course.itemType || 'course',
                        singleVideoOnly: course.itemType === 'video',
                        courseId: course.id,
                        courseTitle: course.title
                    }, (resp) => {
                        if (chrome.runtime.lastError) {
                            // Inject content.js if not yet ready and retry
                            chrome.scripting.executeScript({
                                target: { tabId: tabId },
                                files: ['content.js']
                            }).then(() => {
                                setTimeout(() => {
                                    chrome.tabs.sendMessage(tabId, {
                                        action: "start_linkedin_videos",
                                        speed: pathOrchestrator.targetSpeed,
                                        isWorkerTab: true,
                                        itemType: course.itemType || 'course',
                                        singleVideoOnly: course.itemType === 'video',
                                        courseId: course.id,
                                        courseTitle: course.title
                                    }).catch(() => {});
                                }, 500);
                            }).catch(() => {});
                        }
                    });
                } catch(e) {
                    console.error("[Path Orchestrator] Worker start error:", e);
                }
            }, 1000);
        }
    }
});

// Track closed tabs (Worker cleanup & fail-safe)
chrome.tabs.onRemoved.addListener((tabId) => {
    untrackWorkerTabId(tabId);
    if (pathOrchestrator.isRunning && pathOrchestrator.activeWorkers.has(tabId)) {
        const courseId = pathOrchestrator.activeWorkers.get(tabId);
        pathOrchestrator.activeWorkers.delete(tabId);

        const course = pathOrchestrator.courses.find(c => c.id === courseId);
        if (course && course.status === 'running') {
            // Tab was closed before completing — re-queue it
            course.status = 'queued';
            course.tabId = null;
            course.currentItem = "Tab closed; re-queued";
        }

        savePathState();
        broadcastPathProgress();

        // Dispatch next available course in queue
        dispatchNextPathWorkers();
    }
});
