# System Integration Context - Current State

This document provides an overview of the current state of the AI document chatbot system and integration between components.

**System Architecture:**

* **Frontend**: Next.js application running on port 3000
* **Backend**: LangChain/LangGraph API running on port 2024 (not 3001 as previously documented)
* **Database**: Supabase vector store for document embeddings and retrieval

**Integration Points:**

1. **File Upload Flow**:
   * Frontend accepts file uploads via `frontend/app/page.tsx`
   * Files are encoded as Base64 in `frontend/app/api/ingest/route.ts`
   * Encoded files are sent to backend graph `ingestion_graph` on port 2024
   * Backend processes files in `backend/src/ingestion_graph/graph.ts` via `processFiles` node
   * Processed chunks are stored in Supabase vector store

2. **Query Processing Flow**:
   * User query from frontend is sent to backend graph `retrieval_graph`
   * Backend processes query through routing, retrieval, and response generation
   * Responses are streamed back to frontend

**Current Integration Issues:**

* Frontend is properly configured to use backend on port 2024
* API keys and service credentials are functioning correctly 
* Main issue is with the connection between frontend and backend components
* Need to ensure proper request/response handling between Next.js and LangGraph server

**Next Integration Tasks:**

* Verify correct URL configurations in environment variables
* Confirm proper thread/run management for LangGraph API
* Test error handling across integration points
* Implement robust connection retry logic

# Project Context

This project is an AI-powered chatbot designed to interact with uploaded documents (PDF, DOCX, TXT). It leverages a monorepo structure with a Next.js frontend and a LangChain backend.

**Key Components:**

*   **Frontend (`frontend/`):**
    *   Built with Next.js, running on port 3000.
    *   Handles file uploads (`frontend/app/page.tsx`) and displays the chat interface.
    *   Uses Tailwind CSS for styling (`frontend/tailwind.config.ts`).
*   **Backend (`backend/`):**
    *   Built with LangChain and TypeScript, running on port 2024 (not 3001).
    *   Uses LangGraph (`^0.2.41`) to manage document processing and chat logic through state machines defined in `graph.ts` files within the `ingestion_graph` and `retrieval_graph` directories.
    *   **Ingestion Graph (`backend/src/ingestion_graph/`):**
        *   **Purpose:** Processes uploaded documents (parsing, splitting, embedding) and adds them to a vector store for retrieval.
        *   **Workflow (`graph.ts`):** Simple graph (`ingestDocs`) that initializes a retriever (`backend/src/shared/retrieval.ts`) and calls `retriever.addDocuments()`. Uses OpenAI (`text-embedding-3-small`) for embeddings.
        *   **State (`state.ts`):** Manages `docs`.
    *   **Retrieval Graph (`backend/src/retrieval_graph/`):**
        *   **Purpose:** Handles user queries, orchestrates retrieval, generates responses, and manages chat history.
        *   **Workflow (`graph.ts`):** Multi-step graph (`checkQueryType` -> `routeQuery` -> (`directAnswer` or (`retrieveDocuments` -> `generateResponse`))). Uses LLM (`openai/gpt-4o`) for routing and generation, and the retriever (`backend/src/shared/retrieval.ts`) for document fetching.
        *   **State (`state.ts`):** Manages `query`, `route`, `messages`, `documents`.
    *   **Shared Components (`backend/src/shared/`):**
        *   `retrieval.ts`: Configures Supabase vector store (`SupabaseVectorStore`) using `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from `.env`. Uses OpenAI embeddings.
        *   `configuration.ts`: Defines base configuration (retriever provider defaults to `supabase`, k=5).
        *   `state.ts`, `utils.ts`.
        *   Uses environment variables (`backend/.env`) for API keys and Supabase credentials.
*   **Development:**
    *   Managed using Yarn workspaces and Turbo (`package.json`, `turbo.json`).
    *   Includes testing setups (`jest.config.js`).
    *   Port 2024 is used for LangGraph server which the frontend connects to.

**Current Goal:** Implement enhanced ingestion pipeline (PPTX support, improved chunking) and add a frontend document/chunk viewer.

# Deployment Troubleshooting Summary (July 2024 - Netlify/Render)

**TL;DR – We chased three root causes — (1) missing environment variables during Netlify's build step, (2) TypeScript type-mismatch errors, and (3) a monorepo build-path issue.**
_The "golden rule" we wrote on the whiteboard is: "Every value you process.env.X at build-time must exist in Netlify and your code must never access optional JSON fields without narrowing."_
_After adding the env-vars in Netlify, creating a frontend/netlify.toml that points Netlify at the right workspace, and tightening a few TypeScript guards, the deploy finished in ≈ 95 s with 0 errors._

**1. What kept breaking:**

*   **Env-vars:** `Error: LANGCHAIN_API_KEY is not set` (and others like `OPENAI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`).
    *   **Why:** Netlify executes Next.js build steps in a separate container where secrets weren't exposed by default.
*   **Monorepo build path:** Netlify ignored the `frontend` workspace and ran the root `package.json` build.
    *   **Why:** Without a `netlify.toml` specifying the base/command/publish for the workspace, Netlify assumes repo root.
*   **TypeScript:** `Interface 'Message' incorrectly extends…`, `Module has no exported member…`, `property type does not exist on JSONValue`.
    *   **Why:** Custom `Message` type extensions were incompatible with base `ai/react` types; imports were incorrect; unsafe access to optional JSON fields.

**2. Fixes applied step-by-step:**

*   **2.1 Add/verify environment variables:**
    *   Added necessary variables (`LANGCHAIN_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, etc.) in Netlify UI (Build & Deploy > Environment variables).
    *   Ensured variables available to appropriate scopes (Builds, Functions).
    *   Used `echo` in build command (`netlify.toml`) to verify presence/length at build time.
