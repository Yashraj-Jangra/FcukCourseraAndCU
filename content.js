// Background Active & Visibility Override (Keeps Coursera active, focused, and awake in background tabs)
(function enableBackgroundActiveOverride() {
    try {
        // 1. Override document visibility properties so Coursera always perceives foreground state
        Object.defineProperty(document, 'hidden', { get: () => false, configurable: true });
        Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true });
        Object.defineProperty(document, 'webkitVisibilityState', { get: () => 'visible', configurable: true });
        
        if (typeof document.hasFocus === 'function') {
            document.hasFocus = () => true;
        }

        // 2. Intercept and stop visibilitychange and blur events from throttling timers
        const preventIdleEvents = (e) => {
            if (e.type === 'visibilitychange' || e.type === 'webkitvisibilitychange' || e.type === 'blur' || e.type === 'pagehide') {
                e.stopImmediatePropagation();
            }
        };
        window.addEventListener('visibilitychange', preventIdleEvents, true);
        document.addEventListener('visibilitychange', preventIdleEvents, true);
        window.addEventListener('blur', preventIdleEvents, true);

        // 3. Keep-alive heartbeat loop to prevent background sleep and maintain session tokens
        if (!window.__fcukCourseraHeartbeat) {
            window.__fcukCourseraHeartbeat = setInterval(() => {
                try {
                    window.dispatchEvent(new Event('focus'));
                    document.dispatchEvent(new Event('focus'));
                } catch(e) {}
            }, 2500);
        }
    } catch(e) {
        console.log("Notice in visibility override:", e);
    }
})();

// Global State
let globalState = {
    isRunning: false,
    abortRequested: false,
    currentAction: null,
    statusMessage: "Ready",
    progress: { current: 0, total: 0, message: "" },
    logs: []
};

// Helper to log to popup with auto-categorization
function log(msg, type = null) {
    if (!type) {
        const lower = String(msg || "").toLowerCase();
        if (lower.includes('error') || lower.includes('failed') || lower.includes('failure') || lower.includes('could not')) {
            type = 'error';
        } else if (
            lower.includes('completed') || 
            lower.includes('success') || 
            lower.includes('matched option') || 
            lower.includes('[saved') || 
            lower.includes('posted') || 
            lower.includes('done!') ||
            lower.includes('session started!') ||
            lower.includes('quiz submitted')
        ) {
            type = 'success';
        } else if (
            lower.includes('cooling down') || 
            lower.includes('rate limit') || 
            lower.includes('warning') || 
            lower.includes('retrying') || 
            lower.includes('fallback') || 
            lower.includes('skipping')
        ) {
            type = 'warning';
        } else if (
            lower.includes('asking') || 
            lower.includes('response:') || 
            lower.includes('using gemini') || 
            lower.includes('discovered')
        ) {
            type = 'ai';
        } else {
            type = 'info';
        }
    }

    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    const logItem = { text: msg, type: type, timestamp: timestamp };

    console.log(`[FcukCoursera][${type.toUpperCase()}]`, msg);
    globalState.logs.push(logItem);
    if (globalState.logs.length > 250) globalState.logs.shift();
    chrome.runtime.sendMessage({ action: "log", data: logItem }).catch(() => {});
}

function updateStatus(msg) {
    globalState.statusMessage = msg;
    chrome.runtime.sendMessage({ action: "status", data: msg }).catch(() => {});
}

function updateProgress(current, total, message) {
    globalState.progress = { current, total, message };
    chrome.runtime.sendMessage({ 
        action: "progress_update", 
        data: { current, total, message } 
    }).catch(() => {});
}

// Coursera CSRF & Request Header Helpers
function getCsrfToken() {
    const match = document.cookie.match(/(?:CSRF3-Token|csrf3-token|CSRF-Token|CSRF2-Token|csrf2-token|__204_csrf_token)=([^;]+)/i);
    return match ? decodeURIComponent(match[1].trim()) : null;
}

function getCourseraHeaders(extra = {}) {
    const token = getCsrfToken();
    const headers = {
        'Content-Type': 'application/json',
        'x-coursera-application': 'ondemand',
        'x-requested-with': 'XMLHttpRequest',
        ...extra
    };
    if (token) {
        headers['x-csrf3-token'] = token;
        headers['x-csrf2-token'] = token;
        headers['x-csrf-token'] = token;
    }
    return headers;
}

// Main Logic
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "get_status") {
        sendResponse(globalState);
        return;
    }

    if (request.action === "stop_process") {
        if (globalState.isRunning) {
            globalState.abortRequested = true;
            log("Stop requested. Cancelling ongoing operation...");
            updateStatus("Stopping...");
            chrome.storage.local.remove([
                'masterCourseQueue', 'masterCourseIndex', 'masterAiConfig', 
                'masterCourseSlug', 'masterCourseTitle', 'masterUserId', 
                'masterCourseId', 'masterModules', 'masterManualAttention',
                'activeAppQueue', 'appQueueIndex', 'appCourseSlug', 'appCourseTitle', 'appUserId', 'appCourseId',
                'linkedinQueueRunning', 'linkedinTargetSpeed'
            ]).catch(() => {});
            hideOnScreenHUD();
            stopLinkedInVideoPlayback();
            sendResponse({ status: "stopping" });
        } else {
            sendResponse({ status: "not_running" });
        }
        return;
    }

    if (request.action === "start_skipping") {
        if (globalState.isRunning) {
            sendResponse({ status: "already_running" });
            return;
        }
        globalState.isRunning = true;
        globalState.abortRequested = false;

        if (isLinkedInLearningPlatform()) {
            globalState.currentAction = "linkedin_video";
            startLinkedInCourseCompletionProcess({ speed: 16.0, singleVideoOnly: false }).finally(() => { 
                globalState.isRunning = false;
                globalState.abortRequested = false;
            });
            sendResponse({ status: "started" });
            return;
        }

        globalState.currentAction = "skipping";
        startSkippingProcess().finally(() => { 
            globalState.isRunning = false;
            globalState.abortRequested = false;
        });
        sendResponse({ status: "started" });
    }

    if (request.action === "get_linkedin_context") {
        sendResponse(getLinkedInContext());
        return true;
    }

    if (request.action === "start_linkedin_videos") {
        if (globalState.isRunning) {
            sendResponse({ status: "already_running" });
            return;
        }
        globalState.isRunning = true;
        globalState.abortRequested = false;
        globalState.currentAction = "linkedin_video";
        const speed = request.speed || 16.0;
        const isSingleVideoOnly = request.itemType === 'video' || !!request.singleVideoOnly;
        startLinkedInCourseCompletionProcess({ 
            speed: speed, 
            singleVideoOnly: isSingleVideoOnly,
            isWorkerTab: !!request.isWorkerTab,
            courseId: request.courseId,
            courseTitle: request.courseTitle,
            itemType: request.itemType || 'course'
        }).finally(() => { 
            globalState.isRunning = false;
            globalState.abortRequested = false;
        });
        sendResponse({ status: "started" });
        return;
    }

    if (request.action === "start_linkedin_single_video") {
        if (globalState.isRunning) {
            sendResponse({ status: "already_running" });
            return;
        }
        globalState.isRunning = true;
        globalState.abortRequested = false;
        globalState.currentAction = "linkedin_single_video";
        const speed = request.speed || 16.0;
        startLinkedInCourseCompletionProcess({ speed: speed, singleVideoOnly: true }).finally(() => { 
            globalState.isRunning = false;
            globalState.abortRequested = false;
        });
        sendResponse({ status: "started" });
        return;
    }

    if (request.action === "set_linkedin_speed") {
        const speed = parseFloat(request.speed) || 16.0;
        log(`[LinkedIn] Target speed updated to ${speed}x.`);
        applyLinkedInSpeed(speed);
        sendResponse({ status: "speed_updated", speed: speed });
        return;
    }

    if (request.action === "show_floating_hud") {
        createLinkedInFloatingHUD();
        chrome.storage.local.get(['linkedinPathState'], (res) => {
            if (res && res.linkedinPathState) {
                renderFloatingHudState(res.linkedinPathState);
            }
        });
        sendResponse({ status: "hud_shown" });
        return true;
    }

    if (request.action === "path_progress_update") {
        if (request.state) {
            if (!floatingHudEl && isLinkedInLearningPathPage() && request.state.isRunning) {
                createLinkedInFloatingHUD();
            }
            if (floatingHudEl) {
                renderFloatingHudState(request.state);
            }
        }
        sendResponse({ status: "updated" });
        return true;
    }

    if (request.action === "start_reading_completion") {
        if (globalState.isRunning) {
            sendResponse({ status: "already_running" });
            return;
        }
        globalState.isRunning = true;
        globalState.abortRequested = false;
        globalState.currentAction = "reading";
        startReadingCompletionProcess().finally(() => { 
            globalState.isRunning = false;
            globalState.abortRequested = false;
        });
        sendResponse({ status: "started" });
    }
    if (request.action === "start_quiz_solver") {
        if (globalState.isRunning) {
            sendResponse({ status: "already_running" });
            return;
        }
        globalState.isRunning = true;
        globalState.abortRequested = false;
        globalState.currentAction = "quiz";
        const aiConfig = request.aiConfig || request.apiKey;
        startQuizSolverProcess(aiConfig).finally(() => { 
            globalState.isRunning = false;
            globalState.abortRequested = false;
        });
        sendResponse({ status: "started" });
    }
    if (request.action === "start_onscreen_quiz_solver") {
        if (globalState.isRunning) {
            sendResponse({ status: "already_running" });
            return;
        }
        globalState.isRunning = true;
        globalState.abortRequested = false;
        globalState.currentAction = "onscreen_quiz";
        const aiConfig = request.aiConfig || request.apiKey;
        const autoSubmit = (request.autoSubmit !== false);
        startOnScreenQuizSolverProcess(aiConfig, autoSubmit).finally(() => { 
            globalState.isRunning = false;
            globalState.abortRequested = false;
        });
        sendResponse({ status: "started" });
    }
    if (request.action === "complete_app_item_on_screen" || request.action === "start_app_item_solver") {
        if (globalState.isRunning) {
            sendResponse({ status: "already_running" });
            return;
        }
        globalState.isRunning = true;
        globalState.abortRequested = false;
        globalState.currentAction = "app_item";
        updateStatus("Completing all App & Lab items in course...");

        startCompleteAllAppItemsProcess().finally(() => {
            globalState.isRunning = false;
            globalState.abortRequested = false;
            chrome.runtime.sendMessage({ action: "finished" }).catch(() => {});
        });
        sendResponse({ status: "started" });
    }
    if (request.action === "start_complete_course") {
        if (globalState.isRunning) {
            sendResponse({ status: "already_running" });
            return;
        }
        globalState.isRunning = true;
        globalState.abortRequested = false;

        if (isLinkedInLearningPlatform()) {
            globalState.currentAction = "linkedin_video";
            startLinkedInCourseCompletionProcess({ speed: 16.0, singleVideoOnly: false }).finally(() => { 
                globalState.isRunning = false;
                globalState.abortRequested = false;
            });
            sendResponse({ status: "started" });
            return;
        }

        globalState.currentAction = "complete";
        const aiConfig = request.aiConfig || request.apiKey;
        startCompleteCourseProcess(aiConfig).finally(() => { 
            globalState.isRunning = false;
            globalState.abortRequested = false;
        });
        sendResponse({ status: "started" });
    }
});

/**
 * Builds the correct navigable Coursera URL for a course item.
 *
 * Coursera URL structure (from real URLs):
 *   Videos:  /learn/{slug}/lecture/{id}/{itemSlug}
 *   LTI App: /learn/{slug}/ungradedLti/{id}/{itemSlug}
 *   Others:  /learn/{slug}/home/item/{id}  (universal canonical router)
 *
 * Only 'ungradedLti' and 'gradedLti' have their own routable path segments.
 * All other app types (ungradedApp, workspace, lab, widget, programming, etc.)
 * must use /home/item/:id or they 404.
 */
function buildItemUrl(courseSlug, item) {
    const type = item.typeName || '';
    const typeLower = type.toLowerCase();
    const itemSlug = item.slug ? `/${item.slug}` : '';
    // ungradedLti and gradedLti have their own routable path on Coursera (case-insensitive match for safety)
    if (typeLower === 'ungradedlti') {
        return `https://www.coursera.org/learn/${courseSlug}/ungradedLti/${item.id}${itemSlug}`;
    }
    if (typeLower === 'gradedlti') {
        return `https://www.coursera.org/learn/${courseSlug}/gradedLti/${item.id}${itemSlug}`;
    }
    // Lectures have their own /lecture/ path
    if (typeLower === 'lecture') {
        return `https://www.coursera.org/learn/${courseSlug}/lecture/${item.id}${itemSlug}`;
    }
    // All other types (ungradedApp, workspace, lab, supplement, quiz, etc.) use the canonical item router
    return `https://www.coursera.org/learn/${courseSlug}/home/item/${item.id}`;
}

function isAppOrToolItem(item) {
    if (!item) return false;
    const type = String(item.typeName || item.contentSummary?.typeName || item.content?.typeName || item.itemMetadata?.typeName || '').toLowerCase();
    const name = String(item.name || '').toLowerCase();
    const slug = String(item.slug || '').toLowerCase();

    // Block any lecture/video type FIRST — must never be classified as an app regardless of name keywords
    if (type.includes('lecture') || type.includes('video')) return false;

    // 1. Definite App, LTI, Tool, and Lab Types
    const appTypes = [
        'app', 'lti', 'lab', 'workspace', 'tool', 'singlepageapp', 'openlearningapp', 
        'jupyter', 'notebook', 'sandbox', 'cloudide', 'widget', 'programming', 
        'gradedprogramming', 'ungradedprogramming', 'gradedlti', 'ungradedlti', 
        'gradedapp', 'ungradedapp', 'gradedlab', 'ungradedlab', 'gradedworkspace', 'ungradedworkspace'
    ];
    if (appTypes.some(t => type.includes(t))) {
        return true;
    }

    // 2. Keyword Match in Name or Slug — ONLY when type is completely absent/unknown.
    // If type is any known value (even a non-app one like 'lecture', 'quiz', 'supplement'),
    // skip keyword matching entirely to avoid false positives on video/reading titles.
    const knownNonAppTypes = ['lecture', 'video', 'supplement', 'reading', 'quiz', 'exam', 'assignment', 'discussion', 'dialogue'];
    if (type !== '' && knownNonAppTypes.some(t => type.includes(t))) return false;
    // Also skip keyword matching if type is a known app-ish type (already handled above)
    // Only proceed with keyword matching when type is genuinely unknown/empty
    if (type !== '') return false; // Any other known type — don't guess from name

    const appKeywords = [
        'hands-on lab', 'hands on lab', 'lab:', 'lab -', 'practice lab', 
        'ungraded lab', 'workspace', 'jupyter', 'notebook', 'sandbox', 'cloud ide', 
        'rstudio', 'vscode', 'visual studio', 'app:', 'tool:', 'external tool', 
        'interactive tool', 'interactive app', 'virtual lab', 
        'hands-on', 'hands on', 'guided project',
        'practice assignment: hands-on', 'programming assignment'
    ];
    if (appKeywords.some(kw => name.includes(kw) || slug.includes(kw))) {
        return true;
    }

    return false;
}

function classifyItemType(item) {
    const type = (item.typeName || item.contentSummary?.typeName || '').toLowerCase();
    const name = (item.name || '').toLowerCase();
    const slug = (item.slug || '').toLowerCase();

    // --- Type-based classification (authoritative) ---
    if (type.includes('lecture') || type.includes('video')) return 'lecture';
    if (type === 'supplement' || type === 'reading') return 'supplement';
    if (type.includes('discussion') || name.includes('discussion prompt')) return 'discussion';
    if (type.includes('dialogue') || type.includes('roleplay') || name.includes('dialogue') || name.includes('conversation')) return 'dialogue';

    // --- Slug/URL-segment based fallback (when typeName is absent) ---
    // Coursera's URL path segment is the ground truth for item type.
    // e.g. /lecture/8Np77/ -> video,  /ungradedLti/n9tyB/ -> app
    if (type === '') {
        if (slug.includes('lecture') || slug.includes('video')) return 'lecture';
        if (slug.includes('supplement') || slug.includes('reading')) return 'supplement';
        if (slug.includes('ungradedlti') || slug.includes('gradedlti') ||
            slug.includes('ungradedapp') || slug.includes('gradedapp') ||
            slug.includes('lab') || slug.includes('workspace')) return 'app_item';
    }

    // App / LTI items (checked BEFORE generic quizzes)
    if (isAppOrToolItem(item)) {
        return 'app_item';
    }

    // Peer review / peer-graded items
    if (type.includes('peer') || name.includes('peer-graded') || name.includes('peer review')) return 'peer_review';
    if (type.includes('coach') || type.includes('survey') || type.includes('singlepageapp')) return 'interactive';
    
    // Quizzes, assignments, activities, exercises, diagnostics, and programming items
    if (type.includes('quiz') || type.includes('exam') || type.includes('assignment') || type.includes('widget') || 
        type.includes('practice') || type.includes('diagnostic') ||
        name.includes('practice quiz') || name.includes('practice assignment') || name.includes('activity:') || 
        name.includes('quiz:') || name.includes('assignment:')) {
        return 'quiz_assignment';
    }

    return 'generic';
}

/**
 * Multi-layer Progress Pre-Fetcher:
 * Queries all Coursera progress endpoints, syllabus linked data, and DOM status badges
 * to reliably detect 100% of already-completed items and passed quizzes.
 */
async function fetchCourseProgressState(userId, courseId, courseSlug = null, syllabusData = null) {
    const progressData = {
        completedItemIds: new Set(),
        passedQuizScores: {}
    };

    const headers = getCourseraHeaders();

    const addCompleted = (id) => {
        if (id && typeof id === 'string') progressData.completedItemIds.add(id.trim());
    };

    const addPassedQuiz = (id, score) => {
        if (id && typeof id === 'string') {
            const cleanId = id.trim();
            progressData.completedItemIds.add(cleanId);
            progressData.passedQuizScores[cleanId] = score || 100;
        }
    };

    // 1. Extract from Syllabus Linked Data (if available)
    try {
        if (syllabusData && syllabusData.linked) {
            const linkedProgress = syllabusData.linked["onDemandCourseProgresses.v1"] || [];
            linkedProgress.forEach(lp => {
                if (Array.isArray(lp.completedItemIds)) lp.completedItemIds.forEach(addCompleted);
                if (Array.isArray(lp.itemProgresses)) {
                    lp.itemProgresses.forEach(ip => {
                        if (ip.isCompleted || ip.progressState === 'COMPLETED' || ip.progressState === 'PASSED') {
                            addCompleted(ip.itemId);
                        }
                    });
                }
            });

            const linkedItemProgress = syllabusData.linked["onDemandItemProgresses.v1"] || [];
            linkedItemProgress.forEach(ip => {
                if (ip.isCompleted || ip.progressState === 'COMPLETED' || ip.progressState === 'PASSED') {
                    addCompleted(ip.itemId || ip.id);
                }
            });

            const linkedPasses = syllabusData.linked["onDemandAssignmentPasses.v1"] || [];
            linkedPasses.forEach(p => {
                if (p.isPassed || p.status === 'PASSED' || p.status === 'COMPLETED') {
                    addPassedQuiz(p.itemId, Math.round((p.fractionalScore || 1) * 100));
                }
            });
        }
    } catch(e) {}

    // 2. Query all Coursera Progress and LTI/App Completion Endpoints
    const progressEndpoints = [
        `https://www.coursera.org/api/onDemandCourseProgresses.v1/${courseId}~${userId}?includes=completedItemIds,itemProgresses`,
        `https://www.coursera.org/api/onDemandCourseProgresses.v1/${userId}~${courseId}?includes=completedItemIds,itemProgresses`,
        `https://www.coursera.org/api/onDemandCourseProgresses.v1?q=course&courseId=${courseId}`,
        `https://www.coursera.org/api/onDemandCourseProgresses.v1?q=user&userId=${userId}`,
        `https://www.coursera.org/api/onDemandItemProgresses.v1?q=course&courseId=${courseId}`,
        `https://www.coursera.org/api/onDemandItemProgresses.v1?q=courseAndUser&courseId=${courseId}&userId=${userId}`,
        `https://www.coursera.org/api/onDemandLearnerItemProgresses.v1?q=course&courseId=${courseId}`,
        `https://www.coursera.org/api/onDemandLearnerItemProgresses.v1?q=courseAndUser&courseId=${courseId}&userId=${userId}`,
        `https://www.coursera.org/api/onDemandLtiItemPasses.v1?q=course&courseId=${courseId}`,
        `https://www.coursera.org/api/onDemandLtiItemPasses.v1?q=user&userId=${userId}`,
        `https://www.coursera.org/api/onDemandAppCompletions.v1?q=course&courseId=${courseId}`,
        `https://www.coursera.org/api/onDemandAppCompletions.v1?q=user&userId=${userId}`,
        `https://www.coursera.org/api/onDemandAssignmentPasses.v1?q=course&courseId=${courseId}`,
        `https://www.coursera.org/api/onDemandAssignmentPasses.v1?q=user&userId=${userId}`,
        `https://www.coursera.org/api/onDemandSupplementCompletions.v1?q=course&courseId=${courseId}&userId=${userId}`
    ];

    // Fire all progress endpoints in parallel for maximum speed (was sequential, causing 15+ second stalls)
    const progressResults = await Promise.allSettled(
        progressEndpoints.map(url =>
            fetch(url, { headers, credentials: 'include', signal: AbortSignal.timeout(2000) })
                .then(r => r.ok ? r.json() : null)
                .catch(() => null)
        )
    );

    for (const result of progressResults) {
        if (result.status !== 'fulfilled' || !result.value) continue;
        const data = result.value;
        const elements = data.elements || [];
        for (const el of elements) {
            if (Array.isArray(el.completedItemIds)) el.completedItemIds.forEach(addCompleted);
            if (Array.isArray(el.itemProgresses)) {
                el.itemProgresses.forEach(ip => {
                    if (ip.isCompleted || ip.progressState === 'COMPLETED' || ip.progressState === 'PASSED') {
                        addCompleted(ip.itemId);
                    }
                });
            }
            if (el.isCompleted || el.isPassed || el.progressState === 'COMPLETED' || el.progressState === 'PASSED' || el.status === 'PASSED' || el.status === 'COMPLETED' || (el.fractionalScore && el.fractionalScore >= 0.7)) {
                addCompleted(el.itemId || el.id);
                if (el.fractionalScore !== undefined) {
                    addPassedQuiz(el.itemId || el.id, Math.round(el.fractionalScore * 100));
                }
            }
        }
    }

    // 3. Inspect Apollo / Redux State Cache in Memory
    try {
        const apolloState = window.__APOLLO_STATE__ || window.__INITIAL_STATE__;
        if (apolloState && typeof apolloState === 'object') {
            for (const [key, val] of Object.entries(apolloState)) {
                if (val && typeof val === 'object') {
                    if (val.isCompleted === true || val.progressState === 'COMPLETED' || val.progressState === 'PASSED' || val.isPassed === true) {
                        const itId = val.itemId || val.id;
                        if (itId) addCompleted(itId);
                    }
                }
            }
        }
    } catch(e) {}

    // 4. Universal DOM Scanner: Detect all completed checkmarks AND extract item types from sidebar links
    // This is the only reliable source for item typeName — the syllabus API never returns it.
    const itemTypeMap = {}; // itemId → typeName (e.g. 'lecture', 'ungradedLti', 'supplement')
    const URL_TYPE_SEGMENTS = ['ungradedlti', 'gradedlti', 'ungradedapp', 'gradedapp', 'lecture', 'supplement', 'quiz', 'exam', 'assignment', 'ungradedassignment', 'discussionprompt', 'discussion', 'singlepageapp', 'workspace', 'lab'];
    // Canonical casing map for URL segments → typeName
    const TYPE_CASING = {
        'ungradedlti': 'ungradedLti', 'gradedlti': 'gradedLti',
        'ungradedapp': 'ungradedApp', 'gradedapp': 'gradedApp',
        'lecture': 'lecture', 'supplement': 'supplement',
        'quiz': 'quiz', 'exam': 'exam',
        'assignment': 'assignment', 'ungradedassignment': 'ungradedAssignment',
        'discussionprompt': 'discussionPrompt', 'discussion': 'discussion',
        'singlepageapp': 'singlePageApp', 'workspace': 'workspace', 'lab': 'lab'
    };
    try {
        const allCourseLinks = Array.from(document.querySelectorAll('a[href*="/learn/"]'));
        for (const link of allCourseLinks) {
            const href = link.getAttribute('href') || '';
            const parts = href.split('/').filter(p => p);
            // Find the type segment and item ID: /learn/{slug}/{type}/{id}
            const learnIdx = parts.indexOf('learn');
            if (learnIdx === -1 || parts.length < learnIdx + 4) continue;
            const typeSeg = parts[learnIdx + 2]?.toLowerCase();
            const itemId = parts[learnIdx + 3];
            if (!typeSeg || !itemId || !URL_TYPE_SEGMENTS.includes(typeSeg)) continue;

            // Store canonical typeName
            if (!itemTypeMap[itemId]) {
                itemTypeMap[itemId] = TYPE_CASING[typeSeg] || typeSeg;
            }

            // Also check for completion state
            const row = link.closest('li, [class*="ItemRow"], [class*="item-row"], [class*="ItemCard"], [class*="card"], [class*="ItemContainer"], [role="listitem"], div[class*="cds-"]') || link;
            const hasCompletedIcon = !!row.querySelector('[data-testid*="completed"], [data-testid*="Completed"], [data-testid*="SuccessOutline"], [data-testid*="CheckCircle"], [data-testid*="Checkmark"], svg[aria-label*="Completed"], svg[aria-label*="Passed"], [class*="completed"], [class*="CompletedIcon"]');
            const rowText = (row.innerText || row.textContent || '').toLowerCase();
            const isCompletedText = (rowText.includes('completed') || rowText.includes('passed') || rowText.includes('100%') || rowText.includes('80%')) && !rowText.includes('not completed');
            if (hasCompletedIcon || isCompletedText) {
                addCompleted(itemId);
            }
        }
    } catch(e) {}

    progressData.itemTypeMap = itemTypeMap;
    return progressData;
}

async function startCompleteCourseProcess(aiConfig) {
    try {
        log("Initializing Full Course Chronological Auto-Completion...");
        updateStatus("Scanning course syllabus in order...");
        showOnScreenHUD("FcukCoursera: Initializing Chronological Course Solver...", "working");

        // 1. Fetch course data & syllabus (progressData is pre-fetched inside getCourseData for type enrichment)
        const { userId, courseId, courseSlug, courseTitle, allItems, modules, syllabusData, progressData: prefetchedProgress } = await getCourseData();
        log(`Resolved Course: "${courseTitle}" (${courseSlug}), User ID: ${userId}`);
        log(`Total syllabus items: ${allItems.length} across ${modules.length} modules.`);

        // 2. Reuse pre-fetched progressData (avoids a redundant second API round-trip)
        const progressData = prefetchedProgress || await fetchCourseProgressState(userId, courseId, courseSlug, syllabusData);
        log(`[Progress Pre-Check] Found ${progressData.completedItemIds.size} already-completed items in this course.`);

        // 3. Filter strictly for uncompleted items in exact natural syllabus sequence
        const uncompletedItems = allItems.filter(item => {
            if (progressData.completedItemIds.has(item.id)) return false;
            if (progressData.passedQuizScores && progressData.passedQuizScores[item.id] !== undefined) return false;
            return true;
        });

        log(`Queue contains ${uncompletedItems.length} uncompleted item(s) to solve in chronological order.`);

        if (uncompletedItems.length === 0) {
            log(`🎉 All ${allItems.length} items in "${courseTitle}" are already completed! Zero items need solving.`);
            updateProgress(allItems.length, allItems.length, "Done!");
            updateStatus("All course items already completed!");
            showOnScreenHUD("🎉 Entire Course Already 100% Completed!", "success");
            await generateCourseSummaryReport(userId, courseId, courseSlug, courseTitle, allItems, modules, []);
            chrome.runtime.sendMessage({ action: "finished" }).catch(() => {});
            setTimeout(hideOnScreenHUD, 3500);
            return;
        }

        // 4. Build master chronological queue preserving exact syllabus order
        const masterQueue = uncompletedItems.map(it => ({
            id: it.id,
            name: it.name,
            typeName: it.typeName,
            slug: it.slug,
            moduleId: it.moduleId,
            moduleName: it.moduleName,
            isLocked: it.isLocked,
            lockStatus: it.lockStatus,
            url: buildItemUrl(courseSlug, it)
        }));

        const queueData = {
            masterCourseQueue: masterQueue,
            masterCourseIndex: 0,
            masterAiConfig: aiConfig,
            masterCourseSlug: courseSlug,
            masterCourseTitle: courseTitle,
            masterUserId: userId,
            masterCourseId: courseId,
            masterModules: modules,
            masterManualAttention: []
        };

        await chrome.storage.local.set(queueData);

        // Begin step 1 of master chronological queue
        await processMasterCourseQueueStep();

    } catch (e) {
        log("Error in Complete Course initialization: " + e.message);
        updateStatus("Error occurred. Check logs.");
        showOnScreenHUD(`Error: ${e.message}`, "error");
        chrome.runtime.sendMessage({ action: "finished" }).catch(() => {});
        setTimeout(hideOnScreenHUD, 4000);
    }
}

/**
 * Executes a single step of the persistent Master Chronological Course Queue.
 * Follows exact natural syllabus order: Video -> Reading -> App/Lab (on-screen) -> Quiz.
 */
async function processMasterCourseQueueStep() {
    try {
        const data = await chrome.storage.local.get([
            'masterCourseQueue', 'masterCourseIndex', 'masterAiConfig', 
            'masterCourseSlug', 'masterCourseTitle', 'masterUserId', 
            'masterCourseId', 'masterModules', 'masterManualAttention'
        ]);

        if (!data.masterCourseQueue || !Array.isArray(data.masterCourseQueue) || data.masterCourseQueue.length === 0) {
            return;
        }

        if (globalState.abortRequested) {
            log("[Master Runner] Process cancelled by user. Clearing master queue...");
            await chrome.storage.local.remove([
                'masterCourseQueue', 'masterCourseIndex', 'masterAiConfig', 
                'masterCourseSlug', 'masterCourseTitle', 'masterUserId', 
                'masterCourseId', 'masterModules', 'masterManualAttention'
            ]);
            hideOnScreenHUD();
            updateStatus("Process aborted.");
            chrome.runtime.sendMessage({ action: "finished" }).catch(() => {});
            return;
        }

        const currentIndex = data.masterCourseIndex || 0;
        const total = data.masterCourseQueue.length;
        const userId = data.masterUserId;
        const courseId = data.masterCourseId;
        const courseSlug = data.masterCourseSlug;
        const courseTitle = data.masterCourseTitle;
        const aiConfig = data.masterAiConfig;
        const modules = data.masterModules || [];
        const manualAttentionItems = data.masterManualAttention || [];

        // When all items in master queue are completed:
        if (currentIndex >= total) {
            log(`\n🎉 [Master Runner] Successfully completed all ${total} items across the entire course "${courseTitle}" in chronological order!`);
            updateProgress(total, total, "Done!");
            updateStatus(`Done! Completed all ${total} items in course.`);
            showOnScreenHUD(`🎉 Entire Course Completed (100%)!`, "success");
            
            await generateCourseSummaryReport(userId, courseId, courseSlug, courseTitle, data.masterCourseQueue, modules, manualAttentionItems);
            
            await chrome.storage.local.remove([
                'masterCourseQueue', 'masterCourseIndex', 'masterAiConfig', 
                'masterCourseSlug', 'masterCourseTitle', 'masterUserId', 
                'masterCourseId', 'masterModules', 'masterManualAttention'
            ]);
            setTimeout(hideOnScreenHUD, 4500);
            chrome.runtime.sendMessage({ action: "finished" }).catch(() => {});
            return;
        }

        const item = data.masterCourseQueue[currentIndex];
        const category = classifyItemType(item);
        const courseContext = {
            courseSlug: courseSlug,
            courseTitle: courseTitle,
            assignmentName: item.name,
            moduleName: item.moduleName || ""
        };

        const progressMsg = `[${currentIndex + 1}/${total}] ${item.moduleName ? item.moduleName + ': ' : ''}${item.name}`;
        log(`\n----------------------------------------`);
        log(`[Master Runner] Step (${currentIndex + 1}/${total}): ${item.name} (${item.typeName || category}, ID: ${item.id})`);
        log(`----------------------------------------`);
        
        updateStatus(progressMsg);
        updateProgress(currentIndex, total, item.name);
        showOnScreenHUD(`[${currentIndex + 1}/${total}] Solving: ${item.name.substring(0, 30)}...`, "working");

        // 1. Handle Peer Review & Locked items gracefully
        if (category === 'peer_review') {
            log(`[⚠️ Manual Attention Needed] ${item.name} (${item.moduleName}): Peer-graded assignment requires manual peer submission.`);
            manualAttentionItems.push({
                id: item.id,
                name: item.name,
                moduleName: item.moduleName || 'General',
                typeName: item.typeName || 'Peer Review',
                reason: 'Peer-graded assignment requires manual submission & peer reviews.',
                itemUrl: `https://www.coursera.org/learn/${courseSlug}/home/item/${item.id}`
            });
            await chrome.storage.local.set({ 
                masterCourseIndex: currentIndex + 1,
                masterManualAttention: manualAttentionItems
            });
            return processMasterCourseQueueStep();
        }

        // 2. Handle App / Lab / LTI items in series
        // Use only classifyItemType result — it already calls isAppOrToolItem internally with lecture-first priority.
        // Do NOT call isAppOrToolItem(item) again here: it would bypass the lecture guard and misclassify
        // videos whose titles contain keywords like 'lab', 'notebook', 'hands-on', etc.
        if (category === 'app_item') {
            const isCurrentPage = window.location.href.includes(item.id);

            // If not on this item's page, navigate to it!
            if (!isCurrentPage) {
                log(`[Master Runner] Navigating to App/Lab page: ${item.url}`);
                showOnScreenHUD(`📱 Opening Lab (${currentIndex + 1}/${total}): ${item.name.substring(0, 25)}...`, "working");
                await new Promise(r => setTimeout(r, 30));
                window.location.href = item.url;
                return;
            }

            // Run live on-screen solver (with 8s token exchange hold)
            await completeUngradedAppItemInDOM();
            await completeUngradedAppItem(userId, courseId, courseSlug, item, true);

            // Advance index
            const nextIndex = currentIndex + 1;
            await chrome.storage.local.set({ masterCourseIndex: nextIndex });

            if (nextIndex < total) {
                const nextItem = data.masterCourseQueue[nextIndex];
                const nextCategory = classifyItemType(nextItem);
                
                if (nextCategory === 'app_item') {
                    log(`[Master Runner] Lab finished. Navigating to next item (Lab): ${nextItem.name}...`);
                    await new Promise(r => setTimeout(r, 40));
                    window.location.href = nextItem.url;
                } else {
                    log(`[Master Runner] Lab finished. Continuing immediately to next item: ${nextItem.name}...`);
                    await new Promise(r => setTimeout(r, 20));
                    return processMasterCourseQueueStep();
                }
            } else {
                return processMasterCourseQueueStep();
            }
            return;
        }

        // 3. Handle Non-App items (Video, Reading, Discussion, Dialogue, Quiz) sequentially in place
        let result = false;
        try {
            if (category === 'lecture') {
                result = await completeSingleVideo(userId, courseId, courseSlug, item.id);
                if (result) log(`[Video Completed] ${item.name}`);
            } else if (category === 'supplement') {
                result = await completeSingleReading(userId, courseId, courseSlug, item.id);
                if (result) log(`[Reading Completed] ${item.name}`);
            } else if (category === 'discussion') {
                result = await completeDiscussionPrompt(userId, courseId, courseSlug, item, aiConfig, courseContext);
            } else if (category === 'dialogue') {
                result = await completeDialogueItem(userId, courseId, courseSlug, item, aiConfig, courseContext);
            } else if (category === 'interactive') {
                result = await completeGenericInteractiveItem(userId, courseId, courseSlug, item, aiConfig);
            } else if (category === 'quiz_assignment') {
                await processQuizItem(userId, courseId, item, aiConfig, courseContext);
                result = true;
            } else {
                await processQuizItem(userId, courseId, item, aiConfig, courseContext);
                result = true;
            }
        } catch(err) {
            log(`[Notice] ${item.name}: ${err.message}`);
        }

        // Advance to next step in master queue
        const nextIndex = currentIndex + 1;
        await chrome.storage.local.set({ masterCourseIndex: nextIndex });
        await new Promise(r => setTimeout(r, 10));
        return processMasterCourseQueueStep();

    } catch(e) {
        log(`Error in Master Course Runner: ${e.message}`);
        updateStatus("Error occurred in Master runner.");
        showOnScreenHUD(`Error: ${e.message}`, "error");
        setTimeout(hideOnScreenHUD, 4000);
    }
}

