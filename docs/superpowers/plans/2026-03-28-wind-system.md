# Wind System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the random current-shift system with a fixed wind direction that drives raft drift and debris spawning, with a HUD indicator showing wind direction.

**Architecture:** A single `windAngle` (radians) is picked randomly on new game and saved persistently. It anchors the raft's `driftAngle` via a spring, ensures all debris spawns ahead of the raft, and rotates a CSS arrow in the HUD. Four feature branches are merged into `DEV` in order — each branch depends on `windAngle` existing from Branch 1.

**Tech Stack:** Phaser 3 (CDN), vanilla JS, plain HTML/CSS. No build system. Serve with `npx serve .`, open `http://localhost:3000`.

---

## Branch order (merge into DEV in sequence)

1. `feature/wind-init-save`
2. `feature/wind-drift-spring`
3. `feature/wind-debris-spawn`
4. `feature/wind-ui-indicator`

---

## Task 1 — Wind Init & Save/Load

**Branch:** `feature/wind-init-save` (branch off DEV)

**Files:**
- Modify: `main.js` — constants block (~line 10), state block (~line 49), end of `create()` (~line 1071), `saveGame()` (~line 2140), `loadGame()` (~line 2200)

### Steps

- [ ] **1.1 — Create branch**

```bash
git checkout DEV && git pull origin DEV
git checkout -b feature/wind-init-save
```

- [ ] **1.2 — Add `WIND_SPRING` constant**

In `main.js`, after line 10 (`const DRIFT_TURN = 0.008;`), add:

```js
const WIND_SPRING  = 1.5;  // spring strength pulling driftAngle back to windAngle
```

- [ ] **1.3 — Declare `windAngle` state variable**

In `main.js`, after line 49 (`let driftAngle = Math.random() * Math.PI * 2;`), add:

```js
let windAngle = 0; // set in create() or loadGame()
```

- [ ] **1.4 — Initialize `windAngle` in `create()`**

In `main.js`, find the seeder block that starts at ~line 1071:
```js
// Seed the world with debris already in transit
```
Insert these two lines immediately BEFORE that block:

```js
// Establish wind direction for this session (loadGame may overwrite)
windAngle = Math.random() * Math.PI * 2;
driftAngle = windAngle;
```

- [ ] **1.5 — Save `windAngle`**

In `saveGame()`, find the `data` object literal (~line 2140). Add `windAngle` alongside `raftX`/`raftY`:

```js
raftX:      raftContainer.x,
raftY:      raftContainer.y,
windAngle:  windAngle,
```

- [ ] **1.6 — Load `windAngle`**

In `loadGame()`, find the last restore block (player position, ~line 2200). Add after it:

```js
// Restore wind direction (fallback for saves before this feature)
windAngle  = data.windAngle ?? Math.random() * Math.PI * 2;
driftAngle = windAngle;
```

- [ ] **1.7 — Verify in browser**

Open `http://localhost:3000`. In the browser console:
```js
// Should print a number between 0 and 6.28
console.log(windAngle);

// Save, reload, check it's the same number
saveGame();
location.reload();
// After reload:
console.log(windAngle); // same value as before
```

- [ ] **1.8 — Commit**

```bash
git add main.js
git commit -m "feat: add windAngle state, WIND_SPRING constant, save/load support"
```

- [ ] **1.9 — Push and open PR into DEV**

```bash
git push -u origin feature/wind-init-save
```
Open PR: `feature/wind-init-save` → `DEV`. Merge and delete branch when approved.

---

## Task 2 — Raft Drift Spring Pull-back

**Branch:** `feature/wind-drift-spring` (branch off DEV after Task 1 is merged)

**Files:**
- Modify: `main.js` — state block (~line 55), drift update in `update()` (~line 1198), current-shift block (~line 1222)

### Steps

- [ ] **2.1 — Create branch**

```bash
git checkout DEV && git pull origin DEV
git checkout -b feature/wind-drift-spring
```

- [ ] **2.2 — Remove `currentShiftTimer` declaration**

