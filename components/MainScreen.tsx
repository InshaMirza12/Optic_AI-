import React, { useState, useEffect, useRef } from "react";
import * as Haptics from "expo-haptics";
import KeyEvent from "react-native-keyevent";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import * as MediaLibrary from "expo-media-library";
import { Audio as ExpoAudio } from "expo-av";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  PermissionsAndroid,
  Platform,
  ActivityIndicator,
  AccessibilityInfo,
  TextInput,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import * as DocumentPicker from "expo-document-picker";
import * as Speech from "expo-speech";
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from "expo-speech-recognition";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { RootStackParamList } from "../App";

// Current Wi-Fi IP of your PC on your phone's Wi-Fi network: 10.44.224.135
const DEFAULT_HOST = "10.44.224.135:8000";
const INITIAL_BACKEND_BASE =
  Platform.OS === "web"
    ? typeof window !== "undefined" && window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1"
      ? `http://${window.location.hostname}:8000`
      : "http://localhost:8000"
    : `http://${DEFAULT_HOST}`;

export type SummaryMode = "quick" | "detailed" | "exam" | "qa";
export type SupportedLanguage = "English" | "Hindi" | "French" | "Japanese" | "German" | "Spanish";

const LANGUAGE_LOCALES: Record<SupportedLanguage, string> = {
  English: "en-US",
  Hindi: "hi-IN",
  French: "fr-FR",
  Japanese: "ja-JP",
  German: "de-DE",
  Spanish: "es-ES",
};

const LANGUAGE_FLAGS: Record<SupportedLanguage, string> = {
  English: "🇬🇧 English",
  Hindi: "🇮🇳 Hindi",
  French: "🇫🇷 French",
  Japanese: "🇯🇵 Japanese",
  German: "🇩🇪 German",
  Spanish: "🇪🇸 Spanish",
};

const MODE_LABELS: Record<SummaryMode, string> = {
  quick: "⚡ Quick Summary",
  detailed: "📚 Detailed Summary",
  exam: "🎓 Exam Notes & Revision",
  qa: "💬 Document Q&A",
};

type NavigationProp = NativeStackNavigationProp<RootStackParamList, "Main">;

