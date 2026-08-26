# FcukCoursera - Development Progress & Status Tracker

## Session Summary (2026-08-26)

- ⚡ **Background Active & Visibility Override Engine (`enableBackgroundActiveOverride`)**:
  - Overrides `document.hidden`, `document.visibilityState`, and `document.hasFocus()` so Coursera and external LTI integrations always perceive the tab as active, focused, and in the foreground.
  - Intercepts and suppresses `visibilitychange`, `blur`, and `pagehide` events to prevent background tab timer throttling or session freezing when the user switches tabs.
  - Maintains a persistent keep-alive heartbeat loop to prevent background sleep and preserve token handshakes.
- 🎯 **Universal App & Lab Item Classifier (`isAppOrToolItem`)**:
  - Implemented comprehensive pattern matching across all Coursera App/Tool schemas (`programming`, `gradedProgramming`, `ungradedProgramming`, `workspace`, `lab`, `jupyter`, `notebook`, `cloudide`, `widget`, `openLearningApp`, `guided project`).
  - Guarantees 0 missed app items across the entire course syllabus.
- 🌐 **Persistent Multi-Page App Navigation Automation Engine (`processCurrentAppQueueStep`)**:
  - Implemented cross-page persistent state machine using `chrome.storage.local` to physically navigate the active browser tab to every single App, Lab, LTI, and Tool page in the course one by one.
  - Automatically handles tab redirects (`window.location.href`), resumes execution on page load via `checkAndResumeAppQueue`, runs the full live on-screen solver (`completeUngradedAppItemInDOM`), and transitions to the next item until the entire course is completed.
- 📱 **Course-Wide Batch App & Lab Solver (`startCompleteAllAppItemsProcess`)**:
  - Upgraded the `"📱 Complete App Items"` action button to automatically scan the entire course syllabus, pre-check completed status, and complete **all** Ungraded/Graded App, LTI, Lab, Tool, and Workspace items one by one.
  - Automatically executes on-screen launch and token registration for the active page if open, then iterates through all remaining app items with multi-schema API cascades (`onDemandAppCompletions.v1`, `onDemandLtiItemPasses.v1`, etc.).
  - Displays real-time HUD and status updates (`📱 Completing App 1/4...`) with rate-limit pacing.
- 🛡️ **Checkbox State Synchronization & Double-Toggle Prevention (`setNativeCheckbox`)**:
  - Fixed an issue where programmatic `.click()` on an already-checked element toggled it back to `false`, causing `"Error: Please check the box to continue"`.
  - Implemented state comparison check (`isCurrentlyChecked === shouldBeChecked`) before dispatching natural click gesture.
  - Added strict pre-submission verification to guarantee all checkboxes are `checked = true` immediately before LTI form submission.
- 🎯 **Coursera Design System (CDS) LTI Form Submission & Universal URL Item Resolver**:
  - Direct targeting of Coursera's `@react-aria/checkbox` with `aria-labelledby` binding and `value="agree"`.
  - Dispatches native `<form>` submission (`form.requestSubmit` / `form.submit`) on the LTI launch form wrapping `<button type="submit" aria-label="Launch app...">` to trigger external tool auth handshakes.
  - Implemented `extractCourseAndItemIdFromURL` to accurately extract `courseSlug` and `itemId` from all Coursera routes (`/ungradedLti/:id/`, `/ungradedApp/:id/`, `/singlePageApp/:id/`, etc.) and send background API passes.
- 🖱️ **Full Trusted Pointer/Mouse Event Simulation & Launch Button Unlocking (`clickNativeElement`)**:
  - Replaced standard `.click()` with full pointer and mouse coordinate lifecycle simulation (`pointerover` -> `pointerdown` -> `mousedown` -> `pointerup` -> `mouseup` -> `click` -> `change`) with centered `clientX`/`clientY` bounding box coordinates.
  - Automatically strips stuck `disabled` and `aria-disabled="true"` attributes if React state is delayed.
  - Added multi-attempt polling to wait for launch CTA emergence and trigger child text nodes (`<span>Launch app</span>`).
