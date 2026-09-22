# Persistent Agent Tasks

The user wants a capable, general Agent service inspired by Muse, beyond a single quotation workflow. Preserve the public brand website and add a separate authenticated Tasks page. Implement real background execution, model-selected tools, durable progress, user steering, approvals and downloadable deliverables. Do not represent this release as having a general browser/VM, external app connectors, or autonomous payments.

## Boundaries

Use the existing private FastAPI service, SQLite owner isolation, same-origin BFF and model gateway. Keep the production checkout and deployment untouched. API keys are accepted only when starting a task; encrypt them with an explicitly configured Fernet server key, never return them, and clear ciphertext on terminal state. Runtime is disabled by default. No live paid inference is part of automated verification. Tests inject model transports.

## Shared contract

All public operations are below `/api/portal/runtime`. All need existing account session; mutations require the existing exact-origin boundary. IDs are 32 lowercase hex characters. Responses are JSON and no-store.

- GET `/config`: `{enabled, available, models: string[], tools: string[], limits: {maxSteps: 20, maxOutputTokens: 4096, maxReferences: 8, referenceCharacters: 32000}, reason?: string}`. Never disclose encryption key or model key.
- GET `/tasks`: `{tasks: Task[]}` limited to latest 50 owned tasks.
- POST `/tasks`: body `{goal, agentId?: string, model, apiKey, maxSteps, maxOutputTokens, references: [{name, content}]}`; returns `{task: Task}` with status queued, 201. Goal 1..6000 chars, maxSteps 1..20 (default12), maxOutputTokens128..4096(default1024), total reference text <=32000 chars and <=8 items. Key visible ASCII 8..512. Agent snapshot must belong to the account. No implicit customer billing credential.
- GET `/tasks/{id}`: `{task: Task}` including events, plan, approvals, references and artifact summaries. Never include ciphertext, private credentials or hidden model reasoning.
- POST `/tasks/{id}/control`: `{action: 'pause'|'resume'|'cancel'}`. Running pause/cancel is cooperative at a step boundary; return requestedControl. Terminal transitions immutable; resume only paused/failed recoverable/awaiting_approval after valid decision; limits not reset.
- POST `/tasks/{id}/instructions`: `{message}` 1..4000 chars. Durable user steering consumed at the next complete model/tool boundary. Preserve intermediate tool-result ordering.
- POST `/tasks/{id}/approval`: `{approvalId, decision: 'approve'|'reject'}`. Exact tool arguments bound to approval, no wildcard grants, reject stale/different-owner/duplicate decisions; worker resumes only after a decision.
- GET `/tasks/{id}/artifacts/{artifactId}`: `{artifact: {id,name,mimeType,size,contentBase64}}` owner-scoped. Download as attachment in browser, never render generated HTML unsandboxed.

Task summary: `{id, goal, status, model, agentId: string|null, agentVersion: number|null, createdAt: ISO, updatedAt: ISO, stepCount, maxSteps, maxOutputTokens, requestedControl: string|null, usage: {inputTokens,outputTokens}, summary: string, error: string|null}`. Details add `{plan: [{id,title,status}], events: Event[], references: [{id,name,content}], artifacts: ArtifactSummary[], approval: Approval|null}`.
Event `{id,kind,title,content,createdAt}` kind is queued/model/tool/instruction/control/approval/completed/error. Show observable actions and concise model messages, not private chain-of-thought. ArtifactSummary `{id,name,mimeType,size,createdAt}`. Approval `{id,tool,args,reason,status}` status pending/approved/rejected.

States: queued, running, paused, awaiting_approval, completed, failed, cancelled. Preserve state and event history across browser closure and server restart. Only one active lease may execute a task; stale running leases pause for explicit recovery rather than silently repeating billable calls. Maximum two unfinished active tasks per account, 50 retained tasks and bounded artifacts/events. Reserve step budget before every model call; retries do not reset consumed steps.

## Repository interface (Python)

`RuntimeStore(store)` creates its own tables using existing Store.connect(). Raises `RuntimeErrorDetail(code,detail,status=400)`.

