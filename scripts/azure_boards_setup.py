#!/usr/bin/env python3
"""
Azure DevOps Boards bootstrap for:
  Organization: $AZDO_ORG (your Azure DevOps organization)
  Project:      MyWork

What it does (every step is safe to re-run):
  1. Creates (or reuses) an inherited Agile process "MyWork-Workflow".
  2. Adds an "Initiative" work item type on the Features backlog level, so the
     hierarchy is Epic > Initiative > User Story > Task, makes it the default
     type there, hides the inherited Feature type, and renames the level to
     "Initiatives".
  3. Gives Epic, Initiative, User Story, Task and Bug the five requested
     states: New, In Progress, On Hold, In Review, Completed (the inherited
     Active / Resolved / Closed states are hidden).
  4. Switches the project to the process (or tells you how, if your org
     doesn't allow it through the API).
  5. Creates 12 two-week sprints from 2026-10-01 and subscribes the team.
  6. Configures backlogs (bugs managed with requirements, all levels visible)
     and the board columns for Epics, Initiatives and Stories.
  7. Seeds ~270 realistic work items (4 epics, 12 initiatives, 60 stories,
     180 tasks, 16 bugs) spread over past, current and future sprints, so
     "what am I working on this sprint?" has real answers. Seeded items are
     tagged "seed:mywork-demo" and are not created twice.

Run (macOS/Linux):
  python3 -m pip install requests
  export AZDO_ORG="your-org"
  export AZDO_PAT="..."          # or leave it unset and paste it at the prompt
  python3 scripts/azure_boards_setup.py

PowerShell:
  $env:AZDO_ORG = "your-org"
  $env:AZDO_PAT = "..."
  python .\\scripts\\azure_boards_setup.py

Preview the sprints and seed data without connecting (no PAT needed):
  python3 scripts/azure_boards_setup.py --plan

PAT scopes: Work Items (Read, write & manage), Project and Team (Read, write &
manage). Process customisation also needs you to be a Project Collection
Administrator. Never commit the PAT; this script only reads it from the
environment or a hidden prompt and never prints it.
"""

from __future__ import annotations

import argparse
import getpass
import os
import random
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Any
from urllib.parse import quote

try:
    import requests
    from requests.auth import HTTPBasicAuth
except ImportError:  # pragma: no cover - only hit when requests is missing
    requests = None  # type: ignore[assignment]

ORG = os.environ.get("AZDO_ORG", "").strip()
PROJECT = "MyWork"
PROCESS_NAME = "MyWork-Workflow"
TEAM_NAME = "MyWork Team"
SPRINT_START = date(2026, 10, 1)
SPRINT_COUNT = 12
SPRINT_LENGTH_DAYS = 14
API = "7.1"
SEED_TAG = "seed:mywork-demo"

# Microsoft Agile system process.
AGILE_PROCESS_ID = "adcc42ab-9882-485e-a3ed-7678f01f66bc"

# (name, category, color). Order is the workflow order.
REQUESTED_STATES = [
    ("New", "Proposed", "b2b2b2"),
    ("In Progress", "InProgress", "007acc"),
    ("On Hold", "InProgress", "d83b01"),
    ("In Review", "InProgress", "8764b8"),
    ("Completed", "Completed", "2e8b57"),
]
STATE_NAMES = [s[0] for s in REQUESTED_STATES]
# Inherited states never hidden: "Removed" is how items get deleted from boards.
KEEP_STATES = {"Removed"}

# (column name, column type, state)
BOARD_COLUMNS = [
    ("New", "incoming", "New"),
    ("In Progress", "inProgress", "In Progress"),
    ("On Hold", "inProgress", "On Hold"),
    ("In Review", "inProgress", "In Review"),
    ("Completed", "outgoing", "Completed"),
]
IN_PROGRESS_WIP_LIMIT = 8

# Types that get the requested states (Feature too, so any old Feature items stay valid).
STATEFUL_TYPES = ["Epic", "Feature", "Initiative", "User Story", "Task", "Bug"]
SYSTEM_TYPE_REFS = {
    "Epic": "Microsoft.VSTS.WorkItemTypes.Epic",
    "Feature": "Microsoft.VSTS.WorkItemTypes.Feature",
    "User Story": "Microsoft.VSTS.WorkItemTypes.UserStory",
    "Task": "Microsoft.VSTS.WorkItemTypes.Task",
    "Bug": "Microsoft.VSTS.WorkItemTypes.Bug",
}


def log(msg: str) -> None:
    print(msg, flush=True)


def warn(msg: str) -> None:
    print(f"  ! {msg}", flush=True)


# --------------------------------------------------------------------------
# HTTP client
# --------------------------------------------------------------------------


class AdoError(RuntimeError):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