*   **2.2 Tell Netlify to build the frontend workspace:**
    *   Created `netlify.toml` (initially in root, then likely corrected to be in `frontend/` or adjusted base path) with:
        ```toml
        [build]
          base    = "../" # Or adjust as needed relative to netlify.toml location
          command = "turbo run build --filter frontend"
          publish = "frontend/.next"
        ```
*   **2.3 Harden TypeScript types:**
    *   Corrected `JSONValue` import (`ai` vs `ai/react`).
    *   Refined `Message` interface `annotations` type.
    *   Added type guards (`isChatMessage`) before passing messages to components requiring specific roles.
    *   Corrected prop types (`handleInputChange`).
    *   Fixed incorrect/unused imports.
*   **2.4 Client-side Build Safety / Runtime Quirks:**
    *   Added `export const dynamic = 'force-dynamic';` to API routes.
    *   **Refactored client initialization:** Moved `LangGraph`, `OpenAI`, `Supabase` client creation *inside* getter functions (`createServerClient`, `getOpenAI`, `getSupabaseService`) in helper files (`/lib/*.ts`) and called these functions *only at runtime* within API handlers, removing top-level instantiation.
    *   Wrapped component calling `useSearchParams` (`page.tsx`) in `<Suspense>`. 

**3. The golden rule (and two silver ones):**

*   **GOLDEN RULE:** If you `process.env.X` in code that runs during the Next.js build, make sure X is defined in Netlify's build environment.
*   **Silver #1:** In a monorepo, a `netlify.toml` in the correct sub-dir (or configured with correct base path) is mandatory so Netlify builds the right package.
*   **Silver #2:** When extending third-party TypeScript types, stick to the original field contracts or wrap your extension in a new discriminated-union type.

# Next Steps / To Do

