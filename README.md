# Optic-AI: Assistive Gen-AI Document Assistant for Visually Impaired Students

**Optic-AI** is an accessible, agentic AI mobile and backend platform designed specifically to empower visually impaired students. It transforms lengthy educational materials into concise, detailed, or exam-oriented summaries and provides grounded document question-answering with natural **Microsoft Edge Neural Text-to-Speech (Edge-TTS)** and **complete voice-controlled JAWS/screen reader navigation**.

---

## 🌟 Key Features

### 1. Multilingual Voice-to-Text & Edge-TTS Neural Audio
- **Microsoft Edge Neural TTS**: Generates lifelike speech across over 40 languages and regional dialects:
  - English: `en-US-ChristopherNeural` / `en-IN-PrabhatNeural`
  - Hindi: `hi-IN-SwaraNeural`
  - Spanish: `es-ES-AlvaroNeural`
  - French: `fr-FR-HenriNeural`
  - German: `de-DE-ConradNeural`
  - Regional: Bengali, Tamil, Telugu, Marathi, and more.
- **Multilingual Voice Recognition**: Voice input adapts dynamically to English, Hindi, Spanish, French, and German using `expo-speech-recognition`.

### 2. Completely Voice-Controlled Navigation (JAWS & Screen Reader Compliant)
- **Hands-Free Operation**: Users can control 100% of the app purely by voice without touching the screen.
- **Screen Reader Announcements**: Immediate voice announcements (`AccessibilityInfo.announceForAccessibility`) for all actions and state changes, fully compliant with JAWS, NVDA, TalkBack, and VoiceOver.
- **Physical Volume Buttons Push-to-Talk**: Physical volume rockers (KeyCodes `24` & `25`) toggle voice command listening or halt audio narration instantly.
- **Accessible ARIA / Accessibility Semantics**: Every element includes `accessible={true}`, `accessibilityRole`, `accessibilityLabel`, and `accessibilityHint`.

### 3. Multiple Agent Summary Modes (CrewAI Architecture)
Powered by specialized AI agents configured in [`agents.py`](./agents.py) and [`Tasks.py`](./Tasks.py):
- **Quick Summary Specialist** (`quick`): Generates brief, high-level summaries highlighting only core ideas, stripped of noise for fast audio listening.
- **Detailed Document Summarizer** (`detailed`): Delivers topic-by-topic structured explanations covering concepts, definitions, examples, and relationships.
- **Exam Notes & Revision Specialist** (`exam`): Creates exam-ready revision notes, formulas, definitions, and practice questions with answers grounded in the document.

### 4. Grounded Document Q&A (Question & Answer Specialist)
- **Direct Question Answering** (`qa`): Answers specific user questions based strictly on the uploaded document.
- **Strict Anti-Hallucination Guard**: Explicitly states when an answer is not present in the document rather than inventing information.
- **Persistent Context**: Supports follow-up questions without re-uploading the document.

---

## 📂 Project Architecture

```
e:\final_year_project\
├── agents.py                 # Multi-agent persona definitions (CrewAI Agent)
├── Tasks.py                  # Agent task definitions & prompt contracts (CrewAI Task)
├── crewai.py                 # Agent execution & Google GenAI compatibility engine
├── tts_service.py            # Microsoft Edge Neural TTS multilingual synthesis
├── pdf_utils.py              # Accessible PDF text extraction (pypdf)
├── main.py                   # Unified FastAPI backend server & audio endpoints
├── requirements.txt          # Python backend dependencies
├── .env                      # API keys (GEMINI_API_KEY)
│
├── App.tsx                   # React Native navigation stack
├── components/
│   ├── MainScreen.tsx        # Voice navigation, mode selector, audio player & Q&A
│   ├── LoginScreen.tsx       # Accessible welcome & onboarding screen
│   └── HelpScreen.tsx        # Comprehensive voice command guide with speech narration
├── assets/                   # App icons and splash screens
├── package.json              # React Native / Expo dependencies
├── app.json                  # Expo application configuration
└── tsconfig.json             # TypeScript configuration
```

---

## 🚀 Quickstart Guide

### 1. Backend Setup & Run

Activate the virtual environment and start the FastAPI server:
```bash
# From workspace root:
.\myenv\Scripts\activate

# Install dependencies:
pip install -r requirements.txt

# Start the server:
python main.py
```
The server starts at `http://0.0.0.0:8000`. Test the interactive API documentation at `http://localhost:8000/docs`.

### 2. Mobile App Setup & Run (React Native / Expo)

Install Node dependencies and start the Expo development server:
```bash
npm install
npx expo start
```
Scan the QR code with **Expo Go** on Android or iOS.

---

## 🎤 Voice Commands Reference

| Category | Voice Command | Action |
| :--- | :--- | :--- |
| **Modes** | `"Quick summary"` | Activates Quick Summary Specialist |
| | `"Detailed summary"` | Activates Detailed Document Summarizer |
| | `"Exam notes"` / `"Revision"` | Activates Exam Revision Specialist |
| | `"Question answer"` / `"QnA"` | Activates Document Q&A Specialist |
| **Languages** | `"Language Hindi"` | Sets Edge-TTS & Voice to Hindi (`hi-IN`) |
| | `"Language Spanish"` | Sets Edge-TTS & Voice to Spanish (`es-ES`) |
| | `"Language French"` | Sets Edge-TTS & Voice to French (`fr-FR`) |
| | `"Language German"` | Sets Edge-TTS & Voice to German (`de-DE`) |
| | `"Language English"` | Sets Edge-TTS & Voice to English (`en-US`) |
| **Documents** | `"Upload document"` | Opens accessible document picker |
| | `"Clear document"` | Clears current file and resets screen |
| **Audio** | `"Play audio"` / `"Read summary"`| Starts Edge-TTS neural audio playback |
| | `"Stop"` / `"Pause"` | Halts playback and microphone |
| | `"Download"` / `"Save audio"` | Saves MP3 to device library |
| | `"Library"` / `"Files"` | Narrates saved audio summaries by number |
| **Q&A** | `"What is [concept]?"` | Answers question grounded in document |
| | `"Explain [topic]"` | Explains concept with audio response |
| **General** | `"Status"` | Announces active file, mode, and language |
| | `"Help"` | Opens voice commands guide |
| | **Volume Buttons** | Hardware push-to-talk / stop toggle |