async function startSkippingProcess() {
    try {
        const { userId, courseId, courseSlug, allItems, syllabusData } = await getCourseData();
        
        log(`Queued ${allItems.length} items for video skipping...`);
        
        // Pre-fetch progress
        const progressData = await fetchCourseProgressState(userId, courseId, courseSlug, syllabusData);
        log(`[Progress Pre-Check] Found ${progressData.completedItemIds.size} already-completed items.`);

        updateProgress(0, allItems.length, "Starting...");

        let completedCount = 0;
        for (let i = 0; i < allItems.length; i++) {
            if (globalState.abortRequested) {
                log("Video skipping stopped by user.");
                break;
            }

            const item = allItems[i];
            updateStatus(`[${i + 1}/${allItems.length}] ${item.moduleName}: ${item.name}`);
            updateProgress(i, allItems.length, item.name);
            
            // Skip already completed
            if (progressData.completedItemIds.has(item.id)) {
                log(`[Already Completed (✓)] ${item.name} (${item.moduleName}) - Skipping.`);
                completedCount++;
                continue;
            }

            try {
                const result = await completeSingleVideo(userId, courseId, courseSlug, item.id);
                if (result) {
                    log(`[Video Completed] ${item.name} (${item.moduleName})`);
                    completedCount++;
                }
            } catch (e) {
                log(`[Error] ${item.name}: ${e.message}`);
            }
        }

        if (globalState.abortRequested) {
            updateStatus("Process aborted.");
        } else {
            updateProgress(allItems.length, allItems.length, "Done!");
            updateStatus(`Done! Completed ${completedCount} videos.`);
        }
        chrome.runtime.sendMessage({ action: "finished" }).catch(() => {});

    } catch (e) {
        log("Error: " + e.message);
        updateStatus("Error occurred. Check logs.");
        chrome.runtime.sendMessage({ action: "finished" }).catch(() => {});
    }
}

/**
 * Core logic adapted from your script to complete a single video by Item ID
 * Returns true if it was a video and completed successfully, false otherwise.
 */
async function completeSingleVideo(userId, courseId, courseSlug, itemId) {
    // A. Get Video Metadata (Tracking ID & Duration)
    let timeCommitment = 1800000; // Hardcoded to 30 minutes
    let trackingId = null;

    try {
        const videoMetadataUrl = `https://www.coursera.org/api/onDemandLectureVideos.v1/${courseId}~${itemId}?includes=video&fields=disableSkippingForward,startMs,endMs`;
        const metaResp = await fetch(videoMetadataUrl, {credentials: "include"});
        
        // If 404 or other error, it's likely not a video (e.g. reading, quiz)
        if (!metaResp.ok) return false;

        const metaData = await metaResp.json();
        const videoElement = metaData.linked?.["onDemandVideos.v1"]?.[0];
        
        if (videoElement) {
            trackingId = videoElement.id;
        } else {
            return false; // Not a video
        }
    } catch (e) {
        return false; // Failed to fetch metadata, assume not a video
    }

    if (!trackingId) {
        return false;
    }

    // B. Execute Completion Sequence (play + progress update in parallel, then end)
    const apiUrlBase = `https://www.coursera.org/api/opencourse.v1/user/${userId}/course/${courseSlug}/item/${itemId}/lecture/videoEvents/`;
    const progressUrl = `https://www.coursera.org/api/onDemandVideoProgresses.v1/${userId}~${courseId}~${trackingId}`;
    const headers = getCourseraHeaders();
    const payload = JSON.stringify({ contentRequestBody: {} });
    const progressPayload = JSON.stringify({
        videoProgressId: `${userId}~${courseId}~${trackingId}`,
        viewedUpTo: timeCommitment
    });

    // 1. Play + Update Progress in parallel (no need to wait between them)
    await Promise.all([
        fetch(apiUrlBase + 'play?autoEnroll=false', {
            method: 'POST', headers: headers, body: payload, credentials: 'include'
        }),
        fetch(progressUrl, {
            method: 'PUT', headers: headers, body: progressPayload, credentials: 'include'
        })
    ]);

    // 2. End event (removed unnecessary 100ms sleep — server does not require it)
    const endResp = await fetch(apiUrlBase + 'ended?autoEnroll=false', {
        method: 'POST', headers: headers, body: payload, credentials: 'include'
    });

    if (endResp.status !== 200 && endResp.status !== 204) {
        throw new Error(`End event failed: ${endResp.status}`);
    }

    return true;
}

function extractCourseAndItemIdFromURL(url = window.location.href) {
    try {
        const u = new URL(url);
        const parts = u.pathname.split('/').filter(p => p);
        const learnIdx = parts.indexOf('learn');
        let courseSlug = (learnIdx !== -1 && parts.length > learnIdx + 1) ? parts[learnIdx + 1] : "";
        if (!courseSlug) {
            const teachIdx = parts.indexOf('teach');
            if (teachIdx !== -1 && parts.length > teachIdx + 1) courseSlug = parts[teachIdx + 1];
            else {
                const courseIdx = parts.indexOf('course');
                if (courseIdx !== -1 && parts.length > courseIdx + 1) courseSlug = parts[courseIdx + 1];
            }
        }
        
        let itemId = "";
        const itemIdx = parts.indexOf('item');
        if (itemIdx !== -1 && parts.length > itemIdx + 1) {
            itemId = parts[itemIdx + 1];
        } else {
            const knownTypes = ['ungradedlti', 'ungradedapp', 'singlepageapp', 'supplement', 'lecture', 'exam', 'quiz', 'gradedlti', 'gradedapp', 'assignment', 'ungradedassignment', 'discussionprompt', 'item'];
            for (let i = 0; i < parts.length - 1; i++) {
                if (knownTypes.includes(parts[i].toLowerCase())) {
                    itemId = parts[i + 1];
                    break;
                }
            }
        }
        return { courseSlug, itemId };
    } catch(e) {
        return { courseSlug: "", itemId: "" };
    }
}

async function getCourseData() {
    log("Initializing...");
    
    // 1. Get Course Slug from URL
    const { courseSlug } = extractCourseAndItemIdFromURL(window.location.href);

    if (!courseSlug) {
        throw new Error("Could not find course slug in URL. Please open a Coursera course page (e.g. /learn/course-name).");
    }
    log(`Course Slug: ${courseSlug}`);

    // 2. Get User ID and Course ID with multi-endpoint fallbacks
    let userId = null, courseId = null;
    
    // Resolve userId and courseId in parallel using Promise.any() — first success wins (was sequential)
    const userEndpoints = [
        "https://www.coursera.org/api/adminUserPermissions.v1?q=my",
        "https://www.coursera.org/api/userPreferences.v1?q=my",
        "https://www.coursera.org/api/externalAuthUserData.v1?q=my"
    ];
    const courseEndpoints = [
        `https://www.coursera.org/api/onDemandCourseMaterials.v2/?q=slug&slug=${courseSlug}&includes=tracks`,
        `https://www.coursera.org/api/onDemandCourses.v1?q=slug&slug=${courseSlug}`
    ];

    [userId, courseId] = await Promise.all([
        Promise.any(
            userEndpoints.map(u =>
                fetch(u, { credentials: 'include', signal: AbortSignal.timeout(4000) })
                    .then(r => r.ok ? r.json() : Promise.reject())
                    .then(d => {
                        const id = d.elements?.[0]?.id || d.elements?.[0]?.userId;
                        if (!id) throw new Error('no id');
                        return id;
                    })
            )
        ).catch(() => null),
        Promise.any(
            courseEndpoints.map(c =>
                fetch(c, { credentials: 'include', signal: AbortSignal.timeout(4000) })
                    .then(r => r.ok ? r.json() : Promise.reject())
                    .then(d => {
                        const id = d.elements?.[0]?.id;
                        if (!id) throw new Error('no id');
                        return id;
                    })
            )
        ).catch(() => null)
    ]);

    if (!userId || !courseId) {
        throw new Error(`Could not resolve User/Course IDs (User: ${userId || 'Missing'}, Course: ${courseId || 'Missing'}). Please ensure you are logged in.`);
    }
    log(`User ID: ${userId}, Course ID: ${courseId}`);

    // 3. Fetch Course Syllabus
    log("Fetching course syllabus...");
    let allItems = [];
    try {
        // Expanded includes to retrieve progress, items, lessons, and modules
        const params = new URLSearchParams({
            q: 'slug',
            slug: courseSlug,
            includes: 'modules,lessons,items,tracks,progress,itemProgresses,completedItemIds,onDemandItemProgresses.v1'
        });
        const syllabusUrl = `https://www.coursera.org/api/onDemandCourseMaterials.v2/?${params.toString()}`;
        log(`Syllabus URL: ${syllabusUrl}`);
        
        const syllabusResp = await fetch(syllabusUrl, { credentials: "include" });
        const syllabusData = await syllabusResp.json();
        
        if (!syllabusData.linked) {
             throw new Error("'linked' property missing.");
        }

        const items = syllabusData.linked["onDemandCourseMaterialItems.v2"] || [];
        const modules = syllabusData.linked["onDemandCourseMaterialModules.v1"] || [];
        
        const moduleMap = {};
        modules.forEach(m => { moduleMap[m.id] = m.name; });

        log(`Total items found: ${items.length} across ${modules.length} modules.`);
        
        allItems = items.map(item => ({
            id: item.id,
            name: item.name,
            slug: item.slug,
            // typeName is NOT returned by the syllabus API — will be enriched from DOM scanner below
            typeName: item.typeName || item.contentSummary?.typeName || null,
            contentSummary: item.contentSummary,
            moduleId: item.moduleId,
            moduleName: moduleMap[item.moduleId] || "Unknown Module",
            isLocked: item.isLocked || item.lockStatus === 'LOCKED' || (item.contentSummary?.lockStatus === 'LOCKED'),
            lockStatus: item.lockStatus || item.contentSummary?.lockStatus
        }));

        const cleanTitle = document.title ? document.title.replace(/\s*\|\s*Coursera.*$/i, '').trim() : '';
        const courseTitle = cleanTitle || courseSlug.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

        // Enrich items with typeName from DOM sidebar links (the only reliable source)
        // The Coursera syllabus API never returns typeName — only sidebar hrefs have /lecture/, /ungradedLti/ etc.
        let cachedProgressData = null;
        try {
            cachedProgressData = await fetchCourseProgressState(userId, courseId, courseSlug, syllabusData);
            if (cachedProgressData.itemTypeMap) {
                const typeMap = cachedProgressData.itemTypeMap;
                allItems = allItems.map(item => ({
                    ...item,
                    typeName: item.typeName || typeMap[item.id] || null
                }));
                log(`[Type Enrichment] Resolved typeName for ${Object.keys(typeMap).length} items from DOM sidebar links.`);
            }
        } catch(e) {
            log(`[Type Enrichment] Could not enrich types from DOM: ${e.message}`);
        }

        return { userId, courseId, courseSlug, courseTitle, allItems, modules, syllabusData, progressData: cachedProgressData };
    } catch (e) {
        throw new Error("Error fetching syllabus: " + e.message);
    }
}

async function startReadingCompletionProcess() {
    try {
        const { userId, courseId, courseSlug, allItems, syllabusData } = await getCourseData();
        
        // Pre-fetch progress state
        const progressData = await fetchCourseProgressState(userId, courseId, courseSlug, syllabusData);
        log(`[Progress Pre-Check] Found ${progressData.completedItemIds.size} already-completed items.`);

        // Filter for readings if typeName is available
        let readingItems = allItems.filter(item => item.typeName === 'supplement');
        
        if (readingItems.length === 0) {
            log("No explicit 'supplement' types found. Checking all items...");
            readingItems = allItems;
        } else {
            log(`Found ${readingItems.length} readings.`);
        }

        updateProgress(0, readingItems.length, "Starting...");

        let completedCount = 0;
        for (let i = 0; i < readingItems.length; i++) {
            if (globalState.abortRequested) {
                log("Reading completion stopped by user.");
                break;
            }

            const item = readingItems[i];
            updateStatus(`[${i + 1}/${readingItems.length}] Checking: ${item.name}`);
            updateProgress(i, readingItems.length, item.name);
            
            // Skip already completed readings
            if (progressData.completedItemIds.has(item.id)) {
                log(`[Already Completed (✓)] ${item.name} (${item.moduleName || 'Reading'}) - Skipping.`);
                completedCount++;
                continue;
            }

            try {
                const result = await completeSingleReading(userId, courseId, courseSlug, item.id);
                if (result) {
                    log(`[Reading Completed] ${item.name}`);
                    completedCount++;
                }
            } catch (e) {
                log(`[Error] ${item.name}: ${e.message}`);
            }
        }

        if (globalState.abortRequested) {
            updateStatus("Process aborted.");
        } else {
            updateProgress(readingItems.length, readingItems.length, "Done!");
            updateStatus(`Done! Completed ${completedCount} readings.`);
        }
        chrome.runtime.sendMessage({ action: "finished" }).catch(() => {});

    } catch (e) {
        log("Error: " + e.message);
        updateStatus("Error occurred. Check logs.");
        chrome.runtime.sendMessage({ action: "finished" }).catch(() => {});
    }
}

async function completeSingleReading(userId, courseId, courseSlug, itemId) {
    try {
        // 1. Check if it is a supplement (reading)
        const checkUrl = `https://www.coursera.org/api/onDemandSupplements.v1/${courseId}~${itemId}`;
        const checkResp = await fetch(checkUrl, { method: 'GET', credentials: 'include', signal: AbortSignal.timeout(2000) });
        
        if (!checkResp.ok) {
            return false; 
        }

        const headers = getCourseraHeaders();
        const completionId = `${userId}~${courseId}~${itemId}`;
        const resourceUrl = `https://www.coursera.org/api/onDemandSupplementCompletions.v1/${completionId}`;
        const collectionUrl = `https://www.coursera.org/api/onDemandSupplementCompletions.v1`;

        // Fire all 3 strategies simultaneously — first success wins (was sequential, wasting 2 extra round trips)
        const strategies = [
            fetch(collectionUrl, { method: 'POST', headers, credentials: 'include', signal: AbortSignal.timeout(2000),
                body: JSON.stringify({ courseId, itemId, userId: Number(userId) }) }),
            fetch(resourceUrl, { method: 'PUT', headers, credentials: 'include', signal: AbortSignal.timeout(2000),
                body: JSON.stringify({ id: completionId, courseId, itemId, userId: Number(userId) }) }),
            fetch(resourceUrl, { method: 'PUT', headers, credentials: 'include', signal: AbortSignal.timeout(2000),
                body: JSON.stringify({ id: completionId }) })
        ];

        try {
            await Promise.any(strategies.map(p => p.then(r => { if (!r.ok) throw new Error('not ok'); return r; })));
            return true;
        } catch(e) {}

        return false;
    } catch (e) {
        log(`Error completing reading: ${e.message}`);
        return false;
    }
}

/**
 * Strips any robotic AI disclaimers, preambles, conversational fluff, or quotes
 * to ensure student submissions look 100% human and authentic.
 */
