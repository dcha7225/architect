# Project Design Planner — VS Code Webview App + Client-Managed MCP Server (1 Page Design Doc)

## Overview

This system provides a **design-first planning layer** for agentic coding workflows. Engineers use a **cohesive planner application inside a VS Code Webview Panel** to design system architecture, requirements, and constraints across multiple documents.

All planning artifacts are stored in a **repo-local `.project-docs/` folder**, which serves as the **single source of truth**. A **standalone MCP server** exposes these documents to AI agents, and is **launched and managed by the coding agent (MCP client)** rather than the VS Code extension.

---

## Goals

- Provide a **unified, app-like planner UI** inside VS Code
- Enable engineers to define **project design and architecture**
- Store artifacts as **version-controlled repo files**
- Allow agents to access and update docs via MCP
- Support **multiple coding agents** via standard MCP integration

---

## Non-Goals

- Not a task execution engine
- Not a Kanban/project tracker
- Not replacing code editing workflows
- Not responsible for launching or managing MCP servers

---

## Core Concept

The system centers around a **Project Docs Folder**:

```text id="c8zvkl"
.project-docs/
  blueprint.json
  requirements.json
  architecture.json
  design_decisions.json
  acceptance_criteria.json
  implementation_notes.json
```

- The **Webview Panel** provides a unified UI to view and edit these documents
- The **MCP server** provides structured access for agents
- The **coding agent (MCP client)** is responsible for launching the MCP server

---

## Core Features

### 1. Webview Panel Planner App

A full-featured planner UI embedded in VS Code.

**Capabilities:**

- Navigate across all project docs (internal sidebar navigation)
- Edit multiple documents in a single interface
- Tabbed/section-based editing (Requirements, Architecture, etc.)
- Inline validation and schema enforcement
- Cross-document awareness (e.g., missing architecture coverage)
- Save changes directly to `.project-docs/`

**Design Choice:**
Use a **Webview Panel (React-based)** for a cohesive multi-document experience.

---

### 2. Repo-Local Project Docs

All planning artifacts are stored in `.project-docs/`.

- JSON-based structured documents
- Version-controlled with Git
- Shared by both UI and MCP server

**Design Choice:**
Use **file-based storage** as the canonical state.

---

### 3. Standalone MCP Server

A reusable MCP server distributed as a separate package.

**Responsibilities:**

- Expose document APIs:
    - `get_doc(doc_type)`
    - `update_doc(doc_type, content)`

- Read/write `.project-docs/`
- Validate schema before updates

**Runtime Model:**

- Launched by MCP clients (e.g., coding agents)
- Runs as a local stdio process
- Scoped to a specific workspace/repo

**Design Choice:**
Follow the **standard MCP stdio model**, where the client owns server lifecycle.

---

### 4. MCP Document API

Agents interact with the planner via a minimal API:

- `get_doc(doc_type)`
- `update_doc(doc_type, content)`

Optional:

- `list_docs()`
- `get_all_docs()`

**Design Choice:**
Keep API **simple and document-oriented**, not workflow-oriented.

---

### 5. Structured Document Schemas

Each document follows a predefined schema:

- **requirements** → functional + non-functional requirements
- **architecture** → components, interfaces, data flow
- **design_decisions** → decision log + rationale
- **acceptance_criteria** → success conditions

**Design Choice:**
Use **strict schema validation (e.g., Zod)** for consistency and agent reliability.

---

### 6. Shared Source of Truth

- Webview UI reads/writes `.project-docs/`
- MCP server reads/writes `.project-docs/`
- No duplicated state or syncing layer

**Design Choice:**
Filesystem acts as the **single state boundary**.

---

### 7. Context Aggregation Layer

Combine multiple docs into compact agent-ready context:

- key requirements
- core components
- constraints
- acceptance criteria

**Design Choice:**
Provide **high-signal aggregated context** for efficient agent usage.

---

### 8. AI Tool Integration (Client-Managed MCP)

AI tools connect by launching the MCP server using their own configuration.

**Integration Pattern:**

- User installs planner extension
- User configures MCP server in their coding agent (e.g., Claude Code)
- Agent launches MCP server locally via stdio
- Agent calls document APIs during execution

**Extension Support:**

- Generate MCP config snippets
- Validate server connectivity
- Provide setup guidance

**Design Choice:**
Decouple UI from runtime to support **multiple MCP clients and tools**.

---

## Architecture

### Components

- **VS Code Extension**
    - launches Webview Panel
    - manages file IO + validation
    - assists with MCP setup (optional)

- **Webview Panel (React App)**
    - planner UI
    - multi-doc navigation/editing
    - communicates with extension via messaging

- **Standalone MCP Server (Node/TypeScript)**
    - exposes document APIs
    - reads/writes `.project-docs/`
    - launched by MCP clients

- **Project Docs Folder**
    - persistent design artifacts

- **Coding Agent / MCP Client**
    - launches MCP server
    - invokes document APIs
    - executes implementation tasks

---

## Key Design Decisions

### 1. Webview Panel as Primary UI

Chosen for **multi-document, app-like experience**.

### 2. Client-Managed MCP Server

Server lifecycle is owned by the MCP client → **standard, flexible integration**.

### 3. File-Based Source of Truth

Ensures **versioning, transparency, and interoperability**.

### 4. Declarative Design Artifacts

Docs define **what to build**, not how to build it.

### 5. Clear Separation of Concerns

- UI → design editing
- MCP → document access
- Agent → execution

---

## Risks & Mitigations

| Risk                    | Mitigation                                   |
| ----------------------- | -------------------------------------------- |
| User setup friction     | Provide config generation + guided setup     |
| Agent misconfiguration  | Validate MCP connection in extension         |
| Schema drift            | Enforce validation in both UI and MCP server |
| Cross-doc inconsistency | Add UI validation + aggregation layer        |

---

## MVP Scope

- Webview Panel planner UI
- `.project-docs/` folder
- Standalone MCP server (stdio)
- MCP APIs: `get_doc`, `update_doc`
- Basic schema validation
- Setup guide for connecting AI tools

---

## Future Extensions

- Remote MCP server (HTTP) for cloud AI tools
- Approval workflow for agent updates
- Visual architecture diagrams
- Doc diff/history viewer
- Deep integration with multiple coding agents

---

## Summary

This system provides a **VS Code-native project design planner** backed by a **client-managed MCP server**. By separating the planner UI from the MCP runtime and storing artifacts in repo-local files, it enables flexible integration with multiple AI tools while maintaining a clear and reliable source of truth for project design.