class AzureDevOps:
    """Minimal REST client: PAT auth, api-version, retries on throttling."""

    def __init__(self, organization: str, pat: str):
        if requests is None:
            sys.exit(
                "This script needs the 'requests' package: python3 -m pip install requests"
            )
        self.base = f"https://dev.azure.com/{organization}"
        self.session = requests.Session()
        self.session.auth = HTTPBasicAuth("", pat)
        self.session.headers.update({"Accept": "application/json"})

    def request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        json: Any = None,
        content_type: str = "application/json",
        api_version: str | None = API,
        auth_errors_fatal: bool = True,
    ) -> Any:
        url = path if path.startswith("https://") else f"{self.base}/{path.lstrip('/')}"
        query = dict(params or {})
        if api_version:
            query["api-version"] = api_version
        headers = {"Content-Type": content_type} if json is not None else {}
        for attempt in range(5):
            response = self.session.request(
                method,
                url,
                params=query,
                json=json,
                headers=headers,
                timeout=60,
                allow_redirects=False,
            )
            if response.status_code in (429, 500, 502, 503, 504) and attempt < 4:
                wait = float(response.headers.get("Retry-After") or 2**attempt)
                time.sleep(min(wait, 30))
                continue
            break
        if response.status_code in (203, 302, 401) and auth_errors_fatal:
            area = (
                "Project and Team"
                if "/_apis/projects" in url or "/teamsettings" in url or "/teams/" in url
                else "Work Items"
            )
            sys.exit(
                f"Azure DevOps refused the PAT ({response.status_code}) for {method} {url}.\n"
                f"Most likely the PAT is missing the '{area}' scope (Read, write & manage). "
                "Edit the PAT under User settings > Personal access tokens, add the scope, and run again."
            )
        if not response.ok:
            try:
                detail = response.json().get("message", response.text)
            except ValueError:
                detail = response.text
            raise AdoError(
                response.status_code,
                f"{method} {url} failed ({response.status_code}): {detail}",
            )
        if response.status_code == 204 or not response.content:
            return {}
        return response.json()

    def get(self, path: str, **kw: Any) -> Any:
        return self.request("GET", path, **kw)

    def post(self, path: str, body: Any, **kw: Any) -> Any:
        return self.request("POST", path, json=body, **kw)

    def patch(self, path: str, body: Any, **kw: Any) -> Any:
        return self.request("PATCH", path, json=body, **kw)

    def put(self, path: str, body: Any, **kw: Any) -> Any:
        return self.request("PUT", path, json=body, **kw)

    def delete(self, path: str, **kw: Any) -> Any:
        return self.request("DELETE", path, **kw)


def p(segment: str) -> str:
    """URL-encode one path segment (project, team, board and type names have spaces)."""
    return quote(segment, safe="")


def try_step(description: str, fn, *args: Any, **kwargs: Any) -> Any:
    """Run an optional step; report failure but keep going."""
    try:
        return fn(*args, **kwargs)
    except AdoError as err:
        warn(f"{description} skipped: {err}")
        return None


# --------------------------------------------------------------------------
# 1–3. Process, Initiative type, states, backlog level
# --------------------------------------------------------------------------


def get_or_create_process(ado: AzureDevOps) -> dict:
    processes = ado.get("_apis/work/processes")["value"]
    existing = next(
        (x for x in processes if x["name"].lower() == PROCESS_NAME.lower()), None
    )
    if existing:
        if existing.get("parentProcessTypeId") != AGILE_PROCESS_ID:
            sys.exit(
                f"A process named {PROCESS_NAME} exists but doesn't inherit from Agile."
            )
        log(f"Process: reusing {PROCESS_NAME}")
        return existing
    created = ado.post(
        "_apis/work/processes",
        {
            "name": PROCESS_NAME,
            "parentProcessTypeId": AGILE_PROCESS_ID,
            "description": "Agile with Epic > Initiative > User Story > Task and a five-state workflow.",
        },
    )
    log(f"Process: created {PROCESS_NAME}")
    return created


def process_types(ado: AzureDevOps, process_id: str) -> list[dict]:
    return ado.get(f"_apis/work/processes/{process_id}/workitemtypes")["value"]


def get_or_derive_type(ado: AzureDevOps, process_id: str, name: str) -> dict:
    """The process's own (customisable) copy of an inherited type, creating it on first use."""
    types = process_types(ado, process_id)
    own = next(
        (
            t
            for t in types
            if t["name"] == name and t.get("customization") in ("inherited", "custom")
        ),
        None,
    )
    if own:
        return own
    parent_ref = SYSTEM_TYPE_REFS[name]
    # Deriving needs the colour (and icon) spelled out; keep the built-in type's look.
    parent = next((t for t in types if t["referenceName"] == parent_ref), {})
    return ado.post(
        f"_apis/work/processes/{process_id}/workitemtypes",
        {
            "inheritsFrom": parent_ref,
            "name": name,
            "color": parent.get("color") or "009ccc",
            "icon": parent.get("icon") or "icon_clipboard",
            "description": parent.get("description") or "",
            "isDisabled": False,
        },
    )


def get_or_create_initiative(ado: AzureDevOps, process_id: str) -> dict:
    existing = next(
        (t for t in process_types(ado, process_id) if t["name"] == "Initiative"), None
    )
    if existing:
        log("Type: reusing Initiative")
        return existing
    created = ado.post(
        f"_apis/work/processes/{process_id}/workitemtypes",
        {
            "name": "Initiative",
            "description": "A body of work that delivers part of an Epic; groups related User Stories.",
            "color": "773b93",
            "icon": "icon_crown",
            "isDisabled": False,
        },
    )
    log("Type: created Initiative")
    return created


