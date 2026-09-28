# FcukCoursera

Automates course progression for Coursera and LinkedIn Learning courses with intelligent completion engines.

## Features

### Coursera Automation
- **Complete Course (All-in-One)**: Chronologically completes videos, readings, labs/apps, and AI-solved quizzes in syllabus order.
- **Skip Videos**: Automatically marks all course videos as watched via API batching.
- **Skip Readings**: Automatically marks all reading materials as completed.
- **Solve Quizzes & On-Screen Solving**: Uses AI (Gemini, OpenRouter, Groq, Custom/Ollama) to answer and submit quiz questions with winning answer reuse.
- **Interactive Apps & Labs**: Automatically handles consent agreements, launches external tools, and verifies completion.

### LinkedIn Learning Automation
- **Learning Path Multi-Course Worker Pool**: Complete entire Learning Paths with automated parallel sub-worker tabs running simultaneously in the background.
- **Anti-Pause Background Tab Spoofing**: Overrides `document.visibilityState` (`visible`), `document.hidden` (`false`), and suppresses `visibilitychange`/`blur` events in the `MAIN` page world so background tabs never pause or idle.
- **Audio Keep-Alive Heartbeat**: Emits an inaudible Web Audio oscillator signal to prevent Chrome from throttling or discarding background media worker tabs.
- **Auto-Close Finished Tabs & Queue Replenishment**: Automatically closes tabs upon 100% course completion and dispatches the next queued course until the entire path is complete.
- **Configurable Parallel Tabs (1–5)**: Choose how many courses to run simultaneously (default: 3 parallel tabs) with instant local storage persistence.
- **Context Auto-Detection (Path vs Single Course)**: Detects whether you are viewing a single course or a full Learning Path, with a 1-click "View Path →" button to jump to the parent path overview.
- **Complete All Videos (Turbo 16x)**: Plays videos at up to 16x speed with muted audio, satisfying LinkedIn's client-side playback telemetry requirements and auto-advancing through the entire course until 100% finished.
- **MAIN World Speed Controller**: Locks playback rate directly in the page's execution context via `HTMLMediaElement.prototype.playbackRate` override, preventing React player resets.
- **Smart Instant Advance**: Automatically advances to the next video the instant LinkedIn Learning marks the current video as completed (checkmark in Table of Contents or Up-Next card), without waiting for the video to reach the end.
- **Stuck Video Watchdog & Auto-Refresh**: Continuously monitors buffering and freeze states; automatically unpauses, nudges, and refreshes the video player stream if playback stalls.
- **Automatic Quiz Skipper**: Detects and bypasses optional chapter quizzes, practice exams, and assessments, jumping directly to the next video lesson.
- **Fast-Forward Active Video**: Quickly accelerates and finishes the currently open video lesson.
- **Speed Selector**: Dynamically choose between 16x Turbo (recommended), 8x Ultra, 4x Fast, and 2x Native speeds with real-time adaptation.
- **Smart TOC Navigation**: Automatically expands chapter sections, tracks checkmark status, and advances to the next uncompleted video.
- **Live Floating HUD**: Real-time on-screen countdown, playback rate indicator, and completion statistics.
- **Persistent Auto-Resume**: Seamlessly continues advancing across SPA route changes and page navigations.

## Installation
1. Clone or download this repository.
2. Open Chrome and navigate to `chrome://extensions`.
3. Enable **Developer mode** in the top right corner.
4. Click **Load unpacked** and select this directory.

## Usage

### On Coursera
1. Log in to Coursera and open your course home page.
2. Click the extension icon.
3. Configure your preferred AI Provider & API Key (if solving quizzes).
4. Click **Complete Entire Course** or use individual action buttons.

### On LinkedIn Learning
1. **For Learning Paths**: Open any Learning Path overview (e.g. `/learning/paths/...`), click the extension icon, choose your parallel tabs (default: 3), and click **Complete Entire Learning Path**.
2. **For Single Courses**: Open any course video lesson, click the extension icon, and click **Complete All Videos** (or **Fast-Forward Video** for single lesson).

## Disclaimer
This tool is for educational purposes only. Using it to bypass academic or professional requirements may violate platform terms of service. Use responsibly.