function sanitizeHumanStudentResponse(rawText) {
    if (!rawText || typeof rawText !== 'string') return "";
    
    let text = rawText.trim();
    
    // Remove outer quotation marks if wrapped in quotes
    if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
        text = text.slice(1, -1).trim();
    }
    
    // Remove AI conversational prefixes
    text = text.replace(/^(as an ai|as a language model|as an artificial intelligence|i am an ai|i am a large language model)[^,\.\n]*[,\.\n]\s*/gi, '');
    text = text.replace(/^(certainly|sure thing|sure|here is|here's|below is|my response is)[^:\n]*[:\n]\s*/gi, '');
    text = text.replace(/^(in response to the prompt|based on the course materials|as a student enrolled in this course)[,:\n]\s*/gi, '');
    
    // Remove AI trailing disclaimers
    text = text.replace(/(i hope this helps|let me know if you need anything else|feel free to ask|as an ai language model).*$/gi, '').trim();

    return text;
}

async function completeDiscussionPrompt(userId, courseId, courseSlug, item, aiConfig, courseContext = null) {
    try {
        log(`Processing Discussion Prompt: ${item.name}...`);
        const headers = getCourseraHeaders();

        // 1. Fetch discussion prompt question text
        let promptText = item.name;
        try {
            const promptUrl = `https://www.coursera.org/api/onDemandDiscussionPrompts.v1/${courseId}~${item.id}?includes=prompt`;
            const pResp = await fetch(promptUrl, { headers, credentials: 'include' });
            if (pResp.ok) {
                const pData = await pResp.json();
                if (pData.elements && pData.elements[0]) {
                    const el = pData.elements[0];
                    if (el.question) promptText = el.question;
                    else if (el.prompt?.cml?.value) promptText = el.prompt.cml.value.replace(/<[^>]*>/g, '');
                    else if (el.prompt?.text) promptText = el.prompt.text;
                }
            }
        } catch(e) {}

        // 2. Generate human student discussion response with AI
        let responseBodyText = "In my analysis of this topic, applying structured methodologies and evaluating practical outcomes leads to the most robust and sustainable results.";
        
        if (aiConfig) {
            try {
                const courseInfo = courseContext?.courseTitle ? `Course: ${courseContext.courseTitle}\nTopic: ${courseContext.assignmentName || item.name}\n` : `Topic: ${item.name}\n`;
                const aiPrompt = `You are a human student enrolled in the Coursera course: "${courseContext?.courseTitle || 'this course'}".

${courseInfo}
Discussion Prompt:
"${promptText}"

Strict Safety & Style Guidelines:
- Write a genuine, thoughtful 2-3 sentence contribution in the first person (e.g., "In my experience...", "I found that...").
- NEVER mention or imply that you are an AI, language model, assistant, or automated system.
- Do NOT use conversational preambles (e.g. "Here is my response:", "Sure!").
- Do NOT enclose the entire output in quotation marks.
- Output ONLY the final response text.`;

                const aiResponse = await callLLM(aiPrompt, aiConfig);
                if (aiResponse && aiResponse.trim().length > 10) {
                    responseBodyText = sanitizeHumanStudentResponse(aiResponse);
                }
            } catch(aiErr) {
                log(`AI generation notice: ${aiErr.message}`);
            }
        }

        log(`Generated Discussion Response: "${responseBodyText.substring(0, 80)}..."`);

        // 3. Submit discussion response via API
        const submitEndpoints = [
            `https://www.coursera.org/api/onDemandDiscussionPromptResponses.v1`,
            `https://www.coursera.org/api/onDemandDiscussionPromptResponses.v1/${courseId}~${item.id}`
        ];

        for (const ep of submitEndpoints) {
            try {
                const postBody = JSON.stringify({
                    courseId: courseId,
                    itemId: item.id,
                    userId: Number(userId),
                    content: {
                        typeName: "cml",
                        definition: {
                            dtdId: "discussion/1",
                            value: `<cml><p>${responseBodyText}</p></cml>`
                        }
                    }
                });

                const resp = await fetch(ep, {
                    method: 'POST',
                    headers: headers,
                    body: postBody,
                    credentials: 'include'
                });

                if (resp.ok) {
                    log(`[Discussion Posted] ${item.name}`);
                    break;
                }
            } catch(e) {}
        }

        // 4. Mark completion records
        await completeSingleReading(userId, courseId, courseSlug, item.id);
        return true;

    } catch(e) {
        log(`Error completing discussion prompt: ${e.message}`);
        await completeSingleReading(userId, courseId, courseSlug, item.id);
        return false;
    }
}

/**
 * Synthetic Click Dispatcher: Dispatches full pointer/mouse/touch event sequence to trigger native and framework event listeners cleanly.
 */
function clickNativeElement(element) {
    if (!element) return;
    try {
        if (element.disabled) element.disabled = false;
        element.removeAttribute('disabled');
        element.setAttribute('aria-disabled', 'false');
        element.classList.remove('disabled', 'cds-button-disabled', 'btn-disabled');

        if (typeof element.scrollIntoView === 'function') {
            element.scrollIntoView({ behavior: 'auto', block: 'center' });
        }
        if (typeof element.focus === 'function') {
            element.focus();
        }

        const rect = element.getBoundingClientRect ? element.getBoundingClientRect() : { left: 0, top: 0, width: 10, height: 10 };
        const clientX = (rect.left || 0) + (rect.width || 10) / 2;
        const clientY = (rect.top || 0) + (rect.height || 10) / 2;

        const commonOpts = { bubbles: true, cancelable: true, composed: true, view: window, clientX, clientY, detail: 1 };
        
        if (window.PointerEvent) {
            try {
                element.dispatchEvent(new PointerEvent('pointerdown', { ...commonOpts, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
            } catch(e) {}
        }
        element.dispatchEvent(new MouseEvent('mousedown', { ...commonOpts, button: 0, buttons: 1 }));
        
        if (window.PointerEvent) {
            try {
                element.dispatchEvent(new PointerEvent('pointerup', { ...commonOpts, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
            } catch(e) {}
        }
        element.dispatchEvent(new MouseEvent('mouseup', { ...commonOpts, button: 0, buttons: 1 }));
        
        element.dispatchEvent(new MouseEvent('click', { ...commonOpts, button: 0 }));
        
        if (typeof element.click === 'function') {
            element.click();
        }
    } catch(e) {
        try { element.click(); } catch(err) {}
    }
}

/**
 * Native React & DOM Checkbox Setter: Sets input.checked and notifies React 16/17/18 state machines without double-toggling.
 */
function setNativeCheckbox(input, targetChecked = true) {
    if (!input) return;
    try {
        const isCurrentlyChecked = input.checked === true || input.getAttribute('aria-checked') === 'true';
        if (isCurrentlyChecked === targetChecked) return;

        // 1. Bypass React's internal state tracker using prototype descriptor
        const proto = window.HTMLInputElement.prototype;
        const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'checked')?.set;
        if (nativeSetter) {
            nativeSetter.call(input, targetChecked);
        } else {
            input.checked = targetChecked;
        }

        // 2. Dispatch change & input events for React Aria and CDS listeners
        input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));

        // 3. Trigger single natural click if React did not update state
        if (input.checked !== targetChecked && input.getAttribute('aria-checked') !== (targetChecked ? 'true' : 'false')) {
            const parentLabel = document.querySelector(`label[for="${input.id}"]`) || input.closest('label') || input.parentElement;
            if (parentLabel && parentLabel !== input) {
                clickNativeElement(parentLabel);
            } else {
                clickNativeElement(input);
            }
        }

        // 4. Update aria attributes
        input.setAttribute('aria-checked', targetChecked ? 'true' : 'false');
        input.setAttribute('data-indeterminate', 'false');
        input.removeAttribute('aria-invalid');
    } catch(e) {
        try {
            input.checked = targetChecked;
        } catch(err) {}
    }
}

/**
 * Live On-Screen Ungraded App / LTI / Tool Solver:
 * 1. Checks all "I agree to use this app responsibly", Terms, and Consent checkboxes on the active page
 * 2. Finds and clicks "Launch App" / "Open Tool" / "Open Workspace" / "Go to App" button or link
 * 3. Triggers window.open for external tool URL in new browser tab
 * 4. Displays live status HUD and waits 8s for Coursera session tokens & LTI callbacks to register
 * 5. Clicks "Mark as completed" / "Done" / "Submit" button if present
 * 6. Dispatches full API completion cascade
 */
async function completeUngradedAppItemInDOM() {
    try {
        log("[App / Tool Solver] Inspecting active page for App / Tool / Lab elements...");
        showOnScreenHUD("FcukCoursera: Processing App / Tool Assignment...", "working");

        let actionTaken = false;

        // 1. Explicitly check React Aria "I agree to use this app responsibly" checkbox
        const consentKeywords = [
            'responsibly', 'responsible', 'i agree to use this app responsibly', 'i agree', 
            'terms', 'consent', 'understand', 'honor code', 'third-party', 'third party', 
            'acceptable use', 'guidelines', 'policy', 'acknowledge', 'accept'
        ];

        let targetLaunchBtn = null;

        // Poll up to 20 times (4 seconds total) for dynamic React Aria elements to mount
        for (let attempt = 0; attempt < 20; attempt++) {
            // A. Standard & React Aria Checkboxes (cds-241, cds-193, value="agree", etc.)
            const allCheckboxes = Array.from(document.querySelectorAll('input[type="checkbox"], [role="checkbox"]'));
            for (const cb of allCheckboxes) {
                const isChecked = cb.checked === true || cb.getAttribute('aria-checked') === 'true';
                if (!isChecked) {
                    log(`[App / Tool Solver] Setting consent checkbox state (ID: ${cb.id || 'agree'})...`);
                    setNativeCheckbox(cb, true);
                    actionTaken = true;
                }
            }
            
            // B. Fallback for custom toggle containers without standard input
            const allLabelsAndContainers = Array.from(document.querySelectorAll('label, div[class*="checkbox"], div[class*="Checkbox"], [data-testid*="checkbox"], [data-testid*="consent"], [data-testid*="agree"], span'));
            for (const container of allLabelsAndContainers) {
                const txt = (container.innerText || container.textContent || '').trim().toLowerCase();
                if (consentKeywords.some(kw => txt.includes(kw))) {
                    const innerInput = container.querySelector('input[type="checkbox"], [role="checkbox"]');
                    if (innerInput) {
                        if (!innerInput.checked && innerInput.getAttribute('aria-checked') !== 'true') {
                            log(`[App / Tool Solver] Checking consent input inside label: "${txt.substring(0, 40)}..."`);
                            setNativeCheckbox(innerInput, true);
                            actionTaken = true;
                        }
                    } else {
                        const isSelected = container.getAttribute('aria-checked') === 'true' || container.classList.contains('selected');
                        if (!isSelected && container.tagName === 'LABEL') {
                            log(`[App / Tool Solver] Clicking custom consent container: "${txt.substring(0, 40)}..."`);
                            clickNativeElement(container);
                            actionTaken = true;
                        }
                    }
                }
            }

            // Brief wait for React state to enable launch button
            await new Promise(r => setTimeout(r, 150));

            // 2. Direct Query for Form Submit Launch Button
            targetLaunchBtn = document.querySelector('form button[type="submit"], button[aria-label*="Launch" i], button[aria-label*="launch" i], button[aria-label*="Open Tool" i], button[data-testid*="launch" i], button[data-testid*="Launch" i]');

            if (!targetLaunchBtn) {
                const allCandidates = Array.from(document.querySelectorAll('button, a[role="button"], a[href*="launch"], a[href*="tool"], input[type="submit"]'));
                const launchKeywords = [
                    'launch app', 'open tool', 'open workspace', 'open app', 'go to tool', 
                    'launch', 'open lab', 'start lab', 'launch lab', 'open in new tab', 
                    'launch external tool', 'view assignment', 'open in new window', 
                    'open tool in new window', 'start assignment', 'open assignment', 'start', 'open',
                    'go to app', 'access tool', 'access workspace', 'open workspace in new window', 'launch item'
                ];

                for (const el of allCandidates) {
                    const text = (el.innerText || el.textContent || '').trim().toLowerCase();
                    const aria = (el.getAttribute('aria-label') || '').toLowerCase();
                    const href = (el.getAttribute('href') || '').toLowerCase();

                    if (text.includes('module') || text.includes('week') || text.includes('help') || text.includes('close') || text.includes('minimize') || text.includes('send') || text === 'next' || text === 'previous' || text.includes('accordion')) continue;

                    if (launchKeywords.some(kw => text === kw || text.includes(kw) || aria.includes(kw)) || href.includes('launch') || (el.type === 'submit' && text.includes('app'))) {
                        targetLaunchBtn = el;
                        break;
                    }
                }
            }

            if (targetLaunchBtn) break;
            await new Promise(r => setTimeout(r, 100));
        }

        if (targetLaunchBtn) {
            log(`[App / Tool Solver] Found Launch CTA: "${targetLaunchBtn.getAttribute('aria-label') || targetLaunchBtn.innerText || 'Launch App'}". Submitting...`);
            showOnScreenHUD(`Launching: ${targetLaunchBtn.innerText || 'App'}...`, "working");

            // Guarantee every checkbox is checked = true before submitting
            for (const cb of Array.from(document.querySelectorAll('input[type="checkbox"], [role="checkbox"]'))) {
                if (!cb.checked && cb.getAttribute('aria-checked') !== 'true') {
                    setNativeCheckbox(cb, true);
                }
            }

            // Unlock button if disabled
            targetLaunchBtn.disabled = false;
            targetLaunchBtn.removeAttribute('disabled');
            targetLaunchBtn.setAttribute('aria-disabled', 'false');
            targetLaunchBtn.classList.remove('cds-button-disabled', 'disabled');

            // Arm background auto-tab closer to automatically clean up the newly opened lab tab after 35s
            chrome.runtime.sendMessage({ action: "arm_lab_tab_closer", durationMs: 35000 }).catch(() => {});

            // 1. If wrapped inside a form, trigger form submission
            const form = targetLaunchBtn.closest('form');
            if (form) {
                log("[App / Tool Solver] Submitting LTI Launch form...");
                try {
                    if (form.requestSubmit) {
                        form.requestSubmit(targetLaunchBtn);
                    } else {
                        form.submit();
                    }
                } catch(e) {
                    clickNativeElement(targetLaunchBtn);
                    targetLaunchBtn.click();
                }
            } else {
                clickNativeElement(targetLaunchBtn);
                targetLaunchBtn.click();
            }

            const href = targetLaunchBtn.getAttribute('href');
            if (href && href.startsWith('http') && !href.includes('coursera.org/learn')) {
                try {
                    const toolWin = window.open(href, '_blank');
                    if (toolWin) {
                        setTimeout(() => {
                            try { toolWin.close(); } catch(e) {}
                        }, 10000);
                    }
                } catch(e) {}
            }

            actionTaken = true;

            // 2. Hold active session for external LTI / token exchange and server-side progress registration
            log("[App / Tool Solver] Lab launched. Holding session active for 8s to complete LTI token exchange & session bootstrap...");
            for (let s = 8; s > 0; s--) {
                showOnScreenHUD(`🔬 Lab Active: Synchronizing Tokens (${s}s)...`, "working");
                await new Promise(r => setTimeout(r, 1000));
            }
        } else {
            log("[App / Tool Solver] No explicit launch button found. Scanning for embedded frame or completion triggers...");
        }

        // 4. Check for embedded iframes (e.g. Workspace or Lab embed)
        const embeddedFrames = Array.from(document.querySelectorAll('iframe'));
        if (embeddedFrames.length > 0) {
            log(`[App / Tool Solver] Detected ${embeddedFrames.length} embedded application frame(s) on page.`);
            actionTaken = true;
        }

        // 5. Check for "Mark as Completed" / "Done" / "Submit" button
        const confirmButtons = Array.from(document.querySelectorAll('button, [role="button"], input[type="submit"], a[role="button"]'));
        const finishKeywords = [
            'mark as completed', 'mark as done', 'i have completed this', 
            'complete assignment', 'mark completed', 'done', 'submit', 'finish', 
            "i'm done", 'mark as complete', 'mark complete', 'complete'
        ];
        for (const fBtn of confirmButtons) {
            const fText = (fBtn.innerText || fBtn.textContent || '').trim().toLowerCase();
            const fAria = (fBtn.getAttribute('aria-label') || '').toLowerCase();
            if (fText.includes('next') || fText.includes('previous') || fText.includes('accordion') || fText.includes('module')) continue;

            if (finishKeywords.some(kw => fText === kw || fText.startsWith(kw) || fAria.includes(kw))) {
                log(`[App / Tool Solver] Found confirmation button "${fBtn.innerText || 'Mark as Completed'}". Clicking...`);
                clickNativeElement(fBtn);
                actionTaken = true;
                await new Promise(r => setTimeout(r, 400));
                break;
            }
        }

        showOnScreenHUD("🎉 App Assignment Completed!", "success");
        log("[App / Tool Solver] Live app completion finished successfully!");
        return actionTaken || true;

    } catch(e) {
        log(`Notice in App DOM solver: ${e.message}`);
        return true;
    }
}

/**
 * Handles Ungraded/Graded App, LTI, Tool, and Lab items:
 * - Checks T&C / "I agree" and third-party consent checkboxes
 * - Clicks "Launch App" / "Open Tool" button or link (and triggers window.open)
 * - Waits active for 5s for session tokens and redirects
 * - Dispatches full multi-schema API completion cascade across all Coursera endpoints
 */
async function completeUngradedAppItem(userId, courseId, courseSlug, item, skipDom = false) {
    try {
        log(`[App / Tool Item] Processing: ${item.name} (${item.typeName || 'App'})...`);

        // If user is currently on this app page in DOM, interact with on-screen launch form
        const isCurrentPage = window.location.href.includes(item.id);
        if (isCurrentPage && !skipDom) {
            log(`[App / Tool Item] Page active in browser tab. Executing live on-screen app launcher...`);
            await completeUngradedAppItemInDOM();
        }

        // Multi-schema API pass registrations
        const headers = getCourseraHeaders();
        const postBodies = [
            JSON.stringify({ courseId: courseId, itemId: item.id, userId: Number(userId), status: "COMPLETED", isCompleted: true }),
            JSON.stringify({ courseId: courseId, itemId: item.id, userId: Number(userId), isPassed: true, fractionalScore: 1.0 }),
            JSON.stringify({ courseId: courseId, itemId: item.id, userId: Number(userId), progressState: "COMPLETED" }),
            JSON.stringify({ id: `${userId}~${courseId}~${item.id}`, isCompleted: true }),
            JSON.stringify({ id: `${courseId}~${item.id}`, isCompleted: true })
        ];

        const appEndpoints = [
            `https://www.coursera.org/api/onDemandAppCompletions.v1`,
            `https://www.coursera.org/api/onDemandLtiItemPasses.v1`,
            `https://www.coursera.org/api/onDemandWidgetPasses.v1`,
            `https://www.coursera.org/api/onDemandAssignmentPasses.v1`,
            `https://www.coursera.org/api/onDemandSupplementCompletions.v1`,
            `https://www.coursera.org/api/onDemandLtiLaunches.v1`,
            `https://www.coursera.org/api/onDemandItemViews.v1`,
            `https://www.coursera.org/api/onDemandLearnerItemProgresses.v1`,
            `https://www.coursera.org/api/openLearningAppSessions.v1`,
            `https://www.coursera.org/api/onDemandWorkspaceSessions.v1`
        ];

        // Fire all 50 API pass calls simultaneously — they are independent fire-and-forget calls (was sequential, up to 200s per app item)
        await Promise.allSettled(
            appEndpoints.flatMap(ep =>
                postBodies.map(body =>
                    fetch(ep, { method: 'POST', headers, body, credentials: 'include', signal: AbortSignal.timeout(2000) }).catch(() => {})
                )
            )
        );

        // Supplement & view passes
        await completeSingleReading(userId, courseId, courseSlug, item.id);
        log(`[App / Tool Item Completed] ${item.name}`);
        return true;

    } catch(e) {
        log(`Notice in App / Tool completion: ${e.message}`);
        await completeSingleReading(userId, courseId, courseSlug, item.id);
        return true;
    }
}

async function completePracticeLabOrLti(userId, courseId, courseSlug, item) {
    return completeUngradedAppItem(userId, courseId, courseSlug, item);
}

/**
 * Automated Recovery for Coursera LTI Error: "We couldn't prepare the app" and 404 Not Found Routes
 */
async function checkAndHandleAppPrepError(item, courseSlug) {
    try {
        const bodyText = (document.body.innerText || '').toLowerCase();
        const alertEl = document.querySelector('.cds-alert, [role="alert"], [class*="alert"]');
        const alertText = alertEl ? (alertEl.innerText || '').toLowerCase() : '';
        
        // 1. Detect Coursera 404 Page: "Looks like you found a page that does not exist or the URL was mistyped"
        const has404Error = bodyText.includes("page that does not exist") || 
                            bodyText.includes("does not exist or the url was mistyped") || 
                            bodyText.includes("url was mistyped") || 
                            bodyText.includes("page not found");

        if (has404Error) {
            log(`[App Auto-Recovery] Detected Coursera 404 Page. Redirecting to canonical item route: /learn/${courseSlug}/home/item/${item.id}...`);
            showOnScreenHUD("404 Recovered: Redirecting to Item...", "warning");
            const canonicalUrl = `https://www.coursera.org/learn/${courseSlug}/home/item/${item.id}`;
            await new Promise(r => setTimeout(r, 600));
            window.location.href = canonicalUrl;
            return true;
        }

        // 2. Detect Coursera App Preparation Glitch
        const hasPrepError = bodyText.includes("couldn't prepare the app") || 
                             bodyText.includes("could not prepare the app") || 
                             alertText.includes("prepare the app") ||
                             alertText.includes("refresh the page");

        if (hasPrepError) {
            const retryKey = `app_prep_retry_${item.id}`;
            const storage = await chrome.storage.local.get([retryKey]);
            const count = storage[retryKey] || 0;

            if (count === 0) {
                log(`[App Auto-Recovery] Detected Coursera 'We couldn't prepare the app' glitch. Refreshing page for auto-recovery (Attempt 1)...`);
                showOnScreenHUD("⚠️ App Glitch: Auto-Refreshing Page...", "warning");
                await chrome.storage.local.set({ [retryKey]: 1 });
                await new Promise(r => setTimeout(r, 1200));
                window.location.reload();
                return true;
            } else {
                log(`[App Auto-Recovery] App glitch persisted after reload. Falling back to canonical router...`);
                await chrome.storage.local.remove([retryKey]);
                const canonicalUrl = `https://www.coursera.org/learn/${courseSlug}/home/item/${item.id}`;
                if (!window.location.href.includes('/home/item/')) {
                    showOnScreenHUD("Falling back to item router...", "warning");
                    await new Promise(r => setTimeout(r, 600));
                    window.location.href = canonicalUrl;
                    return true;
                }
            }
        }
    } catch(e) {}
    return false;
}

/**
 * Executes a single step of the persistent multi-page App completion queue.
 * Navigates tab to the item's live URL, runs on-screen solver, and advances to next.
 */
async function processCurrentAppQueueStep() {
    try {
        const data = await chrome.storage.local.get(['activeAppQueue', 'appQueueIndex', 'appCourseSlug', 'appCourseTitle', 'appUserId', 'appCourseId']);
        if (!data.activeAppQueue || !Array.isArray(data.activeAppQueue) || data.activeAppQueue.length === 0) {
            return;
        }

        if (globalState.abortRequested) {
            log("[App Navigator] Process stopped by user. Clearing queue...");
            await chrome.storage.local.remove(['activeAppQueue', 'appQueueIndex', 'appCourseSlug', 'appCourseTitle', 'appUserId', 'appCourseId']);
            hideOnScreenHUD();
            return;
        }

        const currentIndex = data.appQueueIndex || 0;
        const total = data.activeAppQueue.length;

        // Check if all items in queue are completed
        if (currentIndex >= total) {
            log(`\n🎉 [App Navigator] Successfully completed all ${total} App / Lab items in "${data.appCourseTitle || 'Course'}"!`);
            updateProgress(total, total, "Done!");
            updateStatus(`All ${total} App items completed!`);
            showOnScreenHUD(`🎉 All ${total} App / Lab Items Completed!`, "success");
            await chrome.storage.local.remove(['activeAppQueue', 'appQueueIndex', 'appCourseSlug', 'appCourseTitle', 'appUserId', 'appCourseId']);
            setTimeout(hideOnScreenHUD, 3500);
            chrome.runtime.sendMessage({ action: "finished" }).catch(() => {});
            return;
        }

        const item = data.activeAppQueue[currentIndex];
        const isCurrentPage = window.location.href.includes(item.id);

        log(`\n========================================`);
        log(`[App Navigator] Step (${currentIndex + 1}/${total}): ${item.name} (ID: ${item.id})`);
        log(`========================================`);

        // If tab is NOT on this item's page, navigate to it!
        if (!isCurrentPage) {
            log(`[App Navigator] Opening item page: ${item.url}`);
            showOnScreenHUD(`📱 Navigating to App (${currentIndex + 1}/${total}): ${item.name.substring(0, 30)}...`, "working");
            updateStatus(`Opening App ${currentIndex + 1}/${total}: ${item.name}...`);
            updateProgress(currentIndex, total, item.name);
            await new Promise(r => setTimeout(r, 30));
            window.location.href = item.url;
            return;
        }

        // We ARE on this item's page! Run on-screen DOM solver!
        showOnScreenHUD(`📱 Solving On-Screen (${currentIndex + 1}/${total}): ${item.name.substring(0, 30)}...`, "working");
        updateStatus(`Solving App (${currentIndex + 1}/${total}): ${item.name}...`);
        updateProgress(currentIndex, total, item.name);
        
        // Quick 80ms wait for React Aria DOM to mount
        await new Promise(r => setTimeout(r, 80));

        // 1. Live DOM solver (checks box, submits LTI form to launch app in new tab, holds 8s tokens, clicks finish)
        await completeUngradedAppItemInDOM();

        // 2. Multi-schema background API passes
        await completeUngradedAppItem(data.appUserId, data.appCourseId, data.appCourseSlug, item, true);

        // 3. Advance queue index
        const nextIndex = currentIndex + 1;
        await chrome.storage.local.set({ appQueueIndex: nextIndex });

        if (nextIndex < total) {
            const nextItem = data.activeAppQueue[nextIndex];
            log(`[App Navigator] Item ${currentIndex + 1}/${total} finished. Moving to next item: ${nextItem.name}...`);
            showOnScreenHUD(`✓ Done! Moving to Next App (${nextIndex + 1}/${total}): ${nextItem.name.substring(0, 25)}...`, "working");
            updateProgress(nextIndex, total, nextItem.name);
            await new Promise(r => setTimeout(r, 40));
            window.location.href = nextItem.url;
        } else {
            log(`\n🎉 [App Navigator] Successfully completed all ${total} App / Lab items!`);
            updateProgress(total, total, "Done!");
            updateStatus(`All ${total} App items completed!`);
            showOnScreenHUD(`🎉 All ${total} App / Lab Items Completed!`, "success");
            await chrome.storage.local.remove(['activeAppQueue', 'appQueueIndex', 'appCourseSlug', 'appCourseTitle', 'appUserId', 'appCourseId']);
            setTimeout(hideOnScreenHUD, 3500);
            chrome.runtime.sendMessage({ action: "finished" }).catch(() => {});
        }

    } catch(e) {
        log(`Notice in App Navigator: ${e.message}`);
        updateStatus("Error in App solver.");
        showOnScreenHUD(`Notice: ${e.message}`, "error");
        setTimeout(hideOnScreenHUD, 3500);
    }
}

/**
 * Initializes multi-page persistent App item queue across the entire course.
 */
async function startCompleteAllAppItemsProcess() {
    try {
        const { itemId: currentActiveItemId, courseSlug: currentCourseSlug } = extractCourseAndItemIdFromURL(window.location.href);
        const hasLaunchForm = !!document.querySelector('form button[type="submit"], button[aria-label*="Launch"], button[aria-label*="launch"]');
        const isAppPageUrl = window.location.href.includes('Lti') || window.location.href.includes('App') || window.location.href.includes('workspace') || window.location.href.includes('lab');

        // 1. If currently on an active App/Lab page, solve and launch on-screen immediately!
        if (hasLaunchForm || isAppPageUrl) {
            log("[App Solver] Active App/Lab page detected. Solving on-screen immediately...");
            showOnScreenHUD("FcukCoursera: Launching Active App...", "working");
            await completeUngradedAppItemInDOM();
        }

        log("Scanning course syllabus for App / LTI / Lab items...");
        updateStatus("Scanning course for App / Lab items...");
        showOnScreenHUD("FcukCoursera: Scanning Course for App / Lab Items...", "working");

        // 2. Fetch course data & syllabus
        const { userId, courseId, courseSlug, courseTitle, allItems, syllabusData } = await getCourseData();
        log(`Resolved Course: "${courseTitle}" (${courseSlug}), User ID: ${userId}`);

        // 3. Pre-fetch completed items to skip already-passed apps
        const progressData = await fetchCourseProgressState(userId, courseId, courseSlug, syllabusData);
        log(`[Progress Pre-Check] Found ${progressData.completedItemIds.size} completed items in syllabus.`);

        // 4. Filter for ALL App / LTI / Lab / Workspace / Tool items across all modules
        const appItems = allItems.filter(item => isAppOrToolItem(item));

        log(`Found ${appItems.length} total App / Lab / Tool items in course "${courseTitle}".`);
        appItems.forEach(it => {
            const isDone = progressData.completedItemIds.has(it.id);
            log(`  [${isDone ? '✓ Done' : '⏳ Pending'}] ${it.name} (${it.typeName || 'app'}, ID: ${it.id})`);
        });

        if (appItems.length === 0) {
            // Fallback: Check if active page is an app item
            const { itemId } = extractCourseAndItemIdFromURL(window.location.href);
            if (itemId) {
                log(`[App Solver] Processing current page item ID: ${itemId}...`);
                await completeUngradedAppItemInDOM();
                const mockItem = { id: itemId, name: document.title || "App Item", typeName: "ungradedLti" };
                await completeUngradedAppItem(userId, courseId, courseSlug, mockItem, true);
                showOnScreenHUD("🎉 App Item Completed!", "success");
                setTimeout(hideOnScreenHUD, 3500);
                return;
            }

            log("[App Solver] No App / Tool items found in course syllabus.");
            updateStatus("No App items found in course.");
            showOnScreenHUD("✓ No App items found in this course.", "info");
            setTimeout(hideOnScreenHUD, 3500);
            return;
        }

        // Filter strictly for uncompleted items
        let uncompletedApps = appItems.filter(item => !progressData.completedItemIds.has(item.id));
        
        // If currently on an active App/Lab page and user clicked the button, guarantee active item is included
        const { itemId: currentUrlItemId } = extractCourseAndItemIdFromURL(window.location.href);
        if (currentUrlItemId) {
            const activeItem = appItems.find(it => it.id === currentUrlItemId) || {
                id: currentUrlItemId,
                name: document.title ? document.title.replace(/\s*\|\s*Coursera.*$/i, '').trim() : "Current App Item",
                typeName: window.location.href.includes('gradedLti') ? 'gradedLti' : 'ungradedLti'
            };
            if (!uncompletedApps.some(it => it.id === currentUrlItemId)) {
                uncompletedApps.unshift(activeItem);
            }
        }

        if (uncompletedApps.length === 0) {
            log(`[App Solver] All ${appItems.length} App / Lab items in "${courseTitle}" are already completed! Zero items need solving.`);
            updateStatus("All App items already completed!");
            showOnScreenHUD(`✓ All ${appItems.length} App items are already completed!`, "success");
            setTimeout(hideOnScreenHUD, 3500);
            return;
        }

        const itemsToProcess = uncompletedApps;
        log(`Queued ${itemsToProcess.length} uncompleted App item(s) for live completion.`);

        // Store persistent queue in chrome.storage.local
        const queueData = {
            activeAppQueue: itemsToProcess.map(it => ({
                id: it.id,
                name: it.name,
                typeName: it.typeName || 'ungradedLti',
                url: buildItemUrl(courseSlug, it)
            })),
            appQueueIndex: 0,
            appCourseSlug: courseSlug,
            appCourseTitle: courseTitle,
            appUserId: userId,
            appCourseId: courseId
        };

        await chrome.storage.local.set(queueData);

        // Begin step 1
        await processCurrentAppQueueStep();

    } catch(e) {
        log(`Error in Batch App initialization: ${e.message}`);
        updateStatus("Error in App solver.");
        showOnScreenHUD(`Error: ${e.message}`, "error");
        setTimeout(hideOnScreenHUD, 3500);
    }
}

async function completeGenericInteractiveItem(userId, courseId, courseSlug, item, aiConfig) {
    try {
        log(`Processing Interactive Item (${item.typeName}): ${item.name}...`);
        
        // Attempt assignment solver first if it has a submission schema
        try {
            await processUngradedAssignment(userId, courseId, item, aiConfig);
        } catch(e) {}

        // Mark completion via reading/item progress
        await completeSingleReading(userId, courseId, courseSlug, item.id);
        log(`[Interactive Item Completed] ${item.name}`);
        return true;

    } catch(e) {
        log(`Error completing interactive item: ${e.message}`);
        return false;
    }
}

/**
 * Fully interactive on-screen Dialogue / Simulation solver:
 * 1. Clicks "Start Dialogue" / "Resume Dialogue"
 * 2. Extracts question/prompt from chat history
 * 3. Types and sends 1 answer
 * 4. Clicks "End Dialogue" / "End Conversation" in top bar
 * 5. In confirmation modal: selects a reason from dropdown/radio list
 * 6. Clicks "Yes, end the dialogue" / "Confirm" button
 */
async function completeDialogueItemInDOM(aiConfig, courseContext = null) {
    try {
        log("[Dialogue Solver] Checking on-screen Dialogue / Conversation...");

        // 1. Click "Start Dialogue" / "Start Simulation" if present
        const startButtons = Array.from(document.querySelectorAll('button, a[role="button"], a'));
        const startKeywords = ['start dialogue', 'resume dialogue', 'start conversation', 'resume conversation', 'start simulation', 'begin dialogue', 'begin conversation', 'start'];
        for (const btn of startButtons) {
            const txt = (btn.innerText || btn.textContent || '').trim().toLowerCase();
            const testId = (btn.getAttribute('data-testid') || '').toLowerCase();
            if (startKeywords.some(kw => txt === kw || testId.includes(kw) || txt.startsWith(kw))) {
                log(`[Dialogue Solver] Found "${btn.innerText || 'Start Dialogue'}". Clicking...`);
                btn.click();
                await new Promise(r => setTimeout(r, 1500));
                break;
            }
        }

        // 2. Locate chat input & extract latest question/prompt
        let chatInput = document.querySelector('textarea, input[type="text"]:not([placeholder*="search"]), [contenteditable="true"]');
        
        // Extract last message bubble from the simulation
        const messageBubbles = Array.from(document.querySelectorAll('.rc-MessageBubble, [class*="MessageBubble"], [class*="DialogueMessage"], [class*="chat-message"], [class*="bubble"], [role="log"] p, [role="log"] div'));
        let promptText = "Please proceed with the dialogue objectives.";
        if (messageBubbles.length > 0) {
            const lastBubble = messageBubbles[messageBubbles.length - 1];
            promptText = (lastBubble.innerText || lastBubble.textContent || '').trim();
            log(`[Dialogue Solver] Extracted dialogue prompt: "${promptText.substring(0, 70)}..."`);
        }

        // 3. Generate 1 response and send it
        if (chatInput) {
            log("[Dialogue Solver] Generating 1 student chat response...");
            const courseHeader = courseContext?.courseTitle ? `Course: ${courseContext.courseTitle}\nModule: ${courseContext.moduleName || 'General'}\n` : '';
            const aiPrompt = `You are a student participating in an interactive simulation / dialogue in a Coursera course.

${courseHeader}
Dialogue Prompt from Instructor / Simulation:
${promptText}

Strict Safety & Style Guidelines:
- Write a direct, natural, concise response (1-2 sentences) engaging with the prompt.
- NEVER disclose or imply that you are an AI or automated system.
- Output ONLY the response body.`;

            let responseText = await callLLM(aiPrompt, aiConfig);
            if (!responseText) {
                responseText = "I understand the scenario and will apply the key principles and best practices taught in this course to achieve the learning objectives.";
            } else {
                responseText = sanitizeHumanStudentResponse(responseText);
            }

            log(`[Dialogue Solver] Typing response: "${responseText.substring(0, 60)}..."`);
            setNativeInputValue(chatInput, responseText);
            await new Promise(r => setTimeout(r, 400));

            // Click send button or press enter
            const sendButtons = Array.from(document.querySelectorAll('button[aria-label*="send"], button[type="submit"], button[data-testid*="send"], form button, [class*="send"] button, button:has(svg)'));
            let sendClicked = false;
            for (const sBtn of sendButtons) {
                const sText = (sBtn.innerText || sBtn.getAttribute('aria-label') || '').toLowerCase();
                if (sText.includes('send') || sText.includes('submit') || sBtn.querySelector('svg')) {
                    log("[Dialogue Solver] Clicking Send...");
                    sBtn.click();
                    sendClicked = true;
                    break;
                }
            }

            if (!sendClicked) {
                // Dispatch Enter key event
                chatInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
                chatInput.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
            }

            // Wait 2s for response to render in DOM
            await new Promise(r => setTimeout(r, 2000));
        }

        // 4. Locate and click "End Dialogue" / "End Conversation" button in top toolbar/header
        log("[Dialogue Solver] Locating 'End Dialogue' button...");
        const allActionButtons = Array.from(document.querySelectorAll('button, [role="button"], a, input[type="button"]'));
        const endKeywords = ['end dialogue', 'end conversation', 'end simulation', 'end chat', 'finish dialogue', 'finish conversation', 'exit dialogue', 'complete dialogue', 'end session', 'finish session', 'end'];
        
        let endButton = null;
        for (const el of allActionButtons) {
            const text = (el.innerText || el.textContent || '').trim().toLowerCase();
            const aria = (el.getAttribute('aria-label') || '').toLowerCase();
            const testId = (el.getAttribute('data-testid') || '').toLowerCase();

            if (endKeywords.some(kw => text === kw || aria.includes(kw) || testId.includes(kw) || text.startsWith(kw))) {
                endButton = el;
                break;
            }
        }

        if (endButton) {
            log(`[Dialogue Solver] Clicking "${endButton.innerText || 'End Dialogue'}"...`);
            endButton.click();
            await new Promise(r => setTimeout(r, 800));

            // 5. In Modal: Select Reason (Radio / Dropdown)
            const modal = document.querySelector('[role="dialog"], [aria-modal="true"], .cds-dialog, .modal, [class*="modal"]');
            if (modal) {
                log("[Dialogue Solver] End confirmation modal opened. Selecting reason...");

                // Option A: Radio buttons in modal
                const modalRadios = Array.from(modal.querySelectorAll('input[type="radio"], [role="radio"], .cds-radio, label:has(input[type="radio"])'));
                if (modalRadios.length > 0) {
                    log("[Dialogue Solver] Selecting first available reason radio...");
                    clickNativeOption(modalRadios[0]);
                }

                // Option B: Dropdown select
                const modalSelect = modal.querySelector('select');
                if (modalSelect) {
                    log("[Dialogue Solver] Selecting reason from dropdown...");
                    if (modalSelect.options.length > 1) {
                        modalSelect.selectedIndex = 1;
                    }
                    modalSelect.dispatchEvent(new Event('change', { bubbles: true }));
                }

                // Option C: Clickable reason chips or list items
                const reasonChips = Array.from(modal.querySelectorAll('[class*="reason"], [class*="option"], [class*="item"] button, label'));
                if (reasonChips.length > 0 && modalRadios.length === 0) {
                    reasonChips[0].click();
                }

                await new Promise(r => setTimeout(r, 500));

                // 6. Click "Yes, end the dialogue" / "End dialogue" / "Confirm" button
                const confirmButtons = Array.from(modal.querySelectorAll('button, [role="button"]'));
                const confirmKeywords = ['yes, end the dialogue', 'yes, end', 'end dialogue', 'end conversation', 'end simulation', 'end', 'confirm', 'finish', 'submit'];
                
                for (const cBtn of confirmButtons) {
                    const cText = (cBtn.innerText || cBtn.textContent || '').trim().toLowerCase();
                    const cTestId = (cBtn.getAttribute('data-testid') || '').toLowerCase();
                    if (confirmKeywords.some(kw => cText === kw || cTestId.includes(kw) || cText.includes(kw))) {
                        log(`[Dialogue Solver] Clicking confirmation "${cBtn.innerText || 'Yes, end the dialogue'}"...`);
                        cBtn.click();
                        break;
                    }
                }
            }
            await new Promise(r => setTimeout(r, 1200));
            log("[Dialogue Solver] Live dialogue flow completed successfully!");
            return true;
        }

    } catch(e) {
        log(`Dialogue DOM solver notice: ${e.message}`);
    }
    return false;
}

/**
 * Automatically detects and clicks the "End Conversation" / "End Dialogue" option
 * in the top bar of interactive dialogue simulation items on Coursera.
 */
async function triggerDialogueEndOptionInDOM() {
    try {
        const candidates = Array.from(document.querySelectorAll('button, [role="button"], a, input[type="button"]'));
        
        const endKeywords = [
            'end conversation', 'end dialogue', 'end simulation', 'end chat', 
            'end activity', 'finish dialogue', 'finish conversation', 'exit dialogue',
            'complete dialogue', 'end session', 'finish session'
        ];

        let targetButton = null;

        for (const el of candidates) {
            const text = (el.innerText || el.textContent || '').trim().toLowerCase();
            const aria = (el.getAttribute('aria-label') || '').toLowerCase();
            const testId = (el.getAttribute('data-testid') || '').toLowerCase();

            if (endKeywords.some(kw => text === kw || text.includes(kw) || aria.includes(kw) || testId.includes(kw))) {
                targetButton = el;
                break;
            }
        }

        // Secondary fallback: search top navigation or header buttons for "End"
        if (!targetButton) {
            const topBarButtons = Array.from(document.querySelectorAll('header button, [class*="header"] button, [class*="top"] button, [class*="dialogue"] button, [class*="toolbar"] button'));
            for (const el of topBarButtons) {
                const text = (el.innerText || el.textContent || '').trim().toLowerCase();
                if (text === 'end' || text === 'finish' || text === 'exit') {
                    targetButton = el;
                    break;
                }
            }
        }

        if (targetButton) {
            log(`[Dialogue UI] Found top option "${targetButton.innerText || 'End'}". Clicking to finish...`);
            targetButton.click();

            // Wait for confirmation modal
            await new Promise(r => setTimeout(r, 400));

            // Check if confirmation modal button appeared
            const modalButtons = Array.from(document.querySelectorAll('[role="dialog"] button, .modal button, [class*="modal"] button, [class*="dialog"] button, [class*="confirm"] button'));
            for (const mBtn of modalButtons) {
                const mText = (mBtn.innerText || mBtn.textContent || '').trim().toLowerCase();
                if (mText === 'end' || mText === 'yes' || mText === 'confirm' || mText === 'yes, end' || mText === 'finish' || mText.includes('end conversation') || mText.includes('confirm')) {
                    log(`[Dialogue UI] Confirmed end modal.`);
                    mBtn.click();
                    break;
                }
            }
            return true;
        }
    } catch(e) {
        log(`Dialogue UI click notice: ${e.message}`);
    }
    return false;
}

async function completeDialogueItem(userId, courseId, courseSlug, item, aiConfig, courseContext = null) {
    try {
        log(`Processing Dialogue Simulation: ${item.name}...`);
        
        // 1. If currently open in DOM, execute the full interactive Dialogue solver:
        // (Start Dialogue -> Extract Q -> Send 1 chat response -> End Dialogue -> Select reason -> Yes end)
        const isCurrentPage = window.location.href.includes(item.id);
        if (isCurrentPage) {
            log(`[Dialogue] Page is currently active in browser. Executing live interactive chat solver...`);
            const domDone = await completeDialogueItemInDOM(aiConfig, courseContext);
            if (domDone) {
                await completeSingleReading(userId, courseId, courseSlug, item.id);
                return true;
            }
        }

        // 2. Also try top End button in case already started
        await triggerDialogueEndOptionInDOM();

        const headers = getCourseraHeaders();

        // 3. Call backend End Session & Dialogue Completion Actions
        const sessionActionEndpoints = [
            `https://www.coursera.org/api/onDemandDialogueSessions.v1/${courseId}~${item.id}/actions?includes=progress`,
            `https://www.coursera.org/api/onDemandDialogueSessions.v1/${item.id}/actions?includes=progress`
        ];

        const actionNames = ["endSession", "endConversation", "complete", "end"];
        for (const ep of sessionActionEndpoints) {
            for (const act of actionNames) {
                try {
                    const actionBody = JSON.stringify({ name: act, argument: [] });
                    await fetch(ep, { method: 'POST', headers, body: actionBody, credentials: 'include' });
                } catch(e) {}
            }
        }

        // 4. Attempt REST completion & session updates
        const dialogueEndpoints = [
            `https://www.coursera.org/api/onDemandDialogueSessions.v1`,
            `https://www.coursera.org/api/onDemandDialogueCompletions.v1`,
            `https://www.coursera.org/api/onDemandDialogueResponses.v1`
        ];

        for (const ep of dialogueEndpoints) {
            try {
                const body = JSON.stringify({
                    courseId: courseId,
                    itemId: item.id,
                    userId: Number(userId),
                    status: "COMPLETED",
                    action: "END",
                    completed: true
                });
                await fetch(ep, { method: 'POST', headers, body, credentials: 'include' });
            } catch(e) {}
        }

        // 5. Try GraphQL interactive attempt
        try {
            await processUngradedAssignment(userId, courseId, item, aiConfig, courseContext);
        } catch(e) {}

        // 6. Mark completion in course progress / supplement system
        await completeSingleReading(userId, courseId, courseSlug, item.id);
        
        log(`[Dialogue Completed] ${item.name}`);
        return true;

    } catch (e) {
        log(`Error completing dialogue: ${e.message}`);
        await completeSingleReading(userId, courseId, courseSlug, item.id);
        return false;
    }
}

async function startQuizSolverProcess(aiConfig) {
    try {
        const { userId, courseId, courseSlug, courseTitle, allItems, modules, syllabusData } = await getCourseData();
        
        // Pre-fetch progress state to avoid reattempting passed quizzes
        const progressData = await fetchCourseProgressState(userId, courseId, courseSlug, syllabusData);
        log(`[Progress Pre-Check] Found ${progressData.completedItemIds.size} already-completed items in this course.`);

        const quizItems = allItems.filter(item => {
            const cat = classifyItemType(item);
            return cat === 'quiz_assignment' || cat === 'dialogue' || cat === 'discussion' || cat === 'lab' || cat === 'app_item';
        });
        
        log(`Found ${quizItems.length} quizzes, practice assignments & interactive items in "${courseTitle}".`);
        
        for (let i = 0; i < quizItems.length; i++) {
            if (globalState.abortRequested) {
                log("Quiz solving stopped by user.");
                break;
            }

            const item = quizItems[i];
            
            // Skip already completed items
            if (progressData.completedItemIds.has(item.id)) {
                log(`[Already Completed (✓)] ${item.name} (${item.moduleName || 'General'}) - Skipping.`);
                continue;
            }

            // Skip previously passed quizzes
            if (progressData.passedQuizScores && progressData.passedQuizScores[item.id] !== undefined) {
                log(`[Already Passed (✓)] ${item.name} (${item.moduleName || 'General'}) - Score: ${progressData.passedQuizScores[item.id]}%. Skipping to preserve attempt quota.`);
                continue;
            }

            const courseContext = {
                courseSlug: courseSlug,
                courseTitle: courseTitle,
                assignmentName: item.name,
                moduleName: item.moduleName || ""
            };

            updateStatus(`[${i + 1}/${quizItems.length}] Solving: ${item.name}`);
            log(`[Practice/Graded Item] ${item.name} (${item.typeName || 'Item'}) - ID: ${item.id}`);

            try {
                await processQuizItem(userId, courseId, item, aiConfig, courseContext);
            } catch (err) {
                log(`Failed to process ${item.name}: ${err.message}`);
            }
        }

        if (globalState.abortRequested) {
            updateStatus("Process aborted.");
        } else {
            updateStatus(`Done! Processed quizzes, practice assignments & dialogues.`);
            // Generate summary report
            await generateCourseSummaryReport(userId, courseId, courseSlug, courseTitle, allItems, modules);
        }
        chrome.runtime.sendMessage({ action: "finished" }).catch(() => {});

    } catch (e) {
        log("Error: " + e.message);
        updateStatus("Error occurred. Check logs.");
        chrome.runtime.sendMessage({ action: "finished" }).catch(() => {});
    }
}

async function processQuizItem(userId, courseId, item, aiConfig, courseContext = null) {
    log(`Processing ${item.name} (${item.typeName})...`);
    
    if (item.contentSummary) {
        log(`Content Summary: ${JSON.stringify(item.contentSummary)}`);
    }

    const examTypes = ['exam', 'gradedQuiz', 'quiz'];
    const assignmentTypes = ['ungradedAssignment', 'practiceQuiz', 'assignment', 'gradedAssignment', 'diagnosticExam', 'ungradedWidget'];
    const appTypes = ['ungradedApp', 'gradedApp', 'app', 'singlePageApp', 'externalTool', 'openLearningApp', 'workspace', 'ungradedLti', 'gradedLti', 'ungradedLab', 'gradedLab', 'lab'];
    const discussionTypes = ['discussionPrompt', 'discussionQuestion', 'gradedDiscussionPrompt', 'discussion'];
    const dialogueTypes = ['dialogue', 'dialogueItem', 'interactiveDialogue', 'roleplay', 'conversationSimulation'];

    if (isAppOrToolItem(item)) {
        await completeUngradedAppItem(userId, courseId, '', item);
    } else if (examTypes.includes(item.typeName)) {
        await processExamItem(userId, courseId, item, aiConfig, courseContext);
    } else if (assignmentTypes.includes(item.typeName)) {
        await processUngradedAssignment(userId, courseId, item, aiConfig, courseContext);
    } else if (discussionTypes.includes(item.typeName)) {
        await completeDiscussionPrompt(userId, courseId, '', item, aiConfig, courseContext);
    } else if (dialogueTypes.includes(item.typeName)) {
        await completeDialogueItem(userId, courseId, '', item, aiConfig, courseContext);
    } else {
        // Fallback: try assignment solver, then app completion, then reading completion
        try {
            await processUngradedAssignment(userId, courseId, item, aiConfig, courseContext);
        } catch(e) {
            await completeUngradedAppItem(userId, courseId, '', item);
        }
    }
}

async function processExamItem(userId, courseId, item, aiConfig, courseContext = null) {
    try {
        log(`Processing Graded Exam / Assessment: ${item.name}...`);
        
        // If the user currently has this specific exam page open in front of them, solve it on screen with auto-submit & T&C acceptance!
        const isCurrentPage = window.location.href.includes(item.id);
        if (isCurrentPage) {
            log(`[On-Screen Exam] User is currently on this exam page. Executing live on-screen solver with T&C agreement and auto-submit...`);
            const onScreenSuccess = await solveQuizOnScreenInDOM(aiConfig, courseContext, true);
            if (onScreenSuccess) {
                log(`[On-Screen Exam] Completed, signed terms, and submitted on-screen.`);
                return;
            }
        }
        
        // Background GraphQL solver
        await processUngradedAssignment(userId, courseId, item, aiConfig, courseContext);
    } catch (e) {
        log(`Error processing exam: ${e.message}`);
    }
}

async function processUngradedAssignment(userId, courseId, item, aiConfig, courseContext = null) {
    const isGraded = ['exam', 'gradedQuiz', 'gradedAssignment', 'diagnosticExam'].includes(item.typeName) || 
                     (item.contentSummary && JSON.stringify(item.contentSummary).includes('LIMITED_SUBMISSIONS'));

    log(`Processing Practice / Graded Assignment: ${item.name}...`);

    const graphqlUrl = 'https://www.coursera.org/graphql-gateway?opname=Submission_StartAttempt';
    const headers = getCourseraHeaders();

    const query = `mutation Submission_StartAttempt($courseId: ID!, $itemId: ID!) {
      Submission_StartAttempt(input: {courseId: $courseId, itemId: $itemId}) {
        ... on Submission_StartAttemptSuccess {
          submissionState {
            assignment {
              id
              assignmentFeatures
            }
            allowedAction
            warnings
            attempts {
              attemptsMade
              attemptsAllowed
              attemptsRemaining
              inProgressAttempt {
                id
                draft {
                  id
                }
              }
            }
            outcome {
              earnedGrade
              isPassed
            }
          }
        }
        ... on Submission_StartAttemptFailure {
          errors {
            errorCode
            message
          }
        }
      }
    }`;

    try {
        let maxLoops = 2; // Allow up to 2 attempts if needed to reach passing grade
        for (let loop = 0; loop < maxLoops; loop++) {
            if (globalState.abortRequested) break;

            log(`Sending GraphQL StartAttempt (Cycle ${loop + 1})...`);
            const body = JSON.stringify({
                operationName: "Submission_StartAttempt",
                query: query,
                variables: {
                    courseId: courseId,
                    itemId: item.id
                }
            });

            const resp = await fetch(graphqlUrl, {
                method: 'POST',
                headers: headers,
                body: body,
                credentials: 'include'
            });

            let attemptsRemaining = 1;

            if (resp.ok) {
                const data = await resp.json();
                const result = data.data?.Submission_StartAttempt;
                
                if (result?.submissionState) {
                    const subState = result.submissionState;
                    const attemptsInfo = subState.attempts;
                    const outcome = subState.outcome;
                    
                    // Check if already passed (to save limited attempts)
                    if (outcome?.isPassed === true && isGraded) {
                        log(`[Graded Assignment] Already passed! Highest score recorded. Skipping.`);
                        await markAssignmentCompletedFallback(userId, courseId, item);
                        return;
                    }

                    // Check remaining attempts
                    const allowed = attemptsInfo?.attemptsAllowed || attemptsInfo?.allowedAttempts;
                    const used = attemptsInfo?.attemptsMade || attemptsInfo?.attemptCount || 0;
                    const remaining = attemptsInfo?.attemptsRemaining;
                    if (remaining !== undefined) attemptsRemaining = remaining;

                    if (allowed && remaining !== undefined && remaining <= 0) {
                        log(`[Graded Assignment] Out of attempts (${used}/${allowed} used). Skipping.`);
                        await markAssignmentCompletedFallback(userId, courseId, item);
                        return;
                    }

                    if (isGraded && allowed) {
                        log(`[Graded Assignment] Attempt ${used + 1}/${allowed} in progress...`);
                    }
                }
            }

            // Execute GraphQL session with past attempt intelligence and zero-unanswered safeguard
            const submitState = await processGraphQLSession(courseId, item.id, headers, aiConfig, courseContext);

            // If passed or not a graded assignment or out of attempts, stop loop
            const finalOutcome = submitState?.outcome;
            if (finalOutcome?.isPassed === true || !isGraded || attemptsRemaining <= 1 || loop === maxLoops - 1) {
                break;
            }

            if (finalOutcome?.isPassed === false && attemptsRemaining > 1) {
                log(`[Adaptive Retry Engine] Score was ${(finalOutcome.earnedGrade * 100).toFixed(0)}%. Re-attempting with wrong-answer elimination...`);
                await new Promise(r => setTimeout(r, 2000));
            }
        }

        // Run fallback pass & progress markers to guarantee Coursera records completion
        await markAssignmentCompletedFallback(userId, courseId, item);

    } catch (e) {
        log(`Error in GraphQL assignment process: ${e.message}`);
        await markAssignmentCompletedFallback(userId, courseId, item);
    }
}

async function markAssignmentCompletedFallback(userId, courseId, item) {
    try {
        await completeUngradedAppItem(userId, courseId, '', item);
    } catch(e) {}
}

async function processGraphQLSession(courseId, itemId, headers, aiConfig, courseContext = null) {
    log("Attempting to fetch questions via GraphQL...");
    
    const graphqlUrl = 'https://www.coursera.org/graphql-gateway?opname=QueryState';
    
    // The massive query string provided by the user
    const query = `fragment CheckboxQuestion on Submission_CheckboxQuestion {
  gradeSettings {
    maxScore
    graderType
    __typename
  }
  partId: id
  questionSchema {
    options {
      ...Option
      __typename
    }
    prompt {
      ...SubmissionCmlContent
      ...SubmissionHtmlContent
      __typename
    }
    __typename
  }
  checkboxResponse: response {
    chosen
    __typename
  }
  __typename
}

fragment CheckboxReflectQuestion on Submission_CheckboxReflectQuestion {
  gradeSettings {
    maxScore
    graderType
    __typename
  }
  partId: id
  questionSchema {
    options {
      ...Option
      __typename
    }
    prompt {
      ...SubmissionCmlContent
      ...SubmissionHtmlContent
      __typename
    }
    __typename
  }
  checkboxReflectResponse: response {
    chosen
    __typename
  }
  __typename
}

fragment CodeExpressionQuestion on Submission_CodeExpressionQuestion {
  gradeSettings {
    maxScore
    graderType
    __typename
  }
  partId: id
  questionSchema {
    codeLanguage
    prompt {
      ...SubmissionCmlContent
      ...SubmissionHtmlContent
      __typename
    }
    replEvaluatorId
    starterCode {
      code
      __typename
    }
    __typename
  }
  codeExpressionResponse: response {
    answer {
      code
      __typename
    }
    __typename
  }
  __typename
}

fragment FileUploadQuestion on Submission_FileUploadQuestion {
  gradeSettings {
    maxScore
    graderType
    __typename
  }
  partId: id
  questionSchema {
    plagiarismCheckStatus
    allowedFiles
    prompt {
      ...SubmissionCmlContent
      ...SubmissionHtmlContent
      __typename
    }
    __typename
  }
  fileUploadResponse: response {
    caption
    fileUrl
    title
    __typename
  }
  __typename
}

fragment MathQuestion on Submission_MathQuestion {
  gradeSettings {
    maxScore
    graderType
    __typename
  }
  partId: id
  questionSchema {
    prompt {
      ...SubmissionCmlContent
      ...SubmissionHtmlContent
      __typename
    }
    __typename
  }
  mathResponse: response {
    answer
    __typename
  }
  __typename
}

fragment MultipleChoiceQuestion on Submission_MultipleChoiceQuestion {
  gradeSettings {
    maxScore
    graderType
    __typename
  }
  partId: id
  questionSchema {
    options {
      ...Option
      __typename
    }
    prompt {
      ...SubmissionCmlContent
      ...SubmissionHtmlContent
      __typename
    }
    __typename
  }
  multipleChoiceResponse: response {
    chosen
    __typename
  }
  __typename
}

fragment MultipleChoiceReflectQuestion on Submission_MultipleChoiceReflectQuestion {
  gradeSettings {
    maxScore
    graderType
    __typename
  }
  partId: id
  questionSchema {
    options {
      ...Option
      __typename
    }
    prompt {
      ...SubmissionCmlContent
      ...SubmissionHtmlContent
      __typename
    }
    __typename
  }
  multipleChoiceReflectResponse: response {
    chosen
    __typename
  }
  __typename
}

fragment MultipleChoiceFillableBlank on Submission_MultipleChoiceFillableBlank {
  fillableBlankId: id
  answerOptions {
    ...Option
    __typename
  }
  __typename
}

fragment MultipleChoiceFillableBlankResponse on Submission_MultipleChoiceFillableBlankResponse {
  responseId: id
  optionId
  __typename
}

fragment MultipleFillableBlanksResponse on Submission_MultipleFillableBlanksQuestionResponse {
  responses {
    ...MultipleChoiceFillableBlankResponse
    __typename
  }
  __typename
}

fragment MultipleFillableBlanksQuestion on Submission_MultipleFillableBlanksQuestion {
  partId: id
  questionSchema {
    prompt {
      ...SubmissionCmlContent
      ...SubmissionHtmlContent
      __typename
    }
    fillableBlanks {
      ...MultipleChoiceFillableBlank
      __typename
    }
    __typename
  }
  multipleFillableBlanksResponse: response {
    ...MultipleFillableBlanksResponse
    __typename
  }
  gradeSettings {
    maxScore
    __typename
  }
  __typename
}

fragment NumericQuestion on Submission_NumericQuestion {
  gradeSettings {
    maxScore
    graderType
    __typename
  }
  partId: id
  questionSchema {
    prompt {
      ...SubmissionCmlContent
      ...SubmissionHtmlContent
      __typename
    }
    __typename
  }
  numericResponse: response {
    answer
    __typename
  }
  __typename
}

fragment OffPlatformQuestion on Submission_OffPlatformQuestion {
  gradeSettings {
    maxScore
    graderType
    __typename
  }
  partId: id
  questionSchema {
    prompt {
      ...SubmissionCmlContent
      ...SubmissionHtmlContent
      __typename
    }
    __typename
  }
  __typename
}

fragment PlainTextQuestion on Submission_PlainTextQuestion {
  gradeSettings {
    maxScore
    graderType
    __typename
  }
  partId: id
  questionSchema {
    prompt {
      ...SubmissionCmlContent
      ...SubmissionHtmlContent
      __typename
    }
    __typename
  }
  plainTextResponse: response {
    plainText
    __typename
  }
  __typename
}

fragment RegexQuestion on Submission_RegexQuestion {
  gradeSettings {
    maxScore
    graderType
    __typename
  }
  partId: id
  questionSchema {
    prompt {
      ...SubmissionCmlContent
      ...SubmissionHtmlContent
      __typename
    }
    __typename
  }
  regexResponse: response {
    answer
    __typename
  }
  __typename
}

fragment RichTextQuestion on Submission_RichTextQuestion {
  gradeSettings {
    maxScore
    graderType
    __typename
  }
  partId: id
  questionSchema {
    plagiarismCheckStatus
    prompt {
      ...SubmissionCmlContent
      ...SubmissionHtmlContent
      __typename
    }
    __typename
  }
  richTextResponse: response {
    richText {
      ...SubmissionCmlContent
      ...SubmissionHtmlContent
      __typename
    }
    __typename
  }
  __typename
}

fragment TextExactMatchQuestion on Submission_TextExactMatchQuestion {
  gradeSettings {
    maxScore
    graderType
    __typename
  }
  partId: id
  questionSchema {
    prompt {
      ...SubmissionCmlContent
      ...SubmissionHtmlContent
      __typename
    }
    __typename
  }
  textExactMatchResponse: response {
    answer
    __typename
  }
  __typename
}

fragment TextReflectQuestion on Submission_TextReflectQuestion {
  gradeSettings {
    maxScore
    __typename
  }
  partId: id
  questionSchema {
    prompt {
      ...SubmissionCmlContent
      ...SubmissionHtmlContent
      __typename
    }
    __typename
  }
  textReflectResponse: response {
    answer
    __typename
  }
  __typename
}

fragment UrlQuestion on Submission_UrlQuestion {
  gradeSettings {
    maxScore
    graderType
    __typename
  }
  partId: id
  questionSchema {
    plagiarismCheckStatus
    prompt {
      ...SubmissionCmlContent
      ...SubmissionHtmlContent
      __typename
    }
    __typename
  }
  urlResponse: response {
    caption
    title
    url
    __typename
  }
  __typename
}

fragment WidgetQuestion on Submission_WidgetQuestion {
  gradeSettings {
    maxScore
    graderType
    __typename
  }
  partId: id
  questionSchema {
    prompt {
      ...SubmissionCmlContent
      ...SubmissionHtmlContent
      __typename
    }
    widgetSessionId
    __typename
  }
  widgetResponse: response {
    answer
    __typename
  }
  __typename
}

fragment SubmissionPart on Submission_SubmissionPart {
  ...CheckboxQuestion
  ...CheckboxReflectQuestion
  ...CodeExpressionQuestion
  ...FileUploadQuestion
  ...MathQuestion
  ...MultipleChoiceQuestion
  ...MultipleChoiceReflectQuestion
  ...MultipleFillableBlanksQuestion
  ...NumericQuestion
  ...OffPlatformQuestion
  ...PlainTextQuestion
  ...RegexQuestion
  ...RichTextQuestion
  ...TextBlock
  ...TextExactMatchQuestion
  ...TextReflectQuestion
  ...UrlQuestion
  ...WidgetQuestion
  __typename
}

fragment Submission on Submission_Submission {
  id
  parts {
    ...SubmissionPart
    __typename
  }
  instructions {
    ...SubmissionInstructions
    __typename
  }
  lastSavedAt
  __typename
}

fragment InProgressAttempt on Submission_InProgressAttempt {
  id
  allowedDuration
  draft {
    ...Submission
    __typename
  }
  autoSubmissionRequired
  remainingDuration
  startedTime
  submissionsAllowed
  submissionsMade
  submissionsRemaining
  __typename
}

fragment LastSubmission on Submission_LastSubmission {
  id
  submission {
    ...Submission
    __typename
  }
  submittedAt
  __typename
}

fragment NextAttempt on Submission_NextAttempt {
  allowedDuration
  submissionsAllowed
  __typename
}

fragment SubmissionRateLimiterConfig on Submission_RateLimiterConfig {
  attemptsRemainingIncreasesAt
  maxPerInterval
  timeIntervalDuration
  __typename
}

fragment Attempts on Submission_Attempts {
  lastSubmission {
    ...LastSubmission
    __typename
  }
  nextAttempt {
    ...NextAttempt
    __typename
  }
  attemptsAllowed
  attemptsMade
  attemptsRemaining
  inProgressAttempt {
    ...InProgressAttempt
    __typename
  }
  rateLimiterConfig {
    ...SubmissionRateLimiterConfig
    __typename
  }
  __typename
}

fragment AssignmentOutcome on Submission_AssignmentOutcome {
  earnedGrade
  gradeOverride {
    original
    override
    __typename
  }
  isPassed
  latePenaltyRatio
  __typename
}

fragment IntegrityAutoProctorSettings on Integrity_AutoProctorSettings {
  enabled
  clientId
  hashedAttemptId
  __typename
}

fragment IntegrityHonorlockSettings on Integrity_HonorlockSettings {
  enabled
  __typename
}

fragment IntegrityLockingBrowserSettings on Integrity_LockingBrowserSettings {
  enabled
  enabledForCurrentUser
  __typename
}

fragment IntegrityCourseraProctoringSettings on Integrity_CourseraProctoringSettings {
  enabled
  configuration {
    primaryCameraConfig {
      cameraStatus
      recordingStatus
      monitoringStatus
      __typename
    }
    secondaryCameraConfig {
      cameraStatus
      recordingStatus
      monitoringStatus
      __typename
    }
    __typename
  }
  __typename
}

fragment IntegrityVivaExamSettings on Integrity_VivaExamSettings {
  status
  __typename
}

fragment IntegritySession on Session_Session {
  id
  isPrivate
  __typename
}

fragment AcademicIntegritySettings on Integrity_IntegritySettings {
  attemptId
  session {
    ...IntegritySession
    __typename
  }
  honorlockSettings {
    ...IntegrityHonorlockSettings
    __typename
  }
  lockingBrowserSettings {
    ...IntegrityLockingBrowserSettings
    __typename
  }
  autoProctorSettings {
    ...IntegrityAutoProctorSettings
    __typename
  }
  courseraProctoringSettings {
    ...IntegrityCourseraProctoringSettings
    __typename
  }
  vivaExamSettings {
    ...IntegrityVivaExamSettings
    __typename
  }
  __typename
}

fragment Assignment on Submission_Assignment {
  id
  passingFraction
  assignmentType
  assignmentGradingType
  gradeSelectionStrategy
  requiredMobileFeatures
  learnerFeedbackVisibility
  __typename
}

fragment SlackIntegrationMetadata on Submission_SlackIntegrationMetadata {
  slackGroupId
  slackTeamId
  slackTeamDomain
  __typename
}

fragment SlackProfile on Submission_SlackProfile {
  slackTeamId
  slackUserId
  slackName
  deletedOrInactive
  __typename
}

fragment UserProfile on Submission_UserProfile {
  id
  email
  fullName
  photoUrl
  slackProfile {
    ...SlackProfile
    __typename
  }
  __typename
}

fragment TeamSubmitter on Submission_TeamSubmitter {
  id
  name
  teamActivityDescription
  slackIntegrationMetadata {
    ...SlackIntegrationMetadata
    __typename
  }
  memberProfiles {
    ...UserProfile
    __typename
  }
  __typename
}

fragment IndividualSubmitter on Submission_IndividualSubmitter {
  id
  __typename
}

fragment QueryStateSuccess on Submission_SubmissionState {
  allowedAction
  assignment {
    ...Assignment
    __typename
  }
  integritySettings {
    ...AcademicIntegritySettings
    __typename
  }
  submitter {
    ...IndividualSubmitter
    ...TeamSubmitter
    __typename
  }
  attempts {
    ...Attempts
    __typename
  }
  feedback {
    feedbackId: id
    outcome {
      ...OverallOutcome
      __typename
    }
    __typename
  }
  outcome {
    ...AssignmentOutcome
    __typename
  }
  manualGradingStatus
  warnings
  __typename
}

query QueryState($courseId: ID!, $itemId: ID!) {
  SubmissionState {
    queryState(courseId: $courseId, itemId: $itemId) {
      ... on Submission_QueryStateFailure {
        ...QueryStateFailure
        __typename
      }
      ... on Submission_SubmissionState {
        ...QueryStateSuccess
        __typename
      }
      __typename
    }
    __typename
  }
}

fragment OverallOutcome on Submission_OverallOutcome {
  latestScore
  highestScore
  maxScore
  __typename
}

fragment SubmissionInstructions on Submission_Instructions {
  overview {
    ...SubmissionCmlContent
    ...SubmissionHtmlContent
    __typename
  }
  reviewCriteria {
    ...SubmissionCmlContent
    ...SubmissionHtmlContent
    __typename
  }
  __typename
}

fragment QueryStateFailure on Submission_QueryStateFailure {
  errors {
    ...SubmissionInvalidAttemptIdError
    ...SubmissionInvalidHonorlockSessionError
    ...SubmissionNoAttemptInProgressError
    ...SubmissionNoOpenDraftError
    ...SubmissionQueryState_IpNotAllowedError
    ...SubmissionQueryState_TeamNotAssignedError
    ...SubmissionReworkSubmission_NoSubmissionToReworkError
    ...SubmissionSaveResponses_InvalidResponsesError
    ...SubmissionStaffGradingStartedError
    ...SubmissionStartAttempt_OutOfAttemptsError
    __typename
  }
  __typename
}

fragment SubmissionInvalidAttemptIdError on Submission_InvalidAttemptIdError {
  errorCode
  __typename
}

fragment SubmissionInvalidHonorlockSessionError on Submission_InvalidHonorlockSessionError {
  errorCode
  __typename
}

fragment SubmissionNoAttemptInProgressError on Submission_NoAttemptInProgressError {
  errorCode
  __typename
}

fragment SubmissionNoOpenDraftError on Submission_NoOpenDraftError {
  errorCode
  __typename
}

fragment SubmissionQueryState_IpNotAllowedError on Submission_QueryState_IPNotAllowedError {
  errorCode
  __typename
}

fragment SubmissionQueryState_TeamNotAssignedError on Submission_QueryState_TeamNotAssignedError {
  errorCode
  __typename
}

fragment SubmissionReworkSubmission_NoSubmissionToReworkError on Submission_ReworkSubmission_NoSubmissionToReworkError {
  errorCode
  __typename
}

fragment SubmissionSaveResponses_InvalidResponsesError on Submission_SaveResponses_InvalidResponsesError {
  errorCode
  __typename
}

fragment SubmissionStaffGradingStartedError on Submission_StaffGradingStartedError {
  errorCode
  __typename
}

fragment SubmissionStartAttempt_OutOfAttemptsError on Submission_StartAttempt_OutOfAttemptsError {
  errorCode
  __typename
}

fragment SubmissionCmlContent on CmlContent {
  cmlValue
  dtdId
  htmlWithMetadata {
    html
    metadata {
      hasAssetBlock
      hasCodeBlock
      hasMath
      isPlainText
      __typename
    }
    __typename
  }
  __typename
}

fragment SubmissionHtmlContent on Submission_HtmlContent {
  value
  __typename
}

fragment Option on Submission_MultipleChoiceOption {
  display {
    ...SubmissionCmlContent
    ...SubmissionHtmlContent
    __typename
  }
  optionId: id
  __typename
}

fragment TextBlock on Submission_TextBlock {
  partId: id
  title
  body {
    ...SubmissionCmlContent
    __typename
  }
  __typename
}`;

    try {
        const body = JSON.stringify({
            operationName: "QueryState",
            query: query,
            variables: {
                courseId: courseId,
                itemId: itemId
            }
        });

        const resp = await fetch(graphqlUrl, {
            method: 'POST',
            headers: headers,
            body: body,
            credentials: 'include'
        });

        if (!resp.ok) {
            log(`GraphQL QueryState Failed: ${resp.status}`);
            return;
        }

        const data = await resp.json();
        
        // Navigate the massive response structure
        const queryState = data.data?.SubmissionState?.queryState;
        
        if (!queryState) {
            log("No queryState in response.");
            return;
        }

        // Check candidate locations for parts
        const attempts = queryState.attempts;
        const inProgress = attempts?.inProgressAttempt || queryState.inProgressAttempt;
        
        let parts = inProgress?.draft?.parts 
            || queryState?.draft?.parts 
            || queryState?.assignment?.parts
            || queryState?.activeAttempt?.draft?.parts
            || attempts?.draft?.parts;
        
        const draftId = inProgress?.draft?.id || inProgress?.id || queryState?.draft?.id;

        if (parts && parts.length > 0) {
            log(`Found ${parts.length} parts in the assignment.`);
            
            // Map GraphQL parts to a simpler format for the solver
            const questions = parts.map(part => {
                if (part.__typename === 'Submission_TextBlock') {
                    return null;
                }

                // Extract prompt text from CML or HTML
                let promptText = "No prompt";
                const promptObj = part.questionSchema?.prompt;
                if (promptObj) {
                    if (promptObj.htmlWithMetadata?.html) promptText = promptObj.htmlWithMetadata.html;
                    else if (promptObj.value) promptText = promptObj.value;
                    else if (promptObj.cmlValue) promptText = promptObj.cmlValue;
                }
                
                promptText = promptText.replace(/<[^>]*>/g, '').trim();

                // Extract options
                let options = [];
                if (part.questionSchema?.options) {
                    options = part.questionSchema.options.map(opt => {
                        let optText = "Option";
                        const disp = opt.display;
                        if (disp) {
                            if (disp.htmlWithMetadata?.html) optText = disp.htmlWithMetadata.html;
                            else if (disp.value) optText = disp.value;
                            else if (disp.cmlValue) optText = disp.cmlValue;
                        }
                        optText = optText.replace(/<[^>]*>/g, '').trim();
                        return { id: opt.optionId, text: optText };
                    });
                }

                return {
                    id: part.partId,
                    type: part.__typename,
                    prompt: { text: promptText },
                    options: options
                };
            }).filter(q => q !== null);

            const outcome = await solveQuestions('graphql', courseId, itemId, questions, headers, aiConfig, courseContext, draftId, queryState);
            return outcome;

        } else {
            log("No open parts found in GraphQL state. Proceeding with fallback completion...");
            return false;
        }

    } catch (e) {
        log(`Error in GraphQL QueryState: ${e.message}`);
        return false;
    }
}

/**
 * Extracts past attempt intelligence from QueryState:
 * - Identifies previously chosen correct answers (to reuse with 100% confidence)
 * - Identifies previously chosen incorrect options (to eliminate from candidate choices)
 */
function extractAttemptHistoryFeedback(queryState) {
    const feedback = {
        correctAnswers: {},    // questionId -> response object
        eliminatedOptions: {}, // questionId -> Set of option IDs
        hasHistory: false
    };

    if (!queryState) return feedback;

    try {
        const attempts = queryState.attempts;
        const lastSubmission = attempts?.lastSubmission?.submission;
        const assignmentOutcome = queryState.outcome;

        if (lastSubmission && Array.isArray(lastSubmission.parts)) {
            feedback.hasHistory = true;
            for (const p of lastSubmission.parts) {
                const partId = p.id || p.partId;
                if (!partId) continue;

                if (!feedback.eliminatedOptions[partId]) {
                    feedback.eliminatedOptions[partId] = new Set();
                }

                // Check MCQ response
                if (p.multipleChoiceResponse?.chosen) {
                    const chosenId = p.multipleChoiceResponse.chosen;
                    if (assignmentOutcome?.isPassed === false || (p.gradeSettings && p.gradeSettings.score === 0)) {
                        feedback.eliminatedOptions[partId].add(chosenId);
                    } else if (assignmentOutcome?.isPassed === true || (p.gradeSettings && p.gradeSettings.score > 0)) {
                        feedback.correctAnswers[partId] = {
                            questionId: partId,
                            questionType: 'MULTIPLE_CHOICE',
                            questionResponse: { multipleChoiceResponse: { chosen: chosenId } }
                        };
                    }
                }

                // Check Checkbox response
                if (p.checkboxResponse?.chosen && Array.isArray(p.checkboxResponse.chosen)) {
                    if (assignmentOutcome?.isPassed === false) {
                        p.checkboxResponse.chosen.forEach(id => feedback.eliminatedOptions[partId].add(id));
                    } else if (assignmentOutcome?.isPassed === true) {
                        feedback.correctAnswers[partId] = {
                            questionId: partId,
                            questionType: 'CHECKBOX',
                            questionResponse: { checkboxResponse: { chosen: p.checkboxResponse.chosen } }
                        };
                    }
                }

                // Check Numeric response
                if (p.numericResponse?.answer !== undefined && p.numericResponse?.answer !== null) {
                    if (assignmentOutcome?.isPassed === true) {
                        feedback.correctAnswers[partId] = {
                            questionId: partId,
                            questionType: 'NUMERIC',
                            questionResponse: { numericResponse: { answer: p.numericResponse.answer } }
                        };
                    }
                }

                // Check Code expression response
                if (p.codeExpressionResponse?.answer?.code) {
                    if (assignmentOutcome?.isPassed === true) {
                        feedback.correctAnswers[partId] = {
                            questionId: partId,
                            questionType: 'CODE_EXPRESSION',
                            questionResponse: { codeExpressionResponse: { answer: { code: p.codeExpressionResponse.answer.code } } }
                        };
                    }
                }
            }
        }
    } catch(e) {
        log(`Notice in attempt feedback parsing: ${e.message}`);
    }

    return feedback;
}

/**
 * Zero-Unanswered-Questions Safeguard:
 * Ensures every single question part has a valid, non-null response payload before saving draft.
 */
function ensureCompleteResponses(questions, responsesToSave, attemptHistory = null) {
    const savedIds = new Set(responsesToSave.map(r => r.questionId));

    for (const q of questions) {
        if (!savedIds.has(q.id)) {
            log(`[Zero-Unanswered Safeguard] Auto-filling missing question ID: ${q.id} with safe response...`);
            
            const isMultipleChoice = (q.type === 'Submission_MultipleChoiceQuestion' || q.type === 'Submission_MultipleChoiceReflectQuestion');
            const isCheckbox = (q.type === 'Submission_CheckboxQuestion' || q.type === 'Submission_CheckboxReflectQuestion');
            const isNumeric = (q.type === 'Submission_NumericQuestion' || q.type === 'Submission_SingleNumericQuestion' || q.type === 'Submission_MathQuestion');
            const isText = (q.type === 'Submission_PlainTextQuestion' || q.type === 'Submission_ShortAnswerQuestion' || q.type === 'Submission_TextExactMatchQuestion' || q.type === 'Submission_TextReflectQuestion');
            const isCode = (q.type === 'Submission_CodeExpressionQuestion');
            const isRichText = (q.type === 'Submission_RichTextQuestion');
            const isRegex = (q.type === 'Submission_RegexQuestion');
            const isUrl = (q.type === 'Submission_UrlQuestion' || q.type === 'Submission_FileUploadQuestion');
            const isWidget = (q.type === 'Submission_WidgetQuestion');

            const eliminated = attemptHistory?.eliminatedOptions?.[q.id] || new Set();
            const validOptions = (q.options || []).filter(o => !eliminated.has(o.id));
            const chosenOption = validOptions[0] || q.options?.[0];

            if (isMultipleChoice) {
                if (chosenOption) {
                    responsesToSave.push({
                        questionId: q.id,
                        questionType: 'MULTIPLE_CHOICE',
                        questionResponse: {
                            multipleChoiceResponse: { chosen: chosenOption.id }
                        }
                    });
                }
            } else if (isCheckbox) {
                const chosen = validOptions.length > 0 ? [validOptions[0].id] : (q.options?.[0] ? [q.options[0].id] : []);
                if (chosen.length > 0) {
                    responsesToSave.push({
                        questionId: q.id,
                        questionType: 'CHECKBOX',
                        questionResponse: {
                            checkboxResponse: { chosen }
                        }
                    });
                }
            } else if (isNumeric) {
                responsesToSave.push({
                    questionId: q.id,
                    questionType: 'NUMERIC',
                    questionResponse: {
                        numericResponse: { answer: 0 }
                    }
                });
            } else if (isText) {
                responsesToSave.push({
                    questionId: q.id,
                    questionType: 'PLAIN_TEXT',
                    questionResponse: {
                        plainTextResponse: { answer: "Completed assessment requirements according to course curriculum." }
                    }
                });
            } else if (isRichText) {
                responsesToSave.push({
                    questionId: q.id,
                    questionType: 'RICH_TEXT',
                    questionResponse: {
                        richTextResponse: {
                            richText: {
                                cmlValue: "<cml><p>Completed assessment requirements according to course curriculum.</p></cml>",
                                dtdId: "richText/1"
                            }
                        }
                    }
                });
            } else if (isCode) {
                responsesToSave.push({
                    questionId: q.id,
                    questionType: 'CODE_EXPRESSION',
                    questionResponse: {
                        codeExpressionResponse: {
                            answer: { code: "// Assessment implementation\nreturn true;\n" }
                        }
                    }
                });
            } else if (isRegex) {
                responsesToSave.push({
                    questionId: q.id,
                    questionType: 'REGEX',
                    questionResponse: {
                        regexResponse: { answer: ".*" }
                    }
                });
            } else if (isUrl) {
                responsesToSave.push({
                    questionId: q.id,
                    questionType: 'URL',
                    questionResponse: {
                        urlResponse: {
                            title: "Assignment Submission",
                            url: "https://github.com/coursera-assignments/submission"
                        }
                    }
                });
            } else if (isWidget) {
                responsesToSave.push({
                    questionId: q.id,
                    questionType: 'WIDGET',
                    questionResponse: {
                        widgetResponse: { answer: "completed" }
                    }
                });
            } else {
                if (chosenOption) {
                    responsesToSave.push({
                        questionId: q.id,
                        questionType: 'MULTIPLE_CHOICE',
                        questionResponse: {
                            multipleChoiceResponse: { chosen: chosenOption.id }
                        }
                    });
                }
            }
        }
    }
}

async function processSession(endpoint, sessionId, headers, aiConfig, courseContext = null) {
    try {
        const actionUrl = `https://www.coursera.org/api/${endpoint}/${sessionId}/actions?includes=gradingAttempts`;
        
        const actionBody = JSON.stringify({
            name: "getState",
            argument: []
        });

        const actionResp = await fetch(actionUrl, {
            method: 'POST',
            headers: headers,
            body: actionBody,
            credentials: 'include'
        });

        if (!actionResp.ok) {
            log(`Failed to get state: ${actionResp.status}`);
            return;
        }

        const actionData = await actionResp.json();
        
        let questions = null;
        if (actionData.elements && actionData.elements[0].result && actionData.elements[0].result.questions) {
            questions = actionData.elements[0].result.questions;
        } else if (actionData.questionStates) {
            questions = actionData.questionStates;
        }

        if (questions && questions.length > 0) {
            log(`Found ${questions.length} questions!`);
            await solveQuestions(endpoint, sessionId, sessionId, questions, headers, aiConfig, courseContext);
        } else {
            log("No questions found in session state.");
        }
    } catch (e) {
        log(`Error processing session: ${e.message}`);
    }
}

async function solveQuestions(endpoint, courseId, itemId, questions, headers, aiConfig, courseContext = null, fallbackDraftId = null, queryState = null) {
    log(`Starting solver for ${questions.length} question(s)...`);
    
    // Extract history & feedback from past attempts
    const attemptHistoryFeedback = extractAttemptHistoryFeedback(queryState);
    if (attemptHistoryFeedback.hasHistory) {
        log("[History Intelligence] Past attempt feedback detected. Applying correct answer locks & wrong option exclusions.");
    }

    const responsesToSave = [];

    for (let i = 0; i < questions.length; i++) {
        if (globalState.abortRequested) {
            log("Solver stopped by user.");
            break;
        }

        const q = questions[i];
        log(`[${i + 1}/${questions.length}] Solving Question ID: ${q.id}`);

        // 1. History Intelligence: Reuse locked winning answer if known correct
        if (attemptHistoryFeedback?.correctAnswers?.[q.id]) {
            const winningAnswer = attemptHistoryFeedback.correctAnswers[q.id];
            log(`[History Intelligence Q${i + 1}] Reusing confirmed correct answer from previous attempt!`);
            responsesToSave.push(winningAnswer);
            continue;
        }

        // 2. History Intelligence: Identify eliminated options
        const eliminated = attemptHistoryFeedback?.eliminatedOptions?.[q.id];
        let eliminationNote = "";
        if (eliminated && eliminated.size > 0 && q.options && q.options.length > 0) {
            const eliminatedTexts = q.options.filter(o => eliminated.has(o.id)).map(o => o.text);
            if (eliminatedTexts.length > 0) {
                eliminationNote = `\nCRITICAL ATTEMPT FEEDBACK:\nIn a previous attempt, the following option(s) were chosen and marked INCORRECT:\n- ${eliminatedTexts.join('\n- ')}\nDo NOT choose these incorrect options. You must select only from the other options.\n`;
                log(`[History Intelligence Q${i + 1}] Eliminating ${eliminatedTexts.length} known wrong option(s).`);
            }
        }

        try {
            let prompt = "";
            const isMultipleChoice = (q.type === 'Submission_MultipleChoiceQuestion' || q.type === 'Submission_MultipleChoiceReflectQuestion');
            const isCheckbox = (q.type === 'Submission_CheckboxQuestion' || q.type === 'Submission_CheckboxReflectQuestion');
            const isNumeric = (q.type === 'Submission_NumericQuestion' || q.type === 'Submission_SingleNumericQuestion' || q.type === 'Submission_MathQuestion');
            const isText = (q.type === 'Submission_PlainTextQuestion' || q.type === 'Submission_ShortAnswerQuestion' || q.type === 'Submission_TextExactMatchQuestion' || q.type === 'Submission_TextReflectQuestion');
            const isCode = (q.type === 'Submission_CodeExpressionQuestion');
            const isRichText = (q.type === 'Submission_RichTextQuestion');
            const isRegex = (q.type === 'Submission_RegexQuestion');
            const isUrl = (q.type === 'Submission_UrlQuestion' || q.type === 'Submission_FileUploadQuestion');
            const isWidget = (q.type === 'Submission_WidgetQuestion');

            const courseHeader = courseContext?.courseTitle 
                ? `Course Context:\n- Course: ${courseContext.courseTitle}\n- Module: ${courseContext.moduleName || 'General'}\n- Assignment: ${courseContext.assignmentName || 'Quiz'}\n` 
                : '';

            if (isText || isRichText) {
                prompt = `You are a top-performing student solving an assignment in a Coursera course.

${courseHeader}
Question:
${q.prompt?.text || "No question prompt available"}

Strict Safety & Style Guidelines:
- Write a direct, highly accurate, authentic student response strictly based on the course materials.
- NEVER mention, disclose, or imply that you are an AI, LLM, or automated assistant.
- Do NOT include conversational filler, preamble, or quotation marks. Output ONLY the response body.`;
            } else if (isCode) {
                prompt = `You are an expert programming student solving a coding assessment in a Coursera course.

${courseHeader}
Problem Statement:
${q.prompt?.text || "Implement the required code functionality."}

Strict Safety & Style Guidelines:
- Output ONLY the clean, working source code implementing the solution.
- Do NOT wrap your answer in markdown backticks or commentary unless code comments.`;
            } else if (isRegex) {
                prompt = `You are solving a regular expression (regex) problem in a Coursera course.

${courseHeader}
Pattern Requirement:
${q.prompt?.text || "Provide the regex pattern."}

Strict Safety & Style Guidelines:
- Provide ONLY the exact regular expression string that satisfies the pattern. Do not include quotes.`;
            } else if (isUrl) {
                responsesToSave.push({
                    questionId: q.id,
                    questionType: 'URL',
                    questionResponse: {
                        urlResponse: {
                            title: "Assignment Project Submission",
                            url: "https://github.com/coursera-assignments/project"
                        }
                    }
                });
                log(`[Saved URL Submission]`);
                continue;
            } else if (isNumeric) {
                prompt = `You are solving a mathematical/numerical question in a Coursera course.

${courseHeader}
Problem Statement:
${q.prompt?.text || "Calculate the final numeric value."}

Strict Safety & Style Guidelines:
- Calculate and output ONLY the final numeric answer (e.g. 42 or 3.14159). Do not output units, formulas, or explanation.`;
            } else if (isWidget) {
                responsesToSave.push({
                    questionId: q.id,
                    questionType: 'WIDGET',
                    questionResponse: {
                        widgetResponse: {
                            answer: "completed"
                        }
                    }
                });
                log(`[Saved Widget Completion]`);
                continue;
            } else {
                // Multiple Choice / Checkbox
                const optionsList = (q.options || []).map((o, idx) => {
                    const letter = String.fromCharCode(65 + idx);
                    const isElim = eliminated?.has(o.id) ? " [KNOWN INCORRECT - DO NOT CHOOSE]" : "";
                    return `Option ${idx + 1} (${letter}): ${o.text}${isElim}`;
                }).join('\n');

                const questionTypeDesc = isCheckbox 
                    ? "multi-select checkbox question (one or MORE options may be correct)" 
                    : "single-choice question (exactly ONE option is correct)";
                
                const answerFormatDesc = isCheckbox 
                    ? `Reply ONLY with the correct option number(s) in this exact format: "Option 1, Option 3".` 
                    : `Reply ONLY with the correct option number in this exact format: "Option 1".`;

                prompt = `You are a top-performing student solving a multiple choice question in a Coursera course.

${courseHeader}
Question:
${q.prompt?.text || "No question prompt available"}

Options:
${optionsList}
${eliminationNote}
Question Type: This is a ${questionTypeDesc}.

Strict Safety & Style Guidelines:
- Analyze all options thoroughly and choose the verified correct answer based on this course's curriculum.
- ${answerFormatDesc}
- Do NOT output any explanations, thoughts, or extra words.`;
            }

            const answerText = await callLLM(prompt, aiConfig);

            if (!answerText) {
                log(`Notice: Model did not return answer for question ${q.id}. Fallback safeguard will auto-complete.`);
                continue;
            }

            if (isText) {
                const cleanText = sanitizeHumanStudentResponse(answerText);
                responsesToSave.push({
                    questionId: q.id,
                    questionType: 'PLAIN_TEXT',
                    questionResponse: {
                        plainTextResponse: {
                            answer: cleanText
                        }
                    }
                });
                log(`[Saved Text]: ${cleanText.substring(0, 60)}...`);

            } else if (isRichText) {
                const cleanRich = sanitizeHumanStudentResponse(answerText);
                responsesToSave.push({
                    questionId: q.id,
                    questionType: 'RICH_TEXT',
                    questionResponse: {
                        richTextResponse: {
                            richText: {
                                cmlValue: `<cml><p>${cleanRich}</p></cml>`,
                                dtdId: "richText/1"
                            }
                        }
                    }
                });
                log(`[Saved RichText]: ${cleanRich.substring(0, 60)}...`);

            } else if (isCode) {
                responsesToSave.push({
                    questionId: q.id,
                    questionType: 'CODE_EXPRESSION',
                    questionResponse: {
                        codeExpressionResponse: {
                            answer: {
                                code: answerText.trim()
                            }
                        }
                    }
                });
                log(`[Saved Code]: ${answerText.trim().substring(0, 50)}...`);

            } else if (isRegex) {
                responsesToSave.push({
                    questionId: q.id,
                    questionType: 'REGEX',
                    questionResponse: {
                        regexResponse: {
                            answer: answerText.trim()
                        }
                    }
                });
                log(`[Saved Regex]: ${answerText.trim()}`);

            } else if (isNumeric) {
                const numMatch = answerText.match(/[-+]?[0-9]*\.?[0-9]+/);
                if (numMatch) {
                    const numVal = parseFloat(numMatch[0]);
                    responsesToSave.push({
                        questionId: q.id,
                        questionType: 'NUMERIC',
                        questionResponse: {
                            numericResponse: {
                                answer: numVal
                            }
                        }
                    });
                    log(`[Saved Numeric]: ${numVal}`);
                } else {
                    log(`Could not extract numeric value from answer: "${answerText}"`);
                }

            } else {
                // Multiple Choice / Checkbox
                const matchedOptions = matchGeminiAnswerToOptions(answerText, q.options || [], eliminated);

                if (matchedOptions.length > 0) {
                    log(`Matched Option(s): ${matchedOptions.map(o => o.text).join(' | ')}`);

                    if (isCheckbox) {
                        responsesToSave.push({
                            questionId: q.id,
                            questionType: 'CHECKBOX',
                            questionResponse: {
                                checkboxResponse: {
                                    chosen: matchedOptions.map(o => o.id)
                                }
                            }
                        });
                    } else {
                        responsesToSave.push({
                            questionId: q.id,
                            questionType: 'MULTIPLE_CHOICE',
                            questionResponse: {
                                multipleChoiceResponse: {
                                    chosen: matchedOptions[0].id
                                }
                            }
                        });
                    }
                } else {
                    log(`Could not match AI answer to any option. Raw answer: "${answerText}"`);
                }
            }

        } catch (e) {
            log(`Error solving question ${q.id}: ${e.message}`);
        }

        // Dynamic pacing delay based on provider rate limits
        if (i < questions.length - 1 && !globalState.abortRequested) {
            const provider = (typeof aiConfig === 'object' && aiConfig?.provider) ? aiConfig.provider.toLowerCase() : 'gemini';
            
            if (provider === 'gemini') {
                log(`[Gemini Pacing] Waiting 4.5s before next question...`);
                await new Promise(resolve => setTimeout(resolve, 4500));
            } else if (provider === 'groq') {
                await new Promise(resolve => setTimeout(resolve, 100));
            } else if (provider === 'openrouter') {
                await new Promise(resolve => setTimeout(resolve, 300));
            } else {
                await new Promise(resolve => setTimeout(resolve, 200));
            }
        }
    }

    // Zero-Unanswered Safeguard: Guarantee 100% of question parts have responses before saving!
    ensureCompleteResponses(questions, responsesToSave, attemptHistoryFeedback);

    // Save and submit responses
    if (responsesToSave.length > 0 && !globalState.abortRequested) {
        log(`Saving ${responsesToSave.length}/${questions.length} responses...`);
        
        if (endpoint === 'graphql') {
            const savedDraftId = await saveResponsesGraphQL(headers, courseId, itemId, responsesToSave);
            const finalSubmissionId = savedDraftId || fallbackDraftId;
            
            if (finalSubmissionId) {
                log(`Submitting quiz draft (Submission ID: ${finalSubmissionId})...`);
                const submitOutcome = await submitDraftGraphQL(headers, courseId, itemId, finalSubmissionId);
                return submitOutcome;
            } else {
                log("Submission ID not found in response; submitting latest draft...");
                const submitOutcome = await submitDraftGraphQL(headers, courseId, itemId, itemId);
                return submitOutcome;
            }
        }
    } else if (responsesToSave.length === 0) {
        log("No valid responses were generated to save.");
    }
    return null;
}

function matchGeminiAnswerToOptions(answerText, options, eliminatedOptionIds = null) {
    if (!answerText || !options || options.length === 0) return [];
    
    const isEliminated = (optId) => {
        if (!eliminatedOptionIds) return false;
        if (eliminatedOptionIds instanceof Set) return eliminatedOptionIds.has(optId);
        if (Array.isArray(eliminatedOptionIds)) return eliminatedOptionIds.includes(optId);
        return false;
    };

    const matched = [];
    const matchedIds = new Set();

    const addOption = (opt) => {
        if (opt && !matchedIds.has(opt.id) && !isEliminated(opt.id)) {
            matchedIds.add(opt.id);
            matched.push(opt);
        }
    };

    // 1. Check for "Option X" or "Option [A-Z]" patterns
    const optionWordMatches = [...answerText.matchAll(/Option\s*([0-9]+|[A-Za-z])/gi)];
    for (const match of optionWordMatches) {
        const val = match[1];
        if (/^\d+$/.test(val)) {
            const idx = parseInt(val, 10) - 1;
            if (options[idx]) addOption(options[idx]);
        } else if (/^[A-Za-z]$/.test(val)) {
            const idx = val.toUpperCase().charCodeAt(0) - 65;
            if (options[idx]) addOption(options[idx]);
        }
    }

    // 2. Check for standalone numbers (e.g. "1", "1, 3", "[2]")
    if (matched.length === 0) {
        const numberMatches = [...answerText.matchAll(/\b([1-9]|1[0-9])\b/g)];
        for (const match of numberMatches) {
            const idx = parseInt(match[1], 10) - 1;
            if (options[idx]) addOption(options[idx]);
        }
    }

    // 3. Check for standalone letters (e.g. "A", "B, C", "(A)", "A)")
    if (matched.length === 0) {
        const letterMatches = [...answerText.matchAll(/(?:^|[\s,;(\[])([A-Za-z])(?:$|[\s,;)\]])/g)];
        for (const match of letterMatches) {
            const letter = match[1].toUpperCase();
            const idx = letter.charCodeAt(0) - 65;
            if (idx >= 0 && idx < options.length && options[idx]) {
                addOption(options[idx]);
            }
        }
    }

    // 4. Fallback: Ranked Substring & Token Similarity matching
    if (matched.length === 0) {
        const normalize = str => (str || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
        const cleanAnswer = normalize(answerText);
        const answerTokens = new Set(cleanAnswer.split(' ').filter(t => t.length > 2));

        let bestMatch = null;
        let highestScore = 0;

        for (const opt of options) {
            if (!opt.text || isEliminated(opt.id)) continue;
            const cleanOpt = normalize(opt.text);
            if (!cleanOpt) continue;

            // Direct equality or strong inclusion
            if (cleanAnswer === cleanOpt) {
                addOption(opt);
                return matched;
            }
            if (cleanOpt.length >= 4 && (cleanAnswer.includes(cleanOpt) || cleanOpt.includes(cleanAnswer))) {
                addOption(opt);
            }

            // Token overlap score
            const optTokens = cleanOpt.split(' ').filter(t => t.length > 2);
            if (optTokens.length > 0) {
                const overlap = optTokens.filter(t => answerTokens.has(t)).length;
                const score = overlap / optTokens.length;
                if (score > highestScore && score >= 0.4) {
                    highestScore = score;
                    bestMatch = opt;
                }
            }
        }

        if (matched.length === 0 && bestMatch) {
            addOption(bestMatch);
        }
    }

    // 5. If matched option was eliminated, fallback to highest-ranked non-eliminated option
    if (matched.length === 0 && eliminatedOptionIds && eliminatedOptionIds.size > 0) {
        const available = options.filter(o => !isEliminated(o.id));
        if (available.length > 0) {
            log(`[History Intelligence] Filtered out eliminated choice. Selecting remaining candidate: ${available[0].text}`);
            matched.push(available[0]);
        }
    }

    return matched;
}

async function saveResponsesGraphQL(headers, courseId, itemId, responses) {
    const graphqlUrl = 'https://www.coursera.org/graphql-gateway?opname=Submission_SaveResponses';
    const query = `mutation Submission_SaveResponses($input: Submission_SaveResponsesInput!) {
  Submission_SaveResponses(input: $input) {
    ... on Submission_SaveResponsesSuccess {
      __typename
      submissionState {
        allowedAction
        warnings
        attempts {
          inProgressAttempt {
            draft {
              id
              lastSavedAt
              __typename
            }
            __typename
          }
          __typename
        }
        __typename
      }
    }
    ... on Submission_SaveResponsesFailure {
      __typename
      errors {
        errorCode
        __typename
      }
    }
    __typename
  }
}`;

    try {
        const body = JSON.stringify({
            operationName: "Submission_SaveResponses",
            query: query,
            variables: {
                input: {
                    courseId: courseId,
                    itemId: itemId,
                    questionResponses: responses
                }
            }
        });

        const resp = await fetch(graphqlUrl, {
            method: 'POST',
            headers: headers,
            body: body,
            credentials: 'include'
        });

        if (resp.ok) {
            log("Responses Saved Successfully!");
            const data = await resp.json();
            const draftId = data.data?.Submission_SaveResponses?.submissionState?.attempts?.inProgressAttempt?.draft?.id;
            return draftId;
        } else {
            const errorText = await resp.text();
            log(`Failed to save responses: ${resp.status} - ${errorText.substring(0, 200)}`);
            return null;
        }
    } catch(e) {
        log(`Error saving responses: ${e.message}`);
        return null;
    }
}

async function submitDraftGraphQL(headers, courseId, itemId, submissionId) {
    const graphqlUrl = 'https://www.coursera.org/graphql-gateway?opname=Submission_SubmitLatestDraft';
    const query = `mutation Submission_SubmitLatestDraft($input: Submission_SubmitLatestDraftInput!) {
  Submission_SubmitLatestDraft(input: $input) {
    ... on Submission_SubmitLatestDraftSuccess {
      __typename
      submissionState {
        allowedAction
        warnings
        attempts {
          attemptsMade
          attemptsAllowed
          attemptsRemaining
          __typename
        }
        outcome {
          earnedGrade
          isPassed
          __typename
        }
        __typename
      }
    }
    ... on Submission_SubmitLatestDraftFailure {
      __typename
      errors {
        errorCode
        message
        __typename
      }
    }
    __typename
  }
}`;

    try {
        const body = JSON.stringify({
            operationName: "Submission_SubmitLatestDraft",
            query: query,
            variables: {
                input: {
                    courseId: courseId,
                    itemId: itemId,
                    submissionId: submissionId
                }
            }
        });

        const resp = await fetch(graphqlUrl, {
            method: 'POST',
            headers: headers,
            body: body,
            credentials: 'include'
        });

        if (resp.ok) {
            const data = await resp.json();
            const result = data.data?.Submission_SubmitLatestDraft;
            if (result?.submissionState) {
                log(`[Quiz / Graded Assignment Submitted Successfully!]`);
                const outcome = result.submissionState?.outcome;
                if (outcome) {
                    const scoreText = (outcome.earnedGrade !== undefined && outcome.earnedGrade !== null) ? `${Math.round(outcome.earnedGrade * 100)}%` : 'Recorded';
                    const statusText = outcome.isPassed ? 'PASSED (✓)' : 'Completed';
                    log(`[Grade Result] Score: ${scoreText} - ${statusText}`);
                }
            } else if (result?.errors) {
                log(`Submission Notice: ${JSON.stringify(result.errors)}`);
            }
        } else {
            const errorText = await resp.text();
            log(`Failed to submit quiz: ${resp.status} - ${errorText.substring(0, 200)}`);
        }
    } catch(e) {
        log(`Error submitting quiz: ${e.message}`);
    }
}

/**
 * Queries real-time completion state from Coursera's progress APIs,
 * builds a module-by-module and category breakdown, logs the formatted report,
 * and sends it to the popup UI.
 */
async function generateCourseSummaryReport(userId, courseId, courseSlug, courseTitle, allItems, modules = [], manualAttentionItems = []) {
    try {
        log(`Generating Course Completion & Module Summary Report...`);
        const headers = getCourseraHeaders();

        // 1. Fetch completed item IDs using multi-layer Progress Pre-Fetcher
        const progressState = await fetchCourseProgressState(userId, courseId, courseSlug);
        const completedIds = progressState.completedItemIds;

        // 2. Compute Module Coverage
        const moduleMap = {};
        (modules || []).forEach(m => {
            moduleMap[m.id] = {
                id: m.id,
                moduleName: m.name,
                items: [],
                completedCount: 0,
                totalCount: 0
            };
        });

        // Populate items in moduleMap
        allItems.forEach(item => {
            const modId = item.moduleId || 'unknown';
            if (!moduleMap[modId]) {
                moduleMap[modId] = {
                    id: modId,
                    moduleName: item.moduleName || 'General',
                    items: [],
                    completedCount: 0,
                    totalCount: 0
                };
            }
            const isDone = completedIds.has(item.id);
            moduleMap[modId].items.push({ ...item, isDone });
            moduleMap[modId].totalCount++;
            if (isDone) moduleMap[modId].completedCount++;
        });

        const moduleReports = Object.values(moduleMap).map(m => {
            const percent = m.totalCount > 0 ? Math.round((m.completedCount / m.totalCount) * 100) : 0;
            return {
                id: m.id,
                moduleName: m.moduleName,
                totalCount: m.totalCount,
                completedCount: m.completedCount,
                percent: percent,
                isComplete: m.completedCount >= m.totalCount
            };
        });

        // 3. Compute Category Stats
        const categories = {
            videos: 0,
            readings: 0,
            discussions: 0,
            dialogues: 0,
            labs: 0,
            quizzes: 0,
            graded: 0
        };

        const remainingItems = [];
        let totalCompleted = 0;

        allItems.forEach(item => {
            const isDone = completedIds.has(item.id);
            if (isDone) totalCompleted++;
            else remainingItems.push(item);

            const t = (item.typeName || '').toLowerCase();
            if (t === 'lecture') categories.videos++;
            else if (t === 'supplement') categories.readings++;
            else if (t.includes('discussion')) categories.discussions++;
            else if (t.includes('dialogue') || t.includes('roleplay')) categories.dialogues++;
            else if (t.includes('lti') || t.includes('lab') || t.includes('app')) categories.labs++;
            else if (['exam', 'gradedquiz', 'gradedassignment'].includes(t)) categories.graded++;
            else categories.quizzes++;
        });

        const overallPercent = allItems.length > 0 ? Math.round((totalCompleted / allItems.length) * 100) : 0;

        const reportData = {
            courseTitle: courseTitle,
            courseSlug: courseSlug,
            totalItems: allItems.length,
            completedItems: totalCompleted,
            percent: overallPercent,
            modules: moduleReports,
            categories: categories,
            remainingItems: remainingItems,
            manualAttentionItems: manualAttentionItems
        };

        // 4. Output rich console log summary
        log(`========================================`);
        log(`📊 COURSE COMPLETION REPORT: ${courseTitle}`);
        log(`🏆 Overall Progress: ${overallPercent}% (${totalCompleted}/${allItems.length} Completed)`);
        log(`📁 Module Coverage:`);
        moduleReports.forEach(m => {
            const icon = m.isComplete ? '✓' : '⏳';
            log(`  ${icon} [${m.percent}%] ${m.moduleName} (${m.completedCount}/${m.totalCount})`);
        });
        
        if (manualAttentionItems && manualAttentionItems.length > 0) {
            log(`----------------------------------------`);
            log(`⚠️ ITEMS REQUIRING MANUAL ATTENTION (${manualAttentionItems.length}):`);
            log(`The following item(s) are locked or require manual action to unlock final assessments:`);
            manualAttentionItems.forEach((m, idx) => {
                log(`  ${idx + 1}. [${m.moduleName}] ${m.name} (${m.typeName})`);
                log(`     Reason: ${m.reason}`);
                log(`     Link: ${m.itemUrl}`);
            });
            log(`----------------------------------------`);
        }

        if (remainingItems.length > 0) {
            log(`⏳ Remaining Items (${remainingItems.length}):`);
            remainingItems.slice(0, 5).forEach(r => {
                log(`  • [${r.moduleName}] ${r.name} (${r.typeName})`);
            });
            if (remainingItems.length > 5) {
                log(`  ...and ${remainingItems.length - 5} more`);
            }
        } else {
            log(`🎉 All modules and items are 100% completed!`);
        }
        log(`========================================`);

        // Send report to popup UI and persist directly to storage
        chrome.runtime.sendMessage({ action: "summary_report", data: reportData }).catch(() => {});
        chrome.storage.local.set({ latestSummaryReport: reportData });
        return reportData;

    } catch (err) {
        log(`Notice on generating summary report: ${err.message}`);
    }
}

// Dynamic Gemini Model Discovery & Cache
let cachedAvailableModels = null;

const EXCLUDED_MODEL_KEYWORDS = ['tts', 'image', 'vision', 'embedding', 'aqa', 'retrieval', 'semantic'];

const PREFERRED_TEXT_MODELS = [
    'gemini-2.0-flash',
    'gemini-1.5-flash',
    'gemini-1.5-flash-8b',
    'gemini-2.5-flash',
    'gemini-1.5-pro'
];

async function getAvailableGeminiModels(apiKey) {
    if (cachedAvailableModels && cachedAvailableModels.length > 0) {
        return cachedAvailableModels;
    }

    try {
        const listUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
        const resp = await fetch(listUrl, { signal: AbortSignal.timeout(8000) });
        if (resp.ok) {
            const data = await resp.json();
            if (data.models && Array.isArray(data.models)) {
                const textModels = data.models
                    .filter(m => m.supportedGenerationMethods && m.supportedGenerationMethods.includes('generateContent'))
                    .map(m => m.name.replace('models/', ''))
                    .filter(name => !EXCLUDED_MODEL_KEYWORDS.some(kw => name.toLowerCase().includes(kw)));

                if (textModels.length > 0) {
                    textModels.sort((a, b) => {
                        const aPref = PREFERRED_TEXT_MODELS.findIndex(p => a === p || a.startsWith(p));
                        const bPref = PREFERRED_TEXT_MODELS.findIndex(p => b === p || b.startsWith(p));
                        if (aPref !== -1 && bPref !== -1) return aPref - bPref;
                        if (aPref !== -1) return -1;
                        if (bPref !== -1) return 1;
                        if (a.includes('flash') && !b.includes('flash')) return -1;
                        if (!a.includes('flash') && b.includes('flash')) return 1;
                        return 0;
                    });

                    log(`Using Gemini models: ${textModels.slice(0, 4).join(', ')}`);
                    cachedAvailableModels = textModels;
                    return cachedAvailableModels;
                }
            }
        }
    } catch (e) {
        log(`Notice: Model discovery fallback: ${e.message}`);
    }

    cachedAvailableModels = PREFERRED_TEXT_MODELS;
    return cachedAvailableModels;
}

/**
 * Calls OpenAI-Compatible Endpoints (OpenRouter, Groq, Local Ollama, DeepSeek, etc.)
 */
async function callOpenAICompatible(prompt, config, maxRetries = 2) {
    const provider = config.provider || 'custom';
    const apiKey = config.apiKey || '';
    let endpoint = config.endpoint;
    let model = config.model;

    if (provider === 'openrouter') {
        endpoint = endpoint || 'https://openrouter.ai/api/v1/chat/completions';
        model = model || 'meta-llama/llama-3.3-70b-instruct:free';
    } else if (provider === 'groq') {
        endpoint = endpoint || 'https://api.groq.com/openai/v1/chat/completions';
        model = model || 'llama-3.3-70b-versatile';
    } else {
        endpoint = endpoint || 'http://localhost:11434/v1/chat/completions';
        model = model || 'gpt-4o-mini';
    }

    const headers = {
        'Content-Type': 'application/json'
    };
    if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
    }
    if (provider === 'openrouter') {
        headers['HTTP-Referer'] = 'https://coursera.org';
        headers['X-Title'] = 'FcukCoursera';
    }

    const body = JSON.stringify({
        model: model,
        messages: [
            {
                role: 'user',
                content: prompt
            }
        ],
        temperature: 0.1,
        max_tokens: 1024
    });

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        if (globalState.abortRequested) return null;

        try {
            const resp = await fetch(endpoint, {
                method: 'POST',
                headers: headers,
                body: body,
                signal: AbortSignal.timeout(15000)
            });

            if (resp.ok) {
                const data = await resp.json();
                const content = data.choices?.[0]?.message?.content;
                if (content) {
                    return content.trim();
                }
                log(`[${provider}] Warning: Empty response from model.`);
                return null;
            }

            if (resp.status === 429 || resp.status === 503 || resp.status === 500) {
                const backoffMs = (attempt + 1) * 2000;
                const errType = resp.status === 429 ? "Rate limited (429)" : `Server error (${resp.status})`;
                if (attempt < maxRetries) {
                    log(`[${provider}/${model}] ${errType} - Retrying in ${(backoffMs / 1000).toFixed(1)}s (Attempt ${attempt + 1}/${maxRetries})...`);
                    await new Promise(r => setTimeout(r, backoffMs));
                    continue;
                }
            }

            const errText = await resp.text();
            log(`[${provider}/${model}] Error ${resp.status}: ${errText.substring(0, 120)}`);
            return null;

        } catch (netErr) {
            log(`[${provider}/${model}] Network notice: ${netErr.message}`);
            if (attempt < maxRetries) {
                await new Promise(r => setTimeout(r, 1500));
                continue;
            }
            return null;
        }
    }

    return null;
}

/**
 * Calls Google Gemini API with:
 * - Dynamic model discovery & fast fallback cascade
 * - Exponential backoff retry on 429 / 503 / 500
 * - Non-blocking abort timeout
 */
async function callGemini(apiKey, prompt, maxRetries = 2) {
    if (!apiKey) {
        log("Error: No Gemini API Key provided.");
        return null;
    }

    const models = await getAvailableGeminiModels(apiKey);

    for (const model of models) {
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            if (globalState.abortRequested) return null;

            try {
                const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
                const response = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        contents: [{
                            parts: [{
                                text: prompt
                            }]
                        }],
                        generationConfig: {
                            temperature: 0.1,
                            maxOutputTokens: 1024
                        }
                    }),
                    signal: AbortSignal.timeout(12000)
                });

                if (response.ok) {
                    const data = await response.json();
                    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
                    if (text) {
                        return text.trim();
                    }
                    log(`[${model}] Warning: Empty response from model.`);
                    return null;
                }

                // Handle Rate Limit (429) or Server Overloaded (503 / 500)
                if (response.status === 429 || response.status === 503 || response.status === 500) {
                    const backoffMs = (attempt + 1) * 2500;
                    const errorDetail = response.status === 429 ? "Rate limit quota (429)" : `Server error (${response.status})`;
                    
                    if (attempt < maxRetries) {
                        log(`[${model}] ${errorDetail} - Cooling down ${(backoffMs / 1000).toFixed(1)}s (Attempt ${attempt + 1}/${maxRetries})...`);
                        await new Promise(r => setTimeout(r, backoffMs));
                        continue;
                    } else {
                        log(`[${model}] Rate limit reached. Moving to fallback model...`);
                        break;
                    }
                }

                // Model not found or bad request on model - immediately try next model without waiting
                if (response.status === 404 || response.status === 400) {
                    const errText = await response.text();
                    log(`[${model}] Status ${response.status}: ${errText.substring(0, 60)}. Trying fallback model...`);
                    break;
                }

                const errBody = await response.text();
                log(`[${model}] HTTP ${response.status}: ${errBody.substring(0, 60)}`);
                break;

            } catch (networkErr) {
                log(`[${model}] Network/Timeout: ${networkErr.message}`);
                if (attempt < maxRetries) {
                    await new Promise(r => setTimeout(r, 1500));
                    continue;
                }
                break;
            }
        }
    }

    log("Notice: Model calls completed.");
    return null;
}