def ensure_field(
    ado: AzureDevOps, process_id: str, wit_ref: str, field_ref: str, default: Any = None
) -> None:
    fields = ado.get(
        f"_apis/work/processes/{process_id}/workItemTypes/{wit_ref}/fields"
    )["value"]
    if any(f["referenceName"] == field_ref for f in fields):
        return
    body: dict[str, Any] = {"referenceName": field_ref, "required": False}
    if default is not None:
        body["defaultValue"] = default
    ado.post(f"_apis/work/processes/{process_id}/workItemTypes/{wit_ref}/fields", body)


CATEGORY_RANK = {"Proposed": 0, "InProgress": 1, "Resolved": 2, "Completed": 3, "Removed": 4}


def next_state_order(states: list[dict], category: str) -> int:
    """
    Azure DevOps requires states to stay in category order (Proposed, In Progress,
    Resolved, Completed), so a new state goes right after the last existing state
    of its own or an earlier category.
    """
    rank = CATEGORY_RANK[category]
    earlier = [s.get("order") or 0 for s in states if CATEGORY_RANK.get(s.get("stateCategory"), 9) <= rank]
    return max(earlier, default=0) + 1


def ensure_states(ado: AzureDevOps, process_id: str, wit: dict) -> None:
    """Add the requested states, then hide or delete every other state except Removed."""
    ref = wit["referenceName"]
    base = f"_apis/work/processes/{process_id}/workItemTypes/{ref}/states"
    for name, category, color in REQUESTED_STATES:
        # Orders shift as states are added, so re-read before each one.
        states = ado.get(base)["value"]
        if any(s["name"] == name for s in states):
            continue
        ado.post(
            base,
            {
                "name": name,
                "stateCategory": category,
                "color": color,
                "order": next_state_order(states, category),
            },
        )
    # Hide old states only after the new ones exist (each category needs a visible state).
    for state in ado.get(base)["value"]:
        if (
            state["name"] in STATE_NAMES
            or state["name"] in KEEP_STATES
            or state.get("hidden")
        ):
            continue
        if state.get("customizationType") == "custom":
            ado.delete(f"{base}/{state['id']}")
        else:
            ado.put(f"{base}/{state['id']}", {"hidden": True})
    log(f"States: {wit['name']} → {', '.join(STATE_NAMES)}")


def configure_initiative_level(
    ado: AzureDevOps, process_id: str, initiative: dict
) -> None:
    behaviors = ado.get(f"_apis/work/processes/{process_id}/behaviors")["value"]
    feature_level = next(
        (b for b in behaviors if b["name"] in ("Features", "Initiatives")), None
    )
    if not feature_level:
        sys.exit("Couldn't find the Features backlog level in the process.")
    level_ref = feature_level["referenceName"]

    assoc_url = f"_apis/work/processes/{process_id}/workitemtypesbehaviors/{initiative['referenceName']}/behaviors"
    current = ado.get(assoc_url).get("value", [])
    if not any(b["behavior"]["id"] == level_ref for b in current):
        ado.post(assoc_url, {"behavior": {"id": level_ref}, "isDefault": True})
        log("Backlog: Initiative added to the Features level as the default type")
    else:
        try_step(
            "Making Initiative the default type",
            ado.patch,
            assoc_url,
            {"behavior": {"id": level_ref}, "isDefault": True},
        )

    if feature_level["name"] != "Initiatives":
        renamed = try_step(
            "Renaming the Features level to Initiatives",
            ado.put,
            f"_apis/work/processes/{process_id}/behaviors/{level_ref}",
            {"name": "Initiatives", "color": "773b93"},
        )
        if renamed:
            log("Backlog: Features level renamed to Initiatives")
        else:
            warn(
                "Rename it in Organization settings > Process > MyWork-Workflow > Backlog levels."
            )

    # Hide the inherited Feature type so Initiative is the only type on that level.
    feature = try_step(
        "Customising Feature", get_or_derive_type, ado, process_id, "Feature"
    )
    if feature and not feature.get("isDisabled"):
        if try_step(
            "Hiding Feature",
            ado.patch,
            f"_apis/work/processes/{process_id}/workitemtypes/{feature['referenceName']}",
            {"isDisabled": True},
        ):
            log("Type: Feature hidden")


def setup_process(ado: AzureDevOps) -> dict:
    process = get_or_create_process(ado)
    process_id = process["typeId"]
    initiative = get_or_create_initiative(ado, process_id)
    for ref in ("Microsoft.VSTS.Common.Priority",):
        try_step(
            "Adding Priority to Initiative",
            ensure_field,
            ado,
            process_id,
            initiative["referenceName"],
            ref,
            2,
        )
    configure_initiative_level(ado, process_id, initiative)
    for name in STATEFUL_TYPES:
        wit = (
            initiative
            if name == "Initiative"
            else get_or_derive_type(ado, process_id, name)
        )
        ensure_states(ado, process_id, wit)
    return process


# --------------------------------------------------------------------------
# 4. Project on the process
# --------------------------------------------------------------------------


def project_process_id(ado: AzureDevOps, project_id: str) -> str | None:
    props = ado.get(
        f"_apis/projects/{project_id}/properties",
        params={"keys": "System.ProcessTemplateType"},
        api_version="7.1-preview.1",
    )["value"]
    return next(
        (x["value"] for x in props if x["name"] == "System.ProcessTemplateType"), None
    )