In `main.js`, find and delete line ~55:
```js
let currentShiftTimer = 25 + Math.random() * 20;
```
Remove this line entirely.

- [ ] **2.3 — Add spring to drift update**

In `update()`, find the drift section (~line 1198):
```js
driftAngle += DRIFT_TURN * dt;
```
Replace with:
```js
driftAngle += DRIFT_TURN * dt;
driftAngle += (windAngle - driftAngle) * WIND_SPRING * dt;
```

- [ ] **2.4 — Remove the current-shift block**

Find and delete the entire block (~lines 1222–1229):
```js
// --- Current shift ---
currentShiftTimer -= dt;
if (currentShiftTimer <= 0) {
  // Rotate current 60–150° so the new groups visibly come from a different direction
  const shift = (Math.PI / 3) + Math.random() * (Math.PI / 3);
  driftAngle += Math.random() < 0.5 ? shift : -shift;
  currentShiftTimer = 25 + Math.random() * 20; // next shift in 25–45 s
}
```
Remove all 8 lines.

- [ ] **2.5 — Verify in browser**

Open `http://localhost:3000`. Watch the raft for 30 seconds. It should drift in one consistent direction with slight natural wobble, never making large sudden direction changes. In the console:
```js
// Log driftAngle and windAngle each second to confirm spring behaviour
setInterval(() => console.log('drift:', driftAngle.toFixed(3), 'wind:', windAngle.toFixed(3)), 1000);
```
`driftAngle` should stay close to `windAngle` (within ~0.3 rad).

- [ ] **2.6 — Commit**

```bash
git add main.js
git commit -m "feat: spring pull-back drift toward windAngle, remove currentShiftTimer"
```

- [ ] **2.7 — Push and open PR into DEV**

```bash
git push -u origin feature/wind-drift-spring
```
Open PR: `feature/wind-drift-spring` → `DEV`. Merge and delete branch when approved.

---

## Task 3 — Debris Spawning Along Wind Path

**Branch:** `feature/wind-debris-spawn` (branch off DEV after Task 2 is merged)

**Files:**
- Modify: `main.js` — `spawnGroup()` (~line 1105), seeder block in `create()` (~line 1079)

### Steps

- [ ] **3.1 — Create branch**

```bash
git checkout DEV && git pull origin DEV
git checkout -b feature/wind-debris-spawn
```

- [ ] **3.2 — Fix `spawnGroup()` to spawn ahead of raft**

In `main.js`, find `spawnGroup()` (~line 1099). It currently reads:
```js
spawnGroupAt.call(this, driftAngle + Math.PI, dist);
```
Replace with:
```js
spawnGroupAt.call(this, windAngle, dist);
```
`windAngle` is the direction the raft travels toward — passing it directly places the spawn point ahead of the raft. `spawnItemAt` then aims each item back toward the raft center, so they float in from ahead.

- [ ] **3.3 — Fix seeder to fan ahead of raft**

In `create()`, find the seeder loop (~line 1077):
```js
const groupAngle = driftAngle + Math.PI + fanOffset;
```
Replace with:
```js
const groupAngle = windAngle + fanOffset;
```
This seeds the 5 initial groups in a fan ahead of the raft rather than behind it.

- [ ] **3.4 — Verify in browser**

Open `http://localhost:3000`. Watch the water for 30–60 seconds. Debris (wood planks, plastic, palm fronds) should appear as a spread-out line crossing the raft's path from ahead, not from random sides. The spread should be perpendicular (left-right) to the raft's heading.

To confirm direction visually: note where `windAngle ≈ 0` (east) — debris should appear to the right of the raft and drift leftward toward it.

- [ ] **3.5 — Commit**

```bash
git add main.js
git commit -m "feat: spawn debris ahead of raft along wind path"
```

- [ ] **3.6 — Push and open PR into DEV**

```bash
git push -u origin feature/wind-debris-spawn
```
Open PR: `feature/wind-debris-spawn` → `DEV`. Merge and delete branch when approved.

---

