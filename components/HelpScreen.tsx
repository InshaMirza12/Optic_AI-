import React from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, AccessibilityInfo } from "react-native";
import { useNavigation } from "@react-navigation/native";
import * as Speech from "expo-speech";

const HelpScreen = () => {
  const navigation = useNavigation();

  const handleReadHelp = () => {
    const helpContent =
      "Optic AI Voice Commands Guide. " +
      "To change mode say: Quick summary, Detailed summary, Exam notes, or Question answer. " +
      "To change language say: Language Hindi, Language Spanish, Language French, Language German, or Language English. " +
      "To manage documents say: Upload document, or Clear document. " +
      "To ask a question say: What is, explain, or any question about your document. " +
      "To control audio say: Play audio, Stop, Download, or Library. " +
      "You can also press your phone's volume buttons at any time to start or stop voice control.";
    
    AccessibilityInfo.announceForAccessibility(helpContent);
    Speech.speak(helpContent);
  };

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      accessible={true}
      accessibilityLabel="Help and Voice Commands Screen"
    >
      <Text
        style={styles.header}
        accessible={true}
        accessibilityRole="header"
      >
        🎙️ Voice & JAWS Navigation Commands
      </Text>

      <TouchableOpacity
        style={styles.readButton}
        onPress={handleReadHelp}
        accessible={true}
        accessibilityRole="button"
        accessibilityLabel="Read all help commands aloud"
      >
        <Text style={styles.readButtonText}>🔊 Read Commands Aloud</Text>
      </TouchableOpacity>

      <View style={styles.section} accessible={true}>
        <Text style={styles.sectionTitle}>1. Summary Modes</Text>
        <Text style={styles.commandText}>• "Quick summary" — Brief, audio-friendly overview</Text>
        <Text style={styles.commandText}>• "Detailed summary" — In-depth breakdown of concepts</Text>
        <Text style={styles.commandText}>• "Exam notes" — Exam revision, definitions, formulas & practice Q&A</Text>
        <Text style={styles.commandText}>• "Question answer" / "QnA" — Grounded Q&A agent</Text>
      </View>

      <View style={styles.section} accessible={true}>
        <Text style={styles.sectionTitle}>2. Multilingual Edge-TTS</Text>
        <Text style={styles.commandText}>• "Language Hindi" — Edge-TTS Swara Neural</Text>
        <Text style={styles.commandText}>• "Language Spanish" — Edge-TTS Alvaro Neural</Text>
        <Text style={styles.commandText}>• "Language French" — Edge-TTS Henri Neural</Text>
        <Text style={styles.commandText}>• "Language German" — Edge-TTS Conrad Neural</Text>
        <Text style={styles.commandText}>• "Language English" — Edge-TTS Christopher Neural</Text>
      </View>

      <View style={styles.section} accessible={true}>
        <Text style={styles.sectionTitle}>3. Document Q&A</Text>
        <Text style={styles.commandText}>• "What is [concept]?"</Text>
        <Text style={styles.commandText}>• "Explain [topic] based on the document"</Text>
        <Text style={styles.commandText}>• "Does the document mention [formula or event]?"</Text>
      </View>

      <View style={styles.section} accessible={true}>
        <Text style={styles.sectionTitle}>4. Hands-Free Controls</Text>
        <Text style={styles.commandText}>• "Upload document" / "Select document"</Text>
        <Text style={styles.commandText}>• "Play audio" / "Read summary"</Text>
        <Text style={styles.commandText}>• "Stop" / "Pause"</Text>
        <Text style={styles.commandText}>• "Download" / "Save audio"</Text>
        <Text style={styles.commandText}>• "Library" / "Files"</Text>
        <Text style={styles.commandText}>• "Status" — Announces active file, mode and language</Text>
        <Text style={styles.commandText}>• Physical Volume Buttons — Instant push-to-talk / stop</Text>
      </View>

      <TouchableOpacity
        style={styles.backButton}
        onPress={() => navigation.goBack()}
        accessible={true}
        accessibilityRole="button"
        accessibilityLabel="Go back to main screen"
      >
        <Text style={styles.backButtonText}>⬅ Back to Home</Text>
      </TouchableOpacity>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 20,
    backgroundColor: "#001845",
    flexGrow: 1,
  },
  header: {
    fontSize: 22,
    fontWeight: "bold",
    color: "#ffffff",
    marginBottom: 15,
    textAlign: "center",
  },
  readButton: {
    backgroundColor: "#0077b6",
    padding: 14,
    borderRadius: 10,
    alignItems: "center",
    marginBottom: 15,
  },
  readButtonText: {
    color: "#ffffff",
    fontWeight: "bold",
    fontSize: 16,
  },
  section: {
    backgroundColor: "#023e8a",
    padding: 14,
    borderRadius: 10,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#90e0ef",
    marginBottom: 6,
  },
  commandText: {
    fontSize: 14,
    color: "#e0e1dd",
    lineHeight: 22,
    marginVertical: 2,
  },
  backButton: {
    backgroundColor: "#48cae4",
    padding: 15,
    borderRadius: 10,
    alignItems: "center",
    marginTop: 10,
    marginBottom: 30,
  },
  backButtonText: {
    color: "#03045e",
    fontWeight: "bold",
    fontSize: 16,
  },
});

export default HelpScreen;
