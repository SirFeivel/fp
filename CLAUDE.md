# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

FloorPlanner (fp) is a browser-based tile layout planning tool built with Vite. It visualizes rooms with tile patterns, calculates material requirements, and supports complex room shapes through composite sections. The UI is bilingual (German/English).

## Commands

- `npm run dev` - Start development server
- `npm run build` - Production build to `dist/`
- `npm run test` - Run all tests once
- `npm run test:watch` - Run tests in watch mode
- `npm run test:ui` - Run tests with Vitest UI

## Architecture

### State Management
- **state.js** - Central state store with undo/redo, session persistence (localStorage), and project save/load. State is normalized on load, including migration from v1 to v2 schema.
- **core.js** - Default state factory, utility functions (`uuid`, `deepClone`, `getCurrentRoom`, `getCurrentFloor`), and localStorage keys.

### Geometry Pipeline
- **geometry.js** - Core geometry operations using `polygon-clipping` library:
  - `roomPolygon()` - Builds room shape from sections
  - `computeAvailableArea()` - Subtracts exclusions from room
  - `tilesForPreview()` - Generates clipped tile polygons for rendering
  - Pattern-specific tile generators: `tilesForPreviewHerringbone`, `tilesForPreviewHex`, `tilesForPreviewBasketweave`, etc.
- **composite.js** - Handles composite room shapes (L/T/U) via multiple rectangular sections. `getRoomSections()` returns section list from room.

### Calculation
- **calc.js** - `computePlanMetrics()` calculates tile counts, waste, pricing. Contains `OffcutPool` class for tracking reusable tile remnants with guillotine cutting.

### Rendering
- **render.js** - All DOM rendering functions (`renderPlanSvg`, `renderMetrics`, `renderWarnings`, etc.). SVG rendering uses helper `svgEl()` from geometry.js.

### Controllers
- **exclusions.js** - CRUD for exclusion shapes (rect, circle, triangle)
- **sections.js** - CRUD for room sections
- **structure.js** - Floor/room hierarchy management
- **drag.js** - SVG drag controller for moving exclusions

### UI
- **main.js** - Application entry point, wires controllers, event handlers
- **ui.js** - Binds form inputs to state
- **i18n.js** - Translation system with `t(key)` function

## Data Model

State contains:
- `floors[]` - Array of floors, each with `rooms[]`
- `selectedFloorId`, `selectedRoomId` - Current selection
- Each room has: `widthCm`, `heightCm`, `exclusions[]`, `tile`, `grout`, `pattern`, optional `sections[]`
- `pattern.type`: "grid", "runningBond", "herringbone", "doubleHerringbone", "basketweave", "verticalStackAlternating"
- `tile.shape`: "rect" or "hex"

## Key Patterns

- All state changes go through `store.commit(label, nextState)` for undo support
- Validation runs via `validateState()` before rendering
- Tile placement uses polygon clipping to handle complex room shapes and exclusions
- Dimensions are in centimeters throughout

## Rulebook

**MANDATORY. BLOCKING. NON-NEGOTIABLE.** Every rule in this section applies at all times — during planning, execution, review, after context compression, in new sessions, and in every mode. No rule may be skipped, downgraded, or worked around. A violation means stopping immediately, reverting, and fixing before continuing. If you are unsure whether an action violates a rule: it does. Ask the user.

### Change Protocol (BLOCKING — governs all code modifications)

**One change at a time.** Never batch multiple logical changes into a single pass. Each change is: one edit (or a small cohesive group of edits to one function/behavior) → run tests → verify → only then proceed.

**Test after every change.** Run `npm run test` after every edit to a source file. If tests fail, fix the failure before making the next change. Do not accumulate edits and test at the end. Do not present code with failing tests.

**Load real data when provided.** If the user provides a state file, load and inspect it before writing any code. Understand the actual problem from actual data first. Do not reason about fixes in the abstract when concrete data is available.

**Plans are hypotheses, not scripts.** A confirmed plan is a direction, not a checklist to execute blindly. Each step must be validated against reality (tests, real data, blast radius analysis). If a step produces unexpected results, stop and reassess — do not push through to the next step.

**Trace consequences before editing.** Before modifying a shared function, identify every caller. Predict which tests will break and why. Write down the expected wall counts / outcomes. If you cannot predict the consequences, you do not understand the change well enough to make it.

