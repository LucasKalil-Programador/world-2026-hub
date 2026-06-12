# World Cup 2026 Hub

## 1. Overview

Develop a static web application for hosting on GitHub Pages that displays complete information about the FIFA World Cup 2026.

The system should consume JSON files to load match, results, and standings information, with no backend required.

The main focus is:

* Modern interface
* Excellent visual experience
* Responsiveness
* Interactive bracket
* Easy maintenance via JSON

---

# 2. Objectives

Create a portal that allows:

* Browsing all World Cup matches
* Viewing the group stage
* Viewing the complete knockout stage
* Tracking results
* Viewing stadiums and match information
* Simulating knockout stage winners (optional mode)
* Working fully offline after loading

---

# 3. Technologies

## Required

* HTML5
* CSS3
* JavaScript ES2022+

## Allowed

* CSS Variables
* CSS Grid
* Flexbox
* Web Components (Optional)

## Not allowed

* Backend
* Database
* Heavy frameworks

---

# 4. File Structure

```text
/
├── index.html
├── assets/
│   ├── css/
│   │   ├── style.css
│   │   ├── bracket.css
│   │   └── animations.css
│   │
│   ├── js/
│   │   ├── app.js
│   │   ├── bracket.js
│   │   ├── groups.js
│   │   ├── schedule.js
│   │   └── modal.js
│   │
│   └── images/
│
├── data/
│   ├── matches.json
│   ├── results.json
│   ├── stadiums.json
│   ├── teams.json
│   └── groups.json
│
└── README.md
```

---

# 5. Visual Theme

## Style

Visual inspired by:

* FIFA World Cup
* UEFA Champions League
* Apple Design Language

## Characteristics

* Glassmorphism
* Soft shadows
* Rounded corners
* Smooth transitions
* Gradient backgrounds

## Palette

```css
--bg-primary: #081421;
--bg-secondary: #10243b;

--accent-gold: #d4af37;
--accent-blue: #1e88e5;

--text-primary: #ffffff;
--text-secondary: #cfd8dc;
```

---

# 6. Main Layout

## Header

Display:

* World Cup 2026 logo
* Navigation

Menu:

* Home
* Matches
* Groups
* Knockout Stage
* Stadiums

---

## Hero Section

Display:

* Next match
* Countdown
* Highlights

---

## Dashboard

Cards:

* Total matches
* Completed matches
* Upcoming matches
* Participating teams

---

# 7. Match System

## Data Source

matches.json

Example:

```json
{
  "id": 1,
  "phase": "Group A",
  "date": "2026-06-11",
  "time": "17:00",
  "stadium": "Azteca",
  "city": "Mexico City",
  "homeTeam": "Mexico",
  "awayTeam": "Canada"
}
```

---

## Features

### Filters

Filter by:

* Date
* Group
* Phase
* Team
* Stadium

### Search

Search by:

* Country
* City
* Stadium

### Sorting

* Date ascending
* Date descending

---

# 8. Results System

File:

results.json

Example:

```json
{
  "matchId": 1,
  "homeScore": 2,
  "awayScore": 1,
  "status": "finished"
}
```

Possible statuses:

```text
scheduled
live
finished
```

---

# 9. Knockout Bracket

## Goal

Create a highly interactive visualization.

---

## Rounds

* Round of 32
* Round of 16
* Round of 16
* Quarterfinals
* Semifinals
* Third Place
* Final

---

## Layout

Horizontal format.

Example:

```text
Round of 16 -> Quarterfinals -> Semifinals -> Final -> Champion
```

---

## Features

### Hover

On mouse hover:

* Highlight the full path

### Animations

* Fade-in
* Slide-in
* Glow

### Zoom

Allow:

* Mouse wheel
* Pinch on mobile devices

### Drag

Freely move the bracket.

---

## Simulation Mode

User can:

* Choose winner
* Enter score
* Update next rounds

Without modifying the original JSON.

State saved in:

```javascript
localStorage
```

---

# 10. Match Info Modal

When clicking on a match.

Open a modal containing:

## Information

* Teams
* Date
* Time
* Stadium
* City
* Capacity
* Result

## Future statistics

Prepare space for:

* Possession
* Shots
* Cards

---

# 11. Stadiums Page

Data from:

stadiums.json

Example:

```json
{
  "id": 1,
  "name": "Estadio Azteca",
  "city": "Mexico City",
  "capacity": 87000,
  "image": "azteca.jpg"
}
```

---

## Display

Responsive cards containing:

* Photo
* Name
* City
* Capacity
* Matches held

---

# 12. Responsiveness

## Desktop

1440px+

Full layout.

---

## Tablet

768px–1439px

Reduced menu.

---

## Mobile

Up to 767px

Bracket with:

* Horizontal scroll
* Zoom
* Drag

---

# 13. Performance

Goals:

* Lighthouse > 90
* First render < 2s
* JS bundle < 300KB

---

# 14. Accessibility

Implement:

* ARIA labels
* Keyboard navigation
* Adequate contrast
* Visible focus states

---

# 15. Animations

## Entry

```css
fade-in
slide-up
slide-left
```

## Interaction

```css
hover-scale
hover-glow
pulse
```

## Bracket

```css
line-draw
winner-highlight
path-highlight
```

---

# 16. Local Persistence

Save:

* Simulations
* Visual preferences
* Last opened tab

Use:

```javascript
localStorage
```

---

# 17. Code Requirements

## JavaScript

* Modular
* No duplicated code
* Pure functions when possible

## CSS

* Organized by component
* Global variables
* Mobile First

---

# 18. Acceptance Criteria

The project will be considered complete when:

* All matches are loaded via JSON
* All results are loaded via JSON
* The bracket is generated dynamically
* It works on GitHub Pages
* It works on desktop and mobile
* It allows knockout stage simulation
* It has smooth animations
* It does not depend on a backend

---

# 19. Future Improvements

* PWA
* Dark/light mode
* Real-time statistics
* Results API
* FIFA ranking
* World Cup history
* Team comparison
* Push notifications

---

# 20. Deliverables

The final system must provide:

1. Single page (SPA)
2. Complete dynamic bracket
3. Group standings tables
4. Match schedule
5. Stadiums page
6. Detailed match modal
7. Simulation system
8. Architecture ready for expansion
9. Compatibility with GitHub Pages
10. Clean, documented code
