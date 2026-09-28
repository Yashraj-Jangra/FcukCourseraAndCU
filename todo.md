# Project State & Task Tracker (`todo.md`)

This tracker maintains the active state, completed capabilities, known architecture, and prioritized backlog for **FcukCourseraAndCU**. Any developer or AI agent (via `.agents` or Antigravity sessions) should read this file first to understand current progress and resume development seamlessly.

---

## 📌 Active Architecture Overview

The extension operates across two major educational platforms:

### 1. Coursera & CU Engine
- **Full-Course Auto-Completion**: REST and GraphQL solvers handling videos, readings, quizzes, exams, programming assignments, and discussions.
- **Multi-AI Provider Integration**: OpenRouter, Groq, Google Gemini, and Localhost (Ollama/LM Studio).
- **Exam & Assessment Engine**: Support for multiple choice, checkbox, regex, rich text, code expression, and widget questions.
- **Safety Guardrails**: Pass status checks to preserve remaining exam attempts and anti-AI student response sanitization.

### 2. LinkedIn Learning Path & Video Engine
- **Learning Path & Career Hub Detection**: Resolves multi-course paths (`/learning/paths/`, `/career-hub/learning/path/`, `/learning/*`) extracting canonical titles, URLs, durations, and course slugs.
- **Smart Parallel Worker Orchestrator (`background.js`)**:
  - Manages concurrent worker tabs (default 3, auto-adjustable 1–5).
  - Background queue manager that launches workers, tracks individual progress, closes tabs upon completion, and promotes queued courses.
- **Main-World Anti-Pause & Speed Overrides (`injectMainWorldAntiPauseAndSpeed`)**:
  - Injects directly into the `MAIN` execution world via `chrome.scripting`.
  - Overrides `document.hidden = false`, `document.visibilityState = 'visible'`, suppresses `blur`, `visibilitychange`, and `pagehide` events.
  - Keeps timers and `requestAnimationFrame` running when tabs are unfocused or minimized.
  - Multi-tier playback speed enforcer up to 16.0x with forced muting to bypass browser background autoplay restrictions.
- **Floating On-Screen HUD (`#fcuk-linkedin-floating-hud`)**:
  - Persistent floating control interface injected on all LinkedIn pages.
  - Uses dedicated drag handle (`#fcuk-hud-drag-handle`) with grab/grabbing cursor to prevent sticking to cursor on hover.
  - Visual status badges (Active, In-Progress, Pending, Completed), progress bars, and real-time buffer warnings.
- **Dynamic Buffer-Aware Tab Scaling**:
  - Monitored tabs signal MSE buffer stalls; orchestrator automatically reduces active parallel workers to prevent browser freezing.
- **Lowest Video Quality Clamping**:
  - Enforces lowest video resolution (360p) via DOM player controls and HLS.js (`currentLevel = 0`) / Video.js quality level APIs to minimize bandwidth and eliminate video decoder stalls.
- **Transient Error Auto-Recovery**:
  - Automatically handles transient LinkedIn outages (`"It's not you. It's us. Give it another try, please."`, `"Something went wrong"`, media loading errors).
  - Clicks "Give it another try" / "Retry" buttons, or executes graceful page reloads (up to 3 attempts with `sessionStorage` guardrails) before auto-skipping stuck lessons.
- **Worker Tab Auto-Resume across Reloads**:
  - `background.js` clears worker tab initialization on `changeInfo.status === 'loading'`.
  - `content.js` queries `get_my_worker_course` on page startup to immediately re-bind and resume worker execution.
- **Quiz Auto-Skipper & Modal Auto-Dismiss**:
  - Detects and bypasses non-mandatory chapter quizzes and practice assessments.
  - Automatically dismisses post-course feedback, survey, and rating popups.

---

## ✅ Completed Tasks (Done Log)

### LinkedIn Learning Path Parallelism & Resilience (Recent Session)
- [x] **Career Path & Learning Hub Detection**: Updated regex and DOM scrapers to identify all courses in career path and learning hub pages.
- [x] **Smart Tab Pool Management (`background.js`)**: Fixed runaway tab opening bug by enforcing strict tab concurrency caps and closing completed worker tabs before spawning new ones.
- [x] **Background Tab Video Playback (Unfocused Tab Execution)**:
  - Ensured videos continuously play in unfocused/minimized background tabs by muting audio (`muted = true`, `volume = 0`) to comply with Chromium Autoplay Policy.
  - Injected main-world page script spoofing `document.visibilityState`, `document.hasFocus()`, and window focus events.
- [x] **HUD Cursor Sticking Bug Fix**:
  - Restricted drag movement initiation strictly to the drag handle (`#fcuk-hud-drag-handle`).
  - Implemented window-level `mousemove` and `mouseup` tracking with `cleanupDrag` on pointer departure.
- [x] **Smart Buffer-Aware Parallel Scaling**:
  - Detected MSE buffering/freezing in worker tabs and reported backpressure to background orchestrator.
  - Orchestrator automatically steps down worker concurrency and displays status notification in Floating HUD.
- [x] **Transient Error Auto-Recovery**:
  - Implemented `checkAndHandleLinkedInErrors` detecting `"It's not you. It's us"`, `"Give it another try"`, and media load failures.
  - Integrated retry button clicker and 3-attempt reload guardrail in `ensureLinkedInVideoPlayerMounted`, `waitForLinkedInVideo`, `playLinkedInVideoToCompletion`, and `startLinkedInCourseCompletionProcess`.
- [x] **Lowest Video Quality Enforcement (360p)**:
  - Created `setLowestLinkedInVideoQuality` to locate player settings, find the lowest resolution option, and select 360p.
  - Clamped HLS.js levels (`hls.currentLevel = 0`) and Video.js quality levels in main world injector.