**Never present unverified results.** Before reporting a task as complete: all tests pass, real-world data (if provided) produces correct results, and the specific success criteria from the plan are confirmed with exact values. "Should work" is not verification.

**Include meaningful logging in every plan.** Every plan must include `console.log` instrumentation as part of the implementation — not as an afterthought. Each new function, pipeline step, and decision point must log its inputs, decisions, and outputs. Logging is a first-class deliverable: it is how the user verifies that the code does what it claims. Prefix all log lines with a bracketed module tag (e.g. `[envelope]`, `[walls]`) for easy filtering. Remove debug logging only when the user confirms the feature works correctly.

### Plan Scorecard (BLOCKING — every plan must include this)

Before presenting any plan, score it honestly on these five dimensions (0–10). Display the scorecard in a table. **Threshold is 7 on every score.** If any score is below 7, do not present the plan — iterate on the weak areas or discuss with the user first.

| Score | Meaning |
|---|---|
| **Hacky** (0 = duct tape, 10 = clean) | Does this solve the problem properly or is it a workaround? |
| **Compliance** (0 = violates everything, 10 = textbook) | Do the proposed changes respect the project architecture, rulebook, and best practices? |
| **Complexity** (0 = extremely complex, 10 = minimal) | Is this the simplest solution that works? Could it be simpler? |
| **Problem Understanding** (0 = guessing, 10 = fully mapped) | Have I read the real data, traced all callers, identified root cause, and understood every consequence? |
| **Confidence** (0 = hope, 10 = certain) | How sure am I this will work end-to-end without surprises? Based on evidence, not optimism. |

**Rules:**
- **Every score starts at 0.** You must work your way up by earning each point with a concrete, specific justification. No score may be stated without the reasoning that produced it.
- **Iterative scoring is mandatory.** Score after each phase of research. If a score is below 7, stop and do more work — read more code, trace more callers, load real data — before rescoring. Do not present a plan until all scores reach 7.
- **One point = one piece of evidence.** Vague claims ("I understand the code") do not raise scores. Specific evidence does ("I read all 5 callers of syncFloorWalls and traced what each one does").
- A low score is not a failure — it is a signal to do more research, simplify, or ask the user.
- If Problem Understanding is below 7, stop planning and investigate first.
- If Confidence is below 7, identify what is uncertain and resolve it before proceeding.
- **Inflating scores to pass the threshold is a rulebook violation.** Past sessions presented 9s and 10s and were catastrophically wrong. Optimism is not evidence.

### Architecture Rules

1. **Use existing APIs.** Before writing conversion logic, coordinate math, or helper code inline, check if a centralized function already exists. If it does, use it. If it almost does, extend it — don't duplicate it with a "local version."
2. **One source of truth.** Every concept (coordinate conversion, geometry computation, state derivation) must live in exactly one place. Other code calls that place. No copies, no "slightly different" variants.
3. **No niche fixes.** If a bug surfaces in one call site, check whether the root cause is in a shared function. Fix the root, not the symptom. A fix that patches one consumer while leaving the broken function intact is wrong.
4. **Correct layer, correct file.** Coordinate math belongs in geometry/walls modules. DOM manipulation belongs in render.js. State mutation belongs in controllers/ui.js behind `store.commit()`. Don't mix layers.
5. **Explicit coordinate spaces.** When working with coordinates, always be clear about which space you're in (room-local, floor-global, wall-space, SVG/screen). Conversions between spaces must go through named functions, never ad-hoc inline math.
6. **Tests reflect real scenarios.** Tests must use realistic data (actual room sizes, actual wall configurations). Don't test only the happy path with trivially simple geometry.

### Anti-Patterns (reject these on sight)

- **Inline reimplementation.** Computing something that a utility function already computes, but "just for this one spot." Always call the function.
- **Guard-clause band-aids.** Adding `if (x < 0) continue` or `Math.max(x, 0)` to hide a value that shouldn't be negative in the first place. Find why it's negative and fix the source.
- **Scope creep in fixes.** A bug fix should fix the bug. Don't refactor surrounding code, add features, or "improve" unrelated things in the same change.
- **Untested assumptions.** "The owner room's direction always matches the wall direction" — prove it or handle both cases. No comments that say "this should always be true."
- **Silent fallbacks.** `|| 0`, `?? {}`, `|| []` that mask broken data instead of surfacing the problem.