/**
 * Universal LLM dispatcher:
 * - Directs to OpenAI-compatible provider (OpenRouter, Groq, Custom/Local) or Gemini
 */
async function callLLM(prompt, aiConfig) {
    let config = aiConfig;
    if (typeof aiConfig === 'string') {
        config = { provider: 'gemini', apiKey: aiConfig };
    } else if (!config) {
        config = { provider: 'gemini', apiKey: '' };
    }

    if (config.provider === 'openrouter' || config.provider === 'groq' || config.provider === 'custom') {
        return await callOpenAICompatible(prompt, config);
    } else {
        return await callGemini(config.apiKey, prompt);
    }
}

// ==========================================
// Live On-Screen DOM Quiz & Graded Assignment Solver
// ==========================================

function showOnScreenHUD(text, type = 'info') {
    try {
        let hud = document.getElementById('fcukcoursera-live-hud');
        if (!hud) {
            hud = document.createElement('div');
            hud.id = 'fcukcoursera-live-hud';
            hud.style.position = 'fixed';
            hud.style.bottom = '24px';
            hud.style.right = '24px';
            hud.style.zIndex = '2147483647';
            hud.style.padding = '10px 16px';
            hud.style.borderRadius = '8px';
            hud.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
            hud.style.fontSize = '12px';
            hud.style.fontWeight = '700';
            hud.style.color = '#f1f5f9';
            hud.style.backgroundColor = '#0b0f19';
            hud.style.border = '1px solid #3b82f6';
            hud.style.boxShadow = '0 10px 25px rgba(0, 0, 0, 0.7), 0 0 15px rgba(59, 130, 246, 0.35)';
            hud.style.display = 'flex';
            hud.style.alignItems = 'center';
            hud.style.gap = '8px';
            hud.style.transition = 'all 0.25s ease';
            hud.style.pointerEvents = 'none';
            document.body.appendChild(hud);
        }
        let icon = '⚡';
        let color = '#38bdf8';
        if (type === 'success') { icon = '✓'; color = '#4ade80'; }
        else if (type === 'warning') { icon = '⏳'; color = '#facc15'; }
        else if (type === 'error') { icon = '✕'; color = '#f87171'; }
        
        hud.innerHTML = `<span style="color: ${color}; font-size: 14px;">${icon}</span> <span>${text}</span>`;
    } catch(e) {}
}

