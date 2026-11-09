# Optic-AI: Voice-Based AI Assistant for Blind & Visually Impaired Users

**Optic-AI** is a 100% voice-based, hands-free assistive AI platform designed specifically to empower blind and visually impaired students. It transforms study materials into concise, detailed, or exam-oriented audio notes, provides page-by-page and paragraph-level document reading, and answers questions grounded strictly in educational content using **Microsoft Edge Neural Text-to-Speech (Edge-TTS)** and **CrewAI Multi-Agent Intelligence**.

---

## 🌟 Key Features

### 1. 100% Hands-Free Voice Control & Wake Word
- **Continuous Listening**: The assistant continuously listens for instructions—no typing, clicking, buttons, or screen touches required.
- **Wake Word Detection**: Responds to `"Hey Optic AI"`, `"Hey Optic"`, or `"Optic"`.
- **Intelligent Central Coordinator**: Receives voice commands, analyzes intent via NLP, routes to specialized CrewAI agents or the Document Reader, speaks results using Edge-TTS, and seamlessly resumes listening.
- **Priority Instant Stop**: Saying `"Stop"`, `"Quiet"`, `"Pause"`, or pressing the Escape key or physical volume rockers immediately halts all audio.
- **Acoustic Safety**: Microphone recognition is paused while Optic AI speaks so it never hears itself, and automatically resumes once speech completes.

### 2. Voice-Controlled Document Reader
- `"Read my document"` / `"Start reading"` — Reads the loaded document from the current position.
- `"Read the next paragraph"` / `"Next paragraph"` — Advances to the next paragraph and narrates it.
- `"Read the previous paragraph"` / `"Previous paragraph"` — Moves back one paragraph and narrates it.
- `"Read from page five"` / `"Go to page <number>"` — Jumps to any page and begins audio narration.
- `"Where am I?"` / `"Current position"` — Tells the user their current page, paragraph, and progress.
- `"Repeat the last response"` / `"Say that again"` — Re-narrates the last answer or paragraph.

### 3. Voice-Controlled File Search & Ingestion
- Users can say: *"Upload document"*, *"Find file quantum cryptography in downloads"*, or *"Load file unit 4"*.
- The backend searches Windows directories (`Downloads`, `Documents`, `Desktop`, workspace) for matching PDF files and loads them into memory and disk cache.

### 4. Multiple Agent Summary Modes (CrewAI Architecture)
Powered by specialized AI agents configured in [`agents.py`](./agents.py) and [`Tasks.py`](./Tasks.py):
- **Quick Summary Specialist** (`quick`): Generates brief, high-level summaries highlighting only core ideas.
- **Detailed Document Summarizer** (`detailed`): Delivers topic-by-topic structured explanations covering concepts, definitions, and examples.
- **Exam Notes & Revision Specialist** (`exam`): Creates exam-ready revision notes, formulas, definitions, and practice questions.
- **Document Q&A Specialist** (`qa`): Answers specific user questions based strictly on the uploaded document.

### 5. Multilingual Edge-TTS Neural Audio
Generates lifelike neural speech across languages:
- English: `en-US-ChristopherNeural` / `en-IN-PrabhatNeural`
- Hindi: `hi-IN-SwaraNeural`
- Spanish: `es-ES-AlvaroNeural`
- French: `fr-FR-HenriNeural`
- German: `de-DE-ConradNeural`
- Japanese: `ja-JP-KeitaNeural`

---

## 📂 Project Architecture

```
e:\final_year_project\
├── agents.py                 # Multi-agent persona definitions (CrewAI Agent)
├── Tasks.py                  # Agent task definitions & prompt contracts (CrewAI Task)
├── crewai.py                 # Agent execution & Google GenAI compatibility engine
├── tts_service.py            # Microsoft Edge Neural TTS multilingual synthesis
├── pdf_utils.py              # Accessible PDF extraction & paragraph segmentation (pypdf)
├── main.py                   # Unified FastAPI backend & Central Voice Orchestrator
├── run_optic_ai.bat          # 1-Click launcher with automatic port conflict protection
├── test_all_modes.py         # Verification suite for all modes & voice orchestrator
│
├── App.tsx                   # React Native navigation stack (MainScreen initial route)
├── components/
│   ├── MainScreen.tsx        # Central hands-free voice interface & document reader
│   ├── LoginScreen.tsx       # Accessible onboarding screen
│   └── HelpScreen.tsx        # Voice commands reference with speech readout
├── assets/                   # App icons and graphics
├── package.json              # React Native / Expo dependencies
└── tsconfig.json             # TypeScript configuration
```

---

## 🚀 How to Run Optic AI

### Option A: One-Click Windows Launcher (Recommended)
Simply double-click [`run_optic_ai.bat`](./run_optic_ai.bat) or run from CMD:
```cmd
cd /d E:\final_year_project
run_optic_ai.bat
```
*Note: This script automatically detects and frees any stale processes on ports 8000 and 8081 before starting the backend and Expo client.*

### Option B: Manual Commands in Separate CMD Windows

#### Window 1: Backend Server (Port 8000)
```cmd
cd /d E:\final_year_project
.\myenv\Scripts\activate
python main.py
```

#### Window 2: Expo Web / Mobile Client (Port 8081)
```cmd
cd /d E:\final_year_project
npx expo start --web
```
Access the application in your browser at: **`http://localhost:8081`**

---

## 🎤 Spoken Voice Commands Reference

| Category | Spoken Voice Command | Action |
| :--- | :--- | :--- |
| **Wake Word** | `"Hey Optic AI"` / `"Hey Optic"` | Awakens assistant and prompts for command |
| **Navigation** | `"Open document reader"` | Switches to Document Reader mode |
| | `"Go to question answering"` | Switches to Document Q&A mode |
| | `"Open my notes"` | Switches to Exam Notes & Revision mode |
| | `"Start camera"` | Activates camera guidance module |
| | `"Go back"` / `"Return to home"` | Returns to main home screen |
| | `"Go to settings"` / `"Help"` | Opens voice commands guide |
| | `"Stop listening"` | Pauses continuous microphone listening |
| **Document Reader** | `"Read my document"` / `"Start reading"` | Begins reading from current position |
| | `"Read the next paragraph"` / `"Next"` | Narrates the next paragraph |
| | `"Read the previous paragraph"` / `"Previous"` | Narrates the previous paragraph |
| | `"Read from page five"` / `"Go to page <N>"` | Jumps to page N and begins audio narration |
| | `"Where am I?"` / `"Current position"` | Speaks current page and paragraph status |
| | `"Repeat the last response"` | Re-plays the last spoken answer or paragraph |
| **Summarization** | `"Give me a quick summary"` | Generates concise overview with Quick Summarizer |
| | `"Give me a detailed summary"` | Generates in-depth breakdown with Detailed Summarizer |
| | `"Prepare exam-oriented notes"` | Generates revision notes & practice questions |
| **Document Files** | `"Upload document"` | Prompts for file name/location |
| | `"Fetch file <name>"` | Automatically searches filesystem and ingests PDF |
| **Priority Stop** | `"Stop"` / `"Pause"` / `"Quiet"` / `"Cancel"` | Immediately halts all audio and speech |