- [x] **Worker Reload Re-Arming & Auto-Resume**:
  - Added reset in `chrome.tabs.onUpdated` for `changeInfo.status === 'loading'`.
  - Added `get_my_worker_course` message handler in `background.js`.
  - Added self-invoking auto-resume in `content.js` to pick up worker execution on page reload without getting stranded.
- [x] **Post-Course Dialog & Survey Dismissal**:
  - Added `dismissLinkedInModalsIfPresent` targeting rating modals, feedback forms, and course completion dialogs.
- [x] **Master Page Live Progress Dashboard ("Relax & Watch Progress Live")**:
  - Implemented `#fcuk-master-page-banner` injected at the top of syllabus/hero sections on Learning Path and Career Hub pages.
  - Prominently informs the user: *"🛋️ Relax & Watch Progress Live — Workers are completing courses in background tabs. Keep this Master tab open."*
  - Shows real-time progress metrics (Completed / Total, Active Workers, Speed), concurrency buttons, and live course status badges (`✓ 100% Complete`, `[Worker Tab #1] 65%`, `Queued`, `Incomplete`).
  - Synced live with Floating HUD and persistent storage across background worker tabs.
- [x] **Auto-Start Prevention & Learning Path Navigation Bug Fix**:
  - Eliminated automatic course opening when visiting a Learning Path page:
    - Added strict negative keyword filters in `scanLinkedInLearningPath` button expanders to prevent clicking action buttons ("Start course", "Resume course", "Start learning path").
    - Added guards in `ensureLinkedInVideoPlayerMounted` and `startLinkedInCourseCompletionProcess` to completely disable video mounting/playback on Master Pages.
    - Deprecated persistent `linkedinQueueRunning` in global storage, restricting course auto-resume strictly to tab-scoped `sessionStorage` and background worker assignments (`get_my_worker_course`).
- [x] **Page-Specific Context Across Extension Popup & Floating HUD**:
  - **Master Page**: Shows Master Orchestrator controls, Relax banner, full curriculum tray, and concurrency controls.
  - **Worker Tab**: Shows `[Worker Tab]` tag, active worker status syncing to Master tab, lesson progress (`[5/14]`), and single-worker stop option.
  - **Standalone Course**: Shows Single Course Player controls, course title, video count, start/stop buttons, and progress bar.
- [x] **Rigorous Course & Lesson Completion Verification**:
  - Implemented `isPathCourseCardCompleted(card)` in `content.js` to prevent courses with partial progress ("Completed 2 of 10", "20% completed") or "Start course" from falsely registering as 100% complete.
  - Fixed item type misclassification: stopped treating 3-segment course URLs (`/learning/course-name/lesson-slug`) as single videos so workers no longer abandon courses after 1 video.
  - Implemented `isTocItemCompleted(el, link)` to eliminate substring false positives (e.g. `'incomplete'.includes('complete')`) and placeholder CSS class matches.
  - Added TOC verification when `advanceToNextLinkedInVideo` fails: instead of exiting and falsely marking complete, automatically jumps directly to remaining uncompleted lessons.
  - Secured `finally` block in `startLinkedInCourseCompletionProcess`: only reports `path_worker_course_completed` if completion was explicitly verified; otherwise reports `path_worker_course_failed`.
  - Added `path_worker_course_failed` handler in `background.js` and `.badge-error` / `.hud-badge-error` UI badges.

### Coursera Core Features (Previous Milestones)
- [x] Multiple AI provider integrations (OpenRouter, Groq, Gemini, Localhost).
- [x] Complete REST & GraphQL solvers for Coursera quizzes, readings, labs, and interactive dialogues.
- [x] Attempt guardrails for graded assignments to protect GPA and course pass status.
- [x] Human student response sanitization (anti-AI disclosure prompts).
- [x] Summary report generator with modal viewer and clipboard export.

---

## 📋 Prioritized Backlog (What's Left to Implement)

### Immediate Next Steps (Phase 1)
- [ ] **Live Testing & Edge Case Verification**:
  - Test parallel worker execution across 5+ courses in a live LinkedIn Learning Path.
  - Verify HUD updates accurately reflect worker progress percentages in real-time.
- [ ] **User Preference for Default Video Quality**:
  - Add setting toggle in `popup.html` allowing user to choose lowest quality (360p, recommended) vs. standard (720p/Auto).
- [ ] **Certificate Auto-Collector**:
  - Once all courses in a learning path reach 100%, trigger automatic certificate navigation or claim notification.

### Medium-Term Enhancements (Phase 2)
- [ ] **Coursera Peer-Review Assignment Helper**:
  - Implement assistive evaluation interface for Coursera peer reviews with AI rubrics.
- [ ] **Extension Options Page**:
  - Create a dedicated Chrome options page (`options.html`) for configuring API keys, speed defaults, and concurrency limits without needing popup open.
- [ ] **Network Failure Retry Exponential Backoff**:
  - Add exponential backoff for offline network detection across both Coursera and LinkedIn.

---

## 🗂️ File & Module Reference

| File | Purpose |
| :--- | :--- |
| `manifest.json` | Manifest V3 extension configuration, permissions, content script declarations. |
| `background.js` | Service worker managing tab pools, learning path orchestration, main-world script injection, keep-alive heartbeats. |
| `content.js` | Main content script containing DOM interactions, video playback loops, Coursera solvers, error recovery, and HUD. |
| `popup.html` | Extension popup interface with provider settings, speed controls, report modals, and manual triggers. |
| `popup.js` | UI logic for popup actions, settings persistence, learning path triggers, and status sync. |
| `todo.md` | Single source of truth for project state, completed capabilities, and development backlog. |
| `progress.md` | Historical session changelog and technical implementation details. |