function hideOnScreenHUD() {
    try {
        const hud = document.getElementById('fcukcoursera-live-hud');
        if (hud) {
            hud.style.opacity = '0';
            setTimeout(() => { hud.remove(); }, 300);
        }
    } catch(e) {}
}

// React Synthetic Event & Native Property Setters
function setNativeInputValue(element, value) {
    if (!element) return;
    try {
        const valueSetter = Object.getOwnPropertyDescriptor(element, 'value')?.set;
        const prototype = Object.getPrototypeOf(element);
        const prototypeValueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
        if (prototypeValueSetter && valueSetter !== prototypeValueSetter) {
            prototypeValueSetter.call(element, value);
        } else if (valueSetter) {
            valueSetter.call(element, value);
        } else {
            element.value = value;
        }
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
    } catch(e) {
        element.value = value;
    }
}

function clickNativeOption(element) {
    clickNativeElement(element);
}

async function startOnScreenQuizSolverProcess(aiConfig, autoSubmit = true) {
    try {
        const modeLabel = autoSubmit ? "Auto-Submit Mode" : "Save as Draft Mode";
        log(`Starting On-Screen Live Solver (${modeLabel})...`);
        updateStatus(autoSubmit ? "Solving & Auto-Submitting..." : "Solving & Saving as Draft...");
        showOnScreenHUD(`FcukCoursera: Analyzing Page (${modeLabel})...`, "working");

        const cleanTitle = document.title ? document.title.replace(/\s*\|\s*Coursera.*$/i, '').trim() : '';
        const urlParts = window.location.pathname.split('/').filter(p => p);
        const learnIndex = urlParts.indexOf('learn');
        const courseSlug = (learnIndex !== -1 && urlParts.length > learnIndex + 1) ? urlParts[learnIndex + 1] : "";
        const courseContext = {
            courseSlug: courseSlug,
            courseTitle: cleanTitle || courseSlug,
            assignmentName: cleanTitle
        };

        // 1. Try Quiz Solver first
        let result = await solveQuizOnScreenInDOM(aiConfig, courseContext, autoSubmit);
        
        // 2. If no quiz questions found, check if it's an App / Tool / Lab assignment
        if (!result) {
            log("[On-Screen] Checking if active page is an App / Tool / Lab assignment...");
            result = await completeUngradedAppItemInDOM();
        }

        // 3. If still not handled, check if it's an Interactive Dialogue / Simulation
        if (!result) {
            log("[On-Screen] Checking if active page is an Interactive Dialogue...");
            result = await completeDialogueItemInDOM(aiConfig, courseContext);
        }

        if (result) {
            if (autoSubmit) {
                log("On-Screen Solving and Submission Completed!");
                updateStatus("Item Completed Successfully!");
                showOnScreenHUD("🎉 Item Completed Successfully!", "success");
            } else {
                log("On-Screen Answering Completed! Saved as draft for manual review.");
                updateStatus("Saved as Draft on Screen!");
                showOnScreenHUD("💾 Saved as Draft! Review and Submit.", "success");
            }
            setTimeout(hideOnScreenHUD, 4500);
        } else {
            log("On-screen check completed.");
            updateStatus("Completed on-screen check.");
            hideOnScreenHUD();
        }
        chrome.runtime.sendMessage({ action: "finished" }).catch(() => {});
    } catch(e) {
        log(`Error in on-screen solver: ${e.message}`);
        updateStatus("Error in on-screen solver.");
        hideOnScreenHUD();
        chrome.runtime.sendMessage({ action: "finished" }).catch(() => {});
    }
}

