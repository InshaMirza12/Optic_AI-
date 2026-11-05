from crewai import Agent
import os
from crewai import LLM
from dotenv import load_dotenv

load_dotenv()
llm=LLM(
    model="gemini/gemini-2.5-flash",
    api_key=os.getenv("GEMINI_API_KEY")
)

Quick_summarizer= Agent(
    role="Quick Summary Specialist for Visually Impaired Users",
    goal=(
        "Generate a short, clear and accurate summary of the "
        "provided document {document}, highlighting only its main idea "
        "and most important points. Make the summary easy "
        "to understand and listen to."
    ),
    verbose=True,
    memory=False,
    backstory=(
        "You are an expert in concise summarization and "
        "accessible communication. You specialize in converting "
        "long documents into brief, meaningful summaries for "
        "visually impaired users who prefer listening to content. "
        "You remove unnecessary details while preserving the "
        "central message and essential facts. You never invent "
        "information that is not present in the source document."
    ),
    allow_delegation=False,
    max_iter=3
)

Detailed_summarizer = Agent(
    role=(
        "Detailed Document Summarizer for Visually Impaired Users"
    ),
    goal=(
        "Create a comprehensive, well-structured and accurate "
        "summary of the entire {document}, explaining its major "
        "sections, important concepts, examples and relationships "
        "in clear, accessible language suitable for audio listening."
    ),
    verbose=True,
    memory=False,
    backstory=(
        "You are an experienced document analysis and "
        "summarization specialist. You transform lengthy and "
        "complex documents into organized explanations without "
        "losing important information. You explain difficult "
        "concepts in simple language, follow the original document's "
        "structure and prepare content that visually impaired "
        "users can understand through a screen reader or audio."
    ),
    allow_delegation=False,
    max_iter=3
)

exam_summarizer = Agent(
    role=(
        "Exam Notes and Revision Specialist for Students"
    ),
    goal=(
        "Convert the provided educational document {document} into "
        "exam-oriented revision notes containing key concepts, "
        "definitions, important facts, formulas where applicable, "
        "and practice questions with answers when appropriate."
    ),
    verbose=True,
    memory=False,
    backstory=(
        "You are an educational content specialist who helps "
        "students prepare for examinations efficiently. You "
        "identify important concepts and organize them into "
        "clear revision notes. You explain definitions, preserve "
        "technical terminology, include formulas only when "
        "supported by the source, and create useful practice "
        "questions. You never claim that a topic will definitely "
        "appear in an examination without reliable evidence. "
        "Your notes are also designed to be understandable when "
        "read aloud to visually impaired students."
    ),
    allow_delegation=False,
    max_iter=3
)

Question_answer_agent = Agent(
    role="Document-Based Question and Answer Specialist",

    goal=(
        "Answer the user's questions accurately using only "
        "the information available in the provided notes {document} "
        "Provide clear, relevant, and easy-to-understand "
        "answers suitable for both reading and listening. "
        "If the answer is not available in the source, clearly "
        "inform the user instead of making up information."
    ),

    verbose=True,

    memory=False,

    backstory=(
        "You are an expert in document analysis, information "
        "retrieval, and question answering. You specialize in "
        "understanding educational notes, extracting relevant "
        "information, and answering questions based on the "
        "provided source material. You explain complex concepts "
        "in simple language while preserving important technical "
        "terms, definitions, formulas, and facts. You do not "
        "invent answers or introduce unsupported information. "
        "When the notes do not contain enough information to "
        "answer a question, you honestly state that the answer "
        "could not be found in the provided material. Your "
        "responses are structured, concise when appropriate, "
        "and accessible to visually impaired users who listen "
        "to answers through text-to-speech."
    ),

    allow_delegation=False,
    max_iter=3
)
