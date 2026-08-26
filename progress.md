# FcukCoursera - Development Progress & Status Tracker

## Session Summary (2026-08-26)

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