def project_uses_process(ado: AzureDevOps, project: dict, process: dict) -> bool:
    """Checked two ways, since the project property and the process's project list can lag differently."""
    if (project_process_id(ado, project["id"]) or "").lower() == process["typeId"].lower():
        return True
    detail = ado.get(f"_apis/work/processes/{process['typeId']}", params={"$expand": "projects"})
    return any(p_["id"] == project["id"] for p_ in detail.get("projects") or [])


def wait_for_operation(ado: AzureDevOps, operation: dict, timeout_s: int = 180) -> None:
    url = operation.get("url")
    deadline = time.time() + timeout_s
    while url and time.time() < deadline:
        status = ado.get(url, api_version=None).get("status")
        if status in ("succeeded", "failed", "cancelled"):
            if status != "succeeded":
                raise AdoError(500, f"Process change {status}")
            return
        time.sleep(2)


def ensure_project_on_process(ado: AzureDevOps, process: dict) -> bool:
    project = ado.get(f"_apis/projects/{p(PROJECT)}")
    if project_uses_process(ado, project, process):
        log(f"Project: {PROJECT} already uses {PROCESS_NAME}")
        return True
    op = try_step(
        "Switching the project's process through the API",
        ado.patch,
        f"_apis/projects/{project['id']}",
        {"capabilities": {"processTemplate": {"templateTypeId": process["typeId"]}}},
        # Many organisations only allow this in the UI; fall back to instructions.
        auth_errors_fatal=False,
    )
    if op:
        try_step("Waiting for the process change", wait_for_operation, ado, op)
        if project_uses_process(ado, project, process):
            log(f"Project: switched {PROJECT} to {PROCESS_NAME}")
            return True
    current_id = project_process_id(ado, project["id"]) or ""
    processes = ado.get("_apis/work/processes")["value"]
    current = next((x for x in processes if x["typeId"].lower() == current_id.lower()), None)
    current_name = current["name"] if current else "an unknown process"
    log(f"\n{PROJECT} currently uses the {current_name} process.")
    if current_name == "Basic":
        log(
            "Azure DevOps can move a Basic project onto an Agile-based process, but only in the UI:\n"
            f"  Organization settings > Boards > Process > Basic > Projects tab\n"
            f"  > '...' next to {PROJECT} > Change process > {PROCESS_NAME} > Save\n"
            "Then run this script again."
        )
    elif current and current.get("parentProcessTypeId") == AGILE_PROCESS_ID or current_name == "Agile":
        log(
            "Switch it once in the UI, then run this script again:\n"
            f"  Organization settings > Boards > Process > {current_name} > Projects tab\n"
            f"  > '...' next to {PROJECT} > Change process > {PROCESS_NAME} > Save"
        )
    else:
        log(
            f"Azure DevOps can't move a {current_name} project onto an Agile-based process.\n"
            f"Create a new project on {PROCESS_NAME} instead (Organization settings > Projects >\n"
            f"New project > Advanced > Work item process: {PROCESS_NAME}), then set PROJECT and\n"
            "TEAM_NAME at the top of this script to it and run again."
        )
    return False


# --------------------------------------------------------------------------
# 5. Sprints and team settings
# --------------------------------------------------------------------------


@dataclass
class Sprint:
    number: int
    start: date
    finish: date

    @property
    def name(self) -> str:
        return f"Sprint {self.number}"

    @property
    def path(self) -> str:
        return f"{PROJECT}\\{self.name}"


def sprint_calendar(
    start: date = SPRINT_START, count: int = SPRINT_COUNT
) -> list[Sprint]:
    return [
        Sprint(
            i + 1,
            start + timedelta(days=i * SPRINT_LENGTH_DAYS),
            start + timedelta(days=i * SPRINT_LENGTH_DAYS + SPRINT_LENGTH_DAYS - 1),
        )
        for i in range(count)
    ]


def current_sprint_number(sprints: list[Sprint], today: date) -> int:
    for s in sprints:
        if s.start <= today <= s.finish:
            return s.number
    return 1 if today < sprints[0].start else sprints[-1].number


def ensure_sprints(ado: AzureDevOps, sprints: list[Sprint]) -> None:
    base = f"{p(PROJECT)}/_apis/wit/classificationnodes/Iterations"
    team = f"{p(PROJECT)}/{p(TEAM_NAME)}/_apis/work/teamsettings"
    root = ado.get(base, params={"$depth": 1})
    existing = {c["name"]: c for c in root.get("children", [])}
    subscribed = {
        i["path"].split("\\")[-1]: i for i in ado.get(f"{team}/iterations")["value"]
    }
    wanted = {s.name for s in sprints}

    for s in sprints:
        attributes = {
            "startDate": f"{s.start.isoformat()}T00:00:00Z",
            "finishDate": f"{s.finish.isoformat()}T00:00:00Z",
        }
        node = existing.get(s.name)
        if node:
            node = ado.patch(f"{base}/{p(s.name)}", {"attributes": attributes})
        else:
            node = ado.post(base, {"name": s.name, "attributes": attributes})
        if s.name not in subscribed:
            ado.post(f"{team}/iterations", {"id": node["identifier"]})
    # The project template's undated "Iteration 1..3" would confuse "current sprint".
    for name, it in subscribed.items():
        if name not in wanted and not (it.get("attributes") or {}).get("startDate"):
            try_step(
                f"Unsubscribing the team from {name}",
                ado.delete,
                f"{team}/iterations/{it['id']}",
            )
    log(
        f"Sprints: {sprints[0].name}–{sprints[-1].name} ({sprints[0].start} to {sprints[-1].finish}), team subscribed"
    )

    ado.patch(
        team,
        {
            "backlogIteration": root["identifier"],
            "defaultIterationMacro": "@currentIteration",
            "bugsBehavior": "asRequirements",
            "backlogVisibilities": {
                "Microsoft.EpicCategory": True,
                "Microsoft.FeatureCategory": True,
                "Microsoft.RequirementCategory": True,
            },
            "workingDays": ["monday", "tuesday", "wednesday", "thursday", "friday"],
        },
    )
    log(
        "Team: backlog = project root, new items default to the current sprint, bugs on the Stories backlog"
    )


