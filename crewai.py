"""
CrewAI Compatibility & Execution Engine for Optic-AI
Provides native Agent, Task, LLM, and Crew classes backed by Google GenAI.
Supports multilingual output, educational reasoning, and strict grounding for accessibility.
"""

import os
import re
from typing import Any, Dict, List, Optional
from dotenv import load_dotenv

load_dotenv()

try:
    from google import genai
    from google.genai import types
except ImportError:
    genai = None


class LLM:
    """Configures the language model for agents."""
    def __init__(
        self,
        model: str = "gemini-3.5-flash",
        api_key: Optional[str] = None,
        temperature: float = 0.4,
        **kwargs: Any
    ):
        clean_model = model.replace("gemini/", "").replace("models/", "")
        # Normalize deprecated models to modern production models
        if "2.5" in clean_model:
            clean_model = "gemini-3.5-flash"
        self.model = clean_model
        self.api_key = api_key or os.getenv("GEMINI_API_KEY")
        self.temperature = temperature
        self.extra_kwargs = kwargs
        self._client = None

    def get_client(self):
        if not self._client and genai and self.api_key:
            self._client = genai.Client(api_key=self.api_key)
        return self._client

    def generate(self, system_instruction: str, prompt: str) -> str:
        client = self.get_client()
        if not client:
            raise ValueError("GEMINI_API_KEY not configured or google-genai library missing.")

        candidate_models = [self.model, "gemini-3.5-flash-lite", "gemini-3.8-flash"]
        # Ensure model is first
        if self.model not in candidate_models:
            candidate_models.insert(0, self.model)

        last_error = None
        for m in candidate_models:
            try:
                config = types.GenerateContentConfig(
                    system_instruction=system_instruction,
                    temperature=self.temperature,
                )
                response = client.models.generate_content(
                    model=m,
                    contents=prompt,
                    config=config,
                )
                if response and response.text:
                    return response.text.strip()
            except Exception as e:
                last_error = e
                print(f"[Optic-AI LLM] Fallback from model {m} due to: {e}")
                continue

        raise RuntimeError(f"All Gemini models failed. Last error: {last_error}")


# Default global LLM instance
default_llm = LLM()


class Agent:
    """Defines an autonomous AI agent with role, goal, and backstory."""
    def __init__(
        self,
        role: str,
        goal: str,
        backstory: str,
        verbose: bool = True,
        memory: bool = False,
        allow_delegation: bool = False,
        max_iter: int = 3,
        llm: Optional[LLM] = None,
        **kwargs: Any
    ):
        self.role = role
        self.goal = goal
        self.backstory = backstory
        self.verbose = verbose
        self.memory = memory
        self.allow_delegation = allow_delegation
        self.max_iter = max_iter
        self.llm = llm or default_llm
        self.kwargs = kwargs

    def get_system_prompt(self, target_language: str = "English") -> str:
        lang_instruction = (
            f"You MUST produce the final output in {target_language}. "
            if target_language and target_language.lower() != "english"
            else "You produce output in clear, natural English. "
        )

        return (
            f"ROLE: {self.role}\n\n"
            f"GOAL: {self.goal}\n\n"
            f"BACKSTORY: {self.backstory}\n\n"
            f"ACCESSIBILITY AND AUDIO GUIDELINES:\n"
            f"- Your output will be read aloud to visually impaired students using Text-to-Speech (TTS).\n"
            f"- Keep sentences conversational, well-paced, and easily understandable by ear.\n"
            f"- Avoid complex visual formatting like ASCII diagrams or messy markdown tables.\n"
            f"- Spell out symbols when needed for speech clarity.\n"
            f"- {lang_instruction}\n"
            f"- Be strictly truthful to the source document. Do NOT hallucinate facts or answers.\n"
        )


class Task:
    """Defines a task to be executed by an agent."""
    def __init__(
        self,
        description: str,
        expected_output: str,
        agent: Agent,
        **kwargs: Any
    ):
        self.description = description
        self.expected_output = expected_output
        self.agent = agent
        self.kwargs = kwargs

    def format_prompt(self, inputs: Dict[str, Any]) -> str:
        prompt = self.description
        for k, v in inputs.items():
            prompt = prompt.replace(f"{{{k}}}", str(v))

        # Check for unformatted placeholders and remove or keep
        expected = self.expected_output
        for k, v in inputs.items():
            expected = expected.replace(f"{{{k}}}", str(v))

        full_prompt = (
            f"TASK INSTRUCTIONS:\n{prompt}\n\n"
            f"EXPECTED OUTPUT SPECIFICATION:\n{expected}\n"
        )
        return full_prompt


class CrewOutput:
    """Output container matching CrewAI's output contract."""
    def __init__(self, raw: str):
        self.raw = raw

    def __str__(self) -> str:
        return self.raw

    def __repr__(self) -> str:
        return f"CrewOutput(raw={self.raw[:60]}...)"


class Crew:
    """Coordinates execution across agents and tasks."""
    def __init__(
        self,
        agents: List[Agent],
        tasks: List[Task],
        verbose: bool = True,
        **kwargs: Any
    ):
        self.agents = agents
        self.tasks = tasks
        self.verbose = verbose
        self.kwargs = kwargs

    def kickoff(self, inputs: Optional[Dict[str, Any]] = None) -> CrewOutput:
        inputs = inputs or {}
        language = inputs.get("language", "English")

        if self.verbose:
            print(f"\n[CrewAI] Starting Crew execution with {len(self.tasks)} task(s)...")

        result_text = ""
        context_accumulator = ""

        for idx, task in enumerate(self.tasks, 1):
            agent = task.agent
            if self.verbose:
                print(f"[CrewAI] Running Task {idx}: Agent '{agent.role}'")

            system_instruction = agent.get_system_prompt(target_language=language)
            task_prompt = task.format_prompt(inputs)

            if context_accumulator:
                task_prompt = f"PREVIOUS STEP OUTPUT:\n{context_accumulator}\n\n" + task_prompt

            output = agent.llm.generate(
                system_instruction=system_instruction,
                prompt=task_prompt
            )

            result_text = output
            context_accumulator += f"\n\n{output}"

            if self.verbose:
                print(f"[CrewAI] Task {idx} completed successfully.")

        return CrewOutput(raw=result_text)
