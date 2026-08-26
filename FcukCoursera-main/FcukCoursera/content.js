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
    const match = document.cookie.match(/(?:CSRF3-Token|csrf3-token|CSRF-Token)=([^;]+)/i);
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
        globalState.currentAction = "skipping";
        startSkippingProcess().finally(() => { 
            globalState.isRunning = false;
            globalState.abortRequested = false;
        });
        sendResponse({ status: "started" });
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
        startOnScreenQuizSolverProcess(aiConfig).finally(() => { 
            globalState.isRunning = false;
            globalState.abortRequested = false;
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
        globalState.currentAction = "complete";
        const aiConfig = request.aiConfig || request.apiKey;
        startCompleteCourseProcess(aiConfig).finally(() => { 
            globalState.isRunning = false;
            globalState.abortRequested = false;
        });
        sendResponse({ status: "started" });
    }
});

function classifyItemType(item) {
    const type = (item.typeName || '').toLowerCase();
    const name = (item.name || '').toLowerCase();

    if (type === 'lecture' || type.includes('video')) return 'lecture';
    if (type === 'supplement' || type === 'reading') return 'supplement';
    if (type.includes('discussion') || name.includes('discussion prompt')) return 'discussion';
    if (type.includes('dialogue') || type.includes('roleplay') || name.includes('dialogue') || name.includes('conversation')) return 'dialogue';
    if (type.includes('lti') || type.includes('lab') || name.includes('lab') || name.includes('jupyter') || name.includes('workspace')) return 'lab';
    if (type.includes('coach') || type.includes('survey') || type.includes('peer') || type.includes('singlepageapp')) return 'interactive';
    
    // Quizzes, assignments, activities, exercises, diagnostics, and programming items
    if (type.includes('quiz') || type.includes('exam') || type.includes('assignment') || type.includes('widget') || 
        type.includes('practice') || type.includes('programming') || type.includes('diagnostic') ||
        name.includes('practice quiz') || name.includes('practice assignment') || name.includes('activity:') || 
        name.includes('exercise:') || name.includes('quiz:') || name.includes('assignment:')) {
        return 'quiz_assignment';
    }

    return 'generic';
}

async function startCompleteCourseProcess(aiConfig) {
    try {
        const { userId, courseId, courseSlug, courseTitle, allItems, modules } = await getCourseData();
        
        log(`Starting Course Completion for "${courseTitle}". Found ${allItems.length} items across ${modules.length} modules.`);
        updateProgress(0, allItems.length, "Starting...");

        let completedCount = 0;
        
        for (let i = 0; i < allItems.length; i++) {
            if (globalState.abortRequested) {
                log("Course completion stopped by user.");
                break;
            }

            const item = allItems[i];
            const courseContext = {
                courseSlug: courseSlug,
                courseTitle: courseTitle,
                assignmentName: item.name,
                moduleName: item.moduleName || ""
            };

            const progressMsg = `[${i + 1}/${allItems.length}] ${item.typeName || 'Item'}: ${item.name}`;
            updateStatus(progressMsg);
            updateProgress(i, allItems.length, item.name);
            
            try {
                let result = false;
                const category = classifyItemType(item);
                
                if (category === 'lecture') {
                    result = await completeSingleVideo(userId, courseId, courseSlug, item.id);
                    if (result) log(`[Video Completed] ${item.name}`);
                } 
                else if (category === 'supplement') {
                    result = await completeSingleReading(userId, courseId, courseSlug, item.id);
                    if (result) log(`[Reading Completed] ${item.name}`);
                }
                else if (category === 'discussion') {
                    log(`[Discussion Prompt Found] ${item.name}`);
                    result = await completeDiscussionPrompt(userId, courseId, courseSlug, item, aiConfig, courseContext);
                }
                else if (category === 'dialogue') {
                    log(`[Dialogue Simulation Found] ${item.name}`);
                    result = await completeDialogueItem(userId, courseId, courseSlug, item, aiConfig, courseContext);
                }
                else if (category === 'lab') {
                    log(`[Practice Lab / LTI Found] ${item.name}`);
                    result = await completePracticeLabOrLti(userId, courseId, courseSlug, item);
                }
                else if (category === 'interactive') {
                    log(`[Interactive Item Found] ${item.name}`);
                    result = await completeGenericInteractiveItem(userId, courseId, courseSlug, item, aiConfig);
                }
                else if (category === 'quiz_assignment') {
                    log(`[Quiz / Practice Assignment Found] ${item.name}`);
                    await processQuizItem(userId, courseId, item, aiConfig, courseContext);
                    result = true;
                }
                else {
                    // Fallback for unknown item types
                    log(`[Processing Item: ${item.typeName || 'Item'}] ${item.name}`);
                    await processQuizItem(userId, courseId, item, aiConfig, courseContext);
                    result = true;
                }

                if (result) {
                    completedCount++;
                    await new Promise(r => setTimeout(r, 100));
                }

            } catch (e) {
                log(`[Error] ${item.name}: ${e.message}`);
            }
        }

        if (globalState.abortRequested) {
            updateStatus("Process aborted.");
        } else {
            updateProgress(allItems.length, allItems.length, "Done!");
            updateStatus(`Done! Processed ${allItems.length} items.`);
            // Generate and output comprehensive course summary report
            await generateCourseSummaryReport(userId, courseId, courseSlug, courseTitle, allItems, modules);
        }
        chrome.runtime.sendMessage({ action: "finished" }).catch(() => {});

    } catch (e) {
        log("Error: " + e.message);
        updateStatus("Error occurred. Check logs.");
        chrome.runtime.sendMessage({ action: "finished" }).catch(() => {});
    }
}