# --------------------------------------------------------------------------
# 6. Board columns
# --------------------------------------------------------------------------


def configure_boards(ado: AzureDevOps) -> None:
    base = f"{p(PROJECT)}/{p(TEAM_NAME)}/_apis/work/boards"
    for board in ado.get(base)["value"]:
        url = f"{base}/{p(board['id'])}/columns"
        columns = ado.get(url)["value"]
        types = sorted({t for c in columns for t in (c.get("stateMappings") or {})})
        if not types:
            continue
        incoming = next((c for c in columns if c["columnType"] == "incoming"), None)
        outgoing = next((c for c in columns if c["columnType"] == "outgoing"), None)
        by_name = {c["name"]: c for c in columns}
        body = []
        for name, column_type, state in BOARD_COLUMNS:
            existing = (
                incoming
                if column_type == "incoming"
                else outgoing
                if column_type == "outgoing"
                else by_name.get(name)
            )
            column = {
                "name": name,
                "columnType": column_type,
                "itemLimit": IN_PROGRESS_WIP_LIMIT
                if column_type == "inProgress"
                else 0,
                "isSplit": False,
                "stateMappings": {t: state for t in types},
            }
            if existing and existing.get("columnType") == column_type:
                column["id"] = existing["id"]
            body.append(column)
        if (
            try_step(f"Board columns for {board['name']}", ado.put, url, body)
            is not None
        ):
            log(
                f"Board: {board['name']} columns → {' | '.join(c[0] for c in BOARD_COLUMNS)} ({', '.join(types)})"
            )


# --------------------------------------------------------------------------
# 7. Seed work items
# --------------------------------------------------------------------------

PORTFOLIO = [
    (
        "Customer Portal v2",
        "frontend",
        [
            (
                "Secure sign-in and identity",
                [
                    "Sign in with Microsoft Entra ID",
                    "Remember me and session refresh",
                    "Multi-factor authentication prompt",
                    "Account lockout after failed attempts",
                    "Self-service password reset",
                ],
            ),
            (
                "Self-service billing",
                [
                    "View and download invoices",
                    "Update payment method",
                    "Export billing history to CSV",
                    "Plan upgrade and downgrade flow",
                    "Show tax details on invoices",
                ],
            ),
            (
                "Notifications center",
                [
                    "In-app notification inbox",
                    "Email digest preferences",
                    "Mark all notifications as read",
                    "Real-time notification badge",
                    "Notification retention policy",
                ],
            ),
        ],
    ),
    (
        "Platform Reliability",
        "backend",
        [
            (
                "Observability and alerting",
                [
                    "Structured logging for API services",
                    "Distributed tracing across services",
                    "Alert on error-rate spikes",
                    "Service health dashboard",
                    "On-call runbooks in the wiki",
                ],
            ),
            (
                "API performance",
                [
                    "Cache product catalog responses",
                    "Fix slow order lookup query",
                    "Rate limiting for the public API",
                    "Connection pooling for the database",
                    "Load test the checkout flow",
                ],
            ),
            (
                "Disaster recovery",
                [
                    "Automated nightly backups",
                    "Restore drill for the primary database",
                    "Multi-region failover plan",
                    "Encrypt backups at rest",
                    "Recovery time objective report",
                ],
            ),
        ],
    ),
    (
        "Mobile App Launch",
        "mobile",
        [
            (
                "Offline mode",
                [
                    "Cache recent orders for offline use",
                    "Queue actions while offline",
                    "Sync conflict resolution",
                    "Offline indicator banner",
                    "Background sync on reconnect",
                ],
            ),
            (
                "Push notifications",
                [
                    "Register devices for push",
                    "Order shipped push notification",
                    "Quiet hours setting",
                    "Deep links from notifications",
                    "Push delivery analytics",
                ],
            ),
            (
                "App store release",
                [
                    "App store screenshots and listing",
                    "Crash reporting integration",
                    "Beta testing with TestFlight",
                    "Privacy nutrition labels",
                    "Release checklist automation",
                ],
            ),
        ],
    ),
    (
        "Data and Analytics",
        "data",
        [
            (
                "Usage analytics pipeline",
                [
                    "Ingest product events into the data lake",
                    "Daily active users metric",
                    "Event schema validation",
                    "Backfill historical events",
                    "Pipeline failure alerts",
                ],
            ),
            (
                "Executive dashboards",
                [
                    "Revenue by region dashboard",
                    "Weekly KPI email report",
                    "Churn trend chart",
                    "Dashboard access controls",
                    "Drill-down into customer segments",
                ],
            ),
            (
                "Data governance",
                [
                    "Classify personal data fields",
                    "Automate data retention",
                    "Access request workflow",
                    "Audit log for data exports",
                    "Handle GDPR deletion requests",
                ],
            ),
        ],
    ),
]