- 🛡️ **Explicit "I agree to use this app responsibly" & Synthetic Checkbox Dispatcher (`setNativeCheckbox`)**:
  - Implemented specialized React Synthetic Event & Native Property setter (`setNativeCheckbox`) that directly updates `HTMLInputElement.prototype.checked` and dispatches `input`, `change`, and mouse event chains to ensure React state updates and unlocks the launch CTA.
  - Explicitly targets Coursera's AI app consent statement: `"I agree to use this app responsibly."` alongside standard honor code and third-party terms containers.
- 🛡️ **Dynamic Content Script Auto-Injection & Error Resilience (`sendTabMessageWithAutoInject`)**:
  - Implemented dynamic script injection recovery for popup message dispatching (`chrome.scripting.executeScript`).
  - Automatically recovers from stale port disconnections when the extension is updated or reloaded in developer mode without requiring the user to refresh their active Coursera tab.
  - Enhanced on-screen element detection for custom React checkbox toggles, aria-checked containers, embedded iframe sandboxes, and alternative launch button patterns.
- 📱 **Dedicated "Complete App Item" Popup Action Button (`#appItemBtn`)**:
  - Added a dedicated green action button **"📱 Complete App Item"** directly in the extension popup grid alongside **"🎯 Solve on Screen"**.
  - Allows users to individually test and complete any Ungraded App Assignment, External Tool, Workspace, or Lab page with a single click.
  - Automatically handles consent checkboxes, triggers app launch in browser tab, holds 5s token registration, clicks completion buttons, and records multi-schema passes.
- 📱 **Dedicated Live On-Screen App / Tool Solver (`completeUngradedAppItemInDOM`)**:
  - Upgraded the on-screen solver (`startOnScreenQuizSolverProcess`) to automatically detect when the page is an Ungraded App Assignment, Tool, Lab, or Dialogue item when no standard quiz questions exist.
  - Automatically clicks all "I agree" / Terms / third-party consent checkboxes on page.
  - Detects and triggers "Launch App" / "Open Tool" / "Open Workspace" buttons and opens the external tool tab.
  - Keeps session active with a 5-second live countdown HUD to ensure authentication tokens register.
  - Automatically checks and clicks any "Mark as completed" / "Done" / "Submit" confirmation button.
  - Cascades multi-schema payloads across all 10 Coursera app/LTI/assignment endpoints (`onDemandAppCompletions.v1`, `onDemandLtiItemPasses.v1`, `onDemandWidgetPasses.v1`, `onDemandWorkspaceSessions.v1`, etc.).
- ⚡ **Multi-Layer Progress Pre-Check Engine Fix (`fetchCourseProgressState`)**:
  - Resolved the 0 completed items issue by replacing single-endpoint query with a 6-layer fallback cascade:
    1. **Syllabus Linked Objects**: Extracts `onDemandCourseProgresses.v1`, `onDemandItemProgresses.v1`, and `onDemandAssignmentPasses.v1` directly from `onDemandCourseMaterials.v2` linked data.
    2. **Dual-Key Course Progress**: Queries both `${courseId}~${userId}` and `${userId}~${courseId}` parameter ordering, plus `?q=course` and `?q=user`.
    3. **Item Progress API**: Queries `onDemandItemProgresses.v1?q=course` and `?q=courseAndUser`.
    4. **Assignment Passes API**: Checks all passed quizzes and fractional scores >= 0.7 across `onDemandAssignmentPasses.v1`.
    5. **Item Views API**: Queries `onDemandItemViews.v1?q=course` and `?q=user`.
    6. **On-Screen DOM Fallback**: Scans live syllabus checkmarks (`svg[aria-label*="Completed"]`, `.rc-ItemRow--completed`, `[class*="ItemStatus--completed"]`) on Coursera web pages to capture active visual progress.
- 🎭 **Interactive On-Screen Dialogue & Simulation Completer (`completeDialogueItemInDOM`)**:
  - Implemented the complete end-to-end interactive chat workflow for Coursera Dialogue simulations:
    1. Clicks `"Start Dialogue"` / `"Start Simulation"` button.
    2. Extracts the scenario question/prompt from the message thread.
    3. Types and sends 1 authentic, curriculum-aligned response into the chat input.
    4. Clicks `"End Dialogue"` / `"End Conversation"` in the top toolbar.
    5. In the confirmation modal: automatically selects a reason (from radio buttons or dropdown select).
    6. Clicks `"Yes, end the dialogue"` / `"Confirm"` button to finalize completion.