### Review Workflow

Before presenting any non-trivial code change, spawn a review subagent (Task tool, Explore type) to verify:
1. Does an existing API already handle this? Am I duplicating logic?
2. Is the fix at the right layer, or am I patching a symptom?
3. Are coordinate spaces explicitly handled through named functions?
4. Would this change surprise someone reading the code for the first time?

If the review finds violations, fix them before presenting. Do not present code with known rulebook violations and a disclaimer — fix it first.

### End-to-End Testing (BLOCKING — applies to all feature-related code changes)

**Every feature-related code change must have end-to-end test coverage.** Unit tests alone are not sufficient. A feature can pass every unit test and still be completely broken in practice. End-to-end tests exercise the full pipeline — from user input through all intermediate transformations to final output — and catch integration failures that unit tests miss.

**E2E test scenarios are part of the plan.** When planning a feature or change, define concrete end-to-end test scenarios before writing any code. These scenarios must appear in the plan alongside implementation steps, not as an afterthought. A plan without E2E test scenarios is incomplete and must not be approved.

**What counts as an E2E test:** A test that wires together the actual modules involved in the feature (not mocks), feeds in realistic input (real state data, real coordinates, real images where applicable), and asserts on the final observable output. For detection features: input image + click coordinates → created room with correct geometry. For rendering features: state → SVG output with expected elements. For calculation features: room configuration → final metrics.

**Verify the feature works, not just the functions.** After completing implementation, run the E2E tests AND manually verify in the running application if the feature has a UI component. "All tests pass" is necessary but not sufficient — confirm the feature actually works as a user would experience it.

### Debugging Protocol (BLOCKING — governs all debugging)

**Start with logging, not theorizing.** When investigating a bug, the first action is to add logging/instrumentation to observe what is actually happening at runtime. Do not analyze code in your head and guess at root causes. Theories formed without evidence are usually wrong and waste time.

**Sequence:** (1) Add `console.log` / `console.warn` at key points in the suspected code path to capture actual values, flow, and state. (2) Reproduce the issue and read the logs. (3) Only then form a hypothesis based on the observed evidence. (4) Verify the hypothesis with more targeted logging if needed. (5) Fix the root cause. (6) Remove debug logging.

**No armchair debugging.** Reading code and reasoning about "what should happen" is not debugging — it is speculation. The bug exists precisely because what happens differs from what should happen. Observing the actual runtime behavior is mandatory before proposing any fix.

### Plan Storage (BLOCKING — governs all plan files)

**Plans are never overwritten.** Every plan is stored as a new file in `/plans/` with a date-timestamp filename: `plans/YYYY-MM-DD_HH-MM_<short-slug>.md`. Never edit a previously saved plan file to change its approach or steps — create a new one.

**On successful execution, update the plan file.** After a plan is executed and verified (all tests pass, success criteria met), append an `## Implementation` section to the corresponding plan file with:
- What was actually done (may differ from the steps if reality required adjustments)
- Core findings: non-obvious discoveries made during implementation (surprising callers, wrong assumptions, edge cases)
- Final test count and pass/fail result

**Plan file lifecycle:**
1. Plan approved by user → save to `plans/YYYY-MM-DD_HH-MM_<slug>.md`
2. Execution begins → file unchanged
3. Execution succeeds → append `## Implementation` section with findings
4. Execution fails or is abandoned → append `## Outcome: Abandoned` with reason

### Execution Rules

6. **Follow confirmed plans to completion.** Once the user has approved a plan, execute every item in it. Do not stop, skip, or downgrade a goal without explicit user approval. "I believe this is hard" is not a reason to stop — it is a reason to ask.
7. **Verify goals before declaring them reached.** When a plan has a measurable success criterion (e.g. ≤0.5 cm error, all tests pass, no visual artifacts), verify the criterion is actually met before reporting completion. Do not approximate, round, or declare a "known limitation" and move on — confirm the exact number against the exact threshold.
8. **Never unilaterally abandon a constraint.** If you conclude a constraint is impossible to satisfy with your current approach, you must surface that to the user with a clear explanation and ask how to proceed. The decision to change or drop a constraint belongs to the user, not to you.