TASK_TEMPLATES = [
    "Design the approach for {}",
    "Implement {}",
    "Write automated tests for {}",
    "Review and fix feedback on {}",
    "Document {}",
]

# (title, initiative index)
BUGS = [
    ("Login fails when the email has uppercase letters", 0),
    ("Session expires during checkout", 0),
    ("Invoice PDF shows the wrong currency symbol", 1),
    ("Payment form accepts expired cards", 1),
    ("Notification badge count never resets", 2),
    ("Trace IDs missing from error logs", 3),
    ("Order lookup times out under load", 4),
    ("Rate limiter blocks internal health checks", 4),
    ("Backup job silently skips large tables", 5),
    ("Offline queue loses edits after app restart", 6),
    ("Duplicate push notifications on Android", 7),
    ("Crash on launch on older iOS devices", 8),
    ("Daily active users double-counts web sessions", 9),
    ("Revenue dashboard ignores refunds", 10),
    ("Dashboard filters reset on refresh", 10),
    ("Export includes deleted customers", 11),
]

# Story state in the current sprint, by position; and the task states for each story state.
CURRENT_STORY_STATES = [
    "In Progress",
    "In Progress",
    "In Review",
    "On Hold",
    "New",
    "Completed",
]
TASK_STATES_FOR = {
    "Completed": ["Completed", "Completed", "Completed"],
    "In Progress": ["Completed", "In Progress", "New"],
    "In Review": ["Completed", "Completed", "In Review"],
    "On Hold": ["Completed", "On Hold", "New"],
    "New": ["New", "New", "New"],
}


@dataclass
class SeedItem:
    key: str
    type: str
    title: str
    state: str = "New"
    parent: str | None = None
    sprint: int | None = None
    mine: bool = True
    priority: int = 2
    tags: list[str] = field(default_factory=list)
    description: str = ""
    story_points: int | None = None
    estimate_hours: int | None = None
    level: int = 0


def roll_up(states: list[str]) -> str:
    if states and all(s == "Completed" for s in states):
        return "Completed"
    return "In Progress" if any(s != "New" for s in states) else "New"