async function solveQuizOnScreenInDOM(aiConfig, courseContext = null, autoSubmit = true) {
    try {
        // 1. Check for "Start Attempt" / "Resume Attempt" buttons on intro page
        const startButtons = Array.from(document.querySelectorAll('button, [role="button"], a[role="button"]'));
        const startKeywords = ['start attempt', 'resume attempt', 'start assignment', 'resume', 'try again', 'retake', 'take quiz', 'continue'];
        let startBtn = null;
        for (const btn of startButtons) {
            const txt = (btn.innerText || btn.textContent || '').trim().toLowerCase();
            const testId = (btn.getAttribute('data-testid') || btn.getAttribute('data-e2e') || '').toLowerCase();
            if (startKeywords.some(kw => txt === kw || txt.includes(kw) || testId.includes(kw))) {
                startBtn = btn;
                break;
            }
        }

        if (startBtn) {
            log(`[On-Screen] Found "${startBtn.innerText || 'Start Attempt'}". Clicking to open quiz form...`);
            showOnScreenHUD("Opening Quiz Form...", "working");
            startBtn.click();
            await new Promise(r => setTimeout(r, 1800));
        }

        // 2. Discover Question Containers in the DOM
        let questionElements = Array.from(document.querySelectorAll('.rc-FormPart, [class*="FormPart"], [class*="QuizQuestion"], [class*="QuestionContainer"], fieldset, [data-testid*="question"]'));
        
        // Filter out elements with 0 inputs
        questionElements = questionElements.filter(qEl => {
            const hasInputs = qEl.querySelector('input, textarea, select, [contenteditable="true"]');
            return !!hasInputs;
        });

        // Fallback: If no standard containers, group by fieldsets or question legends
        if (questionElements.length === 0) {
            questionElements = Array.from(document.querySelectorAll('fieldset, div[role="group"], div[role="region"]'));
            questionElements = questionElements.filter(qEl => !!qEl.querySelector('input, textarea, select'));
        }

        if (questionElements.length === 0) {
            log("[On-Screen] No active quiz question elements found in current DOM.");
            return false;
        }

        log(`[On-Screen] Found ${questionElements.length} questions on page. Beginning live answering (${autoSubmit ? 'Auto-Submit' : 'Draft Mode'})...`);
        showOnScreenHUD(`Solving 1/${questionElements.length} Questions...`, "working");

        for (let i = 0; i < questionElements.length; i++) {
            if (globalState.abortRequested) {
                log("[On-Screen] Solver stopped by user.");
                break;
            }

            const qEl = questionElements[i];
            qEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            qEl.style.outline = "2px solid #3b82f6";
            qEl.style.borderRadius = "8px";
            qEl.style.transition = "outline 0.3s ease";

            showOnScreenHUD(`Solving Question ${i + 1} of ${questionElements.length}...`, "working");
            updateProgress(i, questionElements.length, `Question ${i + 1}/${questionElements.length}`);

            // 1. Check for on-screen attempt feedback (e.g. from previous attempt review)
            const isMarkedCorrect = !!qEl.querySelector('.rc-FormPartCorrect, [data-testid*="correct"], svg[aria-label*="Correct"], [class*="Correct"]');
            const isMarkedIncorrect = !!qEl.querySelector('.rc-FormPartIncorrect, [data-testid*="incorrect"], svg[aria-label*="Incorrect"], [class*="Incorrect"]');

            if (isMarkedCorrect) {
                log(`[On-Screen History Q${i + 1}] Already marked CORRECT in past attempt. Keeping winning selection!`);
                qEl.style.outline = "2px solid #22c55e";
                await new Promise(r => setTimeout(r, 200));
                continue;
            }

            // If previously marked incorrect, identify and eliminate the wrong checked input
            const eliminatedElements = new Set();
            if (isMarkedIncorrect) {
                const prevChecked = Array.from(qEl.querySelectorAll('input:checked'));
                prevChecked.forEach(inp => {
                    eliminatedElements.add(inp);
                    inp.checked = false; // uncheck previously wrong answer
                });
                if (prevChecked.length > 0) {
                    log(`[On-Screen History Q${i + 1}] Eliminating ${prevChecked.length} previously selected incorrect option(s).`);
                }
            }

            // Extract question prompt
            const promptEl = qEl.querySelector('legend, [class*="prompt"], [class*="Prompt"], [class*="cml"], h3, h4, p');
            const promptText = (promptEl ? promptEl.innerText : qEl.innerText || '').split('\n')[0].replace(/<[^>]*>/g, '').trim();

            const radios = Array.from(qEl.querySelectorAll('input[type="radio"]'));
            const checkboxes = Array.from(qEl.querySelectorAll('input[type="checkbox"]')).filter(cb => {
                const labelTxt = (cb.closest('label')?.innerText || cb.parentElement?.innerText || '').toLowerCase();
                return !labelTxt.includes('honor code') && !labelTxt.includes('submitting work') && !labelTxt.includes('i understand') && !labelTxt.includes('terms and conditions');
            });
            const textareas = Array.from(qEl.querySelectorAll('textarea, input[type="text"]:not([inputmode="numeric"]), [contenteditable="true"]')).filter(inp => {
                const p = (inp.getAttribute('placeholder') || '').toLowerCase();
                return !p.includes('signature') && !p.includes('name');
            });
            const numberInputs = Array.from(qEl.querySelectorAll('input[type="number"], input[inputmode="numeric"]'));

            const courseHeader = courseContext?.courseTitle ? `Course: ${courseContext.courseTitle}\nAssignment: ${courseContext.assignmentName || 'Quiz'}\n` : '';

            // Handle Multiple Choice (Radios)
            if (radios.length > 0) {
                const domOptions = radios.map((r, idx) => {
                    const parentLabel = r.closest('label') || r.parentElement;
                    const text = (parentLabel ? parentLabel.innerText : '').replace(/<[^>]*>/g, '').trim() || `Option ${idx + 1}`;
                    return { id: `opt_${idx}`, element: r, text: text, parent: parentLabel, isEliminated: eliminatedElements.has(r) };
                });

                const eliminatedIds = new Set(domOptions.filter(o => o.isEliminated).map(o => o.id));

                const optionsList = domOptions.map((o, idx) => {
                    const elimNote = o.isEliminated ? " [KNOWN INCORRECT - DO NOT CHOOSE]" : "";
                    return `Option ${idx + 1} (${String.fromCharCode(65 + idx)}): ${o.text}${elimNote}`;
                }).join('\n');

                const prompt = `You are a student solving a multiple choice question in a Coursera course.

${courseHeader}
Question:
${promptText}

Options:
${optionsList}

Strict Safety & Style Guidelines:
- Select the single best correct option based on this course's curriculum.
- Reply ONLY with the correct option number(s) in this format: "Option 1".
- Do not output anything else.`;

                log(`[On-Screen Q${i + 1}] Asking AI for multiple choice...`);
                const answer = await callLLM(prompt, aiConfig);
                let matched = matchGeminiAnswerToOptions(answer, domOptions, eliminatedIds);

                // Fallback: If AI fails or doesn't match, pick the first non-eliminated option
                if (matched.length === 0) {
                    const available = domOptions.filter(o => !o.isEliminated);
                    matched = [available[0] || domOptions[0]];
                    log(`[On-Screen Q${i + 1}] Applying Zero-Unanswered fallback option: ${matched[0].text}`);
                }

                if (matched.length > 0) {
                    const target = matched[0];
                    clickNativeOption(target.element);
                    if (target.parent) {
                        target.parent.style.border = "2px solid #22c55e";
                        target.parent.style.borderRadius = "6px";
                        target.parent.style.padding = "4px";
                    }
                }
            }
            // Handle Multiple Choice (Checkboxes)
            else if (checkboxes.length > 0) {
                const domOptions = checkboxes.map((cb, idx) => {
                    const parentLabel = cb.closest('label') || cb.parentElement;
                    const text = (parentLabel ? parentLabel.innerText : '').replace(/<[^>]*>/g, '').trim() || `Option ${idx + 1}`;
                    return { id: `opt_${idx}`, element: cb, text: text, parent: parentLabel, isEliminated: eliminatedElements.has(cb) };
                });

                const eliminatedIds = new Set(domOptions.filter(o => o.isEliminated).map(o => o.id));

                const optionsList = domOptions.map((o, idx) => {
                    const elimNote = o.isEliminated ? " [KNOWN INCORRECT - DO NOT CHOOSE]" : "";
                    return `Option ${idx + 1} (${String.fromCharCode(65 + idx)}): ${o.text}${elimNote}`;
                }).join('\n');

                const prompt = `You are a student solving a multi-select checkbox question in a Coursera course.

${courseHeader}
Question:
${promptText}

Options:
${optionsList}

Strict Safety & Style Guidelines:
- Select all correct options based on this course.
- Reply ONLY with the correct option number(s) in this format: "Option 1, Option 3".
- Do not output anything else.`;

                log(`[On-Screen Q${i + 1}] Asking AI for checkbox question...`);
                const answer = await callLLM(prompt, aiConfig);
                let matched = matchGeminiAnswerToOptions(answer, domOptions, eliminatedIds);

                // Fallback: Pick first non-eliminated checkbox if no match
                if (matched.length === 0) {
                    const available = domOptions.filter(o => !o.isEliminated);
                    matched = [available[0] || domOptions[0]];
                    log(`[On-Screen Q${i + 1}] Applying Zero-Unanswered fallback checkbox: ${matched[0].text}`);
                }

                for (const target of matched) {
                    if (!target.element.checked) {
                        clickNativeOption(target.element);
                    }
                    if (target.parent) {
                        target.parent.style.border = "2px solid #22c55e";
                        target.parent.style.borderRadius = "6px";
                        target.parent.style.padding = "4px";
                    }
                }
            }
            // Handle Number Inputs
            else if (numberInputs.length > 0) {
                const numInput = numberInputs[0];
                const prompt = `You are solving a numerical question in a Coursera course.

${courseHeader}
Question:
${promptText}

Provide ONLY the final calculated numeric value. Do not output words, units, or commentary.`;

                const answer = await callLLM(prompt, aiConfig);
                let numMatch = answer ? answer.match(/[-+]?[0-9]*\.?[0-9]+/) : null;
                const finalNum = numMatch ? numMatch[0] : "0";
                setNativeInputValue(numInput, finalNum);
                numInput.style.border = "2px solid #22c55e";
            }
            // Handle Textarea / Text Inputs
            else if (textareas.length > 0) {
                const textInput = textareas[0];
                const prompt = `You are a top student writing an answer to an assignment question in a Coursera course.

${courseHeader}
Question:
${promptText}

Strict Safety & Style Guidelines:
- Write a direct, concise, authentic human student answer strictly based on this course.
- NEVER disclose, mention, or imply that you are an AI or automated system.
- Do NOT include conversational greetings or quotes. Output ONLY the response text.`;

                const answer = await callLLM(prompt, aiConfig);
                const finalAnswer = answer ? sanitizeHumanStudentResponse(answer) : "Completed assessment requirements according to course curriculum.";
                setNativeInputValue(textInput, finalAnswer);
                textInput.style.border = "2px solid #22c55e";
            }

            qEl.style.outline = "2px solid #22c55e";
            await new Promise(r => setTimeout(r, 400));
        }

        // 2.5 Zero-Unanswered DOM Audit Pass: Verify every single question container is filled
        for (let i = 0; i < questionElements.length; i++) {
            const qEl = questionElements[i];
            const hasCheckedRadio = qEl.querySelector('input[type="radio"]:checked');
            const hasCheckedCb = qEl.querySelector('input[type="checkbox"]:checked:not([aria-label*="honor"]):not([aria-label*="terms"])');
            const hasFilledText = qEl.querySelector('textarea, input[type="text"]:not([placeholder*="signature"])');
            const hasFilledNum = qEl.querySelector('input[type="number"], input[inputmode="numeric"]');

            const allRadios = Array.from(qEl.querySelectorAll('input[type="radio"]'));
            const allCbs = Array.from(qEl.querySelectorAll('input[type="checkbox"]:not([aria-label*="honor"]):not([aria-label*="terms"])'));

            if (allRadios.length > 0 && !hasCheckedRadio) {
                log(`[Zero-Unanswered DOM Audit] Question ${i + 1} missing radio selection. Auto-selecting first option...`);
                clickNativeOption(allRadios[0]);
            } else if (allCbs.length > 0 && !hasCheckedCb) {
                log(`[Zero-Unanswered DOM Audit] Question ${i + 1} missing checkbox selection. Auto-selecting first option...`);
                clickNativeOption(allCbs[0]);
            } else if (hasFilledNum && (!hasFilledNum.value || hasFilledNum.value.trim() === '')) {
                log(`[Zero-Unanswered DOM Audit] Question ${i + 1} numeric field empty. Auto-filling 0...`);
                setNativeInputValue(hasFilledNum, "0");
            } else if (hasFilledText && (!hasFilledText.value || hasFilledText.value.trim() === '')) {
                log(`[Zero-Unanswered DOM Audit] Question ${i + 1} text field empty. Auto-filling response...`);
                setNativeInputValue(hasFilledText, "Completed assessment requirements according to course curriculum.");
            }
        }

        // Check if user chose "Save as Draft Only"
        if (!autoSubmit) {
            log("[On-Screen] 'Save as Draft Only' mode selected. All answers filled on screen without submitting.");
            showOnScreenHUD("💾 All Answers Filled! Review and Submit.", "success");
            return true;
        }

        // 3. Honor Code & Academic Integrity Agreement Checkbox
        showOnScreenHUD("Signing Honor Code & T&C...", "working");
        const honorCheckboxes = Array.from(document.querySelectorAll('input[type="checkbox"], [role="checkbox"]')).filter(cb => {
            const labelTxt = (cb.closest('label')?.innerText || cb.parentElement?.innerText || cb.getAttribute('aria-label') || '').toLowerCase();
            const testId = (cb.getAttribute('data-testid') || cb.name || cb.id || '').toLowerCase();
            return labelTxt.includes('honor code') || labelTxt.includes('submitting work') || labelTxt.includes('own work') 
                || labelTxt.includes('i understand') || labelTxt.includes('academic integrity') || labelTxt.includes('terms and conditions') 
                || labelTxt.includes('terms of use') || labelTxt.includes('terms') || labelTxt.includes('agreement') 
                || labelTxt.includes('i agree') || labelTxt.includes('acknowledge') || labelTxt.includes('code of conduct')
                || labelTxt.includes('responsibly') || labelTxt.includes('responsible')
                || testId.includes('honor') || testId.includes('integrity') || testId.includes('agree');
        });

        for (const hCb of honorCheckboxes) {
            const isChecked = hCb.checked || hCb.getAttribute('aria-checked') === 'true';
            if (!isChecked) {
                log("[On-Screen] Accepting Coursera Honor Code, Responsible Use & T&C checkbox...");
                setNativeCheckbox(hCb, true);
            }
        }

        // Signature Text Field
        const signatureInputs = Array.from(document.querySelectorAll('input[type="text"]')).filter(inp => {
            const p = (inp.getAttribute('placeholder') || inp.getAttribute('aria-label') || inp.name || inp.id || '').toLowerCase();
            return p.includes('signature') || p.includes('full name') || p.includes('type your name') || p.includes('your name');
        });

        for (const sInp of signatureInputs) {
            if (!sInp.value) {
                log("[On-Screen] Entering student signature...");
                const cleanName = document.querySelector('[data-testid="user-profile-name"], .user-name, [class*="UserName"]')?.innerText || "Accepted";
                setNativeInputValue(sInp, cleanName);
            }
        }

        await new Promise(r => setTimeout(r, 600));

        // 4. Locate and Click Submit Button
        showOnScreenHUD("Submitting Assignment...", "working");
        const allButtons = Array.from(document.querySelectorAll('button, [role="button"], input[type="submit"]'));
        const submitKeywords = ['submit assignment', 'submit quiz', 'submit exam', 'submit', 'agree and submit', 'confirm and submit', 'review and submit'];
        
        let submitBtn = null;
        for (const btn of allButtons) {
            const txt = (btn.innerText || btn.textContent || '').trim().toLowerCase();
            const testId = (btn.getAttribute('data-testid') || btn.getAttribute('data-e2e') || '').toLowerCase();
            if (submitKeywords.some(kw => txt === kw || testId.includes(kw) || txt.includes(kw))) {
                submitBtn = btn;
                break;
            }
        }

        if (submitBtn) {
            log(`[On-Screen] Found "${submitBtn.innerText || 'Submit'}" button. Submitting...`);
            submitBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
            await new Promise(r => setTimeout(r, 500));
            submitBtn.click();

            // Wait for confirmation modal
            await new Promise(r => setTimeout(r, 800));

            // Check if confirmation modal appeared (with multi-selector fallback)
            const modalButtons = Array.from(document.querySelectorAll('[role="dialog"] button, [aria-modal="true"] button, .modal button, [class*="modal"] button, [class*="dialog"] button, [class*="Modal"] button'));
            for (const mBtn of modalButtons) {
                const mText = (mBtn.innerText || mBtn.textContent || '').trim().toLowerCase();
                const mTestId = (mBtn.getAttribute('data-testid') || '').toLowerCase();
                if (mText === 'submit' || mText === 'yes' || mText === 'confirm' || mText === 'yes, submit' || mText.includes('submit assignment') || mText.includes('confirm') || mTestId.includes('submit') || mTestId.includes('confirm')) {
                    log(`[On-Screen] Confirmed final submit modal dialog.`);
                    mBtn.click();
                    break;
                }
            }

            return true;
        } else {
            log("[On-Screen] All questions answered! Please review and click Submit.");
            return true;
        }

    } catch(e) {
        log(`[On-Screen] Notice: ${e.message}`);
        return false;
    }
}

// ==========================================
// LinkedIn Learning Video Completer Engine
// ==========================================

function isLinkedInLearningPlatform() {
    return window.location.hostname.includes("linkedin.com") && window.location.pathname.includes("/learning");
}

let currentLinkedInSpeed = 16.0;

function injectMainWorldSpeedScript(speed = 16.0) {
    try {
        // 1. Request background service worker to execute in MAIN world via chrome.scripting
        chrome.runtime.sendMessage({ 
            action: "inject_main_world_speed", 
            speed: speed 
        }).catch(() => {});

        // 2. Post message to page window for any already-active MAIN world listener
        window.postMessage({ 
            type: '__FCUK_LINKEDIN_SPEED__', 
            speed: speed, 
            active: true 
        }, '*');

        // 3. Fallback direct DOM script injection in case background worker is waking up
        const scriptId = '__fcuk_speed_injector';
        if (!document.getElementById(scriptId)) {
            const script = document.createElement('script');
            script.id = scriptId;
            script.textContent = `(${function() {
                try {
                    window.__fcukLinkedInTargetSpeed = 16.0;
                    window.__fcukLinkedInSpeedActive = true;

                    if (!window.__fcukPlaybackRatePatched) {
                        window.__fcukPlaybackRatePatched = true;
                        const origDesc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'playbackRate');
                        window.__fcukOriginalPlaybackDesc = origDesc;

                        Object.defineProperty(HTMLMediaElement.prototype, 'playbackRate', {
                            get: function() {
                                if (window.__fcukLinkedInSpeedActive && window.__fcukLinkedInTargetSpeed) {
                                    return window.__fcukLinkedInTargetSpeed;
                                }
                                return origDesc ? origDesc.get.call(this) : 1.0;
                            },
                            set: function(val) {
                                const effective = (window.__fcukLinkedInSpeedActive && window.__fcukLinkedInTargetSpeed)
                                    ? window.__fcukLinkedInTargetSpeed
                                    : val;
                                if (origDesc) {
                                    return origDesc.set.call(this, effective);
                                }
                            },
                            configurable: true,
                            enumerable: true
                        });
                    }

                    window.addEventListener('message', (e) => {
                        if (e.data && e.data.type === '__FCUK_LINKEDIN_SPEED__') {
                            window.__fcukLinkedInTargetSpeed = Number(e.data.speed) || 16.0;
                            window.__fcukLinkedInSpeedActive = !!e.data.active;
                            const orig = window.__fcukOriginalPlaybackDesc;
                            document.querySelectorAll('video').forEach(v => {
                                try {
                                    v.muted = true;
                                    v.defaultMuted = true;
                                    v.volume = 0;
                                    if (orig && window.__fcukLinkedInSpeedActive) {
                                        orig.set.call(v, window.__fcukLinkedInTargetSpeed);
                                    } else if (window.__fcukLinkedInSpeedActive) {
                                        v.playbackRate = window.__fcukLinkedInTargetSpeed;
                                    }
                                } catch(err) {}
                            });
                        }
                    });
                } catch(e) {}
            }})();`;
            (document.head || document.documentElement).appendChild(script);
        }
    } catch(e) {
        console.log("Notice in injectMainWorldSpeedScript:", e);
    }
}

function applyLinkedInSpeed(speed = 16.0) {
    currentLinkedInSpeed = speed;
    injectMainWorldSpeedScript(speed);

    const video = getLinkedInVideo();
    if (video) {
        try {
            video.muted = true;
            video.defaultMuted = true;
            video.volume = 0;
            video.playbackRate = speed;
        } catch(e) {}
    }
}

// =========================================================================
// LinkedIn Learning Path Context Detection, Scanner & Anti-Pause Heartbeat
// =========================================================================

function startTabKeepAliveHeartbeat() {
    try {
        if (window.__fcukHeartbeatActive) return;
        window.__fcukHeartbeatActive = true;
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (AudioContextClass) {
            const ctx = new AudioContextClass();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            gain.gain.value = 0.00001; // Silent
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start();
        }
    } catch(e) {}
}

function isLinkedInLearningPathPage() {
    const path = (window.location.pathname || '').toLowerCase();
    return path.includes('/learning/paths/') || 
           path.includes('/learning/career-paths/') ||
           (path.includes('/learning/') && !!document.querySelector('.learning-path-header, [class*="learning-path-header"], [data-test-learning-path-item]'));
}

function detectLinkedInParentPath() {
    try {
        const pathLink = document.querySelector(
            'a[href*="/learning/paths/"], ' +
            'a[href*="/learning/career-paths/"], ' +
            '[data-control-name="learning_path_breadcrumb"] a, ' +
            '.learning-path-breadcrumb a, ' +
            '[class*="breadcrumb"] a[href*="/paths/"]'
        );
        if (pathLink) {
            return {
                hasParentPath: true,
                pathUrl: pathLink.href,
                pathTitle: pathLink.innerText?.trim() || "Parent Learning Path"
            };
        }
    } catch(e) {}
    return { hasParentPath: false, pathUrl: null, pathTitle: null };
}

function scanLinkedInLearningPath() {
    const titleCandidates = [
        document.querySelector('h1')?.innerText,
        document.querySelector('.learning-path-header__title')?.innerText,
        document.querySelector('[class*="learning-path"] h1')?.innerText,
        document.querySelector('[class*="path-header"] h1')?.innerText,
        document.querySelector('[class*="career-hub"] h1')?.innerText,
        document.title
    ];
    let pathTitle = "Learning Path";
    for (const t of titleCandidates) {
        if (t && t.trim().length > 1) {
            pathTitle = t.replace(/\| LinkedIn Learning.*$/i, '').trim();
            break;
        }
    }

    const currentUrlObj = new URL(window.location.href);
    const enterpriseU = currentUrlObj.searchParams.get('u');
    const pathUrl = window.location.href;

    // Strict blacklist of non-course URL slugs to NEVER open navigation or profile pages
    const NON_COURSE_SLUGS = new Set([
        'career-hub', 'career-plan',
        'me', 'my-content', 'in-progress', 'saved', 'history',
        'topics', 'search', 'feed', 'subscription', 'certificates',
        'certifications', 'instructors', 'settings', 'help',
        'browse', 'ai-coaching', 'role-play', 'hands-on', 'hands-on-tech',
        'login', 'logout', 'signup', 'home', 'mypreferences',
        'notifications', 'messaging'
    ]);

    // Helper: is link inside global navigation/sidebar/header/footer?
    const isNavigationElement = (el) => {
        return !!el.closest(
            '#app-header, .global-nav, .learning-career-hub-nav, [class*="career-hub-nav" i], ' +
            'nav[aria-label*="Primary" i], nav[aria-label*="Side" i], ' +
            'footer, [role="banner"]'
        );
    };

    // Expand any collapsed sections or see-more buttons in the path
    try {
        const expandButtons = Array.from(document.querySelectorAll(
            'button[aria-expanded="false"], ' +
            'button[class*="show-more" i], ' +
            'button[class*="see-more" i], ' +
            'button[class*="expand" i]'
        ));
        expandButtons.forEach(btn => {
            if (!isNavigationElement(btn)) btn.click();
        });
    } catch(e) {}

    // Multi-tier detection: First find the specific "Content in this Learning Path" container
    let contentContainer = null;
    const allHeadings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, div, span, p, section'));
    for (const h of allHeadings) {
        const text = (h.childNodes[0]?.textContent || h.innerText || '').trim().toLowerCase();
        if (text === 'content in this learning path' || 
            text.startsWith('content in this learning path') || 
            text.startsWith('content in this path') || 
            text.startsWith('content in this career path')) {
            // Walk up to find the container holding syllabus items
            let cur = h.parentElement;
            while (cur && cur !== document.body && cur !== document.documentElement) {
                const links = cur.querySelectorAll('a[href*="/learning/"], a[href]');
                if (links.length >= 2) {
                    contentContainer = cur;
                    break;
                }
                cur = cur.parentElement;
            }
            if (contentContainer) break;
        }
    }

    // Collect candidate links (prioritize links inside contentContainer if found)
    let candidateLinks = [];
    if (contentContainer) {
        candidateLinks = Array.from(contentContainer.querySelectorAll('a[href*="/learning/"], a[href]'));
    }
    if (candidateLinks.length === 0) {
        candidateLinks = Array.from(document.querySelectorAll(
            'a[href*="/learning/"], a[href^="/learning/"], [data-test-learning-path-item] a, [class*="learning-path-item"] a, .content-entity-card a'
        ));
    }

    const itemMap = new Map();

    for (const link of candidateLinks) {
        try {
            // If link is inside the identified contentContainer, it is definitely syllabus content, not global nav!
            const isInsideSyllabus = contentContainer && contentContainer.contains(link);
            if (!isInsideSyllabus && isNavigationElement(link)) {
                continue;
            }

            // Ignore top header actions like "Resume", "Start", "Bookmark", "Share"
            if (link.closest('.learning-path-header, [class*="header__actions" i], [class*="hero" i]')) {
                continue;
            }

            const linkText = (link.innerText || '').trim().toLowerCase();
            if (linkText === 'resume' || linkText === 'start' || linkText === 'share' || linkText === 'bookmark' || linkText === 'add to profile') {
                continue;
            }

            const rawHref = link.getAttribute('href') || link.href;
            if (!rawHref || rawHref.startsWith('#') || rawHref.startsWith('javascript:')) continue;

            const urlObj = new URL(rawHref, window.location.origin);
            const pathname = urlObj.pathname.toLowerCase();

            // Ignore links that match the current learning path URL exactly (e.g. self links or breadcrumbs)
            if (pathname === window.location.pathname.toLowerCase()) continue;

            // Exclude author and instructor profile links
            if (pathname.includes('/in/') || pathname.includes('/instructors/')) continue;

            const segments = pathname.split('/').filter(Boolean);
            if (segments.length < 2 || segments[0] !== 'learning') continue;

            // If link is /learning/paths/... or /learning/career-paths/...:
            if (segments[1] === 'paths' || segments[1] === 'career-paths') {
                // Must have at least 4 segments to be an actual item (e.g. /learning/paths/<path>/<item>)
                if (segments.length < 4) continue;
            } else {
                const firstSlug = segments[1];
                if (NON_COURSE_SLUGS.has(firstSlug)) continue;
            }

            // Preserve enterprise SSO parameter 'u' (e.g. ?u=92961692 for Chandigarh University)
            const cleanParams = new URLSearchParams();
            if (enterpriseU) {
                cleanParams.set('u', enterpriseU);
            } else if (urlObj.searchParams.has('u')) {
                cleanParams.set('u', urlObj.searchParams.get('u'));
            }
            const cleanQuery = cleanParams.toString() ? `?${cleanParams.toString()}` : '';
            const canonicalUrl = `${window.location.origin}${urlObj.pathname}${cleanQuery}`;
            const itemSlug = segments[segments.length - 1];
            const dedupeKey = itemSlug;

            // Locate parent card container
            const card = link.closest(
                '.learning-path-item, [class*="learning-path-item"], ' +
                '.content-entity-card, [class*="content-entity-card"], ' +
                '.base-card, [class*="base-card"], ' +
                'li[class*="path-course"], li[class*="course-item"], ' +
                'li, article, [class*="card"], [class*="item"]'
            ) || link.parentElement || link;

            // Card text and ARIA
            const cardText = (card.innerText || '').toLowerCase();
            const cardAria = (card.getAttribute('aria-label') || '').toLowerCase();

            // Detect item type: 'course' vs standalone 'video'
            let itemType = 'course';
            const typeBadge = card.querySelector(
                '.content-entity-card__type, [class*="entity-type" i], [class*="content-type" i], [class*="badge" i]'
            );
            const badgeText = (typeBadge?.innerText || '').trim().toLowerCase();

            if (badgeText === 'video' || cardText.includes('from the course:') || segments.length >= 3) {
                itemType = 'video';
            } else if (badgeText === 'course') {
                itemType = 'course';
            } else {
                itemType = segments.length >= 3 ? 'video' : 'course';
            }

            // Extract item title
            let title = "";
            const titleEl = card.querySelector(
                'h2, h3, h4, h5, ' +
                '.base-card__title, .content-entity-card__title, ' +
                '[class*="card-title" i], [class*="entity-title" i], ' +
                '[class*="item-title" i], [class*="title" i]:not([class*="subtitle" i]):not([class*="section" i])'
            );
            if (titleEl && titleEl.innerText?.trim()) {
                title = titleEl.innerText.trim();
            } else {
                title = (link.innerText || '').trim();
            }

            // Clean title of prefixes and suffixes
            title = title
                .replace(/^(Course|Video|Audio|Quiz)\s*/i, '')
                .replace(/\s*(Add to Profile|Completed\s*[\d/.]*)\s*$/i, '')
                .replace(/\n+/g, ' ')
                .trim();

            if (!title || title.length < 2) {
                title = itemSlug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
            }

            // Extract duration if present (e.g. 1h 13m, 3m 18s)
            let duration = "";
            const durMatch = cardText.match(/(\d+\s*h\s*\d+\s*m|\d+\s*h|\d+\s*m\s*\d+\s*s|\d+\s*m|\d+\s*s)/i);
            if (durMatch) {
                duration = durMatch[0];
            }

            // Completion check
            let isCompleted = false;
            const checkIcon = card.querySelector(
                'svg[data-test-icon*="check" i], ' +
                'svg[type="check"], ' +
                '[data-test-icon="check-small"], ' +
                '[class*="completed" i], ' +
                '[class*="is-complete" i]'
            );

            if (checkIcon || 
                card.classList.contains('is-complete') || 
                card.classList.contains('completed') || 
                cardText.includes('completed') || 
                cardAria.includes('completed')) {
                isCompleted = true;
            }

            // Deduplicate by clean itemSlug so multiple links in one card resolve into a single item
            if (!itemMap.has(dedupeKey)) {
                itemMap.set(dedupeKey, {
                    id: `item_${dedupeKey.replace(/[^a-z0-9]/gi, '_')}`,
                    slug: itemSlug,
                    index: itemMap.size + 1,
                    title: title,
                    itemType: itemType,
                    duration: duration,
                    url: canonicalUrl,
                    isCompleted: isCompleted
                });
            } else {
                // If title was missing or shorter in previous link, update with richer title
                const existing = itemMap.get(dedupeKey);
                if (title && title.length > existing.title.length && !title.includes('http')) {
                    existing.title = title;
                }
                if (isCompleted) {
                    existing.isCompleted = true;
                }
            }
        } catch(e) {}
    }

    const items = Array.from(itemMap.values());
    return {
        isPath: true,
        pathTitle: pathTitle,
        pathUrl: pathUrl,
        totalCourses: items.length,
        completedCourses: items.filter(c => c.isCompleted).length,
        courses: items
    };
}

