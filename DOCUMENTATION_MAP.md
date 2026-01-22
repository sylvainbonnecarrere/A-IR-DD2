# A-IR-DD2 Documentation Map

Welcome to A-IR-DD2. This document provides a concise overview to help you navigate the project.

## Project Status and Usage Modes

The project is under active development. There are two main ways to use the application:

*   **Guest Mode**: Ideal for quick testing. All configurations (including API keys) are stored directly in your browser's `localStorage`. This data is not encrypted and does not persist if you switch devices or browsers.
*   **Authenticated Mode**: Requires account creation. This mode offers full data persistence in a MongoDB database. API keys, prototypes, workflows, and user preferences are securely stored and synchronized across all your devices.

## Core Application: AI Agent Development

Current development focuses on the application's core functionality: the creation and orchestration of artificial intelligence agents.

*   **Multi-LLM Support**: The application integrates APIs from major language model providers (Gemini, OpenAI, Anthropic, etc.).
*   **On-Premise LLM**: It is also possible to connect to local models via services like LMStudio, offering maximum privacy.
*   **Centralized Configuration**: Management of all API keys and providers is unified via the "LLM Settings" interface.

## Creation Process: From Prototype to Instance

The user workflow for agent creation is designed around a "robot" specialization architecture.

1.  **Using Robot Archi**: The **Archi** robot is the architecture specialist. The user uses it to access the "Prototyping" section.
2.  **Creating Prototypes**: In this section, you can create **agent prototypes**. A prototype defines an agent's base behavior: its role (system prompt), capabilities (image generation, web search, etc.), and the tools it can use. For a logged-in user, these prototypes are saved to their account.
3.  **Instantiation on Workflow**: Once a prototype is created, you can add it to your visual workspace (the workflow). This action creates an **instance** of the agent. You can then customize this instance (e.g., by modifying its name or prompt for a specific task) without altering the original prototype. This allows reusing a single prototype to create multiple specialized agents on your canvas.