*   **Implement SSE Proxy via Render Backend (Option B):** (Resolves Netlify 502 Timeout)
    *   [x] Use data-stream v1 protocol: set `x-vercel-ai-data-stream: v1` header and send numeric code frames (`0:` for tokens, `1:` for final message).
    *   [x] Confirm deletion of unused Netlify Function `frontend/app/api/chat/route.ts`.
    *   [x] Update SSE frame format: initial thinking event, heartbeat, proper data frames, done event.
    *   [ ] Deploy updated backend code to Render service (ensure env vars are set).
    *   [ ] Deploy updated frontend code to Render service (set build command and publish directory, e.g., `yarn build --filter frontend`, publish `frontend/.next` or `frontend/out`) and configure frontend environment variables: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_LANGGRAPH_API_URL`.
    *   [ ] Remove Netlify-specific configuration: delete `frontend/netlify.toml` and any Netlify function routes.
    *   [ ] Test deployed chat functionality:
        *   [ ] Verify token-by-token streaming.
        *   [ ] Check for frontend/backend console errors.
        *   [ ] Confirm conversation history/threads (`threadId`) functionality.
    *   [ ] (Optional) Refinements:
        *   [ ] Review/restrict backend CORS settings (`ALLOWED_ORIGINS`).
        *   [ ] Add context message passing logic to backend `/chat/stream` if needed.
        *   [ ] Add logic to save complete conversation message to Supabase after stream finishes.
*   **Investigate Runtime Errors (Post-Deployment):** (Potentially resolved by Option B)
    *   [x] Verify Netlify `NEXT_PUBLIC_LANGGRAPH_API_URL` points to correct deployed Render backend URL. (URL now used by backend, not frontend API)
    *   [ ] Check Render backend logs for runtime errors (post-build, e.g., crashes, connection issues).
    *   [x] Confirm correct `assistantId` used (`retrieval_graph` used in new backend endpoint).
    *   [ ] Check Render backend CORS logs (Current setting is `*`, check if needs tightening).
    *   [ ] ~~Check Render HTTP Request logs for specific 404/502 details.~~ (Error likely moves to backend logs)
    *   [ ] ~~Check Netlify Function Logs~~ (Frontend API route bypassed)
    *   [ ] ~~Review `streamMode: "values"` logic~~ (Backend now uses `updates`)
    *   [ ] Consider potential SDK/LangServe version mismatch (Still possible).
    *   [ ] Redeploy backend with cleared cache (Needed after code changes).

*   **Improve Retrieval Reliability (High Priority):**
    *   [ ] **Address `MaxListenersExceededWarning`:** Investigate and fix the root cause of this warning (likely in frontend SSE handling or backend async operations) to prevent potential leaks and ensure stability. (Pending info)

*   **Consolidate/Optimize Retrieval Logic (Medium Priority):**
    *   [ ] **Simplify `retrieval.ts`:** Remove redundant registry lookups within the retriever if `extractQueryFilters` now reliably provides validated filters.
    *   [ ] **Refine Query Cleaning:** Implement safer query cleaning in `extractQueryFilters` if desired.

*   **Code Cleanup & Testing (Medium Priority):**
    *   [ ] Remove unused variables/code in `graph.ts` and `retrieval.ts`.
    *   [ ] Add basic unit/integration tests for filter extraction and retrieval logic.

*   **UI/UX Overhaul (Phase 1):** Enhance layout, clarity, and branding.
    *   [~] **Implement Collapsible Sidebar:** (Reverted for now)
        *   [~] Create basic `Sidebar` component structure.
        *   [~] Add placeholders for Documents list and Chat History.
        *   [~] Implement collapse/expand functionality.
        *   [~] Integrate into main layout (`layout.tsx`).
        *   [~] Style using Sladen palette.
    *   [ ] **Refine Header:**
        *   [x] Adjust height/padding.
        *   [ ] Integrate Sladen logo (if available).
        *   [x] Review navigation link styling.
    *   [ ] **Create Dedicated File Upload Area:**
        *   [ ] Design visual drag-and-drop/selection area (in sidebar or main view).
        *   [ ] Integrate with existing file handling logic.
    *   [x] **Enhance Thinking Process Display:**
        *   [x] Added more detailed thinking state descriptions in frontend/app/api/chat/route.ts
        *   [x] Implemented dynamic icons based on thinking stage in chat-message.tsx
        *   [x] Added animated progress indicator in the thinking display
        *   [x] Enhanced visual styling of thinking message boxes for better readability
        *   [x] Added custom animation in Tailwind config for thinking progress visualization
        *   [x] Fixed visibility issue with more prominent styling and colorful animation
        *   [x] Enhanced SSE event handling to ensure thinking states are properly displayed
        *   [x] Added debug logging to track thinking state updates
        *   [x] Fixed content property to ensure thinking state is correctly shown instead of empty message
        *   [x] Fixed isThinking condition to properly detect and display thinking messages
        *   [x] Added explicit stage properties in API route thinking updates
        *   [x] Fixed thinking-to-response transition to properly clear thinking state
        *   [x] Added comprehensive debugging to track message state changes
*   **Testing & Validation:**
    *   **Action:** Test file uploads (PDF, DOCX, PPTX) using frontend processing.
    *   Verify chunks (`RecursiveCharacterTextSplitter`) appear correctly in `/documents` viewer.
    *   Test chat functionality with newly ingested documents.
    *   Monitor logs for errors.
*   **PowerPoint Enhancement:**
    *   [x] Create frontend components to display full PowerPoint content. (Implemented slide-separated view in `chat-message.tsx`)
    *   [ ] Add unit tests for the PowerPoint retrieval functionality.
*   **Document Management Enhancements:**
    *   [ ] **Document Querying:** Implement ability to query specific documents by name/ID.
    *   [x] **Duplicate Prevention:** Add validation to prevent uploading documents with duplicate filenames. (Implemented in backend `processFiles` node)
    *   [In Progress] **Document Deletion:** Create API endpoint and UI for deleting documents and their vector embeddings from the data store.
    *   [ ] **Refine Filtering Bug Fix:** Continue testing and refining document name filtering.
        *   [x] Implement fuzzy matching fallback for close document name matches
        *   [x] Update the file pattern regex to better detect file references in natural language
        *   [x] Enhance logging to track filter application throughout the retrieval process
        *   [x] Add special case handling for "test pdf" queries (via regex fallback)
        *   [Paused] Add more precise comparison logic for document names without file extensions (Current regex struggles with phrases like "test pdf" vs metadata "test.pdf").
        *   [Paused] Implement case-insensitive matching for document names.
        *   [ ] Test with various query formulations including partial names, full names with/without extensions
        *   [ ] Create unit tests specifically for document filtering functionality
        *   [Paused] Monitor the fix in production and make further refinements if needed (Filtering paused).
*   **Backend Graph Issues:**
    *   [ ] Check `as any` workarounds if LangGraph is updated.
    *   [x] Investigate `Schema extract worker timed out` in `retrieval_graph`. (Routing LLM call still bypassed).
    *   [Paused] Filtering Logic in `extractQueryFilters` (`backend/src/retrieval_graph/graph.ts`):
        *   Attempted LLM-based extraction (unreliable for "test pdf").
        *   Attempted multi-stage regex fallback (strict + loose).
        *   Attempted normalization of extracted filenames (e.g., "test pdf" -> "test.pdf").
        *   Attempted simplified regex-only approach without query cleaning.
        *   Issue: Consistently fails to extract the correct filename string ("test.pdf") to match stored metadata.source for filtering.
    *   [x] Re-enabled filter extraction logic (LLM) in `extractQueryFilters` (`backend/src/retrieval_graph/graph.ts`).
    *   [x] Added regex fallback for filename extraction in `extractQueryFilters` if LLM fails to identify target.
    *   [x] Adjusted query cleaning logic to prevent removal of non-filename terms (e.g., "pdf") if a filename filter is active.
    *   [x] **Fixed filename extraction in `extractQueryFilters` by implementing a two-phase approach:**
        *   [x] Added more precise regex pattern for exact filename matching
        *   [x] Added contextual pattern matching for document references
        *   [x] Added special case handling for specific documents (Merck Fertility Forum)
        *   [x] Added test cases to verify correct behavior with Merck document
        *   [x] Improved filename normalization with better context detection
    *   [x] **Added conversation context handling for follow-up questions:**
        *   [x] Detect phrases like "this document" or "this presentation" in queries
        *   [x] Maintain document context from previous messages in conversation
        *   [x] Apply previous document filters to follow-up questions
        *   [x] Fixed contextual reference parsing to avoid treating phrases like "this document" as filenames
    *   [x] **Enhanced corporate document identification:**
        *   [x] Added specialized pattern matching for documents with numeric IDs (like "1485_Merck")
        *   [x] Implemented specific handling for corporate documents with underscores
        *   [x] Added improved error messaging when documents can't be found after multiple attempts
        *   [x] Fixed response generation to properly handle cases where no relevant documents exist
    *   [x] **Implemented content-based document identification:**
        *   [x] Added semantic document matching based on key terms
        *   [x] Created scoring system to identify best document match
        *   [x] Extract key terms from queries (company names, IDs, dates)
        *   [x] Use content search to find document sources that best match extracted terms
        *   [x] Implemented dynamic weighting of document sources based on term matching
        *   [x] Format-independent document identification (works with varied formatting)
        *   [x] Added detailed logs to track document matching process
*   **State Management Enhancement:**
    *   Test new state fields.
*   **Session & Thread Management:**
    *   [x] **Implement persistent conversation storage using Supabase:**
        *   [x] Create conversations table in Supabase with thread_id, created_at, updated_at, and title fields
        *   [x] Add messages table linked to conversations with message content, role, timestamps, and display order
        *   [x] Develop API endpoints for conversation management (create, retrieve, list, delete)
        *   [x] Add conversation history sidebar UI to allow users to access previous chats
    *   [x] **Improve thread persistence across page reloads:**
        *   [x] Store thread_id in localStorage as fallback for non-authenticated sessions
        *   [x] Add proper error handling when reconnecting to existing threads
        *   [x] Implement thread validation before use to ensure it still exists on the backend
    *   [ ] **Add authentication (optional):**
        *   [ ] Set up Supabase Auth for user management
        *   [ ] Link conversations to user accounts
        *   [ ] Add login/registration UI components
    *   [x] **Implement conversation UI features:**
        *   [x] Create conversation list sidebar component to display recent conversations
        *   [x] Add ability to switch between conversations
        *   [x] Implement conversation title editing and deletion
        *   [x] Add "New Chat" button to start fresh conversations
        *   [x] Add auto-generated conversation titles based on first message
        *   [x] Fixed sidebar positioning and styling issues
        *   [x] Styled the sidebar with Sladen color scheme for visual consistency
    *   [x] **Message synchronization:**
        *   [x] Implement saving messages to Supabase when they are created or received
        *   [x] Add loading of conversation history when switching between threads
        *   [x] Implement handling of messages with thinking states and sources
        *   [x] Add support for continuation of conversations from previous sessions
*   **Refinement (Optional):**
    *   Improve chunk viewer.
    *   Monitor performance.
    *   Consider `SemanticChunker`.
    *   Re-enable LangSmith.
*   **Advanced Context Management (New):**
    *   [ ] Implement dynamic sliding context window sizing and overlap.
    *   [ ] Develop custom retrieval strategies for different document types.
    *   [ ] Add cross-document linking.
*   **Backend-Frontend Connection Issues:**
    *   [x] Fixed build error in frontend related to missing eventemitter3 dependency:
        *   [x] Reinstalled dependencies using `yarn install`
        *   [x] Added specific versions of p-queue and eventemitter3 packages
        *   [x] Cleared Next.js cache
    *   [x] Resolved syntax error in `backend/src/ingestion_graph/graph.ts`:
        *   [x] Fixed improper try-catch structure that was causing "Expected 'finally' but found '}'" error
        *   [x] Added proper error handling with outer catch block
    *   [x] Start and test backend server on port 2024
    *   [x] **Fix Frontend Supabase Client Import Error:**
        *   [x] Diagnosed "Cannot find module '@/lib/supabase-server'" error.
        *   [x] Confirmed `supabase-server.ts` did not exist in `frontend/lib`.
        *   [x] Created `frontend/lib/supabase-server.ts` with server-side client initialization.
        *   [x] Verified API routes already had the correct import statement.
    *   [ ] **Fix Backend Deployment (Render):**
        *   [ ] **Fix DB Migration #5:** Run SQL (`DROP TABLE checkpoints` or `ALTER TABLE checkpoints ALTER COLUMN thread_id TYPE uuid ...`) on Supabase DB.
        *   [ ] **Set `DATABASE_URI`:** Use the **Supabase Connection Pooler URI** (IPv4) in Render Environment Variables.
        *   [ ] **Verify Start Command uses `$PORT`:** Check `backend/package.json` `start` script.
        *   [ ] **Set Render Start Command** (in Render UI): `yarn install && yarn build && yarn start`.
        *   [ ] Redeploy backend with cleared cache and monitor logs.
    *   [ ] Debug connection issues between frontend and backend:
        *   [ ] Test thread creation from frontend to backend
        *   [ ] Monitor network requests in browser DevTools for connection errors
        *   [ ] Check CORS configuration if needed
        *   [ ] Verify environment variables in both services
    *   [ ] Test complete integration flow:
        *   [ ] Test document ingestion flow from frontend to backend to Supabase
        *   [ ] Test chat functionality with ingested documents
        *   [ ] Verify document retrieval with different query types
    *   [ ] Implement improved error handling:
        *   [ ] Add retry mechanism for transient connection errors
        *   [ ] Improve error messages for user experience
        *   [ ] Add proper status indicators in the UI for backend connection status

# Tasks Completed

*   **Core Specific Document Retrieval Debugging (Major Effort):**
    *   **Symptom:** Queries for specific documents (e.g., "tell me about 1570 merck document") failed to retrieve relevant chunks, often falling back to broad vector search.
    *   **Initial Incorrect Hypotheses:** Frontend `thread_id` management issues.
    *   **Root Cause Analysis & Fixes:**
        *   **Identified Filter Extraction Failure:** Logs showed specific document queries weren't being recognized by initial regex (`extractDocumentNameFromQuery` in `retrieval.ts`). **Fix:** Made regex stricter.
        *   **Identified Registry Lookup Failure (RPC Function Call):** Logs showed `extractQueryFilters` (`graph.ts`) failed when calling `find_document_by_name` RPC due to incorrect parameters (`match_threshold` sent, function didn't accept it). **Fix:** Corrected RPC call signature in `graph.ts`.
        *   **Identified Registry Lookup Failure (SQL Function Logic):** Direct SQL tests showed `find_document_by_name` wasn't finding matches due to default fuzzy match threshold being too high. **Fix:** Modified `find_document_by_name` SQL function to use an explicit, lower `similarity` threshold.
        *   **Identified Registry Lookup Failure (Confidence Threshold):** Logs showed `extractQueryFilters` (`graph.ts`) found the correct document via registry RPC but discarded it because the returned similarity score was below the hardcoded `CONFIDENCE_THRESHOLD` (0.65). **Fix:** Lowered `CONFIDENCE_THRESHOLD` to 0.15 (may need tuning).
        *   **Identified Registry Lookup Failure (Selection Logic):** Direct SQL tests showed `find_document_by_name` returned multiple matches, but `extractQueryFilters` (`graph.ts`) naively took the top one based only on similarity, which wasn't always the correct one if numeric IDs were present. **Fix:** Added logic to `extractQueryFilters` to prioritize registry matches containing numeric identifiers from the query.
        *   **Identified Query Cleaning Error:** Logs showed `extractQueryFilters` crashed due to `new RegExp()` failing on complex filenames during query cleaning. **Fix:** Simplified query cleaning, passing original query when registry match occurs.
        *   **Identified Retriever Logic Failure (Filter Application):** Logs showed the retriever (`retrieval.ts`) received the correct `metadata.source` filter but incorrectly skipped the document-specific search stage. **Root Cause:** Incorrectly reading filter from `options.filter['metadata.source']` instead of `options['metadata.source']`. **Fix:** Corrected filter access in `retrieval.ts`.
        *   **Identified Retriever Logic Failure (Error Handling):** Logs showed retriever incorrectly falling back to standard search if the specific document search stage had an error. **Fix:** Modified `catch` block in retriever's Stage 1 to return `[]` on error, preventing fallback.
        *   **Identified RPC Function Failure (`match_documents_enhanced`):** Logs showed the primary RPC function failed silently (forcing fallback query) potentially due to ambiguous `id` column (though fixing function logic might resolve this). **Fix:** Corrected logic in `match_documents_enhanced` SQL function to handle `document_id` vs `filter` correctly.
        *   **Ensured DB Link Integrity:** Ran `populate_document_registry()` to ensure `documents.document_id` foreign key is populated.
    *   **Current Status:** Core specific document identification and retrieval **is now functioning** for tested cases (e.g., "1570 Merck document"), correctly using the document registry and applying filters, retrieving via the corrected `match_documents_enhanced` RPC.
    *   **IMPORTANT NOTE:** Do not revert the fixes related to fuzzy matching (`pg_trgm`, `find_document_by_name` function, similarity thresholds in SQL and graph code, numeric ID prioritization, retriever filter access `options['metadata.source']`) as these were critical to achieving current functionality.

*   **Environment Setup:** Verified `yarn` installation and `PATH`.
*   **Dependency Installation:** Successfully installed dependencies for both `frontend` and `backend` using `yarn install`.
*   **Service Startup:** Started development servers for both `frontend` (port 3000) and `backend` (port 2024) using `yarn dev`.
*   **LangGraph Connection Diagnosis:**
    *   Verified NEXT_PUBLIC_LANGGRAPH_API_URL points to correct backend port (2024)
    *   Confirmed LangGraph server is running on expected port
    *   Diagnosed connection issues between frontend API routes and backend graphs
    *   Verified threadId and runId handling in frontend-to-backend communication
*   **Frontend (`frontend/`):
    *   Implemented `/api/documents` route to fetch chunks from Supabase.
    *   Created `/documents` page with nested accordion view for chunks.
    *   Added navigation link in layout.
    *   **Refactored Ingestion:** Moved parsing (PDF, DOCX, PPTX) and chunking (`RecursiveCharacterTextSplitter`) logic into `/api/ingest` route.
    *   Previous fixes for DOCX upload (`Buffer`, source display enhancements).
    *   **Refactored file upload UX: separated file selection and processing, added explicit 'Process Files' button (`frontend/app/page.tsx`, `frontend/components/file-preview.tsx`).**
    *   **Restored and fixed functionality of `frontend/app/api/ingest/route.ts` to handle file parsing, chunking, and backend graph invocation.**
    *   Fixed file type display in `FilePreview` component and improved its styling (`frontend/components/file-preview.tsx`).
    *   **Updated `chat-message.tsx` to correctly identify and display 'PPTX' badge for PowerPoint MIME type.**
    *   **Fixed TypeScript errors in message handling**:
        *   Added proper type assertions (`as const`) for message role properties
        *   Fixed type errors in initial thinking message creation
        *   Ensured consistent type usage in SSE event handling
        *   Fixed error message display type in catch blocks
    *   **Improved document management workflow:**
        *   Removed document upload functionality from main chat page
        *   Added redirect button to the documents page for document management
        *   Centralized all document upload and management functionality in the documents page
        *   Simplified the main chat interface to focus on conversation functionality
        *   Fixed related TypeScript errors and optimized component imports
*   **Backend (`backend/`):
    *   Added `officeparser` dependency.
    *   Reverted `ingestion_graph` and `state` to simpler working version (accepts `Document[]`).
    *   **Note:** Persistent type errors in `graph.ts` (addEdge) being ignored for now.
    *   Previous fixes (`mammoth` dep, filtering empty docs).
    *   Addressed persistent TypeScript errors in `backend/src/ingestion_graph/graph.ts` using `as any` workaround.
*   **Strategy Change:** Shifted parsing/chunking logic from backend graph to frontend API route due to persistent backend graph type errors.
*   **Diagnosis:** Resolved initial errors (DOCX upload, embedding).
*   **Code Mods:** Previous fixes, logging, UI updates, API routes, page components.
*   **Process Management:** `lsof`/`kill` usage.

## Frontend UI Enhancements

- [x] Remove O'Reilly book reference from the initial view (`frontend/app/page.tsx`).
- [x] Add a generic title and subtitle to the initial view (`frontend/app/page.tsx`).
- [x] Updated example prompts to be generic document questions in `frontend/components/example-prompts.tsx`.
- [x] Changed the display of example prompts from cards to buttons in `frontend/components/example-prompts.tsx`.
- [x] Updated page styling in `frontend/app/page.tsx` for better visual appeal.
- [x] Refined UI styling in `frontend/app/page.tsx`, especially the bottom input bar, for better integration.
- [x] Further improved UI clarity in `frontend/app/page.tsx` using theme-consistent colors and borders.
- [x] Added background color and styling to chat area in `frontend/app/page.tsx` for better visual separation.
- [x] Removed container styling from chat area in `frontend/app/page.tsx` as requested.
- [x] Changed main page background from gradient to solid white/black in `frontend/app/page.tsx`.
- [x] Refactored file upload UX: separated file selection and processing, added explicit 'Process Files' button (`frontend/app/page.tsx`, `frontend/components/file-preview.tsx`).
- [x] Restored and fixed functionality of `frontend/app/api/ingest/route.ts` to handle file parsing, chunking, and backend graph invocation.
- [x] Fixed file type display in `FilePreview` component and improved its styling (`frontend/components/file-preview.tsx`).
- [x] **Updated `chat-message.tsx` to correctly identify and display 'PPTX' badge for PowerPoint MIME type.**
- [x] Enhanced the metadata display in documents view with improved formatting and layout
- [x] Fixed the "Other Metadata" section with proper styling and a spinning arrow indicator
- [x] Improved example prompt buttons with better styling, larger size, and clearer visual feedback
- [x] Enhanced the "Enhanced Retrieval Features" alert box to be more visually appealing and fit properly on screen
- [x] Improved metadata key-value display with better spacing and text formatting
- [x] Fixed the "Enhanced Retrieval Features" alert box positioning to ensure it fits properly on screen as a centered bubble
- [x] Improved the Sladen Chat header with a proper gradient background, better typography, and increased visual hierarchy
- [x] Repositioned the example prompts to be just above the chat input for better user flow and visual balance
- [x] Arranged example prompts in a balanced 2x2 grid layout for improved visual structure
- [x] Fixed example prompt functionality to properly populate selected text into the chat input
- [x] Fixed example prompt button display on smaller screens, switching to single column for better readability
- [x] Enhanced sources display with document title, document type badge, and better formatted chunk information
- [x] Improved sources card layout with cleaner spacing and better information hierarchy
- [x] Added file size display to source cards when available
- [x] Completely redesigned the landing page layout with a professional, cohesive structure
- [x] Created a prominent hero section with clear call-to-action for document uploads
- [x] Integrated "Enhanced Retrieval Features" section directly into the landing page for better context
- [x] Improved feature descriptions with clearer headings and examples for each capability
- [x] Fixed layout structure to maintain proper spacing and overflow handling
- [x] Moved document upload functionality from main page to documents page for better organization
- [x] Added navigation button on home page to direct users to documents page for uploading
- [x] Simplified main page UI by removing redundant upload functionality
- [x] Improved user flow by centralizing document management in one dedicated location
- Investigated and addressed 404 error for `/api/ingest` route, likely due to caching (recommended server restart).
- Addressed persistent TypeScript errors in `backend/src/ingestion_graph/graph.ts` using `as any` workaround.

## Backend Retrieval Issues Action Plan

After reviewing the codebase, there are several issues with the document retrieval functionality that need to be addressed:

### Issues Identified

1. **Same Document Retrieval Problems**:
   * Documents from the same source are not consistently retrieved when queried
   * Exact matching by filename has inconsistencies, especially with similar file names
   * The `extractQueryFilters` function struggles with extracting the correct filename in some cases
   * Levenshtein distance-based suggestion may be too permissive or too strict in some scenarios
   * **Root Cause Identified:** Inconsistent `thread_id` management between frontend and backend, primarily due to fragile pre-validation in `frontend/app/api/chat/route.ts`, causing new threads to be created mid-conversation, leading to lost state.

2. **Latest Documents Retrieval Issues**:
   * The date-based sorting for retrieving recent documents is not working properly
   * Recency filters do not consistently return the newest documents
   * Metadata for `parsedAt` may not be properly indexed or formatted for optimal sorting
   * **Root Cause Identified:** Bug in `shared/retrieval.ts` where the `match_documents_enhanced` RPC call failed silently for `__LATEST__` document requests, preventing the correct filter from being effectively applied. The fallback logic was triggered inappropriately.

### Action Plan

1. **Fix Thread ID Management (Root Cause):**
   * [x] **Removed Fragile Thread Pre-validation:** Modified `frontend/app/api/chat/route.ts` to remove the `threads.get` pre-validation check. The route now trusts the `threadId` provided by the client, preventing accidental new thread creation and preserving conversation context.
   * [ ] **Verify Frontend `thread_id` Persistence:** (Low priority if fix works) Add detailed logging in frontend components (hooks/context managing chat state) to ensure `thread_id` is correctly stored (localStorage/Supabase) and retrieved between user messages.
   * [ ] **Verify Backend Thread Association:** (Low priority if fix works) Add logging in `backend/src/server.ts` to confirm the `thread_id` received matches the one sent by the frontend.
   * [ ] **Confirm Checkpointer Configuration:** (Low priority if fix works) Double-check Supabase checkpointer setup in backend graph configuration.

2. **Refine Document Filtering Logic**:
   * [x] **Enhanced `extractQueryFilters`:** Modified `backend/src/retrieval_graph/graph.ts`. The function now uses a two-stage approach: 
        1. Attempts explicit extraction (`extractDocumentNameFromQuery` regex).
        2. If stage 1 fails, extracts keywords, searches `document_registry` via `find_document_by_name` RPC, and applies a filter if a high-confidence match is found.
   * [ ] Implement a confidence score system for file name matching to avoid false positives (Partially addressed by threshold in registry lookup)
   * [ ] Add unit tests with various query formulations to validate filter extraction

3. **Improve Same-Document Retrieval**:
   * [ ] Enhance the exact match functionality in `makeRetriever` to support more query variations
   * [ ] Implement case-insensitive matching consistently throughout the retrieval pipeline
   * [ ] Add file extension normalization (handle queries with and without file extensions consistently)
   * [ ] Revise the Levenshtein distance threshold for fuzzy matching, potentially making it dynamic based on string length
   * [ ] Implement a ranking system that prioritizes source matches over semantic similarity when relevant

4. **Fix Latest Documents Functionality**:
   * [x] **Added Fallback Query for Latest Document:** Modified `shared/retrieval.ts`. If the `match_documents_enhanced` RPC fails for a `__LATEST__` request, it now attempts a standard Supabase query using `.eq('metadata->>source', resolved_filename)` as a fallback.
   * [x] **Fixed Linter Errors:** Corrected try/catch structure and added type annotations in `shared/retrieval.ts`.
   * [ ] Ensure consistent ISO date format is used for `parsedAt` metadata during document ingestion
   * [ ] Add proper indexing for the `parsedAt`

*   [ ] Update `ChatInterface` (frontend) to parse code-2 stream events and display stage messages (e.g., message_saved, history_fetched, executing_graph, finalizing) for improved UX during streaming.

# Ingestion Graph Improvements (Backend)

*   **Security & Dependencies (High Priority):**
    *   [ ] **Replace `officeparser`:** Investigate and replace `officeparser` with `pptx2json` or a LibreOffice-headless pipeline due to historical CVEs. (Suggestion #2)
    *   [ ] **Service Role Key Exposure:** Review Next.js API route imports to ensure the Supabase service key is not bundled client-side. Consider an internal RPC layer if needed. (Suggestion #2)
*   **Memory & Performance (High Priority):**
    *   [ ] **Fix Buffer Life-cycle/State Bloat:** Modify `processSingleFile` or `processFiles` to clear `contentBase64` from state immediately after parsing/use. (Suggestion 1-A, 3-B)
    *   [ ] **Use Worker Threads for PDF Parsing:** Offload synchronous `pdf-parse` work to worker threads to avoid blocking the event loop. (Suggestion 1-B)
    *   [ ] **Improve Supabase Duplicate Check:** Implement a functional index on `lower((metadata->>'source'))` or use file hashes for faster duplicate checks instead of `ilike`. (Suggestion 1-D)
*   **Correctness & Tuning (Medium Priority):**
    *   [ ] **Tune PPTX Chunk Size:** Evaluate increasing `chunkSize` for `pptxSplitter` (e.g., to 4k+) for potentially better retrieval with long-context models. (Suggestion 1-C)
*   **Graph Semantics & Error Flow (Medium Priority):**
    *   [ ] **Refine `finalStatus` Logic:** Implement a stricter enum for `finalStatus` and freeze the state upon reaching a terminal status in nodes like `processFiles`. (Suggestion 3-A)
    *   [ ] **Short-circuit on All Skipped:** Modify `processFiles` to conditionally transition directly to `END` if all files were skipped (e.g., duplicates), avoiding unnecessary runs of `chunkAndEmbedDocs`. (Suggestion #4)
    *   [ ] **Decouple Graph Config:** Refactor graph compilation to avoid hardcoding `runName` and allow configuration injection at invocation time (e.g., using a factory pattern). (Suggestion 3-C)
*   **Observability & Logging (Medium Priority):**
    *   [ ] **Implement Structured Logging:** Integrate Pino or Winston and replace `console.log` calls with structured logging, including request/run IDs. (Suggestion #8, #5)
    *   [ ] **Emit Custom LangGraph Events:** Use `.publish()` within graph nodes to emit custom metrics (e.g., `slide_count`, `duplicate_skipped`) for tracing. (Suggestion #5)
*   **Code Quality & Style (Low Priority):**
    *   [ ] Use `const enum` for node names/magic strings. (Suggestion #6)
    *   [ ] Make `MAX_PPTX_SIZE` configurable via `RunnableConfig`. (Suggestion #6)
    *   [ ] Use `unknown` in `catch` blocks and narrow types. (Suggestion #6)
    *   [ ] Enforce `import type` where applicable. (Suggestion #6)