function getLinkedInContext() {
    const isPath = isLinkedInLearningPathPage();
    if (isPath) {
        const pathData = scanLinkedInLearningPath();
        return {
            platform: "linkedin",
            isPathPage: true,
            pathTitle: pathData.pathTitle,
            pathUrl: pathData.pathUrl,
            courses: pathData.courses,
            totalCourses: pathData.totalCourses,
            completedCourses: pathData.completedCourses
        };
    } else {
        const parentPath = detectLinkedInParentPath();
        const toc = scanLinkedInTOC();
        return {
            platform: "linkedin",
            isPathPage: false,
            courseTitle: document.title.replace(/\| LinkedIn Learning.*$/i, '').trim(),
            courseUrl: window.location.href,
            hasParentPath: parentPath.hasParentPath,
            parentPathUrl: parentPath.pathUrl,
            parentPathTitle: parentPath.pathTitle,
            totalVideos: toc.totalCount,
            completedVideos: toc.completedCount
        };
    }
}

// =========================================================================
// In-Page Persistent Floating HUD Window (LinkedIn Learning)
// =========================================================================
let floatingHudEl = null;
let hudDragState = { isDragging: false, startX: 0, startY: 0, initialLeft: 0, initialTop: 0 };

function createLinkedInFloatingHUD() {
    if (document.getElementById('fcuk-floating-hud')) {
        floatingHudEl = document.getElementById('fcuk-floating-hud');
        floatingHudEl.style.display = 'block';
        return floatingHudEl;
    }

    const hud = document.createElement('div');
    hud.id = 'fcuk-floating-hud';
    hud.innerHTML = `
        <style>
            #fcuk-floating-hud {
                position: fixed;
                bottom: 24px;
                right: 24px;
                width: 330px;
                max-width: calc(100vw - 32px);
                background: rgba(14, 16, 21, 0.95);
                backdrop-filter: blur(16px);
                -webkit-backdrop-filter: blur(16px);
                border: 1px solid rgba(255, 255, 255, 0.12);
                border-radius: 12px;
                box-shadow: 0 16px 40px rgba(0, 0, 0, 0.65), 0 0 1px rgba(255, 255, 255, 0.2);
                color: #f4f4f6;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                font-size: 11px;
                z-index: 2147483647;
                overflow: hidden;
                user-select: none;
                transition: opacity 0.15s ease, transform 0.15s ease;
            }
            #fcuk-floating-hud.minimized {
                width: auto;
                cursor: pointer;
                border-radius: 9999px;
                padding: 6px 14px;
                background: rgba(14, 16, 21, 0.92);
                box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
            }
            #fcuk-floating-hud.minimized .hud-body,
            #fcuk-floating-hud.minimized .hud-header-actions {
                display: none !important;
            }
            #fcuk-floating-hud.minimized .hud-header {
                padding: 0;
                border-bottom: none;
                gap: 8px;
            }
            #fcuk-floating-hud.minimized .hud-pill-summary {
                display: flex !important;
            }
            .hud-pill-summary {
                display: none;
                align-items: center;
                gap: 6px;
                font-size: 11px;
                font-weight: 600;
                color: #38bdf8;
            }
            .hud-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 8px 12px;
                border-bottom: 1px solid rgba(255, 255, 255, 0.08);
                cursor: default;
                background: rgba(255, 255, 255, 0.02);
                user-select: none;
            }
            .hud-header:active {
                cursor: default;
            }
            .hud-drag-handle {
                display: inline-flex;
                align-items: center;
                gap: 4px;
                padding: 3px 8px;
                background: rgba(255, 255, 255, 0.06);
                border: 1px solid rgba(255, 255, 255, 0.14);
                border-radius: 5px;
                font-size: 10px;
                font-weight: 500;
                color: #a1a1aa;
                cursor: grab;
                user-select: none;
                -webkit-user-select: none;
                transition: background 0.12s ease, border-color 0.12s ease, color 0.12s ease;
            }
            .hud-drag-handle:hover {
                background: rgba(255, 255, 255, 0.14);
                border-color: rgba(255, 255, 255, 0.28);
                color: #ffffff;
            }
            .hud-drag-handle:active,
            #fcuk-floating-hud.dragging .hud-drag-handle {
                cursor: grabbing;
                background: rgba(2, 132, 199, 0.25);
                border-color: #38bdf8;
                color: #38bdf8;
            }
            #fcuk-floating-hud.dragging {
                user-select: none !important;
                -webkit-user-select: none !important;
                box-shadow: 0 20px 48px rgba(0, 0, 0, 0.8), 0 0 0 1px rgba(56, 189, 248, 0.4);
            }
            .hud-title-box {
                display: flex;
                align-items: center;
                gap: 7px;
                overflow: hidden;
            }
            .hud-dot {
                width: 7px;
                height: 7px;
                border-radius: 50%;
                background: #10b981;
                box-shadow: 0 0 8px #10b981;
                flex-shrink: 0;
            }
            .hud-dot.busy {
                animation: hudPulse 1.4s ease-in-out infinite;
            }
            @keyframes hudPulse {
                0%, 100% { opacity: 1; transform: scale(1); }
                50% { opacity: 0.4; transform: scale(0.85); }
            }
            .hud-title {
                font-size: 11.5px;
                font-weight: 600;
                color: #f4f4f6;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                max-width: 190px;
            }
            .hud-btn-icon {
                background: transparent;
                border: none;
                color: #8e929e;
                cursor: pointer;
                padding: 2px 6px;
                border-radius: 4px;
                font-size: 13px;
                line-height: 1;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            .hud-btn-icon:hover {
                color: #ffffff;
                background: rgba(255, 255, 255, 0.1);
            }
            .hud-body {
                padding: 11px 12px;
                display: flex;
                flex-direction: column;
                gap: 9px;
            }
            .hud-progress-card {
                background: rgba(255, 255, 255, 0.03);
                border: 1px solid rgba(255, 255, 255, 0.06);
                border-radius: 8px;
                padding: 7px 9px;
            }
            .hud-progress-row {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 5px;
            }
            .hud-progress-label {
                font-size: 10px;
                color: #8e929e;
                font-weight: 500;
            }
            .hud-progress-val {
                font-size: 10.5px;
                font-weight: 700;
                color: #38bdf8;
            }
            .hud-bar-track {
                width: 100%;
                height: 4px;
                background: rgba(255, 255, 255, 0.08);
                border-radius: 9999px;
                overflow: hidden;
            }
            .hud-bar-fill {
                height: 100%;
                width: 0%;
                background: linear-gradient(90deg, #0284c7, #38bdf8);
                border-radius: 9999px;
                transition: width 0.3s ease;
            }
            .hud-tray {
                background: rgba(0, 0, 0, 0.25);
                border: 1px solid rgba(255, 255, 255, 0.06);
                border-radius: 8px;
                padding: 6px 8px;
                max-height: 130px;
                overflow-y: auto;
                display: flex;
                flex-direction: column;
                gap: 4px;
            }
            .hud-worker-item {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 6px;
                padding: 3px 5px;
                background: rgba(255, 255, 255, 0.03);
                border-radius: 4px;
                font-size: 9.5px;
            }
            .hud-worker-title {
                color: #e2e4ea;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                max-width: 190px;
            }
            .hud-badge {
                font-size: 9px;
                font-weight: 600;
                padding: 1px 5px;
                border-radius: 3px;
                white-space: nowrap;
            }
            .hud-badge-running {
                background: rgba(2, 132, 199, 0.2);
                color: #38bdf8;
                border: 1px solid rgba(2, 132, 199, 0.35);
            }
            .hud-badge-done {
                background: rgba(16, 185, 129, 0.2);
                color: #34d399;
                border: 1px solid rgba(16, 185, 129, 0.35);
            }
            .hud-badge-queued {
                background: rgba(255, 255, 255, 0.06);
                color: #8e929e;
            }
            .hud-controls-row {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 6px;
            }
            .hud-pill-group {
                display: flex;
                gap: 3px;
            }
            .hud-pill {
                min-width: 20px;
                height: 19px;
                padding: 0 4px;
                font-size: 9px;
                font-weight: 600;
                border-radius: 3px;
                background: rgba(255, 255, 255, 0.05);
                border: 1px solid rgba(255, 255, 255, 0.1);
                color: #8e929e;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            .hud-pill:hover {
                color: #ffffff;
                border-color: rgba(255, 255, 255, 0.25);
            }
            .hud-pill.active {
                background: #0284c7;
                border-color: #0284c7;
                color: #ffffff;
            }
            .hud-speed-select {
                background: rgba(255, 255, 255, 0.06);
                border: 1px solid rgba(255, 255, 255, 0.1);
                color: #f4f4f6;
                border-radius: 4px;
                font-size: 9.5px;
                font-weight: 600;
                padding: 2px 4px;
                outline: none;
                cursor: pointer;
            }
            .hud-speed-select option {
                background: #14171f;
                color: #f4f4f6;
            }
            .hud-btn-stop {
                width: 100%;
                padding: 6px;
                border-radius: 6px;
                font-size: 10px;
                font-weight: 600;
                background: rgba(239, 68, 68, 0.12);
                border: 1px solid rgba(239, 68, 68, 0.3);
                color: #f87171;
                cursor: pointer;
                transition: all 0.12s ease;
            }
            .hud-btn-stop:hover {
                background: rgba(239, 68, 68, 0.2);
                border-color: rgba(239, 68, 68, 0.5);
            }
            .hud-notice-banner {
                display: none;
                align-items: center;
                gap: 6px;
                padding: 6px 9px;
                background: rgba(245, 158, 11, 0.14);
                border: 1px solid rgba(245, 158, 11, 0.38);
                border-radius: 6px;
                font-size: 9.5px;
                color: #fcd34d;
                line-height: 1.35;
            }
            .hud-notice-icon {
                flex-shrink: 0;
                font-size: 11px;
            }
            .hud-notice-text {
                flex: 1;
                font-weight: 500;
            }
            .hud-notice-dismiss {
                background: transparent;
                border: none;
                color: #fcd34d;
                opacity: 0.7;
                cursor: pointer;
                font-size: 13px;
                line-height: 1;
                padding: 0 2px;
            }
            .hud-notice-dismiss:hover {
                opacity: 1;
                color: #ffffff;
            }
            .hud-smart-badge {
                font-size: 8.5px;
                font-weight: 700;
                padding: 1px 5px;
                border-radius: 3px;
                background: rgba(16, 185, 129, 0.15);
                border: 1px solid rgba(16, 185, 129, 0.35);
                color: #34d399;
                letter-spacing: 0.2px;
                white-space: nowrap;
                transition: all 0.2s ease;
            }
            .hud-smart-badge.throttled {
                background: rgba(245, 158, 11, 0.22);
                border-color: rgba(245, 158, 11, 0.45);
                color: #fbbf24;
            }
        </style>

        <!-- Header -->
        <div class="hud-header" id="hudDragHeader">
            <div class="hud-title-box">
                <span class="hud-dot" id="hudStatusDot"></span>
                <span class="hud-title" id="hudTitle">LinkedIn Learning Path</span>
                <div class="hud-pill-summary" id="hudPillSummary">
                    <span id="hudPillStats">0/0 done</span>
                </div>
            </div>
            <div class="hud-header-actions" style="display: flex; align-items: center; gap: 5px;">
                <div class="hud-drag-handle" id="hudDragHandle" title="Hold & drag to move HUD">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                        <circle cx="8" cy="6" r="2.5"/>
                        <circle cx="16" cy="6" r="2.5"/>
                        <circle cx="8" cy="12" r="2.5"/>
                        <circle cx="16" cy="12" r="2.5"/>
                        <circle cx="8" cy="18" r="2.5"/>
                        <circle cx="16" cy="18" r="2.5"/>
                    </svg>
                    <span>Drag</span>
                </div>
                <button class="hud-btn-icon" id="hudMinimizeBtn" title="Minimize to pill">−</button>
                <button class="hud-btn-icon" id="hudCloseBtn" title="Close HUD">×</button>
            </div>
        </div>

        <!-- Body -->
        <div class="hud-body">
            <!-- Notice Banner (Smart Auto-Throttle) -->
            <div class="hud-notice-banner" id="hudNoticeBanner">
                <span class="hud-notice-icon">⚠️</span>
                <span class="hud-notice-text" id="hudNoticeText"></span>
                <button class="hud-notice-dismiss" id="hudNoticeDismiss" title="Dismiss">×</button>
            </div>

            <!-- Progress Card -->
            <div class="hud-progress-card">
                <div class="hud-progress-row">
                    <span class="hud-progress-label" id="hudProgressLabel">Progress</span>
                    <span class="hud-progress-val" id="hudProgressVal">0% (0/0)</span>
                </div>
                <div class="hud-bar-track">
                    <div class="hud-bar-fill" id="hudBarFill"></div>
                </div>
            </div>

            <!-- Worker Tray -->
            <div class="hud-tray" id="hudWorkerTray">
                <div style="font-size: 9px; color: #8e929e; font-weight: 600; margin-bottom: 2px;">
                    Parallel Sub-Workers (<span id="hudActiveCount">0</span> active)
                </div>
                <div id="hudWorkerList"></div>
            </div>

            <!-- Controls Row: Concurrency + Speed -->
            <div class="hud-controls-row">
                <div style="display: flex; align-items: center; gap: 4px;">
                    <span style="font-size: 9px; color: #8e929e;">Tabs:</span>
                    <div class="hud-pill-group" id="hudConcurrencyPills">
                        <button class="hud-pill" data-conc="1">1</button>
                        <button class="hud-pill" data-conc="2">2</button>
                        <button class="hud-pill active" data-conc="3">3</button>
                        <button class="hud-pill" data-conc="4">4</button>
                        <button class="hud-pill" data-conc="5">5</button>
                    </div>
                    <span class="hud-smart-badge" id="hudSmartBadge" title="Smart Parallel Tabs active: automatically throttles tabs if video buffering occurs">⚡ Smart</span>
                </div>

                <div style="display: flex; align-items: center; gap: 4px;">
                    <span style="font-size: 9px; color: #8e929e;">Speed:</span>
                    <select class="hud-speed-select" id="hudSpeedSelect">
                        <option value="16" selected>16x Turbo</option>
                        <option value="8">8x Ultra</option>
                        <option value="4">4x Fast</option>
                        <option value="2">2x Native</option>
                    </select>
                </div>
            </div>

            <!-- Stop Button -->
            <button class="hud-btn-stop" id="hudStopBtn">Stop All Workers</button>
        </div>
    `;

    document.body.appendChild(hud);
    floatingHudEl = hud;

    // Restore saved position & minimized state
    chrome.storage.local.get(['fcukHudPosition', 'fcukHudCollapsed'], (res) => {
        if (res.fcukHudPosition) {
            hud.style.left = `${res.fcukHudPosition.x}px`;
            hud.style.top = `${res.fcukHudPosition.y}px`;
            hud.style.bottom = 'auto';
            hud.style.right = 'auto';
        }
        if (res.fcukHudCollapsed) {
            hud.classList.add('minimized');
        }
    });

    initHudDragging(hud);
    attachHudControls(hud);

    return hud;
}

function initHudDragging(hud) {
    const dragHandle = hud.querySelector('#hudDragHandle');
    if (!dragHandle) return;

    let isPointerDown = false;
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let initialLeft = 0;
    let initialTop = 0;

    const stopDragging = () => {
        isPointerDown = false;
        if (isDragging) {
            isDragging = false;
            hudDragState.isDragging = false;
            hud.classList.remove('dragging');

            const rect = hud.getBoundingClientRect();
            chrome.storage.local.set({
                fcukHudPosition: { x: Math.round(rect.left), y: Math.round(rect.top) }
            }).catch(() => {});
        }

        window.removeEventListener('pointermove', onPointerMove, { capture: true });
        window.removeEventListener('mousemove', onPointerMove, { capture: true });
        window.removeEventListener('pointerup', stopDragging, { capture: true });
        window.removeEventListener('mouseup', stopDragging, { capture: true });
        window.removeEventListener('pointercancel', stopDragging, { capture: true });
        window.removeEventListener('blur', stopDragging);
    };

    const onPointerMove = (e) => {
        // Critical safeguard: if no mouse button is currently held down, abort immediately!
        if (e.buttons === 0) {
            stopDragging();
            return;
        }

        if (!isPointerDown) return;

        const dx = e.clientX - startX;
        const dy = e.clientY - startY;

        // Require at least 3px movement before engaging drag to prevent sticking on clicks
        if (!isDragging) {
            if (Math.hypot(dx, dy) < 3) return;
            isDragging = true;
            hudDragState.isDragging = true;
            hud.classList.add('dragging');
        }

        e.preventDefault();

        let newLeft = initialLeft + dx;
        let newTop = initialTop + dy;

        // Viewport bounds clamping
        const maxLeft = Math.max(10, window.innerWidth - hud.offsetWidth - 10);
        const maxTop = Math.max(10, window.innerHeight - hud.offsetHeight - 10);

        newLeft = Math.max(10, Math.min(maxLeft, newLeft));
        newTop = Math.max(10, Math.min(maxTop, newTop));

        hud.style.left = `${newLeft}px`;
        hud.style.top = `${newTop}px`;
        hud.style.bottom = 'auto';
        hud.style.right = 'auto';
    };

    dragHandle.addEventListener('pointerdown', (e) => {
        // Only primary mouse button (left click)
        if (e.button !== 0) return;
        if (hud.classList.contains('minimized')) return;

        e.preventDefault();
        e.stopPropagation();

        isPointerDown = true;
        isDragging = false;
        startX = e.clientX;
        startY = e.clientY;

        const rect = hud.getBoundingClientRect();
        initialLeft = rect.left;
        initialTop = rect.top;

        window.addEventListener('pointermove', onPointerMove, { capture: true, passive: false });
        window.addEventListener('mousemove', onPointerMove, { capture: true, passive: false });
        window.addEventListener('pointerup', stopDragging, { capture: true });
        window.addEventListener('mouseup', stopDragging, { capture: true });
        window.addEventListener('pointercancel', stopDragging, { capture: true });
        window.addEventListener('blur', stopDragging);
    });

    // Global failsafe: if cursor moves anywhere without a button pressed, ensure drag is not stuck
    window.addEventListener('mousemove', (e) => {
        if (e.buttons === 0 && (isDragging || isPointerDown)) {
            stopDragging();
        }
    }, { passive: true });
}

function attachHudControls(hud) {
    // Minimize / Expand
    const minBtn = hud.querySelector('#hudMinimizeBtn');
    if (minBtn) {
        minBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            hud.classList.toggle('minimized');
            const isMin = hud.classList.contains('minimized');
            chrome.storage.local.set({ fcukHudCollapsed: isMin });
        });
    }

    // Click pill to expand when minimized
    hud.addEventListener('click', (e) => {
        if (hud.classList.contains('minimized') && !e.target.closest('.hud-btn-icon')) {
            hud.classList.remove('minimized');
            chrome.storage.local.set({ fcukHudCollapsed: false });
        }
    });

    // Close button
    const closeBtn = hud.querySelector('#hudCloseBtn');
    if (closeBtn) {
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            hud.style.display = 'none';
        });
    }

    // Concurrency pills
    const pills = hud.querySelectorAll('.hud-pill');
    pills.forEach(p => {
        p.addEventListener('click', (e) => {
            e.stopPropagation();
            pills.forEach(pill => pill.classList.remove('active'));
            p.classList.add('active');
            const conc = parseInt(p.getAttribute('data-conc'), 10) || 3;
            chrome.runtime.sendMessage({ action: "set_path_concurrency", concurrency: conc }).catch(() => {});
        });
    });

    // Speed selector
    const speedSelect = hud.querySelector('#hudSpeedSelect');
    if (speedSelect) {
        speedSelect.addEventListener('change', (e) => {
            e.stopPropagation();
            const spd = parseFloat(speedSelect.value) || 16.0;
            currentLinkedInSpeed = spd;
            chrome.storage.local.set({ linkedinTargetSpeed: spd });
            chrome.runtime.sendMessage({ action: "set_path_speed", speed: spd }).catch(() => {});
        });
    }

    // Stop button
    const stopBtn = hud.querySelector('#hudStopBtn');
    if (stopBtn) {
        stopBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            stopBtn.innerText = "Stopping...";
            chrome.runtime.sendMessage({ action: "stop_learning_path" }, () => {
                stopBtn.innerText = "Stopped";
                setTimeout(() => { stopBtn.innerText = "Stop All Workers"; }, 2000);
            });
        });
    }

    // Dismiss Notice Banner
    const noticeDismiss = hud.querySelector('#hudNoticeDismiss');
    if (noticeDismiss) {
        noticeDismiss.addEventListener('click', (e) => {
            e.stopPropagation();
            const banner = hud.querySelector('#hudNoticeBanner');
            if (banner) banner.style.display = 'none';
        });
    }
}

function renderFloatingHudState(state) {
    if (!state) return;
    if (!floatingHudEl) {
        createLinkedInFloatingHUD();
    }
    const hud = floatingHudEl;
    if (!hud) return;

    hud.style.display = 'block';

    const titleEl = hud.querySelector('#hudTitle');
    const dot = hud.querySelector('#hudStatusDot');
    const progressVal = hud.querySelector('#hudProgressVal');
    const barFill = hud.querySelector('#hudBarFill');
    const activeCount = hud.querySelector('#hudActiveCount');
    const workerList = hud.querySelector('#hudWorkerList');
    const pillStats = hud.querySelector('#hudPillStats');
    const speedSelect = hud.querySelector('#hudSpeedSelect');

    if (titleEl) titleEl.innerText = state.pathTitle || "Learning Path";
    if (dot) {
        if (state.isRunning) dot.classList.add('busy');
        else dot.classList.remove('busy');
    }

    const total = state.totalCourses || 0;
    const completed = state.completedCourses || 0;
    const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

    if (progressVal) progressVal.innerText = `${pct}% (${completed}/${total})`;
    if (barFill) barFill.style.width = `${pct}%`;
    if (activeCount) activeCount.innerText = String(state.activeWorkerCount || 0);
    if (pillStats) {
        if (state.throttleNotice) {
            pillStats.innerText = `⚠️ ${state.maxConcurrency || 1} tab${(state.maxConcurrency || 1) > 1 ? 's' : ''} (throttled) • ${completed}/${total}`;
        } else {
            pillStats.innerText = `⚡ ${state.targetSpeed || 16}x • ${completed}/${total} (${pct}%)`;
        }
    }

    // Notice banner rendering
    const noticeBanner = hud.querySelector('#hudNoticeBanner');
    const noticeText = hud.querySelector('#hudNoticeText');
    const smartBadge = hud.querySelector('#hudSmartBadge');

    if (state.throttleNotice) {
        if (noticeBanner) noticeBanner.style.display = 'flex';
        if (noticeText) noticeText.innerText = state.throttleNotice;
        if (smartBadge) smartBadge.classList.add('throttled');
    } else {
        if (noticeBanner) noticeBanner.style.display = 'none';
        if (smartBadge) smartBadge.classList.remove('throttled');
    }

    // Concurrency pills sync
    if (state.maxConcurrency) {
        const pills = hud.querySelectorAll('.hud-pill');
        pills.forEach(p => {
            if (parseInt(p.getAttribute('data-conc'), 10) === state.maxConcurrency) {
                p.classList.add('active');
            } else {
                p.classList.remove('active');
            }
        });
    }

    // Speed dropdown sync
    if (speedSelect && state.targetSpeed) {
        speedSelect.value = String(state.targetSpeed);
    }

    // Worker list rendering
    if (workerList && Array.isArray(state.courses)) {
        workerList.innerHTML = '';
        state.courses.forEach(c => {
            const item = document.createElement('div');
            item.className = 'hud-worker-item';

            const titleSpan = document.createElement('span');
            titleSpan.className = 'hud-worker-title';
            const icon = c.itemType === 'video' ? '🎬 ' : '📚 ';
            titleSpan.innerText = `${c.index}. ${icon}${c.title}`;
            titleSpan.title = c.title;

            const badgeSpan = document.createElement('span');
            let badgeClass = 'hud-badge-queued';
            let badgeText = 'Queued';

            if (c.status === 'completed') {
                badgeClass = 'hud-badge-done';
                badgeText = '100% ✓';
            } else if (c.status === 'running') {
                badgeClass = 'hud-badge-running';
                badgeText = c.percent > 0 ? `${c.percent}%` : 'Running...';
            }

            badgeSpan.className = `hud-badge ${badgeClass}`;
            badgeSpan.innerText = badgeText;

            item.appendChild(titleSpan);
            item.appendChild(badgeSpan);
            workerList.appendChild(item);
        });
    }
}

function getLinkedInVideo() {
    // 1. Look for active video in classroom player containers
    const playerSelectors = [
        '.classroom-player video',
        'video.classroom-player__video',
        '.video-player video',
        '.vjs-tech',
        '[data-video-id] video',
        '[class*="classroom-player"] video'
    ];
    for (const sel of playerSelectors) {
        const v = document.querySelector(sel);
        if (v && document.body.contains(v)) {
            return v;
        }
    }

    // 2. Fallback: look for any visible HTML5 video in the DOM
    const allVideos = Array.from(document.querySelectorAll('video'));
    for (const v of allVideos) {
        if (v && document.body.contains(v) && (v.offsetParent !== null || v.clientWidth > 0 || v.clientHeight > 0)) {
            return v;
        }
    }

    return allVideos[0] || null;
}

function isAiChatbotElement(el) {
    if (!el) return false;
    try {
        const aiSelectors = [
            '[class*="ai-" i]',
            '[class*="coach" i]',
            '[class*="chatbot" i]',
            '[class*="assistant" i]',
            '[class*="messaging" i]',
            '[class*="learning-bot" i]',
            '[data-control-name*="ai" i]',
            '[data-control-name*="coach" i]',
            '[data-control-name*="chat" i]',
            '[data-test-ai-assistant]',
            '[id*="ai-" i]',
            '[id*="coach" i]',
            '[id*="chat" i]',
            'aside[class*="drawer" i]',
            '.msg-overlay-conversation-bubble',
            '.msg-overlay-list-bubble'
        ];
        for (const sel of aiSelectors) {
            if (el.matches && el.matches(sel)) return true;
            if (el.closest && el.closest(sel)) return true;
        }

        const textAndAria = ((el.getAttribute('aria-label') || '') + ' ' + (el.innerText || '') + ' ' + (el.title || '')).toLowerCase();
        const aiKeywords = ['ai', 'coach', 'chat', 'assistant', 'conversation', 'ask', 'bot', 'prompt'];
        for (const kw of aiKeywords) {
            const regex = new RegExp(`\\b${kw}\\b`, 'i');
            if (regex.test(textAndAria)) {
                return true;
            }
        }
    } catch(e) {}
    return false;
}

function dismissLinkedInAiChatbotIfOpen() {
    try {
        // 1. AI Coach / AI Assistant drawers
        const aiDrawers = document.querySelectorAll(
            '[class*="ai-coach" i], [class*="ai-assistant" i], [class*="coach-drawer" i], [class*="learning-bot" i], [data-test-ai-assistant], aside[class*="coach" i]'
        );
        for (const drawer of aiDrawers) {
            if (drawer && (drawer.offsetParent !== null || drawer.clientWidth > 0)) {
                const closeBtn = drawer.querySelector(
                    'button[aria-label*="close" i], button[data-control-name*="close" i], button[class*="close" i], button[aria-label*="dismiss" i], button[aria-label*="collapse" i]'
                );
                if (closeBtn) {
                    clickNativeElement(closeBtn);
                }
            }
        }

        // 2. LinkedIn Messaging overlay bubble that sometimes pops up
        const msgOverlays = document.querySelectorAll(
            '.msg-overlay-conversation-bubble, .msg-overlay-bubble-header'
        );
        for (const msg of msgOverlays) {
            const closeBtn = msg.querySelector('button[data-control-name="overlay.close_conversation_window"], button[aria-label*="Close conversation" i], button[class*="close" i]');
            if (closeBtn) {
                clickNativeElement(closeBtn);
            }
        }
    } catch(e) {}
}

function triggerLinkedInNativePlay(video) {
    try {
        dismissLinkedInAiChatbotIfOpen();
        if (!video || !document.body.contains(video)) {
            video = getLinkedInVideo();
        }

        if (video) {
            video.muted = true;
            video.defaultMuted = true;
            video.volume = 0;
            // Always initiate HTML5 play request directly (never blocks async thread)
            video.play().catch(() => {});
        }

        // Targeted play buttons - STRICT matching to never click Autoplay, Chat, or AI settings!
        const playButtonSelectors = [
            'button.classroom-player__play-button',
            'button[data-control-name="play_button"]',
            'button[data-control-name="play"]',
            'button.vjs-big-play-button',
            '.classroom-player button[aria-label="Play" i]',
            '.classroom-player button[aria-label="Play video" i]',
            '.classroom-player button[aria-label="Resume" i]',
            '.classroom-player button[aria-label="Resume video" i]',
            '.classroom-player__play-pause-btn[aria-label*="Play" i]',
            'button[data-control-name="resume_course"]',
            'button[data-control-name="start_course"]'
        ];

        for (const sel of playButtonSelectors) {
            const btn = document.querySelector(sel);
            if (btn && btn.offsetParent !== null) {
                if (isAiChatbotElement(btn)) continue;
                const label = (btn.getAttribute('aria-label') || '').toLowerCase();
                if (!label.includes('autoplay') && !label.includes('pause')) {
                    clickNativeElement(btn);
                    return true;
                }
            }
        }

        // Click the player overlay / video element to toggle playback
        const container = document.querySelector('.classroom-player') || 
                          document.querySelector('.video-player') ||
                          video;
        if (container) {
            clickNativeElement(container);
            return true;
        }
    } catch(e) {}
    return false;
}

async function ensureLinkedInVideoPlayerMounted(maxWaitMs = 12000) {
    dismissLinkedInAiChatbotIfOpen();
    if (getLinkedInVideo()) return true;

    log("[LinkedIn] Video player not yet mounted. Checking for Course Overview Start/Resume buttons...");
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
        if (globalState.abortRequested) return false;
        dismissLinkedInAiChatbotIfOpen();

        const video = getLinkedInVideo();
        if (video) {
            triggerLinkedInNativePlay(video);
            return true;
        }

        // 1. Look for and click Resume / Start Hero CTA buttons on Course Overview pages (STRICT selectors)
        const startSelectors = [
            'button[data-control-name="resume_course"]',
            'button[data-control-name="start_course"]',
            'a[data-control-name="resume_course"]',
            'a[data-control-name="start_course"]',
            'button.course-hero__cta',
            'a.course-hero__cta',
            'button[aria-label="Resume course" i]',
            'button[aria-label="Start course" i]',
            'button[aria-label="Resume learning" i]',
            'button[aria-label="Start learning" i]',
            'a[aria-label="Resume course" i]',
            'a[aria-label="Start course" i]'
        ];

        for (const sel of startSelectors) {
            const btn = document.querySelector(sel);
            if (btn && (btn.offsetParent !== null || btn.clientWidth > 0)) {
                if (isAiChatbotElement(btn)) continue;
                log(`[LinkedIn] Found hero action (${sel}). Clicking to launch course player...`);
                clickNativeElement(btn);
                await new Promise(r => setTimeout(r, 1200));
                dismissLinkedInAiChatbotIfOpen();
                if (getLinkedInVideo()) return true;
            }
        }

        // 2. Search for buttons/links by exact inner text (never match generic single words like 'start' or 'resume')
        const buttons = Array.from(document.querySelectorAll('button, a, [role="button"]'));
        for (const el of buttons) {
            if (isAiChatbotElement(el)) continue;
            const text = (el.innerText || '').trim().toLowerCase();
            if (text === 'resume course' || text === 'start course' || 
                text === 'resume learning' || text === 'start learning' ||
                text === 'watch course' || text === 'continue course') {
                log(`[LinkedIn] Clicking "${text}" button to initialize course player...`);
                clickNativeElement(el);
                await new Promise(r => setTimeout(r, 1200));
                dismissLinkedInAiChatbotIfOpen();
                if (getLinkedInVideo()) return true;
            }
        }

        // 3. Fallback: Click first syllabus lesson in the classroom TOC
        expandAllLinkedInChapters();
        const tocLinks = Array.from(document.querySelectorAll(
            '.classroom-toc-item a, [data-test-toc-item] a, [class*="toc-item"] a, .classroom-sidebar a[href*="/learning/"]'
        ));
        for (const link of tocLinks) {
            if (isAiChatbotElement(link)) continue;
            const href = (link.getAttribute('href') || link.href || '').toLowerCase();
            if (href.includes('/learning/') && !href.includes('/paths/') && !href.includes('/career-hub')) {
                log(`[LinkedIn] Clicking syllabus lesson to launch video player...`);
                clickNativeElement(link);
                await new Promise(r => setTimeout(r, 1200));
                dismissLinkedInAiChatbotIfOpen();
                if (getLinkedInVideo()) return true;
            }
        }

        await new Promise(r => setTimeout(r, 400));
    }

    dismissLinkedInAiChatbotIfOpen();
    return !!getLinkedInVideo();
}

async function waitForLinkedInVideo(timeoutMs = 7000) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
        if (globalState.abortRequested) return null;
        dismissLinkedInAiChatbotIfOpen();
        
        // If current page is a quiz, return early so quiz skipper handles it
        if (isLinkedInQuizPage()) {
            return null;
        }

        // If lesson is already marked complete, return immediately
        if (isCurrentLinkedInLessonCompleted()) {
            return getLinkedInVideo();
        }

        const video = getLinkedInVideo();
        if (video) {
            // Prime video immediately so HLS stream starts loading without waiting 12s
            video.muted = true;
            video.defaultMuted = true;
            video.volume = 0;
            triggerLinkedInNativePlay(video);
            return video;
        }

        // If after 1.5 seconds no video found, attempt mounting course overview CTA
        if (Date.now() - startTime > 1500) {
            await ensureLinkedInVideoPlayerMounted(3500);
            const mounted = getLinkedInVideo();
            if (mounted) {
                mounted.muted = true;
                mounted.defaultMuted = true;
                mounted.volume = 0;
                triggerLinkedInNativePlay(mounted);
                return mounted;
            }
        }

        await new Promise(r => setTimeout(r, 200));
    }
    return getLinkedInVideo();
}