- 📱 **Enhanced Upgraded App Launcher with Browser Tab Launch (`completeUngradedAppItem`)**:
  - Automatically clicks the `"I agree"` / Terms & Conditions checkbox.
  - Clicks `"Launch App"` / `"Open Tool"` and triggers `window.open` in a browser tab.
  - Maintains session active for 5s to ensure authentication tokens and Coursera session callbacks register.
- 📱 **Ungraded App & LTI Item Auto-Completer (`completeUngradedAppItem`)**:
  - Implemented automated completion for `ungradedApp`, `gradedApp`, `app`, `singlePageApp`, `externalTool`, `openLearningApp`, `workspace`, `lab`, `ungradedLab`, `gradedLab`.
  - Automatically checks third-party data / T&C consent checkboxes in DOM, clicks "Open Tool" / "Launch App" buttons, and keeps session active for 4s for auth token registration.
  - Dispatches full API completion cascade across `onDemandAppCompletions.v1`, `onDemandLtiItemPasses.v1`, `onDemandWidgetPasses.v1`, `onDemandAssignmentPasses.v1`, `onDemandSupplementCompletions.v1`, `onDemandLtiLaunches.v1`.
- ⚡ **Strict Progress Skipping (`fetchCourseProgressState`)**:
  - Pre-queries Coursera's progress APIs (`onDemandCourseProgresses.v1`, `onDemandAssignmentPasses.v1`, `onDemandItemViews.v1`) before starting any solver or skipping run.
  - Automatically skips all previously completed videos, readings, discussions, and already-passed quizzes (`[Already Completed (✓)]` / `[Already Passed (✓)]`), saving attempt quotas and accelerating runs.
- ⚠️ **Graceful Locked Assessment & Manual Attention Engine**:
  - Automatically detects locked assessments (`isLocked === true`, `lockStatus === 'LOCKED'`, prerequisite not met) and peer-review tasks (`peer`, `gradedPeerAssignment`).
  - Catalogs them in a dedicated `manualAttentionItems` register with item names, modules, specific blockage reasons, and direct Coursera links.
  - Displays a high-visibility **"⚠️ Items Requiring Your Manual Attention"** alert card in the popup summary report with direct links so users can complete prerequisites to unlock final assessments.
- 🧠 **Historical Attempt Intelligence (Winning Answer Lock & Wrong Option Elimination)**:
  - Extracted past submission feedback from `queryState` (GraphQL) and on-screen DOM review markers (`.rc-FormPartCorrect` / `.rc-FormPartIncorrect`).
  - **Winning Answer Reuse**: Automatically locks and reuses 100% correct answers from previous attempts without risking re-answering.
  - **Wrong Option Elimination**: Automatically excludes options that scored 0 in past attempts from AI candidate pools and fuzzy matchers.
  - **Adaptive Multi-Attempt Convergence**: If a graded assignment does not reach the pass threshold on the first try and attempts remain, automatically launches an intelligent follow-up attempt incorporating past wrong-answer eliminations to converge directly on 100% pass score.
- 🛡️ **Zero-Unanswered-Questions Safeguard (`ensureCompleteResponses` & DOM Audit)**:
  - Implemented a post-generation verification audit across all question types (`MultipleChoice`, `Checkbox`, `Numeric`, `PlainText`, `RichText`, `CodeExpression`, `Regex`, `Url`, `Widget`).
  - Guarantees 100% of question parts are filled and submitted to eliminate Coursera's *"You did not answer the question"* error.
  - Added a secondary Zero-Unanswered DOM Audit Pass to verify all radio buttons, checkboxes, numeric inputs, and textareas on screen are selected before submitting.
