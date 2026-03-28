# Raft Survival — Developer Context

## Overview
2D top-down browser raft survival game built with **Phaser 3** (v3.x, loaded via CDN).
No build system — just `index.html` + `main.js`. Serve locally with `npx serve .` and open `http://localhost:3000`.

## File Structure
```
index.html   — all HTML, CSS, and UI panels
main.js      — all game logic (Phaser scene, input, systems)
Assets/
  raft/              — custom game sprites (16×16 px art, PNG)
  Free Inventory/    — inventory slot UI sprites
  Pixel Crawler - Free Pack 2.0.4/  — character + environment sprites
  water/             — water tileset
```

---

## Key Constants (main.js top)

| Constant | Value | Purpose |
|---|---|---|
| `TILE_SIZE` | 20 | World pixels per raft tile |
| `PLAYER_SPEED` | 45 | px/s movement |
| `WORLD_SIZE` | 4000 | Square world bounds |
| `STACK_MAX` | 20 | Max items per inventory slot |
| `DEV_UNLIMITED` | true/false | Infinite resources cheat |
| `COOK_TIME` | 10s | Seconds to cook one food item |
| `FUEL_TIME` | 15s | Seconds one wood burns in campfire |

---

## Core Data Structures

### Raft
- `raftTiles[]` — `{ gridX, gridY }` — which grid squares have raft tiles
- `raftContainer` — Phaser Container at world position; all raft sprites are children with local coords
- Raft moves via `raftContainer.x/y` drift each frame

### Structures (placed objects on raft)
```js
raftStructures[] = [{ gridX, gridY, type, localX, localY, rotation, id }]
```
- `localX/Y` — pixel offset within the tile (0–TILE_SIZE). Most snap to `TILE_SIZE/2` (center).
- `id` — `Date.now() + Math.random()` float, used as key for chest/furnace storage
- `PLACEABLE_TYPES` — `Set(['campfire', 'chest', 'sleeping_bag', 'workbench'])`
- `STRUCTURE_TILE_SIZE` — `{ sleeping_bag: 2 }` — multi-tile structures
- `CENTER_ONLY_TYPES` — `Set(['workbench', 'campfire'])` — always snap to tile center
- Use `stLocalX(st)` / `stLocalY(st)` helpers to resolve position (respects CENTER_ONLY)

### Inventory
```js
hotbarData[8]  // { type: string|null, count: number }
invData[40]    // same
```
- `countItem(type)` — returns total across hotbar + inv (returns 9999 if `DEV_UNLIMITED`)
- `removeItems(type, amount)` — removes from hotbar first, then inv (no-op if DEV_UNLIMITED)
- `addToInventory(type, amount)` — fills partial stacks then empty slots, returns overflow count

### Chest Storage
```js
chestStorages[id] = Array(20).fill({ type: null, count: 0 })
```
Keyed by structure `id`. Created in `placeStructure()`, deleted in `removeStructureById()`.

### Furnace State
```js
furnaceStates[id] = { food: {type,count}, fuel: {type,count}, output: {type,count}, cookProgress, fuelLeft }
```
- `COOKABLE = { raw_potato: 'cooked_potato' }` — maps food input → output
- `FOOD_VALUES = { cooked_potato: { hunger:45, health:20, stamina:35, hydration:10 } }`
- Tick runs every frame via `tickFurnaces(dt)` in `update()`

### Player Stats
```js
statHealth, statHunger, statHydration, statStamina  // all 0–100
```
Updated every frame in `tickStats(dt)`. Drain rates are slow (minutes to empty).

---

## Crafting System

### Recipes
```js
RECIPES = {
  rope:         { inputs: { palm: 5 },                        outputs: { rope: 1 } },
  workbench:    { inputs: { wood: 10, rope: 1, scrap_metal: 2 }, outputs: { workbench: 1 } },
  // Tier 1 (requires placed workbench):
  campfire:     { inputs: { wood: 10 },                       outputs: { campfire: 1 } },
  cup:          { inputs: { plastic: 10 },                    outputs: { cup: 1 } },
  chest:        { inputs: { wood: 10, rope: 2 },              outputs: { chest: 1 } },
  sleeping_bag: { inputs: { rope: 2, palm: 10 },              outputs: { sleeping_bag: 1 } },
}
```
- `TIER1_RECIPES` — locked until a workbench is placed on the raft
- `craftRecipe(id)` — called from HTML buttons
- Adding a new recipe: add to `RECIPES`, add HTML row in `index.html` craft panel, add to `TIER1_RECIPES` if needed