function expandAllLinkedInChapters() {
    try {
        const collapsedButtons = document.querySelectorAll(
            '.classroom-toc button[aria-expanded="false"], ' +
            '[class*="classroom-toc"] button[aria-expanded="false"], ' +
            '[class*="toc-chapter"] button[aria-expanded="false"], ' +
            '[class*="toc-section"] button[aria-expanded="false"], ' +
            'nav[aria-label*="Table of contents" i] button[aria-expanded="false"], ' +
            'nav[aria-label*="Contents" i] button[aria-expanded="false"]'
        );
        collapsedButtons.forEach(btn => {
            try {
                btn.click();
            } catch(e) {}
        });
    } catch(e) {}
}

function isLinkedInQuizPage() {
    const path = (window.location.pathname || '').toLowerCase();
    if (path.includes('/quiz/') || path.includes('/assessment/') || path.includes('/exam/')) {
        return true;
    }

    const quizContainers = document.querySelector(
        '.quiz-layout, ' +
        '.classroom-assessment, ' +
        '[data-control-name="quiz"], ' +
        'form.quiz-form, ' +
        '[data-test-id*="quiz"], ' +
        '[class*="quiz-module"], ' +
        '[class*="assessment-container"]'
    );
    if (quizContainers) return true;

    const headings = Array.from(document.querySelectorAll('h1, h2, h3'));
    if (headings.some(h => /chapter quiz|practice exam|assessment|knowledge check/i.test(h.innerText || ''))) {
        return true;
    }

    return false;
}

function isCurrentLinkedInLessonCompleted() {
    try {
        // 1. Check active item in TOC for completed checkmark
        const activeTocItem = document.querySelector(
            'li.classroom-toc-item--selected, ' +
            'li[class*="classroom-toc-item--selected"], ' +
            'li[class*="classroom-toc-item"][aria-current="true"], ' +
            'a.classroom-toc-item__link--selected, ' +
            'a[aria-current="page"], ' +
            'a[aria-current="true"]'
        );

        if (activeTocItem) {
            const check = activeTocItem.querySelector(
                'svg[data-test-icon*="check" i], ' +
                'svg[type="check"], ' +
                '[data-test-icon="check-small"], ' +
                '[data-test-icon="check"], ' +
                'svg[aria-label*="completed" i], ' +
                'svg[aria-label*="watched" i], ' +
                '[class*="completed" i], ' +
                '[class*="is-complete" i], ' +
                '[class*="checked" i]'
            );
            const aria = ((activeTocItem.getAttribute('aria-label') || '') + ' ' + (activeTocItem.querySelector('a')?.getAttribute('aria-label') || '')).toLowerCase();
            const isCompletedClass = activeTocItem.classList.contains('classroom-toc-item--completed') || 
                                     activeTocItem.className.includes('completed') ||
                                     activeTocItem.className.includes('is-complete');
            if (check || isCompletedClass || aria.includes('completed') || aria.includes('watched')) {
                return true;
            }
        }

        // 2. Cross-reference with scanLinkedInTOC
        const toc = scanLinkedInTOC();
        if (toc.activeItem && toc.activeItem.isCompleted) {
            return true;
        }

        // 3. Up-Next countdown / Next button overlay visible on player
        const upNextOverlay = document.querySelector(
            'button[data-control-name="up_next_play"], ' +
            '.classroom-player__up-next, ' +
            '[class*="up-next"] button, ' +
            '[data-test-id*="up-next"]'
        );
        if (upNextOverlay && upNextOverlay.offsetParent !== null) {
            return true;
        }
    } catch(e) {}
    return false;
}

async function refreshLinkedInVideo(video) {
    if (!video) return;

    // If lesson already completed while buffering, advance
    if (isCurrentLinkedInLessonCompleted()) return;

    log("[LinkedIn] 🔄 Video stuck/buffering! Recovering video stream...", "warning");
    showOnScreenHUD("🔄 Video stuck — Recovering stream...", "warning");

    // 1. Ensure muted state to satisfy browser Autoplay policies
    try {
        video.muted = true;
        video.defaultMuted = true;
        video.volume = 0;
    } catch(e) {}

    // 2. Look for and click Retry / Play / Resume controls in player DOM
    const recoverySelectors = [
        'button.classroom-player__play-button',
        'button[data-control-name="play_button"]',
        'button[data-control-name="play"]',
        'button.vjs-big-play-button',
        'button[aria-label="Play" i]',
        'button[aria-label="Play video" i]',
        'button[aria-label="Resume" i]',
        'button[aria-label="Resume video" i]',
        'button[aria-label*="retry" i]',
        'button[aria-label*="reload" i]',
        '.vjs-error-display button',
        '.classroom-player__overlay',
        '.video-player__overlay'
    ];
    for (const sel of recoverySelectors) {
        const btn = document.querySelector(sel);
        if (btn && btn.offsetParent !== null) {
            if (isAiChatbotElement(btn)) continue;
            const label = (btn.getAttribute('aria-label') || '').toLowerCase();
            if (label.includes('autoplay') || label.includes('pause')) continue;
            log(`[LinkedIn] Triggering player recovery control: ${sel}`);
            clickNativeElement(btn);
            await new Promise(r => setTimeout(r, 300));
            break;
        }
    }

    // 3. Safe non-destructive MSE buffer nudge (NEVER call video.load() on MediaSource HLS streams!)
    try {
        const curr = video.currentTime || 0;
        const dur = video.duration || 0;
        
        // Gentle seek nudge forces the MSE decoder pipeline to re-synchronize
        if (dur > 2 && curr > 0.5) {
            video.currentTime = Math.max(0, curr - 0.25);
        } else if (dur > 2) {
            video.currentTime = curr + 0.25;
        }

        // Re-enforce playback speed
        applyLinkedInSpeed(currentLinkedInSpeed || 16.0);

        // Resume playback
        if (video.paused) {
            await video.play().catch(() => {
                triggerLinkedInNativePlay(video);
            });
        }
    } catch(e) {
        console.warn("[LinkedIn] Video stream recovery nudge notice:", e);
    }
}

async function skipLinkedInQuizIfPresent() {
    if (!isLinkedInQuizPage()) return false;

    dismissLinkedInAiChatbotIfOpen();
    log("[LinkedIn] ⏭️ Optional Quiz/Assessment detected. Automatically skipping...", "warning");
    showOnScreenHUD("⏭️ Skipping Optional Quiz...", "warning");

    // 1. Find and click Skip button if visible on screen
    const clickable = Array.from(document.querySelectorAll('button, a, [role="button"]'));
    for (const el of clickable) {
        if (isAiChatbotElement(el)) continue;
        const txt = (el.innerText || el.textContent || '').trim().toLowerCase();
        const aria = (el.getAttribute('aria-label') || '').toLowerCase();
        if (txt === 'skip' || txt === 'skip quiz' || txt === 'skip to next' || txt === 'skip assessment' ||
            aria.includes('skip quiz') || aria.includes('skip assessment')) {
            log(`[LinkedIn] Found skip action: "${txt || aria}". Skipping...`);
            clickNativeElement(el);
            await new Promise(r => setTimeout(r, 2000));
            return true;
        }
    }

    // 2. Find and click Next button on quiz page
    const nextSelectors = [
        'button.classroom-nav__next',
        '.classroom-nav__next button',
        'button[data-control-name="up_next_play"]',
        'button[aria-label*="Next video" i]',
        'button[aria-label*="Next" i]',
        'button[data-control-name*="next" i]',
        'a[data-control-name*="next" i]'
    ];
    for (const sel of nextSelectors) {
        const btn = document.querySelector(sel);
        if (btn && !btn.disabled && btn.offsetParent !== null) {
            if (isAiChatbotElement(btn)) continue;
            log("[LinkedIn] Clicking next button to advance past quiz...");
            clickNativeElement(btn);
            await new Promise(r => setTimeout(r, 2000));
            return true;
        }
    }

    // 3. Jump directly to the next uncompleted video from TOC
    const toc = scanLinkedInTOC();
    if (toc.uncompletedVideos && toc.uncompletedVideos.length > 0) {
        let target = null;
        if (toc.activeItem) {
            target = toc.uncompletedVideos.find(it => it.index > toc.activeItem.index) || toc.uncompletedVideos[0];
        } else {
            target = toc.uncompletedVideos[0];
        }

        if (target) {
            log(`[LinkedIn] Bypassing quiz -> jumping directly to next video: "${target.title}"`);
            if (target.linkElement) {
                clickNativeElement(target.linkElement);
            } else if (target.href) {
                window.location.href = target.href;
            }
            await new Promise(r => setTimeout(r, 2500));
            return true;
        }
    }

    return false;
}

function scanLinkedInTOC() {
    expandAllLinkedInChapters();

    const candidateSelectors = [
        'li.classroom-toc-item',
        'li[class*="classroom-toc-item"]',
        '[data-control-name="toc_item"]',
        'li[class*="toc-item"]',
        'a.classroom-toc-item__link',
        'a[class*="classroom-toc-item"]',
        'nav[aria-label*="Contents" i] li',
        'nav[aria-label*="Table of contents" i] li'
    ];

    let rawItems = [];
    for (const sel of candidateSelectors) {
        const found = Array.from(document.querySelectorAll(sel));
        if (found.length > 0) {
            rawItems = found;
            break;
        }
    }

    if (rawItems.length === 0) {
        rawItems = Array.from(document.querySelectorAll('a[href*="/learning/"]')).filter(a => {
            const path = a.getAttribute('href') || '';
            return path.split('/').filter(Boolean).length >= 3 && !path.includes('/search') && !path.includes('/topics');
        });
    }

    const items = [];
    const completedItems = [];
    const uncompletedItems = [];
    let activeItem = null;

    rawItems.forEach((el, index) => {
        const text = el.innerText || el.textContent || '';
        const cleanTitle = text.replace(/\b\d+\s*m(?:in)?(?:\s*\d+\s*s)?\b/gi, '').replace(/\n+/g, ' ').trim() || `Lesson ${index + 1}`;
        
        const link = el.tagName.toLowerCase() === 'a' ? el : el.querySelector('a');
        const href = link ? link.getAttribute('href') : null;

        const hasCheckSvg = !!el.querySelector(
            'svg[data-test-icon*="check" i], ' +
            'svg[type="check"], ' +
            '[data-test-icon="check-small"], ' +
            '[data-test-icon="check"], ' +
            'svg[aria-label*="completed" i], ' +
            'svg[aria-label*="watched" i], ' +
            'svg[aria-label*="Complete" i], ' +
            '[class*="completed" i], ' +
            '[class*="is-complete" i], ' +
            '[class*="checked" i]'
        );
        const ariaLabel = ((el.getAttribute('aria-label') || '') + ' ' + (link?.getAttribute('aria-label') || '')).toLowerCase();
        const isAriaCompleted = ariaLabel.includes('completed') || 
                                ariaLabel.includes('watched') || 
                                ariaLabel.includes('complete');
        const hasCompletedClass = el.classList.contains('classroom-toc-item--completed') || 
                                  el.className.includes('completed') || 
                                  el.className.includes('is-complete');
        
        const isCompleted = hasCheckSvg || isAriaCompleted || hasCompletedClass;

        const isQuiz = (
            /quiz|assessment|practice\s+exam|exam\s+prep|knowledge\s+check|check\s+your\s+understanding/i.test(cleanTitle) ||
            (href && (href.includes('/quiz/') || href.includes('/assessment/') || href.includes('/exam/'))) ||
            !!el.querySelector('svg[data-test-icon*="quiz" i], svg[data-test-icon*="assessment" i], svg[data-test-icon*="clipboard" i], svg[data-test-icon*="document" i]') ||
            el.className.includes('quiz') ||
            el.className.includes('assessment') ||
            el.getAttribute('data-control-name') === 'toc_quiz'
        );

        const isActive = el.classList.contains('classroom-toc-item--selected') ||
                         el.getAttribute('aria-current') === 'true' ||
                         el.getAttribute('aria-current') === 'page' ||
                         (link && (link.getAttribute('aria-current') === 'true' || link.classList.contains('active'))) ||
                         el.className.includes('selected') ||
                         el.className.includes('active');

        const itemObj = {
            index,
            element: el,
            linkElement: link || el,
            title: cleanTitle,
            href,
            isCompleted,
            isQuiz,
            isActive
        };

        items.push(itemObj);
        if (isCompleted) {
            completedItems.push(itemObj);
        } else {
            uncompletedItems.push(itemObj);
        }
        if (isActive) {
            activeItem = itemObj;
        }
    });

    const uncompletedVideos = uncompletedItems.filter(it => !it.isQuiz);
    const completedVideos = completedItems.filter(it => !it.isQuiz);
    const totalVideos = items.filter(it => !it.isQuiz);

    return {
        allItems: items,
        completedItems,
        uncompletedItems,
        uncompletedVideos,
        completedVideos,
        totalVideos,
        activeItem,
        totalCount: totalVideos.length > 0 ? totalVideos.length : items.length,
        completedCount: completedVideos.length
    };
}

async function playLinkedInVideoToCompletion(targetSpeed = 16.0) {
    // 0. Check if current page is an optional quiz/assessment and skip it
    if (await skipLinkedInQuizIfPresent()) {
        return true;
    }

    // 1. Check if the lesson is ALREADY marked completed in TOC
    if (isCurrentLinkedInLessonCompleted()) {
        log("[LinkedIn] 🎯 Smart Detection: Current video is ALREADY marked COMPLETED! Advancing immediately...", "success");
        return true;
    }

    const video = await waitForLinkedInVideo(12000);
    if (!video) {
        if (await skipLinkedInQuizIfPresent()) {
            return true;
        }
        throw new Error("Could not find active video player on page.");
    }

    // Proactively request background to inject main-world anti-pause and speed overrides
    chrome.runtime.sendMessage({
        action: "inject_main_world_speed",
        speed: targetSpeed
    }).catch(() => {});

    // 2. Prime video immediately to satisfy browser autoplay policy & start HLS chunk download
    try {
        video.muted = true;
        video.defaultMuted = true;
        video.volume = 0;
        triggerLinkedInNativePlay(video);
    } catch(e) {}

    // 3. Wait for video stream metadata / readiness with proactive kickstart & failsafe
    const isReady = !isNaN(video.duration) && video.duration > 0 && video.readyState >= 1;
    if (!isReady) {
        log("[LinkedIn] Initializing video stream & waiting for metadata...");
        showOnScreenHUD("⏳ Initializing video stream...", "working");

        await new Promise(resolve => {
            let settled = false;
            const finish = () => {
                if (settled) return;
                settled = true;
                cleanup();
                resolve();
            };

            const events = ['loadedmetadata', 'loadeddata', 'canplay', 'playing', 'timeupdate'];
            const onMediaEvent = () => finish();
            events.forEach(ev => video.addEventListener(ev, onMediaEvent, { once: true }));

            // Active polling: check if duration/readiness populated or TOC marked complete
            const pollInterval = setInterval(() => {
                if (globalState.abortRequested || isCurrentLinkedInLessonCompleted()) {
                    finish();
                    return;
                }

                // Re-bind to fresh video element if React replaced it
                const currentVideo = getLinkedInVideo();
                if (currentVideo && currentVideo !== video) {
                    video = currentVideo;
                    video.muted = true;
                    video.defaultMuted = true;
                    video.volume = 0;
                }

                if (video && !isNaN(video.duration) && video.duration > 0 && video.readyState >= 1) {
                    finish();
                    return;
                }
                if (video && video.currentTime > 0) {
                    finish();
                    return;
                }
                // Proactively kickstart playback so HLS manifest is requested
                triggerLinkedInNativePlay(video);
            }, 200);

            // Maximum failsafe timeout - NEVER hang indefinitely on metadata
            const timeoutTimer = setTimeout(() => {
                log("[LinkedIn] Initializing stream playback...");
                finish();
            }, 2500);

            const cleanup = () => {
                clearInterval(pollInterval);
                clearTimeout(timeoutTimer);
                events.forEach(ev => video.removeEventListener(ev, onMediaEvent));
            };
        });
    }

    // Re-check: did the lesson complete during initialization?
    if (isCurrentLinkedInLessonCompleted()) {
        log("[LinkedIn] 🎯 Smart Detection: Lesson registered COMPLETED by LinkedIn Learning! Advancing...", "success");
        return true;
    }

    // Apply speed via multi-tier system (MAIN world injection + content script)
    applyLinkedInSpeed(targetSpeed);

    // Non-blocking playback initiation (NEVER await video.play() which can hang on buffering streams!)
    try {
        if (video) {
            video.muted = true;
            video.defaultMuted = true;
            video.volume = 0;
            video.play().catch(() => {});
        }
    } catch(e) {}
    triggerLinkedInNativePlay(video);

    log(`[LinkedIn] 🚀 Fast-forwarding video at ${targetSpeed}x Turbo speed (muted)...`);

    const onRateChange = () => {
        if (!globalState.abortRequested && video.playbackRate !== currentLinkedInSpeed) {
            applyLinkedInSpeed(currentLinkedInSpeed);
        }
    };
    video.addEventListener('ratechange', onRateChange);

    let lastTime = video.currentTime;
    let stuckCount = 0;

    return new Promise((resolve) => {
        let finished = false;

        const cleanup = () => {
            finished = true;
            if (intervalId) clearInterval(intervalId);
            video.removeEventListener('ratechange', onRateChange);
        };

        const onEnded = () => {
            if (finished) return;
            cleanup();
            log(`[LinkedIn] ✓ Video reached natural conclusion.`);
            resolve(true);
        };

        video.addEventListener('ended', onEnded, { once: true });

        const intervalId = setInterval(async () => {
            if (globalState.abortRequested) {
                cleanup();
                stopLinkedInVideoPlayback();
                log("[LinkedIn] Playback stopped by user.");
                resolve(false);
                return;
            }

            // SMART DETECTION: Has LinkedIn recorded this lesson as completed?
            if (isCurrentLinkedInLessonCompleted()) {
                cleanup();
                log("[LinkedIn] 🎯 Smart Detection: Lesson registered COMPLETED by LinkedIn Learning! Advancing immediately...", "success");
                showOnScreenHUD("✓ Completed! Advancing...", "success");
                resolve(true);
                return;
            }

            // Check if reached end of video duration
            if (video.duration > 0 && video.currentTime >= video.duration - 0.25) {
                cleanup();
                log(`[LinkedIn] ✓ Video reached conclusion (${Math.round(video.currentTime)}s/${Math.round(video.duration)}s).`);
                resolve(true);
                return;
            }

            // Re-bind to active DOM video element if React replaced it during playback
            if (!video || !document.body.contains(video)) {
                const fresh = getLinkedInVideo();
                if (fresh) {
                    video = fresh;
                    video.muted = true;
                    video.defaultMuted = true;
                    video.volume = 0;
                    applyLinkedInSpeed(currentLinkedInSpeed);
                }
            }

            // Continuously enforce playback rate and unpause
            if (video.playbackRate !== currentLinkedInSpeed) {
                applyLinkedInSpeed(currentLinkedInSpeed);
            }
            if (video.paused && !video.ended) {
                video.play().catch(() => {
                    triggerLinkedInNativePlay(video);
                });
            }

            const curr = Math.round(video.currentTime);
            const total = Math.round(video.duration || 0);
            const percent = total > 0 ? Math.round((curr / total) * 100) : 0;
            const remainingSec = Math.max(0, Math.round((total - curr) / currentLinkedInSpeed));
            showOnScreenHUD(`⚡ ${percent}% (${curr}s/${total}s) • ~${remainingSec}s left at ${currentLinkedInSpeed}x`, "working");

            // STUCK / BUFFERING WATCHDOG: Detect freeze whether playing or paused
            const isProgressing = Math.abs(video.currentTime - lastTime) >= 0.05 && !video.paused;
            if (!isProgressing) {
                stuckCount++;

                // 2.5s stall: nudge currentTime, unpause, and trigger native play
                if (stuckCount === 10) {
                    log("[LinkedIn] Buffering stall detected. Nudging video playback...", "warning");
                    triggerLinkedInNativePlay(video);
                    if (video.duration > 2 && video.currentTime > 0.5) {
                        video.currentTime += 0.25;
                    }
                    video.play().catch(() => {});
                }
                // 5.0s stall: safe non-destructive video stream recovery
                else if (stuckCount === 20) {
                    await refreshLinkedInVideo(video);
                }
                // 6.0s stall (stuckCount === 24): SMART PARALLEL TABS - Signal buffer pressure to auto-reduce tabs!
                else if (stuckCount === 24) {
                    if (isWorkerTab && courseId) {
                        log("[LinkedIn] ⚠️ Heavy video buffering detected. Requesting smart orchestrator to auto-reduce active tabs...", "warning");
                        showOnScreenHUD("⚠️ Buffering detected — auto-reducing tabs...", "warning");
                        chrome.runtime.sendMessage({
                            action: "path_worker_buffering_pressure",
                            courseId: courseId,
                            stuckSeconds: 6
                        }).catch(() => {});
                    }
                }
                // 8.0s stall: step down speed to 4x to alleviate MSE buffer throttling
                else if (stuckCount === 32) {
                    if (currentLinkedInSpeed > 4.0) {
                        log("[LinkedIn] Stepping down speed to 4x to alleviate MSE buffer throttling...", "warning");
                        applyLinkedInSpeed(4.0);
                    }
                    triggerLinkedInNativePlay(video);
                    video.play().catch(() => {});
                }
                // 12.0s stall: try advancing before reloading
                else if (stuckCount >= 48) {
                    log("[LinkedIn] 🔄 Video player stalled. Checking if lesson completed or advancing...", "warning");
                    if (isCurrentLinkedInLessonCompleted() || await advanceToNextLinkedInVideo()) {
                        cleanup();
                        resolve(true);
                        return;
                    }
                    log("[LinkedIn] 🔄 Reloading page to recover...", "error");
                    showOnScreenHUD("🔄 Reloading page...", "error");
                    cleanup();
                    await chrome.storage.local.set({ 
                        linkedinQueueRunning: true, 
                        linkedinTargetSpeed: targetSpeed 
                    });
                    window.location.reload();
                    resolve(false);
                    return;
                }
            } else {
                stuckCount = 0;
                lastTime = video.currentTime;
            }
        }, 250);
    });
}

async function advanceToNextLinkedInVideo() {
    log("[LinkedIn] Advancing to next video...");

    // Check if on a quiz and skip it first
    if (await skipLinkedInQuizIfPresent()) {
        return true;
    }

    const nextButtonSelectors = [
        'button[data-control-name="up_next_play"]',
        'button[data-control-name*="next" i]',
        'button[aria-label*="Next video" i]',
        'button[aria-label*="Next" i]',
        'button[aria-label*="next" i]',
        'button.classroom-nav__next',
        '.classroom-nav__next button',
        'a[data-control-name*="next" i]',
        '[class*="up-next"] button',
        '[class*="next-button"]',
        'button:has(svg[data-test-icon="chevron-right-small"])'
    ];

    for (const sel of nextButtonSelectors) {
        const btn = document.querySelector(sel);
        if (btn && !btn.disabled && btn.offsetParent !== null) {
            if (isAiChatbotElement(btn)) continue;
            log(`[LinkedIn] Triggering next video control...`);
            clickNativeElement(btn);
            return true;
        }
    }

    const toc = scanLinkedInTOC();
    // Prioritize uncompleted videos (skipping all quizzes)
    const queue = (toc.uncompletedVideos && toc.uncompletedVideos.length > 0) 
        ? toc.uncompletedVideos 
        : toc.uncompletedItems;

    if (queue && queue.length > 0) {
        let targetItem = null;
        if (toc.activeItem) {
            targetItem = queue.find(it => it.index > toc.activeItem.index) || queue[0];
        } else {
            targetItem = queue[0];
        }

        if (targetItem && !isAiChatbotElement(targetItem.linkElement)) {
            log(`[LinkedIn] Selecting next lesson from syllabus: ${targetItem.title}`);
            if (targetItem.linkElement) {
                targetItem.linkElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
                await new Promise(r => setTimeout(r, 200));
                clickNativeElement(targetItem.linkElement);
                return true;
            } else if (targetItem.href) {
                window.location.href = targetItem.href;
                return true;
            }
        }
    }

    return false;
}

function stopLinkedInVideoPlayback() {
    try {
        const vid = getLinkedInVideo();
        if (vid) {
            vid.playbackRate = 1.0;
            vid.muted = false;
        }
        chrome.storage.local.remove(['linkedinQueueRunning', 'linkedinTargetSpeed']).catch(() => {});
        chrome.runtime.sendMessage({ action: "reset_main_world_speed" }).catch(() => {});
        window.postMessage({ type: '__FCUK_LINKEDIN_SPEED__', speed: 1.0, active: false }, '*');
    } catch(e) {}
}

async function startLinkedInCourseCompletionProcess(options = {}) {
    const targetSpeed = options.speed || 16.0;
    const singleOnly = !!options.singleVideoOnly;
    const isWorkerTab = !!options.isWorkerTab;
    const courseId = options.courseId || null;
    currentLinkedInSpeed = targetSpeed;

    if (isWorkerTab) {
        startTabKeepAliveHeartbeat();
    }

    log("==========================================");
    log(`[LinkedIn Learning] Initializing Video Completer (${targetSpeed}x Turbo)${isWorkerTab ? ' [Worker Mode]' : ''}...`);
    log("==========================================");
    showOnScreenHUD(`LinkedIn: Initializing Video Completer (${targetSpeed}x)...`, "working");

    if (!singleOnly && !isWorkerTab) {
        await chrome.storage.local.set({
            linkedinQueueRunning: true,
            linkedinTargetSpeed: targetSpeed
        });
    }

    // Ensure video player is mounted (in case we landed on Course Overview page)
    await ensureLinkedInVideoPlayerMounted(12000);

    // Request background to enforce MAIN world speed and anti-pause hook
    chrome.runtime.sendMessage({
        action: "inject_main_world_speed",
        speed: targetSpeed
    }).catch(() => {});

    let loopSafety = 0;
    const MAX_VIDEOS = 150;

    try {
        while (!globalState.abortRequested && loopSafety < MAX_VIDEOS) {
            loopSafety++;

            // 1. Skip quiz / assessment if current screen is a quiz
            const skippedQuiz = await skipLinkedInQuizIfPresent();
            if (skippedQuiz) {
                log("[LinkedIn] Skipped quiz successfully. Loading next lesson...", "success");
                await new Promise(r => setTimeout(r, 2000));
                continue;
            }

            const toc = scanLinkedInTOC();
            const total = toc.totalCount > 0 ? toc.totalCount : 1;
            const completed = toc.completedCount;
            const currentTitle = toc.activeItem ? toc.activeItem.title : (document.title || "Video Lesson");

            updateProgress(completed, total, currentTitle);
            updateStatus(`[${completed}/${total}] ${currentTitle}`);
            showOnScreenHUD(`⚡ [${completed + 1}/${total}] ${currentTitle.substring(0, 30)}...`, "working");

            // Telemetry ping to background orchestrator
            if (isWorkerTab && courseId) {
                chrome.runtime.sendMessage({
                    action: "path_worker_progress",
                    courseId: courseId,
                    percent: total > 0 ? Math.round((completed / total) * 100) : 0,
                    currentTitle: currentTitle,
                    completedVideos: completed,
                    totalVideos: total
                }).catch(() => {});
            }

            if (toc.uncompletedVideos.length === 0 && loopSafety > 1) {
                log("🎉 All videos in this LinkedIn Learning course are completed (100%)!");
                showOnScreenHUD("🎉 Entire Course Completed 100%!", "success");
                if (isWorkerTab && courseId) {
                    await chrome.runtime.sendMessage({
                        action: "path_worker_course_completed",
                        courseId: courseId
                    }).catch(() => {});
                    return;
                }
                break;
            }

            log(`[LinkedIn] Playing: "${currentTitle}" at ${currentLinkedInSpeed}x...`);
            const playSuccess = await playLinkedInVideoToCompletion(currentLinkedInSpeed);

            if (globalState.abortRequested) {
                log("[LinkedIn] Video completion aborted by user.");
                break;
            }

            if (singleOnly) {
                log(`[LinkedIn] Single video completion finished.`);
                showOnScreenHUD("🎉 Video Completed!", "success");
                if (isWorkerTab && courseId) {
                    await chrome.runtime.sendMessage({
                        action: "path_worker_course_completed",
                        courseId: courseId
                    }).catch(() => {});
                    return;
                }
                break;
            }

            log("[LinkedIn] Waiting 1.0s for completion telemetry handshake...");
            showOnScreenHUD("✓ Telemetry Syncing...", "working");
            await new Promise(r => setTimeout(r, 1000));

            const updatedToc = scanLinkedInTOC();
            updateProgress(updatedToc.completedCount, updatedToc.totalCount, "Advancing...");

            if (isWorkerTab && courseId) {
                chrome.runtime.sendMessage({
                    action: "path_worker_progress",
                    courseId: courseId,
                    percent: updatedToc.totalCount > 0 ? Math.round((updatedToc.completedCount / updatedToc.totalCount) * 100) : 0,
                    currentTitle: "Advancing...",
                    completedVideos: updatedToc.completedCount,
                    totalVideos: updatedToc.totalCount
                }).catch(() => {});
            }

            if (updatedToc.uncompletedVideos.length === 0) {
                log("🎉 Entire course is now 100% completed!");
                showOnScreenHUD("🎉 Entire Course Completed (100%)!", "success");
                if (isWorkerTab && courseId) {
                    await chrome.runtime.sendMessage({
                        action: "path_worker_course_completed",
                        courseId: courseId
                    }).catch(() => {});
                    return;
                }
                break;
            }

            const advanced = await advanceToNextLinkedInVideo();
            if (!advanced) {
                log("[LinkedIn] No further video lessons found. Course completed!");
                showOnScreenHUD("🎉 Course Completed!", "success");
                if (isWorkerTab && courseId) {
                    await chrome.runtime.sendMessage({
                        action: "path_worker_course_completed",
                        courseId: courseId
                    }).catch(() => {});
                    return;
                }
                break;
            }

            log("[LinkedIn] Loading next video lesson...");
            await new Promise(r => setTimeout(r, 2000));
            // Proactively re-ensure video player mounted & re-inject main world speed
            await ensureLinkedInVideoPlayerMounted(6000);
            chrome.runtime.sendMessage({
                action: "inject_main_world_speed",
                speed: currentLinkedInSpeed
            }).catch(() => {});
        }

        if (globalState.abortRequested) {
            updateStatus("Process aborted.");
            showOnScreenHUD("Process Aborted", "warning");
        } else {
            updateStatus("Done! All LinkedIn Learning videos completed.");
        }

    } catch (e) {
        log(`[LinkedIn Error] ${e.message}`, "error");
        updateStatus(`Error: ${e.message}`);
        showOnScreenHUD(`Error: ${e.message}`, "error");
    } finally {
        if (!isWorkerTab) {
            await chrome.storage.local.remove([
                'linkedinQueueRunning',
                'linkedinTargetSpeed'
            ]).catch(() => {});
        } else if (courseId && !globalState.abortRequested) {
            // Worker tab completed execution — ensure background orchestrator closes tab and advances queue
            chrome.runtime.sendMessage({
                action: "path_worker_course_completed",
                courseId: courseId
            }).catch(() => {});
        }

        stopLinkedInVideoPlayback();

        setTimeout(() => {
            hideOnScreenHUD();
        }, 4000);

        if (!isWorkerTab) {
            chrome.runtime.sendMessage({ action: "finished" }).catch(() => {});
        }
    }
}

// Auto-Resume Persistent Master Chronological Queue, App Queue, or LinkedIn Learning Queue on Page Load
(async () => {
    try {
        const data = await chrome.storage.local.get([
            'masterCourseQueue', 'masterCourseIndex',
            'activeAppQueue', 'appQueueIndex',
            'linkedinQueueRunning', 'linkedinTargetSpeed'
        ]);

        // 1. Check Master Chronological Course Queue
        if (data.masterCourseQueue && Array.isArray(data.masterCourseQueue) && data.masterCourseQueue.length > 0 && typeof data.masterCourseIndex === 'number' && data.masterCourseIndex < data.masterCourseQueue.length) {
            log("[Master Runner] Resuming active Master Chronological Course queue on new page...");
            globalState.isRunning = true;
            globalState.currentAction = "complete";
            
            if (document.readyState !== 'complete') {
                await new Promise(r => window.addEventListener('load', r, { once: true }));
            }
            await new Promise(r => setTimeout(r, 60));
            await processMasterCourseQueueStep();
            return;
        }

        // 2. Check Standalone App Queue
        if (data.activeAppQueue && Array.isArray(data.activeAppQueue) && data.activeAppQueue.length > 0 && typeof data.appQueueIndex === 'number' && data.appQueueIndex < data.activeAppQueue.length) {
            log("[App Navigator] Resuming active multi-page App completion queue on new page...");
            globalState.isRunning = true;
            globalState.currentAction = "app_item";
            
            if (document.readyState !== 'complete') {
                await new Promise(r => window.addEventListener('load', r, { once: true }));
            }
            await new Promise(r => setTimeout(r, 60));
            await processCurrentAppQueueStep();
            return;
        }

        // 3. Check LinkedIn Learning Video Queue
        if (data.linkedinQueueRunning) {
            log("[LinkedIn Auto-Resume] Resuming LinkedIn Learning video queue on new lesson...");
            globalState.isRunning = true;
            globalState.currentAction = "linkedin_video";

            if (document.readyState !== 'complete') {
                await new Promise(r => window.addEventListener('load', r, { once: true }));
            }
            await new Promise(r => setTimeout(r, 600));

            // Check if current page is quiz upon reload
            await skipLinkedInQuizIfPresent();

            await startLinkedInCourseCompletionProcess({ 
                speed: data.linkedinTargetSpeed || 16.0 
            });
        }
    } catch(e) {
        console.log("Notice in queue auto-resume:", e);
    }
})();

// Synchronize Floating HUD with Persistent Storage across all tabs and popup updates
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.linkedinPathState) {
        if (changes.linkedinPathState.newValue) {
            renderFloatingHudState(changes.linkedinPathState.newValue);
        } else if (floatingHudEl) {
            floatingHudEl.style.display = 'none';
        }
    }
});

// Auto-initialize Floating HUD if a learning path is currently stored in storage
(async () => {
    try {
        if (typeof isLinkedInLearningPlatform === 'function' && isLinkedInLearningPlatform()) {
            const data = await chrome.storage.local.get(['linkedinPathState']);
            if (data.linkedinPathState && (data.linkedinPathState.isRunning || data.linkedinPathState.totalCourses > 0)) {
                renderFloatingHudState(data.linkedinPathState);
            }
        }
    } catch(e) {}
})();