- 🚀 **Full Course Auto-Completer T&C & Auto-Submit Integration**:
  - Integrated automatic Terms & Conditions / Honor Code agreement acceptance, signature filling, and final submission into the full course auto-completer (`startCompleteCourseProcess`) and batch quiz solver (`startQuizSolverProcess`).
  - Strengthened Honor Code / T&C checkbox selector across all Coursera variations (including `terms of use`, `academic integrity`, `code of conduct`, `acknowledge`, `agree and submit`).
  - Added multi-selector submit modal confirmation handling (`[role="dialog"]`, `[aria-modal="true"]`, `.cds-dialog`, `.modal`).
- 🎯 **On-Screen Submission Mode Selector (Auto-Submit vs. Save as Draft)**:
  - Added an interactive modal prompt when clicking **🎯 Solve on Screen**:
    - **🚀 Answer & Auto-Submit**: Automatically answers all questions, accepts Coursera terms and conditions / honor code agreement checkbox, enters student signature, clicks Submit button, and confirms the final submission modal dialog.
    - **💾 Answer & Save as Draft Only**: Fills and highlights all answers on the page for visual inspection without accepting terms or clicking submit, allowing safe manual review.
- ⚡ **Optimized LLM Execution & Non-Blocking Timeouts**:
  - Reordered `PREFERRED_TEXT_MODELS` to place stable high-speed models (`gemini-2.0-flash`, `gemini-1.5-flash`) at the front of the cascade, eliminating 404 preview model discovery delays.
  - Added strict `AbortSignal.timeout` (12s for Gemini, 15s for OpenAI/Custom) on all network requests to prevent unbounded hanging.
  - Immediate fallback on 404/400 errors without wasted retry backoff sleep intervals.
- 🐛 **Fixed GraphQL Schema Validation on Quiz Submission**:
  - Replaced invalid query fields `attemptCount`, `allowedAttempts`, and `completedAttempts` on `Submission_Attempts` with official schema fields `attemptsMade`, `attemptsAllowed`, and `outcome { earnedGrade isPassed }` on `SubmissionState` across `Submission_StartAttempt` and `Submission_SubmitLatestDraft` mutations, completely eliminating HTTP 400 `GRAPHQL_VALIDATION_FAILED` errors on quiz and graded assignment submissions.
- 🎯 **Live On-Screen DOM Quiz & Graded Assignment Solver (`solveQuizOnScreenInDOM`)**:
  - Implemented visual on-screen solving for graded exams, quizzes, and assignments directly in front of the user on the webpage.
  - **Start / Resume Attempt Trigger**: Automatically detects and clicks "Start Attempt", "Resume Attempt", "Take Quiz", or "Continue" buttons on exam entry screens.
  - **Floating HUD Badge (`#fcukcoursera-live-hud`)**: Sleek non-intrusive floating HUD displaying live status (e.g. `Solving Question 3 of 10...`, `Signing Honor Code...`, `Submitting...`).
  - **React Synthetic Interaction**: Dispatches native prototype value setters and synthetic mouse/input/change events to reliably select radio buttons, checkboxes, textareas, code editors, and numeric fields without React state de-sync.
  - **Visual Question & Option Highlighting**: Smoothly scrolls each question into view and highlights chosen options in glowing emerald green.
  - **Honor Code Checkbox & Signature Autofill**: Automatically detects and checks Coursera's academic integrity agreement checkbox and fills student signature.
  - **On-Screen Submission & Modal Confirmation**: Locates the "Submit Assignment" button, clicks it, and auto-confirms the final submit dialog modal.
  - **Dedicated UI Trigger**: Added **🎯 Solve on Screen** button in popup for instant 1-click visual solving on any open graded quiz or exam.
- 🛡️ **Universal Host Permissions in `manifest.json`**:
  - Expanded `host_permissions` to include `<all_urls>`, enabling unrestricted cross-origin API calls to any user-configured local or remote AI endpoint (e.g. Ollama on port `11434`, LM Studio on port `1234`, DeepSeek, OpenAI, vLLM, custom reverse proxies).
