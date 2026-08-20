// Global State
let globalState = {
    isRunning: false,
    abortRequested: false,
    currentAction: null,
    statusMessage: "Ready",
    progress: { current: 0, total: 0, message: "" },
    logs: []
};

// Helper to log to popup
function log(msg) {
    console.log("[FcukCoursera]", msg);
    globalState.logs.push(msg);
    if (globalState.logs.length > 100) globalState.logs.shift();
    chrome.runtime.sendMessage({ action: "log", data: msg }).catch(() => {});
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
        startQuizSolverProcess(request.apiKey).finally(() => { 
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
        startCompleteCourseProcess(request.apiKey).finally(() => { 
            globalState.isRunning = false;
            globalState.abortRequested = false;
        });
        sendResponse({ status: "started" });
    }
});

async function startCompleteCourseProcess(apiKey) {
    try {
        const { userId, courseId, courseSlug, allItems } = await getCourseData();
        
        log(`Starting Course Completion. Found ${allItems.length} items.`);
        updateProgress(0, allItems.length, "Starting...");

        let completedCount = 0;
        
        for (let i = 0; i < allItems.length; i++) {
            if (globalState.abortRequested) {
                log("Course completion stopped by user.");
                break;
            }

            const item = allItems[i];
            const progressMsg = `[${i + 1}/${allItems.length}] ${item.typeName}: ${item.name}`;
            updateStatus(progressMsg);
            updateProgress(i, allItems.length, item.name);
            
            try {
                let result = false;
                
                if (item.typeName === 'lecture') {
                    result = await completeSingleVideo(userId, courseId, courseSlug, item.id);
                    if (result) log(`[Video Completed] ${item.name}`);
                } 
                else if (item.typeName === 'supplement') {
                    result = await completeSingleReading(userId, courseId, courseSlug, item.id);
                    if (result) log(`[Reading Completed] ${item.name}`);
                }
                else if (['exam', 'gradedQuiz', 'quiz', 'ungradedWidget', 'ungradedAssignment'].includes(item.typeName)) {
                    log(`[Quiz Found] ${item.name}`);
                    await processQuizItem(userId, courseId, item, apiKey);
                    result = true;
                }
                else {
                    log(`[Skipping] ${item.name} (Type: ${item.typeName})`);
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

    const csrfTokenMatch = document.cookie.match(/CSRF3-Token=([^;]+)/);
    const csrfToken = csrfTokenMatch ? csrfTokenMatch[1] : null;
    
    const headers = {
        'Content-Type': 'application/json',
        'x-csrf3-token': csrfToken,
        'x-coursera-application': 'ondemand',
        'x-requested-with': 'XMLHttpRequest',
    };
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
    const learnIndex = urlParts.indexOf('learn');
    if (learnIndex === -1 || urlParts.length <= learnIndex + 1) {
        throw new Error("Could not find course slug in URL. Go to course home.");
    }
    const courseSlug = urlParts[learnIndex + 1];
    log(`Course Slug: ${courseSlug}`);

    // 2. Get User ID and Course ID
    let userId, courseId;
    try {
        const userResp = await fetch("https://www.coursera.org/api/adminUserPermissions.v1?q=my", {credentials: "include"});
        const userData = await userResp.json();
        userId = userData.elements?.[0]?.id;

        const courseResp = await fetch(`https://www.coursera.org/api/onDemandCourseMaterials.v2/?q=slug&slug=${courseSlug}&includes=tracks`, {credentials: "include"});
        const courseData = await courseResp.json();
        courseId = courseData.elements?.[0]?.id;
        
        if (!userId || !courseId) throw new Error("Missing IDs");
        log(`User ID: ${userId}, Course ID: ${courseId}`);
    } catch (e) {
        throw new Error("Error fetching User/Course IDs: " + e.message);
    }

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

    } catch (e) {
        throw new Error("Error fetching syllabus: " + e.message);
    }

    return { userId, courseId, courseSlug, allItems };
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

        const csrfTokenMatch = document.cookie.match(/CSRF3-Token=([^;]+)/);
        const csrfToken = csrfTokenMatch ? csrfTokenMatch[1] : null;
        
        const headers = {
            'Content-Type': 'application/json',
            'x-csrf3-token': csrfToken,
            'x-coursera-application': 'ondemand',
            'x-requested-with': 'XMLHttpRequest',
        };

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

async function startQuizSolverProcess(apiKey) {
    try {
        const { userId, courseId, courseSlug, allItems } = await getCourseData();
        
        // Log all found types to help debug
        const uniqueTypes = [...new Set(allItems.map(item => item.typeName))];
        log(`Found item types: ${uniqueTypes.map(t => t || 'undefined').join(', ')}`);

        // Identify quizzes
        const quizTypes = ['exam', 'gradedQuiz', 'quiz', 'ungradedWidget', 'ungradedAssignment'];
        const quizItems = allItems.filter(item => quizTypes.includes(item.typeName));
        
        log(`Found ${quizItems.length} quizzes.`);
        
        for (let i = 0; i < quizItems.length; i++) {
            if (globalState.abortRequested) {
                log("Quiz solving stopped by user.");
                break;
            }

            const item = quizItems[i];
            updateStatus(`[${i + 1}/${quizItems.length}] Quiz: ${item.name}`);
            
            log(`[Quiz Found] ${item.name} (${item.typeName}) - ID: ${item.id}`);

            // Attempt to retrieve questions
            try {
                await processQuizItem(userId, courseId, item, apiKey);
            } catch (err) {
                log(`Failed to process quiz ${item.name}: ${err.message}`);
            }
        }

        if (globalState.abortRequested) {
            updateStatus("Process aborted.");
        } else {
            updateStatus(`Done! Processed quizzes.`);
        }
        chrome.runtime.sendMessage({ action: "finished" }).catch(() => {});

    } catch (e) {
        log("Error: " + e.message);
        updateStatus("Error occurred. Check logs.");
        chrome.runtime.sendMessage({ action: "finished" }).catch(() => {});
    }
}

async function processQuizItem(userId, courseId, item, apiKey) {
    log(`Processing ${item.name} (${item.typeName})...`);
    
    if (item.contentSummary) {
        log(`Content Summary: ${JSON.stringify(item.contentSummary)}`);
    }

    // Types that usually use the Exam Session API
    const examTypes = ['exam', 'gradedQuiz'];
    
    if (examTypes.includes(item.typeName)) {
        await processExamItem(userId, courseId, item, apiKey);
    } else if (item.typeName === 'ungradedAssignment') {
        await processUngradedAssignment(userId, courseId, item, apiKey);
    } else {
        log(`Skipping ${item.typeName} - Not a standard exam type.`);
    }
}

async function processUngradedAssignment(userId, courseId, item, apiKey) {
    log(`Attempting to process Ungraded Assignment: ${item.name}`);

    // Strategy: Use GraphQL Submission_StartAttempt
    // Based on user logs, this is the correct way to start these assignments
    const graphqlUrl = 'https://www.coursera.org/graphql-gateway?opname=Submission_StartAttempt';
    
    const csrfTokenMatch = document.cookie.match(/CSRF3-Token=([^;]+)/);
    const csrfToken = csrfTokenMatch ? csrfTokenMatch[1] : null;
    
    const headers = {
        'Content-Type': 'application/json',
        'x-csrf3-token': csrfToken,
        'x-coursera-application': 'ondemand',
        'x-requested-with': 'XMLHttpRequest',
    };

    const query = `mutation Submission_StartAttempt($courseId: ID!, $itemId: ID!) {
      Submission_StartAttempt(input: {courseId: $courseId, itemId: $itemId}) {
        ... on Submission_StartAttemptSuccess {
          submissionState {
            assignment {
              id
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

        if (!resp.ok) {
            log(`GraphQL Request Failed: ${resp.status}`);
            return;
        }

        const data = await resp.json();
        
        // Check for errors in the top-level response
        if (data.errors) {
            log(`GraphQL Errors: ${JSON.stringify(data.errors)}`);
            return;
        }

        const result = data.data?.Submission_StartAttempt;
        
        // Check if it was a success or failure type
        if (result?.submissionState) {
            log("GraphQL Session Started Successfully!");
            await processGraphQLSession(courseId, item.id, headers, apiKey);
        } else if (result?.errors) {
            log(`Start Attempt Failed: ${JSON.stringify(result.errors)}`);
        } else {
            log(`Unknown GraphQL Response: ${JSON.stringify(result)}`);
        }

    } catch (e) {
        log(`Error in GraphQL Start: ${e.message}`);
    }
}

async function processGraphQLSession(courseId, itemId, headers, apiKey) {
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

        // Check for in-progress attempt
        const attempts = queryState.attempts;
        const inProgress = attempts?.inProgressAttempt;
        
        if (inProgress && inProgress.draft && inProgress.draft.parts) {
            const parts = inProgress.draft.parts;
            log(`Found ${parts.length} parts in the quiz.`);
            
            // Map GraphQL parts to a simpler format for the solver
            const questions = parts.map(part => {
                // Skip TextBlocks or informational parts
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
                
                // Clean HTML from prompt
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
                        // Clean HTML from option
                        optText = optText.replace(/<[^>]*>/g, '').trim();
                        return { id: opt.optionId, text: optText };
                    });
                }

                return {
                    id: part.partId,
                    type: part.__typename, // e.g., Submission_MultipleChoiceQuestion
                    prompt: { text: promptText },
                    options: options
                };
            }).filter(q => q !== null); // Filter out nulls (TextBlocks)

            await solveQuestions('graphql', courseId, itemId, questions, headers, apiKey);

        } else {
            log("No in-progress attempt found. You might need to start it manually once.");
        }

    } catch (e) {
        log(`Error in GraphQL QueryState: ${e.message}`);
    }
}

async function processSession(endpoint, sessionId, headers, apiKey) {
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
        // Structure varies: elements[0].result.questions or questionStates
        let questions = null;
        if (actionData.elements && actionData.elements[0].result && actionData.elements[0].result.questions) {
            questions = actionData.elements[0].result.questions;
        } else if (actionData.questionStates) {
            questions = actionData.questionStates;
        }

        if (questions && questions.length > 0) {
            log(`Found ${questions.length} questions!`);
            await solveQuestions(endpoint, sessionId, questions, headers, apiKey);
        } else {
            log("No questions found in session state.");
            log("State Data: " + JSON.stringify(actionData).substring(0, 200));
        }
    } catch (e) {
        log(`Error processing session: ${e.message}`);
    }
}

async function solveQuestions(endpoint, courseId, itemId, questions, headers, apiKey) {
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

            if (isText) {
                prompt = `You are solving a Coursera quiz question.

Question:
${q.prompt?.text || "No question prompt available"}

Instructions:
Provide a direct, concise, and accurate answer to this question.
Do not include any conversational preamble or explanation. Output only the answer itself.`;
            } else if (isNumeric) {
                prompt = `You are solving a Coursera numerical calculation question.

Question:
${q.prompt?.text || "No question prompt available"}

Instructions:
Calculate the answer accurately.
Provide ONLY the final number (e.g. 42 or 3.14). Do not include words or units unless explicitly specified in the question.`;
            } else {
                // MCQ / Checkbox
                const optionsList = (q.options || []).map((o, index) => `Option ${index + 1} (${String.fromCharCode(65 + index)}): ${o.text}`).join('\n');
                const multiNote = isCheckbox ? "Select all correct options." : "Select the single best correct option.";

                prompt = `You are solving a Coursera multiple choice question.

Question:
${q.prompt?.text || "No question prompt available"}

Options:
${optionsList}

Instructions:
${multiNote}
Reply ONLY with the correct option number(s) in this format: "Option 1" or "Option 1, Option 3".
Do not output anything else.`;
            }

            log(`Asking Gemini AI for question (${q.type || 'Question'})...`);
            const answerText = await callGemini(apiKey, prompt);

            if (!answerText) {
                log(`Warning: Could not obtain answer from Gemini for question ${q.id}. Skipping.`);
                continue;
            }

            log(`Gemini response: ${answerText}`);

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
                    log(`Could not match Gemini answer to any option. Raw answer: "${answerText}"`);
                }
            }

        } catch (e) {
            log(`Error solving question ${q.id}: ${e.message}`);
        }

        // Pacing delay between questions to stay safely under free-tier RPM limits
        if (i < questions.length - 1 && !globalState.abortRequested) {
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }

    // Save and submit responses
    if (responsesToSave.length > 0 && !globalState.abortRequested) {
        log(`Saving ${responsesToSave.length}/${questions.length} responses...`);
        
        if (endpoint === 'graphql') {
            const submissionId = await saveResponsesGraphQL(headers, courseId, itemId, responsesToSave);
            if (submissionId) {
                log(`Submitting quiz draft (Submission ID: ${submissionId})...`);
                await submitDraftGraphQL(headers, courseId, itemId, submissionId);
            } else {
                log("Submission ID not received; skipped draft submission.");
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

    // 4. Fallback: Substring / text comparison against option texts
    if (matched.length === 0) {
        const cleanAnswer = answerText.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').trim();
        for (const opt of options) {
            if (!opt.text) continue;
            const cleanOpt = opt.text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').trim();
            if (cleanOpt.length > 0 && (cleanAnswer.includes(cleanOpt) || cleanOpt.includes(cleanAnswer))) {
                addOption(opt);
            }
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
        __typename
      }
    }
    ... on Submission_SubmitLatestDraftFailure {
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
            log("Quiz Submitted Successfully!");
        } else {
            const errorText = await resp.text();
            log(`Failed to submit quiz: ${resp.status} - ${errorText.substring(0, 200)}`);
        }
    } catch(e) {
        log(`Error submitting quiz: ${e.message}`);
    }
}

async function processExamItem(userId, courseId, item, apiKey) {
    try {
        log(`Attempting to start exam session for ${item.name}...`);
        
        const sessionUrl = `https://www.coursera.org/api/onDemandExamSessions.v1`;
        const csrfTokenMatch = document.cookie.match(/CSRF3-Token=([^;]+)/);
        const csrfToken = csrfTokenMatch ? csrfTokenMatch[1] : null;
        
        const headers = {
            'Content-Type': 'application/json',
            'x-csrf3-token': csrfToken,
            'x-coursera-application': 'ondemand',
            'x-requested-with': 'XMLHttpRequest',
        };

        const startBody = JSON.stringify({
            courseId: courseId,
            itemId: item.id
        });

        const startResp = await fetch(sessionUrl, {
            method: 'POST',
            headers: headers,
            body: startBody,
            credentials: 'include'
        });

        if (!startResp.ok) {
            const text = await startResp.text();
            log(`Failed to start session: ${startResp.status} - ${text.substring(0, 100)}`);
            return;
        }

        let sessionId = startResp.headers.get('x-coursera-id') || startResp.headers.get('X-Coursera-Id');
        if (!sessionId) {
            try {
                const data = await startResp.json();
                if (data && data.id) sessionId = data.id;
            } catch(e) {}
        }

        if (!sessionId) {
            log("Error: No Session ID returned in headers or body.");
            return;
        }
        
        log(`Session Started! Session ID: ${sessionId}`);
        await processSession('onDemandExamSessions.v1', sessionId, headers, apiKey);

    } catch (e) {
        log(`Error processing exam: ${e.message}`);
    }
}

// Supported Gemini models in order of preference
const GEMINI_MODELS = [
    'gemini-2.0-flash',
    'gemini-1.5-flash',
    'gemini-1.5-flash-8b',
    'gemini-1.5-pro'
];

/**
 * Calls Google Gemini API with:
 * - Multi-model cascade fallback
 * - Exponential backoff retry on 429/503/500
 * - Clean string output or null on failure
 */
async function callGemini(apiKey, prompt, maxRetries = 3) {
    if (!apiKey) {
        log("Error: No Gemini API Key provided.");
        return null;
    }

    for (const model of GEMINI_MODELS) {
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
                    const backoffMs = Math.pow(2, attempt) * 2000 + Math.floor(Math.random() * 500);
                    const errorDetail = response.status === 429 ? "Rate limited (429)" : `Server error (${response.status})`;
                    
                    if (attempt < maxRetries) {
                        log(`[${model}] ${errorDetail} - Retrying in ${(backoffMs / 1000).toFixed(1)}s (Attempt ${attempt + 1}/${maxRetries})...`);
                        await new Promise(r => setTimeout(r, backoffMs));
                        continue;
                    } else {
                        log(`[${model}] Exhausted retries for ${model}. Trying next fallback model...`);
                        break;
                    }
                }

                // Model not found or bad request on model
                if (response.status === 404 || response.status === 400) {
                    const errText = await response.text();
                    log(`[${model}] Status ${response.status}: ${errText.substring(0, 100)}. Falling back to next model...`);
                    break;
                }

                const errBody = await response.text();
                log(`[${model}] HTTP ${response.status}: ${errBody.substring(0, 100)}`);
                break;

            } catch (networkErr) {
                log(`[${model}] Network error: ${networkErr.message}`);
                if (attempt < maxRetries) {
                    const backoffMs = (attempt + 1) * 2000;
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