---

## Items / Sprites

All item types and their sprite paths live in `ITEM_SPRITES`:
```
wood, plastic, palm, cask, rope, campfire, cup, chest,
sleeping_bag, hammer, workbench, scrap_metal, raw_potato, cooked_potato
```
Sprites are 16×16 px pixel art in `Assets/raft/`.
To add a new item: add to `ITEM_SPRITES`, `this.load.image(key, path)` in `preload()`.

---

## Debris Spawning

Debris floats toward the raft in waves. Spawn rates (approx):
- `wood` — 52%
- `plastic` — 16%
- `palm` — 24%
- `scrap_metal` — 4% (rare)
- `cask` — 4% (rare, max 1 on screen)

Casks contain: 3–8 wood, 3–8 plastic, 3–8 palm, and 50% chance of 1–2 `raw_potato`.

Hook collects debris → `hookedItems[type]++` → deposited to inventory on reel-in.

---

## Controls

| Key | Action |
|---|---|
| WASD | Move |
| Space | Charge/throw hook |
| B | Toggle build mode (requires hammer in inventory) |
| R | Rotate placement ghost |
| F | Eat selected hotbar food item |
| E / Escape | Close open panel |
| I | Open/close inventory |
| X | Split hovered stack |
| Q | Drop hovered item |
| 1–8 | Select hotbar slot |
| Ctrl+S | Manual save |

---

## Build Mode
- Press **B** to toggle (hammer must be in inventory/hotbar)
- **Left-click** empty tile → place raft tile (costs 10 wood + 2 plastic)
- **Left-click** structure → pick it up to move it
- **Right-click** structure → remove it (refunds recipe materials)
- **Right-click** while moving → cancel move
- Craft panel opens on the left when in build mode
- Ghost preview follows cursor; press R to rotate

---

## Save / Load
- `saveGame()` — serializes to `localStorage` under key `'raftGame_v1'`
- `loadGame()` — called at end of `create()`, rebuilds everything from saved JSON
- Auto-saves every 60s and on tab close
- To wipe save: `localStorage.removeItem('raftGame_v1')` in browser console

**What is saved:** raft tiles, structures, chest contents, furnace states, full inventory, player stats, player + raft positions.

---

## UI Panels (index.html)

| ID | Purpose |
|---|---|
| `#craft-panel` | Build mode crafting, left side |
| `#chest-panel` | Chest storage grid (20 slots) |
| `#furnace-panel` | Campfire cooking UI |
| `#inventory-panel` | Player backpack |
| `#hotbar` | 8-slot hotbar, bottom center |
| `#status-bars` | Health/hunger/hydration/stamina bars, top right |
| `#cask-popup` | Loot popup when opening a cask |
| `#build-indicator` | "BUILD MODE" text above hotbar |

---

## Adding New Content

### New item type
1. Add sprite to `Assets/raft/`
2. Add to `ITEM_SPRITES`
3. `this.load.image(key, path)` in `preload()`
4. If debris: add to spawn roll in `spawnItemAt()` and `hookedItems` init

### New recipe
1. Add to `RECIPES`
2. Add HTML row to craft panel in `index.html`
3. Add to `TIER1_RECIPES` if it needs workbench

### New placeable structure
1. Add type string to `PLACEABLE_TYPES`
2. Handle rendering in `rebuildStructureSprites()`
3. Add to `SOLID_HALF` in `resolveChestCollision()` if it needs collision
4. Add to `CENTER_ONLY_TYPES` if it should always snap to tile center

### New food
1. Add raw → cooked entry to `COOKABLE`
2. Add cooked entry to `FOOD_VALUES` with stat bonuses

---

## Sprite / Asset Notes
- All sprites are 16×16 px pixel art
- Animated spritesheets end in `-Sheet.png`, load with `load.spritesheet(key, path, { frameWidth:16, frameHeight:16 })`
- Static images load with `load.image(key, path)`
- Always run via local HTTP server — `file://` URLs will break asset loading
- Player character sprites: `Assets/Pixel Crawler - Free Pack 2.0.4/Pixel Crawler - Free Pack/Entities/Characters/Body_A/Animations/`