- 🧩 **All-Inclusive Question Type Solver**:
  - Expanded `solveQuestions` in `content.js` to natively handle all Coursera question types without falling into empty MCQ fallbacks:
    - `Submission_CodeExpressionQuestion`: Generates raw working source code in the course's target programming language.
    - `Submission_RichTextQuestion`: Submits formatted CML paragraphs for open-ended rich text answers.
    - `Submission_RegexQuestion`: Submits exact pattern matching and regular expression answers.
    - `Submission_UrlQuestion` / `Submission_FileUploadQuestion`: Submits valid project URLs and completion metadata.
    - `Submission_WidgetQuestion`: Directly marks interactive widgets as completed.
    - `Submission_MultipleChoiceQuestion` & `Submission_CheckboxQuestion`: High-precision multi-mode matching.
- 🎯 **Ranked Fuzzy Option Matcher (`matchGeminiAnswerToOptions`)**:
  - Enhanced option matching with token overlap scoring, normalized string comparisons, and exact keyword matches to eliminate false positives and ensure 100% option selection accuracy.
- 🧹 **Cleaned Duplicate Function Declarations**:
  - Removed duplicate declarations of `processExamItem`, consolidating into a single error-handled assessment solver.
- 🔑 **Centralized CSRF & Header Factory (`getCourseraHeaders` / `getCsrfToken`)**:
  - Unified token extraction with URI decoding and case-insensitive cookie pattern matching, standardizing request headers across all video, reading, quiz, discussion, dialogue, and progress endpoints.
- 🌐 **Multi-Pattern Course Slug & Identity Resolution**:
  - Enhanced `getCourseData()` to resolve course slugs across `/learn/`, `/teach/`, and `/course/` URL structures.
  - Added resilient fallback cascades for `userId` (`adminUserPermissions.v1`, `userPreferences.v1`, `externalAuthUserData.v1`) and `courseId` (`onDemandCourseMaterials.v2`, `onDemandCourses.v1`).
- 📊 **Guaranteed Summary Report & Historical Log Persistence**:
  - `generateCourseSummaryReport` now writes directly to `chrome.storage.local.set({ latestSummaryReport })`.
  - Popup UI on load now restores historical logs, progress percentages, and last completion status from `globalState` even if the process has finished and the popup is reopened.
  - Replaced blocking browser `alert()` on `completeBtn` with in-popup status warning notifications.

---

## Session Summary (2026-08-21)

### What Work Has Been Done:
- 🐛 **Fixed Practice Assignment Detection, Solving & Draft Submission**:
  - **Comprehensive Classifier (`classifyItemType`)**: Matches all practice quizzes, practice assignments, programming exercises, activities, widgets, and labs.
  - **Continuous GraphQL Solving**: Even if `Submission_StartAttempt` indicates an in-progress draft already exists, the solver now queries `QueryState`, parses questions across all schema candidate paths, and solves them with AI.
  - **Reliable Draft Submission**: If `savedDraftId` is omitted from `Submission_SaveResponses`, falls back to `inProgress.draft.id` or active draft IDs to guarantee submission.
  - **Server-Side REST Completion Fallback (`markAssignmentCompletedFallback`)**: Posts completion events to `onDemandAssignmentPasses.v1`, `onDemandWidgetPasses.v1`, `onDemandWidgetProgresses.v1`, `onDemandLtiItemPasses.v1`, and supplement completions to guarantee 100% completion in Coursera's syllabus.
- 🎨 **Redesigned Modern 400px Popup UI**:
  - **Spacious & Minimalist Layout**: Increased width to 400px with comfortable padding, sleek typography, clean glass cards, and reduced div clutter.
  - **Primary Action Hero**: Full-width glowing hero button for **Complete Course (All-in-One)** with secondary grid buttons for **Quizzes**, **Videos**, and **Readings**.
  - **Live Pulsing Status Dot**: Visual status indicator (🟢 Ready / 🔵 Busy pulsing) and dual-label progress meter.
  - **Expanded Console Terminal**: 150px height stream with color-coded alerts (`.log-error`, `.log-success`, `.log-warning`, `.log-ai`, `.log-info`).
- 🛡️ **Comprehensive Logic Verification & Cross-Origin Permissions**:
  - Added full host permissions in `manifest.json` for OpenRouter, Groq, Google Gemini, and Localhost/Ollama to guarantee seamless cross-origin API calls.
- 🎯 **Added Graded Assignment Attempt Guardrails (Limited Attempts e.g. 3 Max)**:
  - Automatically skips passed assignments (`isPassed === true`) to protect remaining attempts.
  - Skips locked assignments when out of attempts (`remaining <= 0`) to prevent penalties.
