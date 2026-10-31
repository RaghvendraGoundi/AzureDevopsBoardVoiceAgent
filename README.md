# DevOps Voice

Voice-first assistant for an Azure DevOps–style board (POC). Talk to it to list, create and update work items. Every write needs your confirmation.

## Run

```bash
npm install
cp .env.example .env.local   # add OPENAI_API_KEY, or set VOICE_PROVIDER=azure and fill the AZURE_* vars
npm run dev                  # http://localhost:3000/voice
```

You don't need a key for **Simulate demo**. It scripts the speech but calls the real tools and board.

| Script | |
|---|---|
| `npm test` | Unit tests (board rules, tools, confirmation lifecycle, UI reducer) |
| `npm run board:reset` | Reseed the emulated board (`.data/board.json`) |
| `npm run voice:audio -- --all` | Generate clips for the voice end-to-end tests ([scripts/voice-test](scripts/voice-test/README.md)) |

## How it fits together

- **Browser:** `RealtimeClient` uses raw WebRTC to talk to OpenAI or Azure Realtime with a short-lived secret from `POST /api/voice/session`. Permanent keys stay on the server.
- **Tool calls:** the model's function calls go to `POST /api/voice/tools`. The server zod-validates them and runs them against `WorkItemRepository`.
- **Writes:** these happen in two steps. `propose_*` returns a preview and an `action_id`. Only `confirm_action` with an unexpired, single-use id writes, and it refuses if the item changed since the preview.
- **UI updates:** tool responses carry `uiEvents`, which feed `workspaceReducer` to update the live workspace.
- **Boards:** `getBoardFor()` (`src/lib/devops/boardFactory.ts`) returns the emulator (`BOARD_PROVIDER=emulated`) or Azure DevOps as the signed-in user (`BOARD_PROVIDER=azure`). The tools only see `WorkItemRepository`.

## Azure DevOps

1. Set `BOARD_PROVIDER=azure`, `AZURE_DEVOPS_ORG` and `AZURE_DEVOPS_PROJECT` (and `AZURE_DEVOPS_TEAM` if it isn't "<project> Team").
2. Plug your Entra ID sign-in into `getAzureDevOpsCredential()` in `src/lib/devops/azure/auth.ts`. Return the user's delegated token for scope `499b84ac-1321-427f-aa17-267ca6abc798/.default` and a stable user id from your verified session. For a quick local check, set `AZURE_DEVOPS_PAT` instead.

**What the tools understand.** The process (Agile, Scrum, Basic, CMMI or custom) is read from the project at session start. "Story", "done", "in progress", "next sprint" and teammates' first names are mapped to that project's own types, states, sprints and people. New items go in the right sprint and under a parent: tasks follow their story's sprint, and portfolio items stay on the backlog. If a parent is missing, the agent asks which item to put it under.

**Latency.** Starting a session loads the project context (6 requests in parallel) and the user's current sprint work while the call connects. Both are cached per user: the context for 15 minutes, lists for 60 seconds, and items for 30 seconds. Each write clears what it changed. A list takes 2 to 3 requests. A create or update is one JSON Patch request, with a revision check so a stale preview can't overwrite someone else's change. Timings are logged as `[ado] …` and `[tool] …`.

### Set up and fill a test board

`scripts/azure_boards_setup.py` prepares the `your-org/MyWork` project for testing. It sets up Epic > Initiative > User Story > Task with the states New, In Progress, On Hold, In Review and Completed, 12 two-week sprints from 2026-10-01, backlogs and board columns. It then seeds about 270 work items across past, current and future sprints. It's safe to re-run.

```bash
python3 -m pip install requests
python3 scripts/azure_boards_setup.py --plan   # preview sprints and seed data, no connection
export AZDO_PAT=...                            # or leave unset to be prompted (input hidden)
python3 scripts/azure_boards_setup.py
```

If your organisation doesn't allow switching a project's process through the API, the script prints the UI steps. Run it again after switching. `--reseed` moves the seeded items (tagged `seed:mywork-demo`) to the recycle bin and creates them again.

