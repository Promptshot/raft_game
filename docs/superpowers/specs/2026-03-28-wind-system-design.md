# Wind System Design

**Date:** 2026-03-28
**Status:** Approved

---

## Context

The raft currently drifts via a randomly rotating `driftAngle` that shifts 60–150° every 25–45 seconds (`currentShiftTimer`). This produces erratic, directionless movement with no player-readable pattern. Debris spawns from random angles.

This feature replaces that system with a **fixed wind direction** that persists for the life of a save. The raft drifts in the wind direction with a natural wobble (spring pull-back), and all flotsam spawns ahead of the raft on a perpendicular line — so the player encounters debris in their path rather than randomly from any side.

---

## Architecture

### New state variable

```js
let windAngle; // radians — set once on new game, saved/loaded with game state
```

`windAngle` is a random angle picked at game start (`Math.random() * Math.PI * 2`) and never changed. It represents the direction the wind is blowing **toward** (i.e., the direction the raft travels).

### Constant

```js
const WIND_SPRING = 1.5; // spring strength pulling driftAngle back to windAngle (tunable)
```

---

## System 1: Wind Initialization

**In `create()`:** After existing init, set:
```js
windAngle = Math.random() * Math.PI * 2;
driftAngle = windAngle; // start already aligned
```

If a save exists, `loadGame()` will overwrite `windAngle` with the saved value.

**Remove:** The `currentShiftTimer` variable and its update block (currently lines ~1222–1229 in `main.js`).

---

## System 2: Raft Drift (Spring Pull-back)

**In `update()`, drift section — replace:**
```js
driftAngle += DRIFT_TURN * dt;
```
**With:**
```js
driftAngle += DRIFT_TURN * dt;
driftAngle += (windAngle - driftAngle) * WIND_SPRING * dt;
```

The rest of the drift block (position clamping, player offset) is unchanged. The spring ensures `driftAngle` orbits `windAngle` organically without wandering far off course.

---

## System 3: Debris Spawning

**In the wave spawner block (`update()`)**, the call to `spawnGroupAt` currently passes a random angle. Replace it with:
```js
spawnGroupAt.call(this, windAngle, dist); // dist is the existing spawn distance used by the wave spawner
```

No changes are needed inside `spawnGroupAt` — it already positions the group at `dist` ahead in `fromAngle` and spreads items laterally along the perpendicular, which is exactly the desired behavior.

**Result:** All flotsam spawns on a perpendicular line directly ahead of the raft in the wind direction.

---

## System 4: Wind UI Indicator

**In `index.html`:** Add a fixed-position wind indicator panel (top-left HUD, consistent with existing dark semi-transparent panel style):

```html
<div id="wind-indicator">
  <div id="wind-arrow">▲</div>
  <div>Wind</div>
</div>
```

Style with `position: fixed`, dark background, white text, matching other HUD panels.

**In `main.js`:** After `windAngle` is set (both new game and load), update the arrow rotation:
```js
// Subtract 90° because ▲ points north (up) at 0deg, but Phaser angle 0 = east
const deg = (windAngle * 180 / Math.PI) - 90;
document.getElementById('wind-arrow').style.transform = `rotate(${deg}deg)`;
```

This only needs to run once (wind is fixed), not every frame.

---

## Save / Load

Add `windAngle` to the `saveGame()` payload:
```js
windAngle: windAngle,
```

In `loadGame()`, restore it:
```js
windAngle = saved.windAngle ?? Math.random() * Math.PI * 2;
```

The `?? fallback` handles saves created before this feature.

---

## Files Modified

| File | Change |
|---|---|
| `main.js` | Add `windAngle` + `WIND_SPRING` constants; init in `create()`; spring in drift update; remove `currentShiftTimer`; fix debris spawn angle; update wind arrow on init/load |
| `index.html` | Add `#wind-indicator` HUD element and CSS |

---

## Git Branching

Each system is implemented on its own short-lived feature branch off `DEV`, per the project's branching strategy. Branches are merged via PR into `DEV` when done, then deleted.

| Branch | Covers |
|---|---|
| `feature/wind-init-save` | System 1 — `windAngle` variable, init in `create()`, save/load |
| `feature/wind-drift-spring` | System 2 — Spring pull-back in drift update, remove `currentShiftTimer` |
| `feature/wind-debris-spawn` | System 3 — Lock debris spawn angle to `windAngle` |
| `feature/wind-ui-indicator` | System 4 — Wind arrow HUD in `index.html` + `main.js` |

Each branch should be rebased on `DEV` before opening its PR. Merge in order (1 → 2 → 3 → 4) since later branches depend on `windAngle` existing.

---

## Verification

1. Start a new game — raft should drift in one consistent direction
2. Reload the page — raft should continue drifting in the same direction (saved angle restored)
3. Watch debris — flotsam should appear ahead of the raft, spread left-right across the path
4. Observe wobble — raft heading should drift a few degrees but always return toward wind direction
5. Wind indicator arrow should point in the raft's travel direction
6. Wipe save (`localStorage.removeItem('raftGame_v1')`) and reload — new random wind direction assigned