const MainScreen = () => {
  const navigation = useNavigation<NavigationProp>();

  // Backend Connectivity Configuration
  const [serverUrl, setServerUrl] = useState<string>(INITIAL_BACKEND_BASE);
  const [inputServerUrl, setInputServerUrl] = useState<string>(INITIAL_BACKEND_BASE);
  const [isServerConnected, setIsServerConnected] = useState<boolean | null>(null);
  const [showServerConfig, setShowServerConfig] = useState<boolean>(false);

  // Document State
  const [fileName, setFileName] = useState<string>("No document uploaded");
  const [docStats, setDocStats] = useState<string>("");
  const [isDocUploaded, setIsDocUploaded] = useState<boolean>(false);
  const [pdfFile, setPdfFile] = useState<any>(null);

  // Output State
  const [summary, setSummary] = useState<string>("Please upload a PDF document to generate an analysis.");
  const [loading, setLoading] = useState<boolean>(false);
  const [loadingMessage, setLoadingMessage] = useState<string>("");
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [textUrl, setTextUrl] = useState<string | null>(null);
  const [activeSound, setActiveSound] = useState<ExpoAudio.Sound | null>(null);
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);

  // Purely voice-based file loading state
  const [awaitingVoiceFilePath, setAwaitingVoiceFilePath] = useState<boolean>(false);

  // Mode & Multilingual Settings
  const [activeMode, setActiveMode] = useState<SummaryMode>("quick");
  const [selectedLanguage, setSelectedLanguage] = useState<SupportedLanguage>("English");
  const [translatingAudio, setTranslatingAudio] = useState<boolean>(false);

  // Custom Q&A Input State
  const [customQuestion, setCustomQuestion] = useState<string>("");

  // Voice Recognition
  const [recognizedText, setRecognizedText] = useState<string>("");
  const [isListening, setIsListening] = useState<boolean>(false);

  const activeSoundRef = useRef<ExpoAudio.Sound | null>(null);
  const hasWelcomedRef = useRef<boolean>(false);
  const webRecognitionRef = useRef<any>(null);

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  // Voice Announcement Helper for Screen Readers (JAWS / TalkBack / VoiceOver)
  const announceAccessibility = (message: string) => {
    AccessibilityInfo.announceForAccessibility(message);
    console.log(`[JAWS/ScreenReader] ${message}`);
  };

  // Comprehensive Audio Cleanup: Guarantees zero voice overlap
  const stopAllAudio = async () => {
    try {
      Speech.stop();
    } catch (e) {}

    if (Platform.OS === "web" && typeof window !== "undefined" && (window as any).speechSynthesis) {
      try {
        (window as any).speechSynthesis.cancel();
      } catch (e) {}
    }

    if (activeSoundRef.current) {
      try {
        const sound = activeSoundRef.current;
        activeSoundRef.current = null;
        await sound.stopAsync();
        await sound.unloadAsync();
      } catch (e) {}
    }
    setActiveSound(null);
    setIsSpeaking(false);
  };

  // Safe voice output with guaranteed single-voice sequencing
  const speakVoiceFeedback = async (message: string) => {
    await stopAllAudio();
    setIsSpeaking(true);
    Speech.speak(message, {
      language: LANGUAGE_LOCALES[selectedLanguage] || "en-US",
      onDone: () => setIsSpeaking(false),
      onStopped: () => setIsSpeaking(false),
      onError: () => setIsSpeaking(false),
    });
    console.log(`[Optic-AI Voice Feedback]: ${message}`);
  };

  // Startup Welcome Greeting: Greets user and asks how to help
  useEffect(() => {
    if (!hasWelcomedRef.current) {
      hasWelcomedRef.current = true;
      const welcomeTimer = setTimeout(async () => {
        await stopAllAudio();
        const welcome =
          "Welcome to Optic AI. How can I help you today? You can say: upload document, quick summary, detailed summary, exam notes, or ask any question.";
        speakVoiceFeedback(welcome);
      }, 1200);
      return () => clearTimeout(welcomeTimer);
    }
  }, []);

  // Web Keyboard Escape Shortcut for Instant Stop
  useEffect(() => {
    if (Platform.OS === "web" && typeof window !== "undefined") {
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          e.preventDefault();
          handleStopAll();
        }
      };
      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
    }
  }, []);

  // Check backend server health
  const checkServerHealth = async (target?: string) => {
    const url = (target || serverUrl).trim().replace(/\/+$/, "");
    try {
      const resp = await fetch(`${url}/health`, { method: "GET" });
      if (resp.ok) {
        const data = await resp.json();
        setIsServerConnected(true);
        if (data.active_document && data.active_document !== "None" && data.char_count > 0) {
          setIsDocUploaded(true);
          setFileName(data.active_document);
          setDocStats(`${data.char_count.toLocaleString()} characters, ${data.page_count || 1} pages`);
        }
        return true;
      }
    } catch (err) {
      console.log(`[Health Check Failed for ${url}]:`, err);
    }
    setIsServerConnected(false);
    return false;
  };

  useEffect(() => {
    checkServerHealth(serverUrl);
  }, [serverUrl]);

  // Priority Instant Stop Action: Runs immediately and stops all speech, mic, and audio
  const handleStopAll = async () => {
    console.log("[PRIORITY COMMAND] Instant STOP requested.");
    setAwaitingVoiceFilePath(false);
    setLoading(false);
    try {
      if (Platform.OS === "web" && webRecognitionRef.current) {
        webRecognitionRef.current.stop();
        webRecognitionRef.current = null;
      } else {
        ExpoSpeechRecognitionModule.stop();
      }
    } catch (e) {}
    setIsListening(false);
    await stopAllAudio();
    Speech.speak("Stopped.", { language: "en-US" });
  };

  // Hardware volume button interception for push-to-talk / instant stop
  const handlePhysicalButtonPress = async () => {
    const speaking = await Speech.isSpeakingAsync();
    if (speaking || activeSoundRef.current || isSpeaking) {
      await handleStopAll();
      return;
    }

    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  };

  useEffect(() => {
    const listener = KeyEvent.onKeyDownListener((keyEvent: any) => {
      if (keyEvent.keyCode === 24 || keyEvent.keyCode === 25) {
        handlePhysicalButtonPress();
      }
    });

    return () => {
      KeyEvent.removeKeyDownListener();
    };
  }, [isListening, isSpeaking, activeSound]);

  // Prompt user by voice for file name and location
  const handleVoiceUploadPrompt = async () => {
    await stopAllAudio();
    setAwaitingVoiceFilePath(true);
    const promptMsg = "Please state the name of the file or where it is saved on your system.";
    await speakVoiceFeedback(promptMsg);
    setTimeout(() => {
      startListening();
    }, 2800);
  };

  // Fetch local file from filesystem based on spoken name/location
  const fetchLocalFile = async (query: string) => {
    setAwaitingVoiceFilePath(false);
    await stopAllAudio();
    setLoading(true);
    setLoadingMessage(`Searching for ${query}...`);

    try {
      const cleanBase = serverUrl.trim().replace(/\/+$/, "");
      const resp = await fetch(`${cleanBase}/fetch-local-file`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });

      if (!resp.ok) {
        const errJson = await resp.json().catch(() => ({}));
        throw new Error(errJson.detail || `File not found on system.`);
      }

      const data = await resp.json();
      setIsDocUploaded(true);
      setFileName(data.document_name);
      setDocStats(`${data.char_count.toLocaleString()} characters, ${data.page_count} pages`);

      const successMsg = `Successfully loaded ${data.document_name}. How can I help you? You can say: quick summary, detailed summary, exam notes, or ask any question.`;
      speakVoiceFeedback(successMsg);
    } catch (err: any) {
      console.error("Local file fetch error:", err);
      speakVoiceFeedback(`Could not find a file matching ${query}. Please tell me the file name or location again, or say cancel.`);
      Alert.alert("File Not Found", err?.message || `Could not find '${query}' on system.`);
    } finally {
      setLoading(false);
    }
  };

  // Immediate Document Upload and Extraction Handler (Manual Fallback)
  const handleUpload = async () => {
    try {
      await stopAllAudio();
      Speech.stop();
      speakVoiceFeedback("Opening document picker. Please select a PDF file.");

      const result = await DocumentPicker.getDocumentAsync({
        type: "application/pdf",
        copyToCacheDirectory: true,
      });

      if (!result.canceled && result.assets?.length) {
        const selected = result.assets[0];
        setPdfFile(selected);
        const name = selected.name || "Uploaded_Document.pdf";
        setFileName(name);

        setLoading(true);
        setLoadingMessage(`Ingesting ${name}...`);
        speakVoiceFeedback(`Uploading and extracting text from ${name}.`);

        const cleanBase = serverUrl.trim().replace(/\/+$/, "");
        const uploadEndpoint = `${cleanBase}/upload-document`;

        const formData = new FormData();

        // Cross-platform binary upload handling
        if (Platform.OS === "web") {
          if ((selected as any).file) {
            formData.append("file", (selected as any).file, name);
          } else if (selected.uri) {
            try {
              const res = await fetch(selected.uri);
              const blob = await res.blob();
              formData.append("file", blob, name);
            } catch (blobErr) {
              console.warn("Blob fetch failed on web, appending URI:", blobErr);
            }
          }
        } else {
          formData.append("file", {
            uri: selected.uri,
            name: name,
            type: selected.mimeType || "application/pdf",
          } as any);
        }

        const uploadResp = await fetch(uploadEndpoint, {
          method: "POST",
          body: formData,
        });

        if (!uploadResp.ok) {
          const errData = await uploadResp.json().catch(() => ({}));
          throw new Error(errData.detail || `Upload returned status ${uploadResp.status}`);
        }

        const uploadData = await uploadResp.json();
        setIsDocUploaded(true);
        setDocStats(`${uploadData.char_count.toLocaleString()} characters, ${uploadData.page_count} pages`);
        
        const successMsg = `Document ${name} uploaded successfully. Generating ${MODE_LABELS[activeMode]}...`;
        speakVoiceFeedback(successMsg);

        // Immediately trigger analysis for the active mode
        await executeModeAnalysis(activeMode, selectedLanguage);
      }
    } catch (err: any) {
      console.error("Document picker error:", err);
      speakVoiceFeedback("Failed to upload document. Please check connection.");
      Alert.alert("Upload Error", err?.message || "Could not upload document.");
      setLoading(false);
    }
  };

  // Execute Agent Analysis for a given mode
  const executeModeAnalysis = async (
    mode: SummaryMode,
    lang: SupportedLanguage,
    customQ?: string
  ) => {
    await stopAllAudio();
    setLoading(true);
    setLoadingMessage(`Generating ${MODE_LABELS[mode]} in ${lang}...`);

    const cleanBase = serverUrl.trim().replace(/\/+$/, "");
    const processEndpoint = `${cleanBase}/process-document`;

    const formData = new FormData();
    formData.append("mode", mode);
    formData.append("language", lang);
    formData.append("user_question", customQ || "");
    formData.append("prompt", customQ || "");

    try {
      const response = await fetch(processEndpoint, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        throw new Error(errJson.detail || `Server error ${response.status}`);
      }

      const data = await response.json();
      const outputText = data.text || data.summary || "Analysis completed.";
      setSummary(outputText);
      setAudioUrl(data.audio_url);
      setTextUrl(data.text_url);

      // Play neural Edge-TTS audio directly with single-voice guarantee (NO overlapping voices)
      if (data.audio_url) {
        playAudioFromUrl(data.audio_url);
      } else {
        speakVoiceFeedback(outputText);
      }
    } catch (err: any) {
      console.error("Analysis Error:", err);
      speakVoiceFeedback("Error generating output. Please verify server connection.");
      Alert.alert("Analysis Error", err?.message || "Failed to process request.");
    } finally {
      setLoading(false);
    }
  };

  // Play audio helper with single-voice guarantee
  const playAudioFromUrl = async (url: string) => {
    try {
      await stopAllAudio();

      const { sound } = await ExpoAudio.Sound.createAsync(
        { uri: url },
        { shouldPlay: true }
      );
      activeSoundRef.current = sound;
      setActiveSound(sound);
      setIsSpeaking(true);

      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded && status.didJustFinish) {
          activeSoundRef.current = null;
          setActiveSound(null);
          setIsSpeaking(false);
          announceAccessibility("Audio playback finished.");
        }
      });
    } catch (err) {
      console.log("Audio playback error, falling back to device speech:", err);
      if (summary) {
        speakVoiceFeedback(summary);
      }
    }
  };

  // Play / Pause summary button handler
  const handlePlaySummary = () => {
    if (audioUrl) {
      playAudioFromUrl(audioUrl);
    } else if (summary) {
      speakVoiceFeedback(summary);
    } else {
      speakVoiceFeedback("No analysis available to play.");
    }
  };

  // Mode Switch Handler - Immediately analyzes if document is uploaded
  const handleModeSwitch = (mode: SummaryMode) => {
    setActiveMode(mode);
    speakVoiceFeedback(`Switched to ${MODE_LABELS[mode]}.`);
    if (isDocUploaded) {
      executeModeAnalysis(mode, selectedLanguage);
    } else {
      speakVoiceFeedback("Please upload a PDF document first.");
    }
  };

  // Multilingual Translator & Audio Synthesizer Handler
  const handleGenerateMultilingual = async (lang: SupportedLanguage) => {
    setSelectedLanguage(lang);
    if (!summary || summary.startsWith("Please upload")) {
      speakVoiceFeedback("Please upload a document and generate an analysis first.");
      return;
    }

    await stopAllAudio();
    setTranslatingAudio(true);

    const cleanBase = serverUrl.trim().replace(/\/+$/, "");
    const multiEndpoint = `${cleanBase}/generate-multilingual`;

    const formData = new FormData();
    formData.append("language", lang);
    formData.append("text", summary);

    try {
      const response = await fetch(multiEndpoint, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Translation returned status ${response.status}`);
      }

      const data = await response.json();
      setSummary(data.translated_text || data.text);
      setAudioUrl(data.audio_url);
      setTextUrl(data.text_url);

      // Play translated neural audio directly with single voice
      if (data.audio_url) {
        playAudioFromUrl(data.audio_url);
      } else {
        speakVoiceFeedback(data.translated_text || data.text);
      }
    } catch (err: any) {
      console.error("Multilingual Generation Error:", err);
      speakVoiceFeedback(`Could not generate audio in ${lang}.`);
      Alert.alert("Translation Error", err?.message || "Failed to generate multilingual audio.");
    } finally {
      setTranslatingAudio(false);
    }
  };

  // Download Text File (.txt) Handler
  const handleDownloadTextFile = () => {
    if (!summary) {
      speakVoiceFeedback("No text available to download.");
      return;
    }

    const cleanDocName = (fileName || "Optic_AI_Report").replace(/\.[^/.]+$/, "");
    const filename = `${cleanDocName}_${activeMode}_${selectedLanguage}.txt`;

    if (Platform.OS === "web") {
      try {
        const element = document.createElement("a");
        const file = new Blob([summary], { type: "text/plain;charset=utf-8" });
        element.href = URL.createObjectURL(file);
        element.download = filename;
        document.body.appendChild(element);
        element.click();
        document.body.removeChild(element);
        speakVoiceFeedback(`Downloaded text file ${filename}`);
      } catch (e) {
        console.error("Web download error:", e);
      }
    } else {
      // Mobile native text save
      (async () => {
        try {
          const path = `${FileSystem.documentDirectory || FileSystem.cacheDirectory}${filename}`;
          await FileSystem.writeAsStringAsync(path, summary, { encoding: FileSystem.EncodingType.UTF8 });
          speakVoiceFeedback("Text file saved.");
          await Sharing.shareAsync(path);
        } catch (err) {
          Alert.alert("Save Error", "Could not save text file.");
        }
      })();
    }
  };

  // Download Audio File (.mp3) Handler
  const handleDownloadAudioFile = () => {
    if (!audioUrl) {
      speakVoiceFeedback("Please generate audio first before downloading.");
      return;
    }

    const cleanDocName = (fileName || "Optic_AI_Audio").replace(/\.[^/.]+$/, "");
    const filename = `${cleanDocName}_${activeMode}_${selectedLanguage}.mp3`;

    if (Platform.OS === "web") {
      try {
        const element = document.createElement("a");
        element.href = audioUrl;
        element.download = filename;
        element.target = "_blank";
        document.body.appendChild(element);
        element.click();
        document.body.removeChild(element);
        speakVoiceFeedback(`Downloading audio file ${filename}`);
      } catch (e) {
        console.error("Web audio download error:", e);
      }
    } else {
      (async () => {
        try {
          const { status } = await MediaLibrary.requestPermissionsAsync();
          if (status !== "granted") {
            speakVoiceFeedback("Storage permission denied.");
            return;
          }
          const destination = `${FileSystem.documentDirectory || FileSystem.cacheDirectory}${filename}`;
          const downloadRes = await FileSystem.downloadAsync(audioUrl, destination);
          if (downloadRes?.uri) {
            await MediaLibrary.createAssetAsync(downloadRes.uri);
            speakVoiceFeedback("Audio saved to your media library.");
            await Sharing.shareAsync(downloadRes.uri);
          }
        } catch (err) {
          Alert.alert("Save Error", "Could not download audio.");
        }
      })();
    }
  };

  // Custom Q&A submission
  const handleAskCustomQuestion = () => {
    if (!customQuestion.trim()) {
      speakVoiceFeedback("Please enter a question.");
      return;
    }
    executeModeAnalysis("qa", selectedLanguage, customQuestion.trim());
    setCustomQuestion("");
  };

  // Web Speech Recognition for Desktop Browsers (Chrome / Edge)
  const startWebListening = () => {
    if (typeof window === "undefined") return;
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      speakVoiceFeedback("Speech recognition not supported in this browser. Please use Google Chrome or Edge.");
      return;
    }

    try {
      if (webRecognitionRef.current) {
        try {
          webRecognitionRef.current.abort();
        } catch (e) {}
      }

      const recognition = new SpeechRecognition();
      recognition.lang = LANGUAGE_LOCALES[selectedLanguage] || "en-US";
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;

      recognition.onstart = () => {
        setIsListening(true);
      };

      recognition.onresult = (event: any) => {
        setIsListening(false);
        const transcript = event.results?.[0]?.[0]?.transcript || "";
        if (transcript) {
          processCommand(transcript);
        }
      };

      recognition.onerror = (err: any) => {
        console.log("Web Speech error:", err);
        setIsListening(false);
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      webRecognitionRef.current = recognition;
      recognition.start();
    } catch (e) {
      console.error("Web recognition start error:", e);
      setIsListening(false);
    }
  };

  // Voice Command Processor (JAWS & Voice-First Compliant)
  const processCommand = async (command: string) => {
    const lower = command.toLowerCase().trim();
    setRecognizedText(command);
    console.log("[JAWS Voice Navigation Command]:", lower);

    // ============================================================
    // 1. HIGHEST PRIORITY: STOP / PAUSE / QUIET / CANCEL COMMAND
    // Executed at once before anything else with zero delay!
    // ============================================================
    if (
      lower === "stop" ||
      lower.startsWith("stop") ||
      lower.includes("stop") ||
      lower.includes("pause") ||
      lower.includes("quiet") ||
      lower.includes("shut up") ||
      lower.includes("silence") ||
      lower.includes("cancel") ||
      lower.includes("halt")
    ) {
      await handleStopAll();
      return;
    }

    // ============================================================
    // 2. Awaiting file name / location from previous voice prompt
    // ============================================================
    if (awaitingVoiceFilePath) {
      await fetchLocalFile(command);
      return;
    }

    // ============================================================
    // 3. Voice-based File Upload Request
    // ============================================================
    if (
      lower.includes("upload") ||
      lower.includes("load file") ||
      lower.includes("open file") ||
      lower.includes("select file") ||
      lower.includes("choose file") ||
      lower.includes("fetch file") ||
      lower.includes("open document") ||
      lower.includes("load document")
    ) {
      await handleVoiceUploadPrompt();
      return;
    }

    // ============================================================
    // 4. Summary Modes & Navigation
    // ============================================================
    if (lower.includes("quick summary") || lower.includes("quick mode") || lower.includes("brief")) {
      handleModeSwitch("quick");
      return;
    }
    if (lower.includes("detailed summary") || lower.includes("detailed mode") || lower.includes("comprehensive")) {
      handleModeSwitch("detailed");
      return;
    }
    if (lower.includes("exam notes") || lower.includes("exam mode") || lower.includes("revision") || lower.includes("prepare for exam")) {
      handleModeSwitch("exam");
      return;
    }
    if (lower.includes("question answer") || lower.includes("q and a") || lower.includes("qna") || lower.includes("ask question")) {
      handleModeSwitch("qa");
      return;
    }

    // ============================================================
    // 5. Multilingual Voice Output Commands
    // ============================================================
    if (lower.includes("hindi")) {
      handleGenerateMultilingual("Hindi");
      return;
    }
    if (lower.includes("french")) {
      handleGenerateMultilingual("French");
      return;
    }
    if (lower.includes("japanese")) {
      handleGenerateMultilingual("Japanese");
      return;
    }
    if (lower.includes("german")) {
      handleGenerateMultilingual("German");
      return;
    }
    if (lower.includes("spanish")) {
      handleGenerateMultilingual("Spanish");
      return;
    }
    if (lower.includes("english")) {
      handleGenerateMultilingual("English");
      return;
    }

    // ============================================================
    // 6. Audio Play / Download Controls
    // ============================================================
    if (lower.includes("play") || lower.includes("read") || lower.includes("speak")) {
      handlePlaySummary();
      return;
    }
    if (lower.includes("download audio") || lower.includes("save audio")) {
      handleDownloadAudioFile();
      return;
    }
    if (lower.includes("download text") || lower.includes("save text")) {
      handleDownloadTextFile();
      return;
    }

    // ============================================================
    // 7. Status & Help
    // ============================================================
    if (lower.includes("status")) {
      const msg = `Status: Document is ${fileName}. Current mode is ${MODE_LABELS[activeMode]}. Language is ${selectedLanguage}.`;
      speakVoiceFeedback(msg);
      return;
    }
    if (lower.includes("help") || lower.includes("what can you do") || lower.includes("how can you help")) {
      const helpMsg =
        "You can say: upload document to fetch a file, quick summary for an overview, detailed summary for full notes, exam notes for revision and practice questions, or ask any question about the document.";
      speakVoiceFeedback(helpMsg);
      return;
    }

    // ============================================================
    // 8. Document Q&A / Natural Language Execution
    // ============================================================
    if (
      activeMode === "qa" ||
      lower.startsWith("what") ||
      lower.startsWith("why") ||
      lower.startsWith("how") ||
      lower.startsWith("who") ||
      lower.startsWith("explain") ||
      lower.includes("?")
    ) {
      executeModeAnalysis("qa", selectedLanguage, command);
    } else {
      executeModeAnalysis(activeMode, selectedLanguage, command);
    }
  };

  const startListening = async () => {
    try {
      await stopAllAudio();
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      if (Platform.OS === "web") {
        startWebListening();
        return;
      }

      const { status } = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (status !== "granted") {
        speakVoiceFeedback("Microphone permission denied.");
        return;
      }

      setIsListening(true);
      // Clean silent start: do NOT speak "Listening." to avoid mic feedback & double voices!
      ExpoSpeechRecognitionModule.start({
        lang: LANGUAGE_LOCALES[selectedLanguage] || "en-US",
        interimResults: false,
      });
    } catch (err) {
      console.error("Mic Error:", err);
      setIsListening(false);
    }
  };

  const stopListening = async () => {
    await handleStopAll();
  };

  useSpeechRecognitionEvent("result", (event) => {
    const text = event.results[0]?.transcript || "";
    if (!text) return;
    setIsListening(false);
    setRecognizedText(text);
    processCommand(text);
  });

  return (
    <LinearGradient colors={["#014f86", "#001845"]} style={styles.gradient}>
      <ScrollView
        contentContainerStyle={styles.container}
        accessible={true}
        accessibilityLabel="Optic AI Main Workspace"
      >
        <Text
          style={styles.header}
          accessible={true}
          accessibilityRole="header"
          accessibilityLabel="Optic AI. Assistive Gen-AI Document Assistant."
        >
          Optic AI
        </Text>

        {/* Server Status Header Bar */}
        <TouchableOpacity
          style={[styles.serverStatusBar, isServerConnected ? styles.serverOnline : styles.serverOffline]}
          onPress={() => setShowServerConfig(!showServerConfig)}
          accessible={true}
          accessibilityRole="button"
          accessibilityLabel={`Server status: ${isServerConnected ? "Online" : "Offline"}. Connected to ${serverUrl}. Tap to change IP.`}
        >
          <Text style={styles.serverStatusText}>
            {isServerConnected ? "🟢 Server Online" : "🔴 Server Offline (Tap to Configure IP)"}
          </Text>
          <Text style={styles.serverSubText}>
            Host: {serverUrl} (Wi-Fi IP: 192.168.1.37:8000)
          </Text>
        </TouchableOpacity>

        {/* Collapsible IP Configuration */}
        {showServerConfig && (
          <View style={styles.serverConfigCard}>
            <Text style={styles.serverConfigLabel}>Backend Server URL (Phone Wi-Fi IP):</Text>
            <TextInput
              style={styles.serverInput}
              value={inputServerUrl}
              onChangeText={setInputServerUrl}
              placeholder="http://192.168.1.37:8000"
              placeholderTextColor="#90e0ef"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <View style={styles.serverConfigButtons}>
              <TouchableOpacity
                style={styles.testServerButton}
                onPress={async () => {
                  const target = inputServerUrl.trim();
                  speakVoiceFeedback(`Testing connection to ${target}`);
                  const ok = await checkServerHealth(target);
                  if (ok) {
                    setServerUrl(target);
                    speakVoiceFeedback("Connected to backend server successfully.");
                    Alert.alert("Connected", `Successfully reached ${target}`);
                  } else {
                    Alert.alert("Connection Failed", `Could not reach ${target}.\nVerify phone and PC are on the same Wi-Fi.`);
                  }
                }}
              >
                <Text style={styles.serverButtonText}>Test & Connect</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.resetServerButton}
                onPress={() => {
                  setInputServerUrl(`http://${DEFAULT_HOST}`);
                  setServerUrl(`http://${DEFAULT_HOST}`);
                  checkServerHealth(`http://${DEFAULT_HOST}`);
                }}
              >
                <Text style={styles.serverButtonText}>Reset to 192.168.1.37</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Document Ingestion & Status Banner */}
        <TouchableOpacity
          style={[styles.uploadBox, isDocUploaded && styles.uploadBoxReady]}
          onPress={handleUpload}
          accessible={true}
          accessibilityRole="button"
          accessibilityLabel={`Upload Document. Current file is ${fileName}`}
          accessibilityHint="Double tap to open file picker and upload a PDF."
        >
          <Text style={styles.uploadTitle}>
            {isDocUploaded ? "✅ Document Ready (Tap to Change)" : "📄 Upload Document (PDF)"}
          </Text>
          <Text style={styles.uploadFile}>{fileName}</Text>
          {docStats ? <Text style={styles.uploadStats}>{docStats}</Text> : null}
        </TouchableOpacity>

        {/* Voice-based Document Location Input Banner */}
        {awaitingVoiceFilePath && (
          <View
            style={styles.voicePromptCard}
            accessible={true}
            accessibilityLiveRegion="assertive"
            accessibilityLabel="Voice Search Active. Please speak the file name and location."
          >
            <Text style={styles.voicePromptTitle}>🎙️ Voice Document Search</Text>
            <Text style={styles.voicePromptSubtitle}>
              State the file name or where it is saved (e.g., "Post Quantum Cryptography in Downloads").
            </Text>
            <TouchableOpacity
              style={styles.voicePromptCancelBtn}
              onPress={handleStopAll}
            >
              <Text style={styles.voicePromptCancelText}>Cancel Voice Search</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Four Distinct Summary & Q&A Mode Tabs */}
        <View
          style={styles.modeContainer}
          accessible={true}
          accessibilityRole="radiogroup"
          accessibilityLabel="Select Summary Mode"
        >
          {(["quick", "detailed", "exam", "qa"] as SummaryMode[]).map((mode) => (
            <TouchableOpacity
              key={mode}
              style={[styles.modeButton, activeMode === mode && styles.modeButtonActive]}
              onPress={() => handleModeSwitch(mode)}
              accessible={true}
              accessibilityRole="radio"
              accessibilityState={{ selected: activeMode === mode }}
              accessibilityLabel={`${MODE_LABELS[mode]} button`}
              accessibilityHint={`Double tap to generate ${MODE_LABELS[mode]}`}
            >
              <Text style={[styles.modeButtonText, activeMode === mode && styles.modeButtonTextActive]}>
                {MODE_LABELS[mode]}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Interactive Q&A Input Box (Appears when QA Mode is active) */}
        {activeMode === "qa" && (
          <View style={styles.qaInputContainer}>
            <TextInput
              style={styles.qaTextInput}
              value={customQuestion}
              onChangeText={setCustomQuestion}
              placeholder="Ask any question about this document..."
              placeholderTextColor="#90e0ef"
              accessible={true}
              accessibilityLabel="Question input"
              onSubmitEditing={handleAskCustomQuestion}
            />
            <TouchableOpacity
              style={styles.qaSubmitButton}
              onPress={handleAskCustomQuestion}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel="Submit question"
            >
              <Text style={styles.qaSubmitButtonText}>🔍 Ask</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Main Output Content Display Card */}
        <View
          style={styles.summaryBox}
          accessible={true}
          accessibilityLiveRegion="assertive"
          accessibilityLabel={`Analysis Output: ${summary}`}
        >
          <View style={styles.summaryHeaderRow}>
            <Text style={styles.summaryHeader}>{MODE_LABELS[activeMode]}</Text>
            <TouchableOpacity
              style={styles.refreshButton}
              onPress={() => executeModeAnalysis(activeMode, selectedLanguage)}
            >
              <Text style={styles.refreshButtonText}>🔄 Refresh</Text>
            </TouchableOpacity>
          </View>

          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#48cae4" />
              <Text style={styles.loadingText}>{loadingMessage || "Agent analyzing document..."}</Text>
            </View>
          ) : (
            <View style={{ maxHeight: 340 }}>
              <ScrollView nestedScrollEnabled={true} contentContainerStyle={{ paddingBottom: 15 }}>
                <Text style={styles.summaryText}>{summary}</Text>
              </ScrollView>
            </View>
          )}
        </View>

        {/* ======================================================== */}
        {/* NEW DEDICATED SECTION: MULTILINGUAL AUDIO & TEXT EXPORT  */}
        {/* ======================================================== */}
        <View
          style={styles.multilingualSection}
          accessible={true}
          accessibilityRole="summary"
          accessibilityLabel="Multilingual Audio and Text Export Section"
        >
          <Text style={styles.multiSectionTitle}>
            🌐 Multilingual Audio & Text Export
          </Text>
          <Text style={styles.multiSectionSubtitle}>
            Translate text & synthesize Microsoft Edge Neural Speech in:
          </Text>

          {/* Language Selection Pills */}
          <View style={styles.languagePillsContainer}>
            {(["English", "Hindi", "French", "Japanese", "German", "Spanish"] as SupportedLanguage[]).map(
              (lang) => (
                <TouchableOpacity
                  key={lang}
                  style={[
                    styles.langPill,
                    selectedLanguage === lang && styles.langPillActive,
                  ]}
                  onPress={() => handleGenerateMultilingual(lang)}
                  accessible={true}
                  accessibilityRole="button"
                  accessibilityLabel={`Generate output in ${lang}`}
                >
                  <Text
                    style={[
                      styles.langPillText,
                      selectedLanguage === lang && styles.langPillTextActive,
                    ]}
                  >
                    {LANGUAGE_FLAGS[lang]}
                  </Text>
                </TouchableOpacity>
              )
            )}
          </View>

          {translatingAudio && (
            <View style={styles.translatingIndicator}>
              <ActivityIndicator size="small" color="#48cae4" />
              <Text style={styles.translatingText}>
                Synthesizing Edge-TTS voice in {selectedLanguage}...
              </Text>
            </View>
          )}

          {/* Audio & Text Download Controls */}
          <View style={styles.actionButtonsGrid}>
            <TouchableOpacity
              style={[styles.actionBtn, styles.playBtn]}
              onPress={handlePlaySummary}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel={`Play neural audio in ${selectedLanguage}`}
            >
              <Text style={styles.actionBtnText}>
                {isSpeaking ? "🔊 Playing Audio" : "▶ Play Audio"}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.actionBtn, styles.downloadAudioBtn]}
              onPress={handleDownloadAudioFile}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel="Download Audio MP3 file"
            >
              <Text style={styles.actionBtnText}>💾 Download MP3</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.actionBtn, styles.downloadTextBtn]}
              onPress={handleDownloadTextFile}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel="Download Text Report file"
            >
              <Text style={styles.actionBtnText}>📄 Download .TXT</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Push-to-Talk Voice & Stop Controls Bar */}
        <View style={styles.micControls}>
          <TouchableOpacity
            style={[styles.startButton, isListening && styles.listeningActive]}
            onPress={startListening}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel={isListening ? "Microphone active. Listening." : "Start Voice Command"}
            accessibilityHint="Double tap to speak voice commands or use volume rockers."
          >
            <Text style={styles.micControlText}>
              🎤 {isListening ? "Listening..." : "Speak Command"}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.stopButton}
            onPress={stopListening}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel="Stop microphone and audio"
          >
            <Text style={styles.micControlText}>⏹ Stop</Text>
          </TouchableOpacity>
        </View>

        {/* Spoken Voice Transcription Confirmation */}
        {recognizedText ? (
          <Text
            style={styles.recognizedText}
            accessible={true}
            accessibilityLabel={`Voice recognized: ${recognizedText}`}
          >
            Heard: "{recognizedText}"
          </Text>
        ) : null}
      </ScrollView>
    </LinearGradient>
  );
};

