"""
Task Definitions for Optic-AI Multi-Agent System.
Defines specialized prompts for Quick Summary, Detailed Summary, Exam Notes, and Document Q&A.
"""

from crewai import Task
from agents import Quick_summarizer, Detailed_summarizer, exam_summarizer, Question_answer_agent

Quick_summarizer_task = Task(
    description=(
        "Carefully read and analyze the following document:\n\n"
        "DOCUMENT TITLE: {doc_title}\n"
        "DOCUMENT CONTENT:\n"
        "{document}\n\n"
        "TASK:\n"
        "Generate a high-impact, concise executive summary of the document.\n"
        "Identify the primary thesis, the most critical 4 to 6 takeaways, and the bottom-line conclusion.\n"
        "Strip away all repetitive padding and trivial details.\n"
        "Use simple, direct language suitable for audio listening via Text-to-Speech.\n"
        "Ground all points strictly in the provided document without hallucinating."
    ),
    expected_output=(
        "A structured quick summary formatted with markdown headings:\n"
        "# ⚡ Quick Summary: {doc_title}\n\n"
        "## 🎯 Executive Overview\n"
        "[A clear, 2 to 3 sentence paragraph explaining what the document is about and its main conclusion]\n\n"
        "## 🔑 Key Takeaways\n"
        "- **[Topic 1]**: [Crisp 1-2 sentence explanation]\n"
        "- **[Topic 2]**: [Crisp 1-2 sentence explanation]\n"
        "- **[Topic 3]**: [Crisp 1-2 sentence explanation]\n"
        "- **[Topic 4]**: [Crisp 1-2 sentence explanation]\n"
        "- **[Topic 5]**: [Crisp 1-2 sentence explanation]\n\n"
        "## 💡 Bottom Line\n"
        "[One concluding summary sentence that leaves a lasting takeaway]"
    ),
    agent=Quick_summarizer
)

Detailed_summarizer_task = Task(
    description=(
        "Perform an in-depth, comprehensive analysis of the following document:\n\n"
        "DOCUMENT TITLE: {doc_title}\n"
        "DOCUMENT CONTENT:\n"
        "{document}\n\n"
        "TASK:\n"
        "Create an exhaustive, structured sectional summary covering every significant chapter, "
        "topic, architecture, methodology, and finding in the document.\n"
        "Organize the content logically with clear descriptive subheadings.\n"
        "Thoroughly explain technical definitions, formulas, protocols, standards, and relationships between concepts.\n"
        "Detail the real-world trade-offs, challenges, or implementation considerations highlighted in the text.\n"
        "Do not invent facts or omit major sections of the document."
    ),
    expected_output=(
        "A comprehensive deep-dive summary formatted with clear markdown headings:\n"
        "# 📚 Detailed Comprehensive Summary: {doc_title}\n\n"
        "## 🌐 Introduction & Background Context\n"
        "[Detailed background of the topic, foundational concepts, and why it is critical]\n\n"
        "## 📑 Major Themes & In-Depth Sectional Breakdown\n"
        "### 1. [Section/Theme 1 Name]\n"
        "[In-depth explanation covering all aspects, principles, and findings]\n\n"
        "### 2. [Section/Theme 2 Name]\n"
        "[In-depth explanation covering all aspects, principles, and findings]\n\n"
        "### 3. [Section/Theme 3 Name]\n"
        "[In-depth explanation covering all aspects, principles, and findings]\n\n"
        "## ⚙️ Technical Architectures, Standards & Algorithms\n"
        "[Specific mechanisms, mathematical problems, protocols, or algorithmic standards mentioned in the document]\n\n"
        "## ⚠️ Key Challenges, Trade-offs & Implementation Realities\n"
        "[Barriers, computational costs, transition hurdles, or limitations described in the source]\n\n"
        "## 🏁 Comprehensive Conclusion & Strategic Takeaways\n"
        "[Final synthesis of findings and implications]"
    ),
    agent=Detailed_summarizer
)

