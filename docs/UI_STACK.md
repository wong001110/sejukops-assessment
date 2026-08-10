# SejukOps UI Stack

## Decision

SejukOps uses a React component-system approach rather than Tailwind CSS as the primary UI implementation strategy.

### Admin and Manager portals

Use **Ant Design** for desktop-oriented internal operations UI.

Typical components include:

- Layout / Menu
- Table
- Form
- Input / Select / DatePicker
- Card / Statistic
- Tabs
- Drawer / Modal
- Upload
- Badge / Tag
- Alert / Result
- Skeleton / Spin
- Notification / Message

### Technician portal

Use **Ant Design Mobile** for the mobile-first field workflow.

Typical components include:

- NavBar
- TabBar
- List
- Card
- Form / Input
- Picker
- ImageUploader or equivalent mobile upload flow
- Popup / Dialog
- Toast
- Button
- Result / loading feedback

## Why this differs from the assessment's preferred styling stack

The assessment permits candidates to choose their stack and lists Tailwind CSS as a preferred styling option rather than a hard requirement.

SejukOps is a form-, table-, dashboard-, review-, and mobile-workflow-heavy internal operations product. Ant Design and Ant Design Mobile provide mature interaction primitives for those workflows and allow implementation effort to stay focused on business workflow, data integrity, AI integration, performance, and QA.

## Visual Direction

The assessment does not require strong branding, so SejukOps should follow familiar **modern internal SaaS / operations dashboard** conventions rather than inventing a highly decorative brand system.

Priorities:

```text
clarity
speed
recognisable controls
information hierarchy
low visual friction
consistent status feedback
```

Avoid:

```text
heavy gradients
glassmorphism-heavy surfaces
large decorative illustrations
excessive animation
unusual navigation patterns
branding that reduces data density or legibility
```

The intended impression is a practical operations product that a new Admin, Technician, or Manager can understand quickly.

## Surface and Layout Direction

Use a restrained light interface by default:

- neutral/light application background
- clear white/raised content surfaces where separation is needed
- restrained primary accent based on the Ant Design theme system
- subtle borders/shadows rather than heavy card effects
- medium corner radius
- clear section spacing
- consistent page/header rhythm

Desktop Admin/Manager layouts may be moderately dense because users need efficient tables and review information, but should remain readable rather than compressed.

Technician pages should trade density for touch comfort and linear task completion.

## Typography

Prefer the normal Ant Design/system UI typography stack.

Requirements:

- clear distinction between page title, section heading, supporting metadata, and body copy
- tabular/numeric values should remain easy to scan in KPI and financial contexts
- avoid decorative display fonts
- avoid very small secondary text on mobile

## Semantic Status Language

Status colours must be semantic and consistent across portals.

Examples:

```text
NEW / neutral               -> neutral/info treatment
ASSIGNED                     -> informative accent
IN_PROGRESS                  -> active/processing treatment
JOB_DONE                     -> completion-ready/review treatment
REVIEWED / CLOSED            -> success/complete treatment
warning / workflow flag      -> warning treatment
error / blocked              -> error treatment
```

Use Ant Design token/custom theme semantics rather than hard-coding unrelated colours in individual screens.

Text labels/icons must carry meaning as well; colour alone is not sufficient.

## Portal-specific UI Patterns

### Admin

Prefer familiar business-application patterns:

- persistent desktop sidebar
- searchable/filterable order table
- structured forms
- summary/result screens after important writes
- drawer/modal only where it reduces navigation cost
- clear destructive/secondary action distinction

### Manager

Prefer review and analytics hierarchy:

- KPI summary row
- period selector near Dashboard context
- simple charts with stable layout
- review queue/table
- workflow/AI flag emphasis without overwhelming normal records
- AI Assistant visually separated from deterministic KPI truth

### Technician

Do not shrink the desktop dashboard into a phone layout.

Prefer:

- mobile cards/lists instead of dense tables
- bottom navigation
- large primary actions
- visible customer/address/problem context
- linear Start -> Work -> Evidence -> Complete flow
- sticky primary action when it improves field use
- camera/file selection reachable with minimal navigation

## Consistency Rules

Ant Design and Ant Design Mobile must still feel like one product.

Share application-level design decisions for:

- typography
- spacing
- semantic status colours
- border radius
- surface hierarchy
- icon conventions
- feedback states
- motion duration/easing
- accessibility expectations

Prefer Ant Design design tokens and project CSS variables for cross-portal consistency.

Do not introduce Tailwind as a second primary styling system merely to match the assessment's preferred-stack wording.

Small project-specific CSS/CSS Modules are acceptable when component-library APIs or tokens are insufficient.

## UI/UX Implementation Requirements

Frontend implementation is not complete when components merely render and submit data.

The Frontend/UIUX Agent is responsible for:

- desktop and mobile layout quality
- loading and skeleton states
- empty states
- error states
- form validation feedback
- disabled states
- hover/focus/pressed feedback
- responsive behaviour
- touch-friendly interaction for Technician pages
- transitions and micro-interactions that communicate state changes
- reduced-motion behaviour where appropriate
- keyboard/accessibility behaviour on desktop flows
- real browser/visual verification

## Motion Principles

Motion should communicate state, hierarchy, continuity, or feedback rather than act as decoration.

Recommended default interaction duration is short/subtle (roughly the normal range used by mainstream business UIs rather than long cinematic motion).

Examples:

- `ASSIGNED -> IN_PROGRESS` should provide clear status feedback rather than abruptly changing without acknowledgement.
- Completion submission should show progress, success feedback, and a stable transition into the completion summary.
- Dashboard period switching should preserve layout continuity while updated data/charts load.
- Mobile bottom-navigation changes should provide clear active and touch states.
- Drawer/modal content should not appear/disappear in a visually confusing jump.

Avoid excessive or long animations that slow down field workflows.

Respect reduced-motion preference where practical; functional feedback must remain clear without decorative movement.

## Loading Strategy

Avoid turning every async action into a full-page spinner.

Prefer:

```text
page skeleton for first load
local button loading for writes
stable card/chart layout during refetch
inline retry/error state for partial failures
```

Dashboard period changes should keep the overall layout stable while values transition/refetch.

Technician completion must make it obvious that a submit is in progress so a slow field network does not encourage repeated taps.

## Verification Viewports

At minimum verify:

### Technician

- 360 px
- 390 px
- 430 px

### Admin / Manager

- standard desktop width around 1440 px
- a narrower desktop/tablet-width sanity check around 768-1024 px where applicable

UI work should be visually checked in a real rendered browser; source-code review alone is not sufficient acceptance evidence.

## Acceptance Questions for UI/UX QA

A QA/UI agent should be able to answer:

- Is the primary action obvious without reading documentation?
- Are tables/forms/cards familiar to normal business-software users?
- Are long names/addresses/messages handled without layout breakage?
- Are loading, empty, success, warning, and error states distinguishable?
- Does motion clarify rather than delay work?
- Can a Technician complete the core flow comfortably on a narrow phone viewport?
- Does the same status mean the same thing across Admin, Technician, and Manager?

## Precedence

This file is the authoritative UI technology and visual-direction decision for SejukOps.

If an older specification still references Tailwind CSS or a different visual direction, this document and the current README supersede that reference. The older wording should be cleaned up when that file is next edited.