const styles = StyleSheet.create({
  gradient: { flex: 1 },
  container: {
    flexGrow: 1,
    padding: 18,
    alignItems: "center",
  },
  header: {
    fontSize: 28,
    fontWeight: "bold",
    color: "#ffffff",
    marginTop: 12,
    letterSpacing: 1,
  },
  serverStatusBar: {
    width: "100%",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    marginTop: 8,
    marginBottom: 6,
    alignItems: "center",
  },
  serverOnline: {
    backgroundColor: "rgba(43, 147, 72, 0.35)",
    borderWidth: 1,
    borderColor: "#2b9348",
  },
  serverOffline: {
    backgroundColor: "rgba(217, 4, 41, 0.35)",
    borderWidth: 1,
    borderColor: "#d90429",
  },
  serverStatusText: {
    color: "#ffffff",
    fontWeight: "bold",
    fontSize: 12,
  },
  serverSubText: {
    color: "#caf0f8",
    fontSize: 11,
    marginTop: 2,
  },
  serverConfigCard: {
    width: "100%",
    backgroundColor: "#001f54",
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#023e8a",
  },
  serverConfigLabel: {
    color: "#90e0ef",
    fontSize: 12,
    fontWeight: "bold",
    marginBottom: 6,
  },
  serverInput: {
    backgroundColor: "#001233",
    color: "#ffffff",
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
    borderWidth: 1,
    borderColor: "#0077b6",
  },
  serverConfigButtons: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 8,
  },
  testServerButton: {
    backgroundColor: "#0096c7",
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 6,
  },
  resetServerButton: {
    backgroundColor: "#023e8a",
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 6,
  },
  serverButtonText: {
    color: "#ffffff",
    fontWeight: "bold",
    fontSize: 12,
  },
  uploadBox: {
    borderWidth: 2,
    borderColor: "#90e0ef",
    borderStyle: "dashed",
    borderRadius: 12,
    padding: 16,
    marginVertical: 6,
    width: "100%",
    alignItems: "center",
    backgroundColor: "rgba(0, 119, 182, 0.15)",
  },
  uploadBoxReady: {
    borderColor: "#2b9348",
    backgroundColor: "rgba(43, 147, 72, 0.15)",
    borderStyle: "solid",
  },
  uploadTitle: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#ffffff",
  },
  uploadFile: {
    color: "#caf0f8",
    marginTop: 4,
    fontSize: 13,
    fontWeight: "500",
  },
  uploadStats: {
    color: "#90e0ef",
    marginTop: 2,
    fontSize: 11,
  },
  voicePromptCard: {
    width: "100%",
    backgroundColor: "rgba(255, 183, 3, 0.2)",
    borderWidth: 2,
    borderColor: "#ffb703",
    borderRadius: 12,
    padding: 14,
    marginVertical: 8,
    alignItems: "center",
  },
  voicePromptTitle: {
    color: "#ffb703",
    fontSize: 16,
    fontWeight: "bold",
    marginBottom: 4,
  },
  voicePromptSubtitle: {
    color: "#ffffff",
    fontSize: 13,
    textAlign: "center",
    marginBottom: 8,
  },
  voicePromptCancelBtn: {
    backgroundColor: "#d90429",
    paddingVertical: 5,
    paddingHorizontal: 16,
    borderRadius: 6,
  },
  voicePromptCancelText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "bold",
  },
  modeContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    width: "100%",
    marginVertical: 8,
  },
  modeButton: {
    width: "48.5%",
    backgroundColor: "#002855",
    paddingVertical: 12,
    paddingHorizontal: 8,
    marginVertical: 4,
    borderRadius: 8,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#023e8a",
  },
  modeButtonActive: {
    backgroundColor: "#0077b6",
    borderColor: "#90e0ef",
  },
  modeButtonText: {
    color: "#ade8f4",
    fontSize: 12,
    fontWeight: "bold",
    textAlign: "center",
  },
  modeButtonTextActive: {
    color: "#ffffff",
  },
  qaInputContainer: {
    flexDirection: "row",
    width: "100%",
    marginVertical: 6,
  },
  qaTextInput: {
    flex: 1,
    backgroundColor: "#001233",
    color: "#ffffff",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    borderWidth: 1,
    borderColor: "#0077b6",
  },
  qaSubmitButton: {
    backgroundColor: "#0096c7",
    paddingHorizontal: 16,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 8,
    marginLeft: 6,
  },
  qaSubmitButtonText: {
    color: "#ffffff",
    fontWeight: "bold",
    fontSize: 13,
  },
  summaryBox: {
    backgroundColor: "#001233",
    borderRadius: 12,
    padding: 14,
    width: "100%",
    marginVertical: 6,
    borderWidth: 1,
    borderColor: "#002855",
  },
  summaryHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#023e8a",
    paddingBottom: 6,
  },
  summaryHeader: {
    color: "#90e0ef",
    fontSize: 15,
    fontWeight: "bold",
  },
  refreshButton: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    backgroundColor: "#023e8a",
    borderRadius: 6,
  },
  refreshButtonText: {
    color: "#caf0f8",
    fontSize: 11,
    fontWeight: "600",
  },
  summaryText: {
    color: "#e0e1dd",
    fontSize: 13.5,
    lineHeight: 22,
  },
  loadingContainer: {
    height: 180,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    color: "#90e0ef",
    marginTop: 10,
    fontSize: 13,
  },
  multilingualSection: {
    width: "100%",
    backgroundColor: "#03045e",
    borderRadius: 12,
    padding: 14,
    marginVertical: 8,
    borderWidth: 1,
    borderColor: "#0077b6",
  },
  multiSectionTitle: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "bold",
    textAlign: "center",
  },
  multiSectionSubtitle: {
    color: "#90e0ef",
    fontSize: 11.5,
    textAlign: "center",
    marginTop: 3,
    marginBottom: 10,
  },
  languagePillsContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  langPill: {
    width: "31.5%",
    backgroundColor: "#002855",
    paddingVertical: 8,
    marginVertical: 3,
    borderRadius: 6,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#023e8a",
  },
  langPillActive: {
    backgroundColor: "#0096c7",
    borderColor: "#90e0ef",
  },
  langPillText: {
    color: "#ade8f4",
    fontSize: 11,
    fontWeight: "600",
  },
  langPillTextActive: {
    color: "#ffffff",
    fontWeight: "bold",
  },
  translatingIndicator: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  translatingText: {
    color: "#48cae4",
    fontSize: 12,
    marginLeft: 6,
  },
  actionButtonsGrid: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 4,
  },
  actionBtn: {
    flex: 1,
    paddingVertical: 10,
    marginHorizontal: 3,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  playBtn: {
    backgroundColor: "#0096c7",
  },
  downloadAudioBtn: {
    backgroundColor: "#0077b6",
  },
  downloadTextBtn: {
    backgroundColor: "#023e8a",
  },
  actionBtnText: {
    color: "#ffffff",
    fontWeight: "bold",
    fontSize: 12,
  },
  micControls: {
    flexDirection: "row",
    justifyContent: "space-between",
    width: "100%",
    marginVertical: 8,
  },
  startButton: {
    flex: 2,
    backgroundColor: "#0096c7",
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
    marginRight: 6,
  },
  listeningActive: {
    backgroundColor: "#2b9348",
  },
  stopButton: {
    flex: 1,
    backgroundColor: "#d90429",
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
    marginLeft: 6,
  },
  micControlText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "bold",
  },
  recognizedText: {
    color: "#caf0f8",
    fontSize: 12,
    fontStyle: "italic",
    textAlign: "center",
    marginTop: 4,
  },
});

export default MainScreen;