Public methods: `create(user_id, payload, credential_ciphertext, agent_snapshot=None)->task`; `list(user_id)->list`; `get(user_id,task_id)->task`; `control(user_id,task_id,action)->task`; `instruct(user_id,task_id,message)->task`; `decide(user_id,task_id,approval_id,decision)->task`; `artifact(user_id,task_id,artifact_id)->dict`.

Worker methods: `claim(worker_id, lease_seconds=120)->internalTask|None` (atomic, recovers expired leases to paused); `heartbeat(task_id,worker_id,lease_seconds=120)->bool`; `checkpoint(task_id,worker_id,messages,*,event=None,plan=None,usage=None)->bool`; `reserve_step(task_id,worker_id)->bool`; `drain_instructions(task_id,worker_id)->list[str]`; `observe_control(task_id,worker_id)->str|None`; `release(task_id,worker_id)->None`; `finish(task_id,worker_id,status,*,summary='',error=None)->bool`; `request_approval(task_id,worker_id,tool,args,call_id,messages)->approval`; `approval_result(task_id)->dict|None`; `add_artifact(task_id,worker_id,artifact,call_id)->ArtifactSummary` (idempotent by call_id).

Internal task includes public fields plus owner_id, encrypted_key, messages, agent_snapshot, references and lease metadata. Methods enforce ownership or lease fencing at every mutation. Usage is cumulative delta when checkpointed, not model-reported cost. Model I/O is not executed inside DB transactions. Store author and engine author must coordinate any necessary API change before editing consumers.

## Engine and tools

`RuntimeEngine(repository, settings, model=None, tools=None)` with `async tick()` claims and executes one task, `async serve(stop_event)` polls without blocking HTTP. `model` is injected async `(messages, tools, model, api_key, max_tokens)->dict` returning OpenAI-compatible assistant message and usage; production uses fixed settings.gateway_origin + `/v1/chat/completions`, HTTPX streaming bounded response, 45s timeout, redirects prohibited. Do not persist credentials in prompts/events; sanitize output containing the active key. Fail clearly on malformed/unsupported tool calls; never fabricate progress or successful actions. Tool loop can make <=20 model calls and <=4 tool calls per response; bound total transcript and each continuous execution segment to five minutes (the step budget persists across approvals and resumes). Before each next model call, incorporate completed steering, limits and control. Renew lease during model/tool work.

`RuntimeTools` exposes `definitions()` and `async execute(name,args,context)->dict`. Context provides `{references, task_id}`; returns `{content: str, artifact?: {name,mimeType,contentBase64}, plan?: [...]}`. Definitions: `read_reference` (id), `analyze_csv` (referenceId, numericColumns?, groupBy?), `write_artifact` (name,format: txt|md|csv|json|docx,content), `read_url` (url), `update_plan` (steps [{id,title,status}]). Unknown tool/args fail closed. Engine requires exact approval for every `read_url`; no user credential is passed into tool context. `read_url` is HTTPS-only, max2 redirects, public unicast IPs only, DNS-pinned TLS with original hostname verification, no cookies/auth, bounded time and bytes; reject private/reserved IP literals or any private resolved address at every redirect. Strip scripts and treat retrieved text as untrusted data. Built-in tools never execute arbitrary model code, send email or mutate third-party systems. Downloads must not contain file paths. DOCX is a deterministic zip/XML document using escaped content, not a macro/template loader.

## Acceptance

Authenticated owner can start a complex task with references; worker continues without page connection; task plans and tool steps persist; different account cannot read/control task or artifact. User can pause/cancel/steer and approve/reject an exact web read. Model-chosen reference reading, CSV analysis and DOCX creation work end-to-end with injected model responses. Restart recovery does not replay an uncertain billable call automatically. Key encrypted at rest and erased after terminal status; no API response, error, artifact or model output may reveal it. UI is English/Traditional Chinese, mobile-usable, keyboard-usable, and explains absent runtime configuration honestly.