## Task 4 — Wind Direction HUD Indicator

**Branch:** `feature/wind-ui-indicator` (branch off DEV after Task 3 is merged)

**Files:**
- Modify: `index.html` — CSS block, HTML body
- Modify: `main.js` — new `updateWindIndicator()` helper, called after `windAngle` is set in `create()` and `loadGame()`

### Steps

- [ ] **4.1 — Create branch**

```bash
git checkout DEV && git pull origin DEV
git checkout -b feature/wind-ui-indicator
```

- [ ] **4.2 — Add CSS for wind indicator**

In `index.html`, find the `#status-bars` CSS rule. Add the following block immediately after it (after its closing `}`):

```css
#wind-indicator {
  position: fixed;
  top: 16px; left: 16px;
  z-index: 25;
  pointer-events: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  background: rgba(0,0,0,0.45);
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 6px;
  padding: 6px 10px;
  font-family: monospace;
  font-size: 11px;
  color: #cccccc;
  min-width: 44px;
  text-align: center;
}
#wind-arrow {
  font-size: 18px;
  line-height: 1;
  display: inline-block;
  color: #aaddff;
}
```

- [ ] **4.3 — Add HTML element**

In `index.html`, find `<div id="status-bars">`. Add the wind indicator immediately before it:

```html
<div id="wind-indicator">
  <div id="wind-arrow">▲</div>
  <div>Wind</div>
</div>
```

- [ ] **4.4 — Add `updateWindIndicator()` to `main.js`**

In `main.js`, find the `// ── Save / Load ───` comment block. Add this helper function immediately before it:

```js
// ── Wind Indicator ────────────────────────────────────────────

function updateWindIndicator() {
  // ▲ points north (up) at 0deg CSS rotation; Phaser angle 0 = east, so subtract 90°
  const deg = (windAngle * 180 / Math.PI) - 90;
  document.getElementById('wind-arrow').style.transform = `rotate(${deg}deg)`;
}
```

- [ ] **4.5 — Call `updateWindIndicator()` after `windAngle` is set in `create()`**

In `create()`, find the two lines added in Task 1.4:
```js
windAngle = Math.random() * Math.PI * 2;
driftAngle = windAngle;
```
Add a call on the next line:
```js
windAngle = Math.random() * Math.PI * 2;
driftAngle = windAngle;
updateWindIndicator();
```

- [ ] **4.6 — Call `updateWindIndicator()` after `windAngle` is restored in `loadGame()`**

In `loadGame()`, find the two lines added in Task 1.6:
```js
windAngle  = data.windAngle ?? Math.random() * Math.PI * 2;
driftAngle = windAngle;
```
Add a call on the next line:
```js
windAngle  = data.windAngle ?? Math.random() * Math.PI * 2;
driftAngle = windAngle;
updateWindIndicator();
```

- [ ] **4.7 — Verify in browser**

Open `http://localhost:3000`. You should see a small dark panel in the top-left with an arrow (▲) and "Wind" label. The arrow should point in the raft's direction of travel. To confirm: note the raft drifting in a direction, mentally draw that heading, and check the arrow matches. Reload — arrow should point the same direction (same saved `windAngle`).

- [ ] **4.8 — Commit**

```bash
git add index.html main.js
git commit -m "feat: add wind direction HUD indicator"
```

- [ ] **4.9 — Push and open PR into DEV**

```bash
git push -u origin feature/wind-ui-indicator
```
Open PR: `feature/wind-ui-indicator` → `DEV`. Merge and delete branch when approved.

---

## Final Verification (after all 4 branches merged into DEV)

1. Wipe save: open browser console → `localStorage.removeItem('raftGame_v1')` → reload
2. Confirm raft drifts in one direction with a gentle wobble
3. Confirm wind arrow in top-left points that direction
4. Confirm debris appears ahead of the raft in a perpendicular spread
5. Save and hard-reload (`Ctrl+Shift+R`) — raft resumes same direction, arrow matches
6. Repeat step 1 multiple times to confirm direction is random each new game
