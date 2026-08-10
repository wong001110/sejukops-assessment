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

## Consistency rules

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

## UI/UX implementation requirements

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

## Motion principles

Motion should communicate state, hierarchy, continuity, or feedback rather than act as decoration.

Examples:

- `ASSIGNED → IN_PROGRESS` should provide clear status feedback rather than abruptly changing without acknowledgement.
- Completion submission should show progress, success feedback, and a stable transition into the completion summary.
- Dashboard period switching should preserve layout continuity while updated data/charts load.
- Mobile bottom-navigation changes should provide clear active and touch states.

Avoid excessive or long animations that slow down field workflows.

## Verification viewports

At minimum verify:

### Technician

- 360 px
- 390 px
- 430 px

### Admin / Manager

- standard desktop width around 1440 px
- a narrower desktop/tablet-width sanity check around 768–1024 px where applicable

UI work should be visually checked in a real rendered browser; source-code review alone is not sufficient acceptance evidence.

## Precedence

This file is the authoritative UI technology decision for SejukOps.

If an older specification still references Tailwind CSS, this document and the current README supersede that reference. The older wording should be cleaned up when that file is next edited.