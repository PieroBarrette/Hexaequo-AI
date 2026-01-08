---
applyTo: '**'
---

## Rule – Response Length & Documentation

- **Do not write any documentation** unless I have **explicitly asked** for it.
- **Do not generate long explanations**, design documents, summaries, or rationales by default.
- Keep all chat responses **concise, direct, and task-focused**.
- Provide **only** the information strictly required to answer the question or complete the task.
- If additional context, explanation, or documentation could be useful, **ask for permission first** before writing it.

# Copilot Instructions for Project Agent

## Purpose
The  `.github/copilot-instructions.md` file serves as a **snapshot of the project**. It provides the agent with a quick understanding of the project's structure, architecture, conventions, and known pitfalls. It is **not** a log or report of work completed, but a living overview reflecting the **current state of the project**.

## Agent Guidelines

1. **Read at the Start of Each Chat**
   - Before performing any action, always read `copilot-instructions.md` to understand the project context.
   - Use it as a reference for architecture, file organization, coding conventions, and any known pitfalls.

2. **Update on Changes**
   - Every time the project is modified (new files, removed files, updated architecture, or changed conventions), update this file immediately.
   - Ensure it accurately reflects the **current state** of the project.

3. **Content Requirements**
   - Include: 
     - Directory structure and key files
     - Frameworks, languages, and libraries in use
     - Coding conventions and style guides
     - Architectural decisions or patterns
     - Known pitfalls or areas to be cautious with
   - Avoid:
     - Writing task logs, to-do lists, or summaries of completed work
     - Personal notes unrelated to the project snapshot

4. **Format**
   - Use clear Markdown headings, lists, and tables for readability.
   - Keep the snapshot concise but complete enough for a new agent or contributor to understand the project quickly.

## Tone
- Formal and factual.
- Focused on providing an accurate, up-to-date project overview.