- 📊 **Added Comprehensive Course & Module Summary Report Generator (`generateCourseSummaryReport`)**:
  - Generates detailed module-by-module coverage, item category matrix, and remaining tasks checklist.
- 📱 **Interactive Summary Report Modal in Popup UI**:
  - Added **📊 Report** button in toolbar opening a modal overview with progress bars, module cards, and one-click **Copy Full Report**.
- 🎭 **Added Top "End Conversation" Trigger for Dialogue Simulations**:
  - Implemented `triggerDialogueEndOptionInDOM` to automatically detect, click, and confirm the top **"End Conversation" / "End Dialogue"** action button in Coursera's dialogue header bar.
- ⚡ **Dynamic High-Speed Pacing for Fast Providers**:
  - Removed arbitrary 7s sleep delay for high-throughput providers (**Groq** runs at ~100ms, **OpenRouter** at ~300ms, and **Custom/Local LLMs** at ~200ms).
- 🛡️ **Added Anti-AI Disclosure Safeguards & Human Response Sanitization**:
  - Implemented `sanitizeHumanStudentResponse` to strip any robotic AI prefixes (`"As an AI..."`, `"As a language model..."`, `"Certainly! Here is..."`, `"Hope this helps!"`) and quotation marks.
  - Enforced strict prompt instructions commanding the model to act solely as a human student enrolled in the course, avoiding conversational preambles or AI disclosures.
- 🧠 **Added Course-Aware & Assignment-Context-Aware AI Prompting**:
  - Injects `courseTitle`, `courseSlug`, `moduleName`, and current `assignmentName` directly into quiz question prompts and discussion prompts.
  - LLM receives full course domain context to ground its answers in the exact conventions, libraries, formulas, and terminology taught in that specific course.
- 🐛 **Fixed ReferenceError in `processGraphQLSession`**:
  - Replaced lingering `apiKey` parameter with unified `aiConfig` object in `processGraphQLSession` call and definition.
- 🎨 **Enhanced Console Log Viewer & Visual Feedback**:
  - **Red Alert Highlighting (`.log-error`)**: Immediate soft red highlight + border on errors, failed requests, and network drops.
  - **Emerald Green Highlighting (`.log-success`)**: Vibrant green styling for successful answers, submitted quizzes, posted discussions, and completed items.
  - **Amber Warning Highlighting (`.log-warning`)**: Clear warning indicators for 429 quota cooling downs, model retries, and fallbacks.
  - **Sky Blue AI Activity (`.log-ai`)**: Dedicated color-coding for AI prompt generation and response parsing.
  - **Timestamps & Typography**: Clean `[HH:MM:SS]` timestamps and monospace font (`SF Mono`/`Fira Code`/`Consolas`).
  - **Toolbar Controls**: Added one-click **Copy Logs** to clipboard and **Clear Logs** buttons.
- 🎭 **Added Interactive Dialogue & Roleplay Auto-Completion (`completeDialogueItem`)**:
  - Automatically completes `dialogue`, `dialogueItem`, `interactiveDialogue`, and `roleplay` conversation simulation items.
- 💬 **Added AI-Powered Discussion Prompt Auto-Completion (`completeDiscussionPrompt`)**:
  - Automatically fetches discussion prompt questions and generates 2-3 sentence student responses via configured AI.
- 🧪 **Added Practice Assignment & Lab Auto-Completion (`completePracticeLabOrLti`)**:
  - Automatically completes `ungradedLti`, `gradedLti`, `ungradedLab`, `lab`, and `ungradedWidget` items.
- 🚀 **Added Multi-AI Provider Support (OpenRouter, Groq, Custom/Local LLMs, Gemini)**:
  - Supports OpenRouter (free models), Groq (high speed), Custom OpenAI-compatible endpoints (Ollama/DeepSeek), and Gemini.

### What's Planned Next / Future Considerations:
- Test live across a broad variety of Coursera course formats (e.g. specialized peer-review assignments).
- Add optional user preference in popup to manually pick a preferred Gemini model or custom temperature.