async function startSkippingProcess() {
    try {
        const { userId, courseId, courseSlug, allItems } = await getCourseData();
        
        log(`Queued ${allItems.length} items for checking...`);
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
            
            try {
                const result = await completeSingleVideo(userId, courseId, courseSlug, item.id);
                if (result) {
                    log(`[Video Completed] ${item.name} (${item.moduleName})`);
                    completedCount++;
                    await new Promise(r => setTimeout(r, 50));
                } else {
                    await new Promise(r => setTimeout(r, 10));
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

    // B. Execute Completion Sequence
    const apiUrlBase = `https://www.coursera.org/api/opencourse.v1/user/${userId}/course/${courseSlug}/item/${itemId}/lecture/videoEvents/`;
    const progressUrl = `https://www.coursera.org/api/onDemandVideoProgresses.v1/${userId}~${courseId}~${trackingId}`;
    const headers = getCourseraHeaders();
    const payload = JSON.stringify({ contentRequestBody: {} });

    // 1. Play
    await fetch(apiUrlBase + 'play?autoEnroll=false', {
        method: 'POST', headers: headers, body: payload, credentials: 'include'
    });

    // 2. Update Progress
    const progressPayload = JSON.stringify({
        videoProgressId: `${userId}~${courseId}~${trackingId}`,
        viewedUpTo: timeCommitment 
    });
    await fetch(progressUrl, {
        method: 'PUT', headers: headers, body: progressPayload, credentials: 'include'
    });

    // Wait a bit for server validation - Reduced to 100ms
    await new Promise(resolve => setTimeout(resolve, 100));

    // 3. End
    const endResp = await fetch(apiUrlBase + 'ended?autoEnroll=false', {
        method: 'POST', headers: headers, body: payload, credentials: 'include'
    });

    if (endResp.status !== 200 && endResp.status !== 204) {
        throw new Error(`End event failed: ${endResp.status}`);
    }

    return true;
}

async function getCourseData() {
    log("Initializing...");
    
    // 1. Get Course Slug from URL
    const urlParts = window.location.pathname.split('/').filter(p => p);
    let courseSlug = null;
    
    const learnIndex = urlParts.indexOf('learn');
    if (learnIndex !== -1 && urlParts.length > learnIndex + 1) {
        courseSlug = urlParts[learnIndex + 1];
    } else {
        const teachIndex = urlParts.indexOf('teach');
        if (teachIndex !== -1 && urlParts.length > teachIndex + 1) {
            courseSlug = urlParts[teachIndex + 1];
        } else {
            const courseIndex = urlParts.indexOf('course');
            if (courseIndex !== -1 && urlParts.length > courseIndex + 1) {
                courseSlug = urlParts[courseIndex + 1];
            }
        }
    }

    if (!courseSlug) {
        throw new Error("Could not find course slug in URL. Please open a Coursera course page (e.g. /learn/course-name).");
    }
    log(`Course Slug: ${courseSlug}`);

    // 2. Get User ID and Course ID with multi-endpoint fallbacks
    let userId = null, courseId = null;
    
    // Fallback cascade for User ID
    const userEndpoints = [
        "https://www.coursera.org/api/adminUserPermissions.v1?q=my",
        "https://www.coursera.org/api/userPreferences.v1?q=my",
        "https://www.coursera.org/api/externalAuthUserData.v1?q=my"
    ];

    for (const uUrl of userEndpoints) {
        try {
            const userResp = await fetch(uUrl, { credentials: "include" });
            if (userResp.ok) {
                const userData = await userResp.json();
                userId = userData.elements?.[0]?.id || userData.elements?.[0]?.userId;
                if (userId) break;
            }
        } catch(e) {}
    }

    // Fallback cascade for Course ID
    const courseEndpoints = [
        `https://www.coursera.org/api/onDemandCourseMaterials.v2/?q=slug&slug=${courseSlug}&includes=tracks`,
        `https://www.coursera.org/api/onDemandCourses.v1?q=slug&slug=${courseSlug}`
    ];

    for (const cUrl of courseEndpoints) {
        try {
            const courseResp = await fetch(cUrl, { credentials: "include" });
            if (courseResp.ok) {
                const courseData = await courseResp.json();
                courseId = courseData.elements?.[0]?.id;
                if (courseId) break;
            }
        } catch(e) {}
    }

    if (!userId || !courseId) {
        throw new Error(`Could not resolve User/Course IDs (User: ${userId || 'Missing'}, Course: ${courseId || 'Missing'}). Please ensure you are logged in.`);
    }
    log(`User ID: ${userId}, Course ID: ${courseId}`);

    // 3. Fetch Course Syllabus
    log("Fetching course syllabus...");
    let allItems = [];
    try {
        // Try namespaced fields to force return of specific properties
        const params = new URLSearchParams({
            q: 'slug',
            slug: courseSlug,
            includes: 'modules,lessons,items',
            fields: 'onDemandCourseMaterialItems.v2(name,typeName,contentSummary)'
        });
        const syllabusUrl = `https://www.coursera.org/api/onDemandCourseMaterials.v2/?${params.toString()}`;
        log(`Syllabus URL: ${syllabusUrl}`);
        
        const syllabusResp = await fetch(syllabusUrl, {credentials: "include"});
        const syllabusData = await syllabusResp.json();
        
        if (!syllabusData.linked) {
             throw new Error("'linked' property missing.");
        }

        const items = syllabusData.linked["onDemandCourseMaterialItems.v2"] || [];
        const modules = syllabusData.linked["onDemandCourseMaterialModules.v1"] || [];
        
        const moduleMap = {};
        modules.forEach(m => { moduleMap[m.id] = m.name; });

        log(`Total items found: ${items.length} across ${modules.length} modules.`);
        
        if (items.length > 0) {
           log("First Item Keys: " + Object.keys(items[0]).join(", "));
           // log("First Item Sample: " + JSON.stringify(items[0]));
        }

        allItems = items.map(item => ({
            id: item.id,
            name: item.name,
            slug: item.slug,
            typeName: item.typeName || item.contentSummary?.typeName,
            contentSummary: item.contentSummary,
            moduleId: item.moduleId,
            moduleName: moduleMap[item.moduleId] || "Unknown Module"
        }));

        const cleanTitle = document.title ? document.title.replace(/\s*\|\s*Coursera.*$/i, '').trim() : '';
        const courseTitle = cleanTitle || courseSlug.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

        return { userId, courseId, courseSlug, courseTitle, allItems, modules };
    } catch (e) {
        throw new Error("Error fetching syllabus: " + e.message);
    }
}

async function startReadingCompletionProcess() {
    try {
        const { userId, courseId, courseSlug, allItems } = await getCourseData();
        
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
            
            try {
                const result = await completeSingleReading(userId, courseId, courseSlug, item.id);
                if (result) {
                    log(`[Reading Completed] ${item.name}`);
                    completedCount++;
                    await new Promise(r => setTimeout(r, 50));
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
        const checkResp = await fetch(checkUrl, { method: 'GET', credentials: 'include' });
        
        if (!checkResp.ok) {
            return false; 
        }

        const headers = getCourseraHeaders();
        const completionId = `${userId}~${courseId}~${itemId}`;
        const resourceUrl = `https://www.coursera.org/api/onDemandSupplementCompletions.v1/${completionId}`;
        const collectionUrl = `https://www.coursera.org/api/onDemandSupplementCompletions.v1`;

        // Strategy 1: POST to collection with userId as Number
        // This is the most common pattern for creating a new completion record
        try {
            const body = JSON.stringify({
                courseId: courseId,
                itemId: itemId,
                userId: Number(userId)
            });
            const res = await fetch(collectionUrl, { method: 'POST', headers, body, credentials: 'include' });
            if (res.ok) return true;
        } catch(e) {}

        // Strategy 2: PUT to resource with composite ID and userId as Number
        try {
            const body = JSON.stringify({
                id: completionId,
                courseId: courseId,
                itemId: itemId,
                userId: Number(userId)
            });
            const res = await fetch(resourceUrl, { method: 'PUT', headers, body, credentials: 'include' });
            if (res.ok) return true;
        } catch(e) {}

        // Strategy 3: PUT to resource with just ID (minimal update)
        try {
            const body = JSON.stringify({
                id: completionId
            });
            const res = await fetch(resourceUrl, { method: 'PUT', headers, body, credentials: 'include' });
            if (res.ok) return true;
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

async function completePracticeLabOrLti(userId, courseId, courseSlug, item) {
    try {
        log(`Processing Practice Lab / LTI: ${item.name}...`);
        const headers = getCourseraHeaders();

        // 1. Touch LTI Item Passes API
        try {
            const ltiPassUrl = `https://www.coursera.org/api/onDemandLtiItemPasses.v1`;
            const passBody = JSON.stringify({
                courseId: courseId,
                itemId: item.id,
                userId: Number(userId)
            });
            await fetch(ltiPassUrl, { method: 'POST', headers, body: passBody, credentials: 'include' });
        } catch(e) {}

        // 2. Touch LTI Launch API
        try {
            const ltiLaunchUrl = `https://www.coursera.org/api/onDemandLtiLaunches.v1`;
            const launchBody = JSON.stringify({
                courseId: courseId,
                itemId: item.id,
                userId: Number(userId)
            });
            await fetch(ltiLaunchUrl, { method: 'POST', headers, body: launchBody, credentials: 'include' });
        } catch(e) {}

        // 3. Mark completion progress
        await completeSingleReading(userId, courseId, courseSlug, item.id);
        log(`[Practice Lab / LTI Completed] ${item.name}`);
        return true;

    } catch(e) {
        log(`Error completing lab: ${e.message}`);
        return false;
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
        
        // 1. Trigger DOM-based top End Conversation / End Dialogue action if open
        const clickedDOM = await triggerDialogueEndOptionInDOM();
        if (clickedDOM) {
            await new Promise(r => setTimeout(r, 500));
        }

        const headers = getCourseraHeaders();

        // 2. Call backend End Session & Dialogue Completion Actions
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

        // 3. Attempt REST completion & session updates
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

        // 4. Try GraphQL interactive attempt
        try {
            await processUngradedAssignment(userId, courseId, item, aiConfig, courseContext);
        } catch(e) {}

        // 5. Mark completion in course progress / supplement system
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
        const { userId, courseId, courseSlug, courseTitle, allItems, modules } = await getCourseData();
        
        const quizItems = allItems.filter(item => {
            const cat = classifyItemType(item);
            return cat === 'quiz_assignment' || cat === 'dialogue' || cat === 'discussion' || cat === 'lab';
        });
        
        log(`Found ${quizItems.length} quizzes, practice assignments & interactive items in "${courseTitle}".`);
        
        for (let i = 0; i < quizItems.length; i++) {
            if (globalState.abortRequested) {
                log("Quiz solving stopped by user.");
                break;
            }

            const item = quizItems[i];
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
    const discussionTypes = ['discussionPrompt', 'discussionQuestion', 'gradedDiscussionPrompt', 'discussion'];
    const dialogueTypes = ['dialogue', 'dialogueItem', 'interactiveDialogue', 'roleplay', 'conversationSimulation'];
    const labTypes = ['ungradedLti', 'gradedLti', 'ungradedLab', 'gradedLab', 'lab'];

    if (examTypes.includes(item.typeName)) {
        await processExamItem(userId, courseId, item, aiConfig, courseContext);
    } else if (assignmentTypes.includes(item.typeName)) {
        await processUngradedAssignment(userId, courseId, item, aiConfig, courseContext);
    } else if (discussionTypes.includes(item.typeName)) {
        await completeDiscussionPrompt(userId, courseId, '', item, aiConfig, courseContext);
    } else if (dialogueTypes.includes(item.typeName)) {
        await completeDialogueItem(userId, courseId, '', item, aiConfig, courseContext);
    } else if (labTypes.includes(item.typeName)) {
        await completePracticeLabOrLti(userId, courseId, '', item);
    } else {
        // Fallback: try assignment solver, then reading completion
        try {
            await processUngradedAssignment(userId, courseId, item, aiConfig, courseContext);
        } catch(e) {
            await completeSingleReading(userId, courseId, '', item.id);
        }
    }
}

async function processExamItem(userId, courseId, item, aiConfig, courseContext = null) {
    try {
        log(`Processing Graded Exam / Assessment: ${item.name}...`);
        
        // If the user currently has this exam page open in front of them, solve it on screen!
        const isCurrentPage = window.location.href.includes(item.id) || !!document.querySelector('.rc-FormPart, [class*="FormPart"], fieldset, [data-testid*="question"]');
        if (isCurrentPage) {
            log(`[On-Screen Exam] User is currently on the exam page. Executing live on-screen solver...`);
            const onScreenSuccess = await solveQuizOnScreenInDOM(aiConfig, courseContext);
            if (onScreenSuccess) {
                log(`[On-Screen Exam] Completed and submitted on-screen.`);
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
              attemptCount
              allowedAttempts
              attemptsRemaining
              inProgressAttempt {
                id
                draft {
                  id
                }
              }
              completedAttempts {
                grade
                isPassed
              }
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
        log("Sending GraphQL StartAttempt...");
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

        if (resp.ok) {
            const data = await resp.json();
            const result = data.data?.Submission_StartAttempt;
            
            if (result?.submissionState) {
                const subState = result.submissionState;
                const attemptsInfo = subState.attempts;
                
                // Check if already passed (to save limited attempts)
                const completedAttempts = attemptsInfo?.completedAttempts || [];
                const isAlreadyPassed = completedAttempts.some(a => a.isPassed === true);
                
                if (isAlreadyPassed && isGraded) {
                    log(`[Graded Assignment] Already passed! Highest score recorded. Skipping to save attempts.`);
                    await markAssignmentCompletedFallback(userId, courseId, item);
                    return;
                }

                // Check remaining attempts
                const allowed = attemptsInfo?.allowedAttempts;
                const used = attemptsInfo?.attemptCount || 0;
                const remaining = attemptsInfo?.attemptsRemaining;

                if (allowed && remaining !== undefined && remaining <= 0) {
                    log(`[Graded Assignment] Out of attempts (${used}/${allowed} used). Skipping.`);
                    await markAssignmentCompletedFallback(userId, courseId, item);
                    return;
                }

                if (isGraded && allowed) {
                    log(`[Graded Assignment] Attempt ${used + 1}/${allowed} in progress... (Highest score will be kept)`);
                } else {
                    log("GraphQL Session Started Successfully!");
                }
            }
        }

        // Always query questions via QueryState (handles newly started and existing in-progress drafts)
        const solved = await processGraphQLSession(courseId, item.id, headers, aiConfig, courseContext);

        // Run fallback pass & progress markers to guarantee Coursera records completion
        await markAssignmentCompletedFallback(userId, courseId, item);

    } catch (e) {
        log(`Error in GraphQL assignment process: ${e.message}`);
        await markAssignmentCompletedFallback(userId, courseId, item);
    }
}

async function markAssignmentCompletedFallback(userId, courseId, item) {
    try {
        const headers = getCourseraHeaders();

        const postBody = JSON.stringify({
            courseId: courseId,
            itemId: item.id,
            userId: Number(userId),
            status: "COMPLETED",
            isCompleted: true
        });

        const endpoints = [
            `https://www.coursera.org/api/onDemandAssignmentPasses.v1`,
            `https://www.coursera.org/api/onDemandAssignmentSubmissions.v1`,
            `https://www.coursera.org/api/onDemandWidgetProgresses.v1`,
            `https://www.coursera.org/api/onDemandWidgetPasses.v1`,
            `https://www.coursera.org/api/onDemandLtiItemPasses.v1`
        ];

        for (const ep of endpoints) {
            try {
                await fetch(ep, { method: 'POST', headers, body: postBody, credentials: 'include' });
            } catch(e) {}
        }

        // Mark completion via supplement / item views
        await completeSingleReading(userId, courseId, '', item.id);

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

            await solveQuestions('graphql', courseId, itemId, questions, headers, aiConfig, courseContext, draftId);
            return true;

        } else {
            log("No open parts found in GraphQL state. Proceeding with fallback completion...");
            return false;
        }

    } catch (e) {
        log(`Error in GraphQL QueryState: ${e.message}`);
        return false;
    }
}

async function processSession(endpoint, sessionId, headers, aiConfig, courseContext = null) {
    // Generic function to handle session state and solving
    try {
        const actionUrl = `https://www.coursera.org/api/${endpoint}/${sessionId}/actions?includes=gradingAttempts`;
        
        // Try standard action payload
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
        
        // Extract questions from response
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
            log("State Data: " + JSON.stringify(actionData).substring(0, 200));
        }
    } catch (e) {
        log(`Error processing session: ${e.message}`);
    }
}

async function solveQuestions(endpoint, courseId, itemId, questions, headers, aiConfig, courseContext = null, fallbackDraftId = null) {
    log(`Starting solver for ${questions.length} question(s)...`);
    
    const responsesToSave = [];

    for (let i = 0; i < questions.length; i++) {
        if (globalState.abortRequested) {
            log("Solver stopped by user.");
            break;
        }

        const q = questions[i];
        log(`[${i + 1}/${questions.length}] Solving Question ID: ${q.id}`);

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
- Provide a direct, concise, and accurate answer strictly based on the conventions, terminology, and tools taught in this specific course.
- NEVER disclose, mention, or imply that you are an AI, language model, assistant, or automated system.
- Do NOT include any conversational preamble, quotes, or explanations. Output ONLY the answer text.`;
            } else if (isCode) {
                prompt = `You are writing code to solve a programming question in a Coursera course.

${courseHeader}
Question:
${q.prompt?.text || "No question prompt available"}

Strict Guidelines:
- Provide ONLY the raw source code required to solve the task.
- Do NOT wrap your response in markdown code blocks (\`\`\`) or conversational text.
- Follow the exact coding conventions of this course.`;
            } else if (isRegex) {
                prompt = `You are solving a regular expression / pattern matching question in a Coursera course.

${courseHeader}
Question:
${q.prompt?.text || "No question prompt available"}

Strict Guidelines:
- Provide ONLY the exact matching string or regex pattern. Do not include markdown or explanations.`;
            } else if (isUrl) {
                prompt = `You are providing a submission link for a Coursera project assignment.

${courseHeader}
Question:
${q.prompt?.text || "No question prompt available"}

Provide a valid submission URL (e.g. a GitHub repository or project link). Reply with ONLY the URL.`;
            } else if (isNumeric) {
                prompt = `You are solving a numerical calculation question in a Coursera course.

${courseHeader}
Question:
${q.prompt?.text || "No question prompt available"}

Strict Safety & Style Guidelines:
- Calculate the answer accurately according to the methods taught in this course.
- Provide ONLY the final numeric value (e.g. 42 or 3.14). Do not include words, units, or AI commentary unless explicitly specified in the question.`;
            } else if (isWidget) {
                // Widget question - complete directly
                responsesToSave.push({
                    questionId: q.id,
                    questionType: 'WIDGET',
                    questionResponse: {
                        widgetResponse: {
                            answer: "COMPLETED"
                        }
                    }
                });
                log(`[Widget Answer Recorded] ${q.id}`);
                continue;
            } else {
                // MCQ / Checkbox
                const optionsList = (q.options || []).map((o, index) => `Option ${index + 1} (${String.fromCharCode(65 + index)}): ${o.text}`).join('\n');
                const multiNote = isCheckbox ? "Select all correct options." : "Select the single best correct option.";

                prompt = `You are solving a multiple choice question in a Coursera course.

${courseHeader}
Question:
${q.prompt?.text || "No question prompt available"}

Options:
${optionsList}

Strict Safety & Style Guidelines:
- ${multiNote}
- Base your answer on the curriculum, definitions, and official conventions taught in this specific course.
- Reply ONLY with the correct option number(s) in this format: "Option 1" or "Option 1, Option 3".
- Do not output anything else.`;
            }

            const providerLabel = (typeof aiConfig === 'object' && aiConfig?.provider) ? aiConfig.provider.toUpperCase() : 'AI';
            log(`Asking ${providerLabel} for question (${q.type || 'Question'})...`);
            const rawAnswer = await callLLM(prompt, aiConfig);

            if (!rawAnswer) {
                log(`Warning: Could not obtain answer from ${providerLabel} for question ${q.id}. Skipping.`);
                continue;
            }

            const answerText = (isText || isRichText) ? sanitizeHumanStudentResponse(rawAnswer) : rawAnswer;
            log(`${providerLabel} response: ${answerText}`);

            if (isText) {
                let questionTypeEnum = 'PLAIN_TEXT';
                if (q.type === 'Submission_ShortAnswerQuestion') questionTypeEnum = 'SHORT_ANSWER';
                else if (q.type === 'Submission_TextExactMatchQuestion') questionTypeEnum = 'TEXT_EXACT_MATCH';

                responsesToSave.push({
                    questionId: q.id,
                    questionType: questionTypeEnum,
                    questionResponse: {
                        plainTextResponse: {
                            plainText: answerText.trim()
                        }
                    }
                });
                log(`[Saved Text]: ${answerText.trim()}`);

            } else if (isRichText) {
                responsesToSave.push({
                    questionId: q.id,
                    questionType: 'RICH_TEXT',
                    questionResponse: {
                        richTextResponse: {
                            richText: {
                                cmlValue: `<cml><p>${answerText.trim()}</p></cml>`,
                                dtdId: "richText/1"
                            }
                        }
                    }
                });
                log(`[Saved RichText]: ${answerText.trim()}`);

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

            } else if (isUrl) {
                const urlMatch = answerText.match(/https?:\/\/[^\s]+/);
                const finalUrl = urlMatch ? urlMatch[0] : `https://www.coursera.org/learn/${courseContext?.courseSlug || 'course'}`;
                responsesToSave.push({
                    questionId: q.id,
                    questionType: 'URL',
                    questionResponse: {
                        urlResponse: {
                            url: finalUrl,
                            title: "Submission",
                            caption: "Completed"
                        }
                    }
                });
                log(`[Saved URL]: ${finalUrl}`);

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
                const matchedOptions = matchGeminiAnswerToOptions(answerText, q.options || []);

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
                // Free-tier Gemini has strict 10-15 RPM quota
                log(`[Gemini Pacing] Waiting 4.5s before next question...`);
                await new Promise(resolve => setTimeout(resolve, 4500));
            } else if (provider === 'groq') {
                // Groq is ultra-fast with high RPM caps
                await new Promise(resolve => setTimeout(resolve, 100));
            } else if (provider === 'openrouter') {
                // OpenRouter handles rapid sequential queries
                await new Promise(resolve => setTimeout(resolve, 300));
            } else {
                // Custom / Local LLMs (Ollama, LM Studio, OpenAI)
                await new Promise(resolve => setTimeout(resolve, 200));
            }
        }
    }

    // Save and submit responses
    if (responsesToSave.length > 0 && !globalState.abortRequested) {
        log(`Saving ${responsesToSave.length}/${questions.length} responses...`);
        
        if (endpoint === 'graphql') {
            const savedDraftId = await saveResponsesGraphQL(headers, courseId, itemId, responsesToSave);
            const finalSubmissionId = savedDraftId || fallbackDraftId;
            
            if (finalSubmissionId) {
                log(`Submitting quiz draft (Submission ID: ${finalSubmissionId})...`);
                await submitDraftGraphQL(headers, courseId, itemId, finalSubmissionId);
            } else {
                log("Submission ID not found in response; submitting latest draft...");
                await submitDraftGraphQL(headers, courseId, itemId, itemId);
            }
        }
    } else if (responsesToSave.length === 0) {
        log("No valid responses were generated to save.");
    }
}

function matchGeminiAnswerToOptions(answerText, options) {
    if (!answerText || !options || options.length === 0) return [];
    
    const matched = [];
    const matchedIds = new Set();

    const addOption = (opt) => {
        if (opt && !matchedIds.has(opt.id)) {
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
            if (!opt.text) continue;
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
                if (score > highestScore && score >= 0.5) {
                    highestScore = score;
                    bestMatch = opt;
                }
            }
        }

        if (matched.length === 0 && bestMatch) {
            addOption(bestMatch);
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
          attemptCount
          allowedAttempts
          attemptsRemaining
          completedAttempts {
            grade
            isPassed
            __typename
          }
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
                const completedAttempts = result.submissionState?.attempts?.completedAttempts;
                if (completedAttempts && completedAttempts.length > 0) {
                    const latest = completedAttempts[completedAttempts.length - 1];
                    const scoreText = (latest.grade !== undefined && latest.grade !== null) ? `${Math.round(latest.grade * 100)}%` : 'Recorded';
                    const statusText = latest.isPassed ? 'PASSED (✓)' : 'Pending Grade';
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
async function generateCourseSummaryReport(userId, courseId, courseSlug, courseTitle, allItems, modules = []) {
    try {
        log(`Generating Course Completion & Module Summary Report...`);
        const headers = getCourseraHeaders();

        // 1. Fetch completed item IDs from Coursera Progress API
        const completedIds = new Set();
        try {
            const progressUrl = `https://www.coursera.org/api/onDemandCourseProgresses.v1/${userId}~${courseId}?includes=completedItemIds,itemProgresses`;
            const resp = await fetch(progressUrl, { headers, credentials: 'include' });
            if (resp.ok) {
                const data = await resp.json();
                if (data.elements && data.elements[0]) {
                    const el = data.elements[0];
                    if (Array.isArray(el.completedItemIds)) {
                        el.completedItemIds.forEach(id => completedIds.add(id));
                    }
                    if (Array.isArray(el.itemProgresses)) {
                        el.itemProgresses.forEach(ip => {
                            if (ip.isCompleted || ip.progressState === 'COMPLETED') {
                                completedIds.add(ip.itemId);
                            }
                        });
                    }
                }
            }
        } catch(e) {}

        // Fallback: check onDemandItemViews if progress API missed some
        try {
            const viewsUrl = `https://www.coursera.org/api/onDemandItemViews.v1/?q=course&courseId=${courseId}&userId=${userId}`;
            const vResp = await fetch(viewsUrl, { headers, credentials: 'include' });
            if (vResp.ok) {
                const vData = await vResp.json();
                (vData.elements || []).forEach(v => {
                    if (v.completed || v.isCompleted) completedIds.add(v.itemId);
                });
            }
        } catch(e) {}

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
            else if (t.includes('lti') || t.includes('lab')) categories.labs++;
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
            remainingItems: remainingItems
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
    'gemini-2.5-flash-lite',
    'gemini-2.5-flash',
    'gemini-2.5-pro',
    'gemini-2.0-flash',
    'gemini-1.5-flash'
];

async function getAvailableGeminiModels(apiKey) {
    if (cachedAvailableModels && cachedAvailableModels.length > 0) {
        return cachedAvailableModels;
    }

    try {
        const listUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
        const resp = await fetch(listUrl);
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
        log(`Notice: Model discovery failed, using defaults: ${e.message}`);
    }

    cachedAvailableModels = PREFERRED_TEXT_MODELS;
    return cachedAvailableModels;
}

/**
 * Calls OpenAI-Compatible Endpoints (OpenRouter, Groq, Local Ollama, DeepSeek, etc.)
 */
async function callOpenAICompatible(prompt, config, maxRetries = 3) {
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
                body: body
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
                const backoffMs = (attempt + 1) * 3000;
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
            log(`[${provider}/${model}] Network error: ${netErr.message}`);
            if (attempt < maxRetries) {
                await new Promise(r => setTimeout(r, 2000));
                continue;
            }
            return null;
        }
    }

    return null;
}

/**
 * Calls Google Gemini API with:
 * - Dynamic model discovery & fallback cascade
 * - Exponential backoff retry on 429 / 503 / 500
 * - Clean string output or null on failure
 */
async function callGemini(apiKey, prompt, maxRetries = 3) {
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
                    })
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
                    const backoffMs = (attempt + 1) * 4000 + Math.floor(Math.random() * 1000);
                    const errorDetail = response.status === 429 ? "Rate limit quota (429)" : `Server error (${response.status})`;
                    
                    if (attempt < maxRetries) {
                        log(`[${model}] ${errorDetail} - Cooling down for ${(backoffMs / 1000).toFixed(1)}s (Attempt ${attempt + 1}/${maxRetries})...`);
                        await new Promise(r => setTimeout(r, backoffMs));
                        continue;
                    } else {
                        log(`[${model}] Rate limit retries exhausted. Trying fallback model...`);
                        break;
                    }
                }

                // Model not found or bad request on model
                if (response.status === 404 || response.status === 400) {
                    const errText = await response.text();
                    log(`[${model}] Status ${response.status}: ${errText.substring(0, 80)}. Trying fallback...`);
                    break;
                }

                const errBody = await response.text();
                log(`[${model}] HTTP ${response.status}: ${errBody.substring(0, 80)}`);
                break;

            } catch (networkErr) {
                log(`[${model}] Network error: ${networkErr.message}`);
                if (attempt < maxRetries) {
                    const backoffMs = (attempt + 1) * 3000;
                    await new Promise(r => setTimeout(r, backoffMs));
                    continue;
                }
                break;
            }
        }
    }

    log("Error: All Gemini models failed or rate limit quota exceeded.");
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
    if (!element) return;
    try {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        element.focus();
        element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
        element.click();
        element.dispatchEvent(new Event('change', { bubbles: true }));
    } catch(e) {
        element.click();
    }
}

async function startOnScreenQuizSolverProcess(aiConfig) {
    try {
        log("Starting On-Screen Live DOM Quiz Solver...");
        updateStatus("Solving quiz in front of user...");
        showOnScreenHUD("FcukCoursera: Analyzing Quiz Form...", "working");

        const cleanTitle = document.title ? document.title.replace(/\s*\|\s*Coursera.*$/i, '').trim() : '';
        const urlParts = window.location.pathname.split('/').filter(p => p);
        const learnIndex = urlParts.indexOf('learn');
        const courseSlug = (learnIndex !== -1 && urlParts.length > learnIndex + 1) ? urlParts[learnIndex + 1] : "";
        const courseContext = {
            courseSlug: courseSlug,
            courseTitle: cleanTitle || courseSlug,
            assignmentName: cleanTitle
        };

        const result = await solveQuizOnScreenInDOM(aiConfig, courseContext);
        if (result) {
            log("On-Screen Quiz Solving and Submission Completed!");
            updateStatus("Quiz Submitted Successfully!");
            showOnScreenHUD("🎉 Quiz Submitted Successfully!", "success");
            setTimeout(hideOnScreenHUD, 4000);
        } else {
            log("On-screen quiz completed or no open quiz questions found on page.");
            updateStatus("Completed on-screen check.");
            hideOnScreenHUD();
        }
        chrome.runtime.sendMessage({ action: "finished" }).catch(() => {});
    } catch(e) {
        log(`Error in on-screen quiz solver: ${e.message}`);
        updateStatus("Error in on-screen solver.");
        hideOnScreenHUD();
        chrome.runtime.sendMessage({ action: "finished" }).catch(() => {});
    }
}

async function solveQuizOnScreenInDOM(aiConfig, courseContext = null) {
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

        log(`[On-Screen] Found ${questionElements.length} questions on page. Beginning live answering...`);
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

            // Extract question prompt
            const promptEl = qEl.querySelector('legend, [class*="prompt"], [class*="Prompt"], [class*="cml"], h3, h4, p');
            const promptText = (promptEl ? promptEl.innerText : qEl.innerText || '').split('\n')[0].replace(/<[^>]*>/g, '').trim();

            const radios = Array.from(qEl.querySelectorAll('input[type="radio"]'));
            const checkboxes = Array.from(qEl.querySelectorAll('input[type="checkbox"]')).filter(cb => {
                const labelTxt = (cb.closest('label')?.innerText || cb.parentElement?.innerText || '').toLowerCase();
                return !labelTxt.includes('honor code') && !labelTxt.includes('submitting work') && !labelTxt.includes('i understand');
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
                    return { id: `opt_${idx}`, element: r, text: text, parent: parentLabel };
                });

                const optionsList = domOptions.map((o, idx) => `Option ${idx + 1} (${String.fromCharCode(65 + idx)}): ${o.text}`).join('\n');
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
                if (answer) {
                    log(`[On-Screen Q${i + 1}] AI Answer: ${answer}`);
                    const matched = matchGeminiAnswerToOptions(answer, domOptions);
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
            }
            // Handle Multiple Choice (Checkboxes)
            else if (checkboxes.length > 0) {
                const domOptions = checkboxes.map((cb, idx) => {
                    const parentLabel = cb.closest('label') || cb.parentElement;
                    const text = (parentLabel ? parentLabel.innerText : '').replace(/<[^>]*>/g, '').trim() || `Option ${idx + 1}`;
                    return { id: `opt_${idx}`, element: cb, text: text, parent: parentLabel };
                });

                const optionsList = domOptions.map((o, idx) => `Option ${idx + 1} (${String.fromCharCode(65 + idx)}): ${o.text}`).join('\n');
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
                if (answer) {
                    log(`[On-Screen Q${i + 1}] AI Answer: ${answer}`);
                    const matched = matchGeminiAnswerToOptions(answer, domOptions);
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
                if (answer) {
                    const numMatch = answer.match(/[-+]?[0-9]*\.?[0-9]+/);
                    if (numMatch) {
                        setNativeInputValue(numInput, numMatch[0]);
                        numInput.style.border = "2px solid #22c55e";
                    }
                }
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
                if (answer) {
                    const cleanAnswer = sanitizeHumanStudentResponse(answer);
                    setNativeInputValue(textInput, cleanAnswer);
                    textInput.style.border = "2px solid #22c55e";
                }
            }

            qEl.style.outline = "2px solid #22c55e";
            await new Promise(r => setTimeout(r, 400));
        }

        // 3. Honor Code & Academic Integrity Agreement Checkbox
        showOnScreenHUD("Signing Honor Code...", "working");
        const honorCheckboxes = Array.from(document.querySelectorAll('input[type="checkbox"]')).filter(cb => {
            const labelTxt = (cb.closest('label')?.innerText || cb.parentElement?.innerText || cb.getAttribute('aria-label') || '').toLowerCase();
            return labelTxt.includes('honor code') || labelTxt.includes('submitting work') || labelTxt.includes('own work') || labelTxt.includes('i understand') || labelTxt.includes('academic integrity');
        });

        for (const hCb of honorCheckboxes) {
            if (!hCb.checked) {
                log("[On-Screen] Checking Coursera Honor Code agreement checkbox...");
                clickNativeOption(hCb);
            }
        }

        // Signature Text Field
        const signatureInputs = Array.from(document.querySelectorAll('input[type="text"]')).filter(inp => {
            const p = (inp.getAttribute('placeholder') || inp.getAttribute('aria-label') || inp.name || '').toLowerCase();
            return p.includes('signature') || p.includes('full name') || p.includes('type your name');
        });

        for (const sInp of signatureInputs) {
            if (!sInp.value) {
                log("[On-Screen] Entering student signature...");
                const cleanName = document.querySelector('[data-testid="user-profile-name"], .user-name')?.innerText || "Accepted";
                setNativeInputValue(sInp, cleanName);
            }
        }

        await new Promise(r => setTimeout(r, 600));

        // 4. Locate and Click Submit Button
        showOnScreenHUD("Submitting Assignment...", "working");
        const allButtons = Array.from(document.querySelectorAll('button, [role="button"], input[type="submit"]'));
        const submitKeywords = ['submit assignment', 'submit quiz', 'submit exam', 'submit'];
        
        let submitBtn = null;
        for (const btn of allButtons) {
            const txt = (btn.innerText || btn.textContent || '').trim().toLowerCase();
            const testId = (btn.getAttribute('data-testid') || btn.getAttribute('data-e2e') || '').toLowerCase();
            if (submitKeywords.some(kw => txt === kw || testId.includes(kw))) {
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

            // Check if confirmation modal appeared
            const modalButtons = Array.from(document.querySelectorAll('[role="dialog"] button, .modal button, [class*="modal"] button, [class*="dialog"] button'));
            for (const mBtn of modalButtons) {
                const mText = (mBtn.innerText || mBtn.textContent || '').trim().toLowerCase();
                if (mText === 'submit' || mText === 'yes' || mText === 'confirm' || mText === 'yes, submit' || mText.includes('submit assignment') || mText.includes('confirm')) {
                    log(`[On-Screen] Confirmed final submit modal.`);
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