def build_seed_plan(
    today: date, sprints: list[Sprint], stories_per_initiative: int = 5
) -> list[SeedItem]:
    """The work items to create, parents before children. Pure: no network."""
    rnd = random.Random(2026)
    current = current_sprint_number(sprints, today)
    items: list[SeedItem] = []

    # Spread stories round-robin across initiatives, six per sprint for the first eight sprints;
    # the rest stay on the backlog for planning.
    initiatives = [
        (e, i) for e in range(len(PORTFOLIO)) for i in range(len(PORTFOLIO[e][2]))
    ]
    order = [(e, i, s) for s in range(stories_per_initiative) for (e, i) in initiatives]
    planned_sprints = min(8, len(sprints))
    story_sprint = {
        key: (k // 6 + 1 if k < planned_sprints * 6 else None)
        for k, key in enumerate(order)
    }

    stories: dict[tuple[int, int], list[SeedItem]] = {}
    tasks: list[SeedItem] = []
    for k, (e, i, s) in enumerate(order):
        _, tag, inits = PORTFOLIO[e]
        title = inits[i][1][s % len(inits[i][1])]
        sprint = story_sprint[(e, i, s)]
        if sprint is None or sprint > current:
            state = "New"
        elif sprint < current:
            state = "In Review" if k % 6 == 5 and sprint == current - 1 else "Completed"
        else:
            state = CURRENT_STORY_STATES[(k % 6)]
        story = SeedItem(
            key=f"story-{e}-{i}-{s}",
            type="User Story",
            title=title,
            state=state,
            parent=f"init-{e}-{i}",
            sprint=sprint,
            mine=sprint is not None and sprint <= current + 1,
            priority=rnd.choice([1, 2, 2, 3, 3, 4]),
            tags=[tag],
            description=f"<p>As a customer, I want {title[0].lower() + title[1:]} so that the product is easier and safer to use.</p>"
            "<p><b>Acceptance criteria</b></p><ul><li>Works on web and mobile</li><li>Covered by automated tests</li></ul>",
            story_points=rnd.choice([1, 2, 3, 5, 5, 8]),
            level=2,
        )
        stories.setdefault((e, i), []).append(story)
        templates = rnd.sample(TASK_TEMPLATES, 3)
        for t, (template, task_state) in enumerate(
            zip(templates, TASK_STATES_FOR[state])
        ):
            hours = rnd.choice([2, 4, 4, 6, 8])
            tasks.append(
                SeedItem(
                    key=f"task-{e}-{i}-{s}-{t}",
                    type="Task",
                    title=template.format(title[0].lower() + title[1:]),
                    state=task_state,
                    parent=story.key,
                    sprint=sprint,
                    mine=story.mine,
                    priority=story.priority,
                    tags=[tag],
                    estimate_hours=hours,
                    level=3,
                )
            )

    for e, (epic_title, tag, inits) in enumerate(PORTFOLIO):
        init_items = []
        for i, (init_title, _) in enumerate(inits):
            init_items.append(
                SeedItem(
                    key=f"init-{e}-{i}",
                    type="Initiative",
                    title=init_title,
                    state=roll_up([s.state for s in stories[(e, i)]]),
                    parent=f"epic-{e}",
                    priority=1 + (i % 3),
                    tags=[tag],
                    description=f"<p>{init_title}: part of the {epic_title} epic.</p>",
                    level=1,
                )
            )
        items.append(
            SeedItem(
                key=f"epic-{e}",
                type="Epic",
                title=epic_title,
                state=roll_up([x.state for x in init_items]),
                priority=1 + (e % 2),
                tags=[tag],
                description=f"<p>{epic_title}: a major investment area for the year.</p>",
            )
        )
        items.extend(init_items)

    for list_ in stories.values():
        items.extend(list_)
    items.extend(tasks)

    # Bugs sit with the stories (bugs are managed with requirements), under an initiative.
    for b, (title, flat_init) in enumerate(BUGS):
        e, i = initiatives[flat_init]
        if b % 3 == 1 and current > 1:
            sprint, state = current - 1, "Completed"
        elif b % 3 == 0:
            sprint, state = current, ["In Progress", "New", "In Review"][(b // 3) % 3]
        else:
            sprint, state = None, "New"
        items.append(
            SeedItem(
                key=f"bug-{b}",
                type="Bug",
                title=title,
                state=state,
                parent=f"init-{e}-{i}",
                sprint=sprint,
                mine=sprint is not None,
                priority=1 if b % 4 == 0 else 2,
                tags=[PORTFOLIO[e][1]],
                description="<p><b>Repro</b>: see the title.</p><p><b>Expected</b>: works correctly.</p>",
                story_points=rnd.choice([1, 2, 3]),
                level=2,
            )
        )
    for item in items:
        item.tags.append(SEED_TAG)
    return items


def describe_plan(items: list[SeedItem], sprints: list[Sprint], today: date) -> None:
    current = current_sprint_number(sprints, today)
    log("Sprints:")
    for s in sprints:
        marker = "  ← current" if s.number == current else ""
        log(f"  {s.name}: {s.start} to {s.finish}{marker}")
    by_type: dict[str, int] = {}
    for it in items:
        by_type[it.type] = by_type.get(it.type, 0) + 1
    log(
        f"\nSeed items: {len(items)} ({', '.join(f'{n} {t}' for t, n in by_type.items())})"
    )
    for s in sorted({it.sprint for it in items if it.sprint is not None}):
        in_sprint = [it for it in items if it.sprint == s]
        states: dict[str, int] = {}
        for it in in_sprint:
            states[it.state] = states.get(it.state, 0) + 1
        log(
            f"  Sprint {s}: {len(in_sprint)} items ({', '.join(f'{n} {st}' for st, n in states.items())})"
        )
    log(f"  Backlog: {sum(1 for it in items if it.sprint is None)} items")


def existing_seed_ids(ado: AzureDevOps) -> list[int]:
    wiql = (
        "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project "
        f"AND [System.Tags] CONTAINS '{SEED_TAG}'"
    )
    return [
        w["id"]
        for w in ado.post(f"{p(PROJECT)}/_apis/wit/wiql", {"query": wiql})["workItems"]
    ]


def create_item(
    ado: AzureDevOps, item: SeedItem, parent_id: int | None, me: str
) -> int:
    ops: list[dict[str, Any]] = [
        {"op": "add", "path": "/fields/System.Title", "value": item.title},
        {"op": "add", "path": "/fields/System.Tags", "value": "; ".join(item.tags)},
        {
            "op": "add",
            "path": "/fields/System.IterationPath",
            "value": f"{PROJECT}\\Sprint {item.sprint}" if item.sprint else PROJECT,
        },
        {
            "op": "add",
            "path": "/fields/Microsoft.VSTS.Common.Priority",
            "value": item.priority,
        },
    ]
    if item.description:
        ops.append(
            {
                "op": "add",
                "path": "/fields/System.Description",
                "value": item.description,
            }
        )
    if item.mine:
        ops.append({"op": "add", "path": "/fields/System.AssignedTo", "value": me})
    if item.story_points is not None:
        ops.append(
            {
                "op": "add",
                "path": "/fields/Microsoft.VSTS.Scheduling.StoryPoints",
                "value": item.story_points,
            }
        )
    if item.estimate_hours is not None:
        done = item.state == "Completed"
        ops += [
            {
                "op": "add",
                "path": "/fields/Microsoft.VSTS.Scheduling.OriginalEstimate",
                "value": item.estimate_hours,
            },
            {
                "op": "add",
                "path": "/fields/Microsoft.VSTS.Scheduling.RemainingWork",
                "value": 0 if done else item.estimate_hours,
            },
            {
                "op": "add",
                "path": "/fields/Microsoft.VSTS.Scheduling.CompletedWork",
                "value": item.estimate_hours if done else 0,
            },
        ]
    if parent_id:
        ops.append(
            {
                "op": "add",
                "path": "/relations/-",
                "value": {
                    "rel": "System.LinkTypes.Hierarchy-Reverse",
                    "url": f"{ado.base}/_apis/wit/workItems/{parent_id}",
                },
            }
        )
    url = f"{p(PROJECT)}/_apis/wit/workitems/${p(item.type)}"
    try:
        created = ado.post(url, ops, content_type="application/json-patch+json")
    except AdoError as err:
        # Priority isn't on every custom type; retry without it rather than fail the whole seed.
        if "Priority" not in str(err):
            raise
        ops = [o for o in ops if "Priority" not in o["path"]]
        created = ado.post(url, ops, content_type="application/json-patch+json")
    if item.state != "New":
        ado.patch(
            f"{p(PROJECT)}/_apis/wit/workitems/{created['id']}",
            [{"op": "add", "path": "/fields/System.State", "value": item.state}],
            content_type="application/json-patch+json",
        )
    return created["id"]


def seed_work_items(
    ado: AzureDevOps, plan: list[SeedItem], reseed: bool, workers: int
) -> None:
    existing = existing_seed_ids(ado)
    if existing and not reseed:
        log(
            f"Seed: {len(existing)} seeded items already exist; skipping (use --reseed to recreate them)"
        )
        return
    if existing:
        log(f"Seed: moving {len(existing)} old seeded items to the recycle bin")
        with ThreadPoolExecutor(workers) as pool:
            list(
                pool.map(
                    lambda i: ado.delete(f"{p(PROJECT)}/_apis/wit/workitems/{i}"),
                    existing,
                )
            )

    me_data = ado.get("_apis/connectionData", api_version=None)["authenticatedUser"]
    me = (me_data.get("properties", {}).get("Account", {}) or {}).get(
        "$value"
    ) or me_data["providerDisplayName"]
    ids: dict[str, int] = {}
    started = time.time()
    # Level by level, so every parent exists before its children; items within a level in parallel.
    for level in sorted({it.level for it in plan}):
        batch = [it for it in plan if it.level == level]
        with ThreadPoolExecutor(workers) as pool:
            results = list(
                pool.map(
                    lambda it: create_item(
                        ado, it, ids.get(it.parent) if it.parent else None, me
                    ),
                    batch,
                )
            )
        for it, new_id in zip(batch, results):
            ids[it.key] = new_id
        log(
            f"Seed: created {len(batch)} {'/'.join(sorted({it.type for it in batch}))} items"
        )
    log(
        f"Seed: {len(ids)} work items in {time.time() - started:.0f}s, assigned to {me_data['providerDisplayName']}"
    )


# --------------------------------------------------------------------------


def read_pat() -> str:
    pat = os.environ.get("AZDO_PAT", "").strip()
    if not pat and sys.stdin.isatty():
        pat = getpass.getpass("Azure DevOps PAT (input hidden): ").strip()
    if not pat:
        sys.exit("Set AZDO_PAT or run interactively to enter the PAT.")
    return pat


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "--plan",
        action="store_true",
        help="Print the sprint calendar and seed plan; don't connect.",
    )
    parser.add_argument(
        "--today",
        type=date.fromisoformat,
        default=date.today(),
        help="Treat this date as today (YYYY-MM-DD).",
    )
    parser.add_argument(
        "--skip-process",
        action="store_true",
        help="Don't touch the process or work item types.",
    )
    parser.add_argument(
        "--skip-boards", action="store_true", help="Don't change board columns."
    )
    parser.add_argument(
        "--skip-seed", action="store_true", help="Don't create work items."
    )
    parser.add_argument(
        "--reseed",
        action="store_true",
        help="Recycle previously seeded items and create them again.",
    )
    parser.add_argument(
        "--stories-per-initiative",
        type=int,
        default=5,
        choices=range(1, 6),
        metavar="1-5",
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=6,
        help="Parallel requests while seeding (default 6).",
    )
    args = parser.parse_args()

    sprints = sprint_calendar()
    plan = build_seed_plan(args.today, sprints, args.stories_per_initiative)
    if args.plan:
        describe_plan(plan, sprints, args.today)
        return

    if not ORG:
        sys.exit("Set AZDO_ORG to your Azure DevOps organization name.")
    ado = AzureDevOps(ORG, read_pat())
    log(f"Azure DevOps: {ORG}/{PROJECT}, team {TEAM_NAME}\n")

    process = None if args.skip_process else setup_process(ado)
    if process and not ensure_project_on_process(ado, process):
        return
    ensure_sprints(ado, sprints)
    if not args.skip_boards:
        configure_boards(ado)
    if not args.skip_seed:
        seed_work_items(ado, plan, args.reseed, max(1, min(args.workers, 10)))

    log(
        "\nDone. To use it from the voice app, put this in .env.local:\n"
        "  BOARD_PROVIDER=azure\n"
        f"  AZURE_DEVOPS_ORG={ORG}\n"
        f"  AZURE_DEVOPS_PROJECT={PROJECT}\n"
        f"  AZURE_DEVOPS_TEAM={TEAM_NAME}\n"
        "  AZURE_DEVOPS_PAT=<a PAT with Work Items read & write>   (or wire up Entra ID in src/lib/devops/azure/auth.ts)"
    )


if __name__ == "__main__":
    main()
