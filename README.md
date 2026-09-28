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
4. Click **🚀 Complete Course (All-in-One)** or use individual buttons (**▶ Videos**, **✓ Readings**, **⚡ Quizzes**).

### On LinkedIn Learning
1. Log in to LinkedIn Learning and open any course video lesson.
2. Click the extension icon (automatically adapts to LinkedIn Learning mode).
3. Select your desired speed (default: **16x Turbo**).
4. Click **⚡ Complete All Videos (16x Turbo)** to auto-advance through the course, or **▶ Fast-Forward Video** for the active lesson.

## Disclaimer
This tool is for educational purposes only. Using it to bypass academic or professional requirements may violate platform terms of service. Use responsibly.