exam_summarizer_task = Task(
    description=(
        "Analyze the following educational document to prepare exam revision notes:\n\n"
        "DOCUMENT TITLE: {doc_title}\n"
        "DOCUMENT CONTENT:\n"
        "{document}\n\n"
        "TASK:\n"
        "Convert the document into complete, student-friendly exam revision notes.\n"
        "1. Extract all essential definitions, technical terms, and acronyms with clear, memorable explanations.\n"
        "2. List all key principles, mathematical formulas, algorithms, or structural rules present in the text.\n"
        "3. Highlight high-yield points that examiners frequently ask in university or certification exams.\n"
        "4. Formulate 5 to 7 realistic practice exam questions (ranging from conceptual definitions to applied scenarios) "
        "and provide complete, authoritative model answers grounded strictly in the document."
    ),
    expected_output=(
        "A structured exam revision guide formatted with markdown headings:\n"
        "# 🎓 Exam Revision Notes & Practice Guide: {doc_title}\n\n"
        "## 📖 Core Definitions & Key Terminology\n"
        "- **[Term 1]**: [Clear, exam-ready definition]\n"
        "- **[Term 2]**: [Clear, exam-ready definition]\n"
        "- **[Term 3]**: [Clear, exam-ready definition]\n"
        "- **[Term 4]**: [Clear, exam-ready definition]\n\n"
        "## 📐 Key Formulas, Frameworks & Principles\n"
        "[Key principles, algorithms, and technical rules]\n\n"
        "## ⭐ High-Yield Exam Focus Areas\n"
        "[The top topics and distinctions most likely to appear on test papers]\n\n"
        "## ❓ Practice Exam Questions & Model Answers\n"
        "### Question 1 (Conceptual Definition)\n"
        "[Question]\n"
        "**Model Answer**: [Comprehensive, accurate answer]\n\n"
        "### Question 2 (Analytical / Comparative)\n"
        "[Question]\n"
        "**Model Answer**: [Comprehensive, accurate answer]\n\n"
        "### Question 3 (Technical / Applied)\n"
        "[Question]\n"
        "**Model Answer**: [Comprehensive, accurate answer]\n\n"
        "### Question 4 (Challenges / Limitations)\n"
        "[Question]\n"
        "**Model Answer**: [Comprehensive, accurate answer]\n\n"
        "### Question 5 (Short Answer Summary)\n"
        "[Question]\n"
        "**Model Answer**: [Comprehensive, accurate answer]"
    ),
    agent=exam_summarizer
)

Question_answer_agent_task = Task(
    description=(
        "Read the following document and respond to the question/request using information from that document:\n\n"
        "DOCUMENT TITLE: {doc_title}\n"
        "DOCUMENT CONTENT:\n"
        "{document}\n\n"
        "USER QUESTION / REQUEST:\n"
        "{user_question}\n\n"
        "TASK:\n"
        "If the user asks a specific question, answer it directly, accurately, and thoroughly with supporting facts from the document.\n"
        "If the user question is general, empty, or asks for 'QnA' / 'questions and answers', generate the top 6 to 8 most essential questions and detailed answers based on the document.\n"
        "Explain complex technical terms in accessible language suitable for listening.\n"
        "If any part of the question is not answered in the document, explicitly declare that the information is absent."
    ),
    expected_output=(
        "If a specific question was asked:\n"
        "# 💬 Q&A: {user_question}\n\n"
        "## 🎯 Direct Answer\n"
        "[Direct, unambiguous response]\n\n"
        "## 🔍 Detailed Evidence & Document Context\n"
        "[In-depth explanation with facts and concepts from the document]\n\n"
        "## 📌 Key Takeaway\n"
        "[Summary point]\n\n"
        "--- OR if generating general document Q&A ---\n"
        "# 💬 Document Q&A: Key Questions & Answers: {doc_title}\n\n"
        "### Q1: [First critical question about the document]\n"
        "**Answer**: [Clear, grounded answer]\n\n"
        "### Q2: [Second critical question]\n"
        "**Answer**: [Clear, grounded answer]\n\n"
        "### Q3: [Third critical question]\n"
        "**Answer**: [Clear, grounded answer]\n\n"
        "### Q4: [Fourth critical question]\n"
        "**Answer**: [Clear, grounded answer]\n\n"
        "### Q5: [Fifth critical question]\n"
        "**Answer**: [Clear, grounded answer]\n\n"
        "### Q6: [Sixth critical question]\n"
        "**Answer**: [Clear, grounded answer]"
    ),
    agent=Question_answer_agent
)