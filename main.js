// ============================================================
// main.js — Raft Survival
// ============================================================

// --- Constants ---
const TILE_SIZE    = 20;
const PLAYER_SPEED = 45;
const WORLD_SIZE   = 4000;
const DRIFT_SPEED  = 3;    // raft barely moves — ocean current does the work
const DRIFT_TURN   = 0.008; // very slow heading change
const CURRENT_SPEED   = 28; // debris drift speed (faster than raft so it passes by)
const WAVE_INTERVAL_MIN   = 12; // calm gap between waves
const WAVE_INTERVAL_MAX   = 22;
const WAVE_SUBGROUP_GAP   = 0.9; // seconds between groups within a wave
const WORLD_MARGIN = 200;  // raft keeps this far from world edge

// --- Hook constants ---
const MAX_CHARGE_TIME = 1.5;
const HOOK_SPEED      = 300;
const REEL_SPEED      = 70;
const MIN_HOOK_DIST   = 40;
const MAX_HOOK_DIST   = 200;
const SPLASH_DURATION = 0.45;

// --- Phaser Game Config ---
const config = {
  type: Phaser.AUTO,
  width: window.innerWidth,
  height: window.innerHeight,
  backgroundColor: '#3e92d1',
  roundPixels: true,
  pixelArt: true,
  physics: {
    default: 'arcade',
    arcade: { gravity: { y: 0 }, debug: false }
  },
  input: { mouse: { disableContextMenu: true } },
  scene: { preload, create, update }
};

const game = new Phaser.Game(config);

// --- Scene-level variables ---
let player;
let wasd;
let raftTiles;
let raftContainer;
let waterBg;
let driftAngle = Math.random() * Math.PI * 2;
let lastDir = 'down';
let floatingItems = []; // { gfx, type, vx, vy, physX, physY, bobPhase }
let waveTimer      = 4;  // first wave arrives quickly
let waveGroupsLeft = 0;
let waveGroupTimer = 0;
let currentShiftTimer = 25 + Math.random() * 20;
let seagullTimer = 90 + Math.random() * 90; // first call in 1.5–3 min
let sndSeagull;

// --- Catchers ---
let catcherTiles    = []; // { gridX, gridY, id }
const catcherStorages = {}; // id -> [{ type, count }]  (flat list, max 30 total items)
let openCatcherId   = null;
const CATCHER_CAPACITY = 30;

// --- Build mode ---
let buildMode     = false;
let tilePlaceMode = 'normal'; // 'normal' | 'catcher'
let movingStructure = null; // structure being repositioned in build mode
let pendingDelete   = null; // structure awaiting Y/N confirmation
let ghostGfx;
let inventoryOpen = false;
const inventoryPanel = document.getElementById('inventory-panel');
// --- Hotbar setup ---
const HOTBAR_SLOTS = 8;
let hotbarSelected = 0;

(function buildHotbar() {
  const bar = document.getElementById('hotbar');
  for (let i = 0; i < HOTBAR_SLOTS; i++) {
    const slot = document.createElement('div');
    slot.className = 'hotbar-slot' + (i === 0 ? ' selected' : '');
    slot.dataset.index = i;
    slot.addEventListener('click', (e) => { setHotbarSelected(i); handleSlotClick('hotbar', i, e); });
    slot.addEventListener('mouseenter', () => { lastHoveredSlot = { source: 'hotbar', index: i }; });
    bar.appendChild(slot);
  }
})();

function setHotbarSelected(idx) {
  hotbarSelected = idx;
  document.querySelectorAll('.hotbar-slot').forEach(s => {
    s.classList.toggle('selected', parseInt(s.dataset.index) === hotbarSelected);
  });
}

window.addEventListener('wheel', (e) => {
  e.preventDefault();
  const dir = e.deltaY > 0 ? 1 : -1;
  setHotbarSelected((hotbarSelected + dir + HOTBAR_SLOTS) % HOTBAR_SLOTS);
}, { passive: false });

// --- Inventory grid setup ---
const INV_COLS = 8;
const INV_ROWS = 4;
const INV_UNLOCKED_ROWS = 1;
let invSelected = 0; // index of keyboard-selected slot (0-based, first row only)

(function buildInventoryGrid() {
  const grid = document.getElementById('inv-grid');
  for (let r = 0; r < INV_ROWS; r++) {
    for (let c = 0; c < INV_COLS; c++) {
      const slot = document.createElement('div');
      slot.className = 'inv-slot' + (r >= INV_UNLOCKED_ROWS ? ' locked' : '');
      slot.dataset.index = r * INV_COLS + c;
      if (r < INV_UNLOCKED_ROWS) {
        slot.addEventListener('click', (e) => handleSlotClick('inv', r * INV_COLS + c, e));
        slot.addEventListener('mouseenter', () => {
          setInvSelected(r * INV_COLS + c);
          lastHoveredSlot = { source: 'inv', index: r * INV_COLS + c };
        });
      }
      grid.appendChild(slot);
    }
  }
  setInvSelected(0);
})();

// Build chest grid slots
(function buildChestGrid() {
  const grid = document.getElementById('chest-grid');
  for (let i = 0; i < 20; i++) {
    const slot = document.createElement('div');
    slot.className = 'chest-slot';
    slot.dataset.index = i;
    slot.addEventListener('click', (e) => handleChestSlotClick(i, e));
    slot.addEventListener('mouseenter', () => { lastHoveredSlot = { source: 'chest', index: i }; });
    grid.appendChild(slot);
  }
})();

function setInvSelected(idx) {
  invSelected = idx;
  document.querySelectorAll('.inv-slot:not(.locked)').forEach(s => {
    s.classList.toggle('selected', parseInt(s.dataset.index) === invSelected);
  });
}

window.addEventListener('keydown', (e) => {
  if (splitDialog.style.display === 'block') return; // let dialog handle input

  if (e.code === 'KeyI') {
    inventoryOpen = !inventoryOpen;
    inventoryPanel.style.display = inventoryOpen ? 'block' : 'none';
  }
  // Y / N for delete confirmation
  if (pendingDelete) {
    if (e.code === 'KeyY') { removeStructureById(pendingDelete.id); hideDeleteConfirm(); return; }
    if (e.code === 'KeyN' || e.code === 'Escape') { hideDeleteConfirm(); return; }
    return; // block other keys while confirming
  }

  if (e.code === 'Escape' || e.code === 'KeyE') {
    if (openChestKey)    { closeChest();   return; }
    if (openFurnaceId)   { closeFurnace(); return; }
    if (openCatcherId)   { closeCatcher(); return; }
    if (inventoryOpen)   { inventoryOpen = false; inventoryPanel.style.display = 'none'; return; }
  }
  // Number keys 1-8 select hotbar slot
  const num = parseInt(e.key);
  if (num >= 1 && num <= HOTBAR_SLOTS) setHotbarSelected(num - 1);

  // Ctrl+S — manual save
  if (e.code === 'KeyS' && e.ctrlKey) {
    e.preventDefault();
    saveGame(); showSaveIndicator();
    return;
  }

  // F — use cup to drink, or eat selected hotbar food item
  if (e.code === 'KeyF') {
    const slot = hotbarData[hotbarSelected];
    if (slot.type === 'cup') {
      statHydration = Math.min(100, statHydration + 50);
      playSoundCraft();
      return;
    }
    const food = slot.type && FOOD_VALUES[slot.type];
    if (food) {
      statHunger    = Math.min(100, statHunger    + food.hunger);
      statHealth    = Math.min(100, statHealth    + food.health);
      statStamina   = Math.min(100, statStamina   + food.stamina);
      statHydration = Math.min(100, statHydration + food.hydration);
      slot.count--;
      if (!slot.count) slot.type = null;
      renderInventory();
      playSoundCraft(); // satisfying little chime when eating
    }
  }

  // R — rotate placeable
  if (e.code === 'KeyR' && buildMode) {
    placeRotation = (placeRotation + 1) % 4;
  }

  // X — split hovered slot
  if (e.code === 'KeyX' && lastHoveredSlot) {
    openSplitDialog(lastHoveredSlot.source, lastHoveredSlot.index);
  }
  // Q — drop hovered slot item
  if (e.code === 'KeyQ' && lastHoveredSlot) {
    const data = lastHoveredSlot.source === 'hotbar' ? hotbarData : invData;
    const slot = data[lastHoveredSlot.index];
    if (slot.type) { slot.type = null; slot.count = 0; renderInventory(); }
  }

  if (inventoryOpen) {
    const maxIdx = INV_UNLOCKED_ROWS * INV_COLS - 1;
    if (e.code === 'ArrowRight') { e.preventDefault(); setInvSelected(Math.min(invSelected + 1, maxIdx)); }
    if (e.code === 'ArrowLeft')  { e.preventDefault(); setInvSelected(Math.max(invSelected - 1, 0)); }
  }
});
const buildIndicator = document.getElementById('build-indicator');

// ============================================================
// INVENTORY SYSTEM
// ============================================================
const STACK_MAX = 20;
const PC_BASE = 'Assets/Pixel Crawler - Free Pack 2.0.4/Pixel Crawler - Free Pack';
const ITEM_SPRITES = {
  wood:         'Assets/raft/plank.png',
  plastic:      'Assets/raft/plastic.png',
  palm:         'Assets/raft/palm.png',
  cask:         'Assets/raft/Cask 0011.png',
  rope:         'Assets/raft/rope.png',
  campfire:     'Assets/raft/campfire_icon.png',
  cup:          'Assets/raft/cup.png',
  chest:        'Assets/raft/chest.png',
  sleeping_bag: 'Assets/raft/sleeping_bag.png',
  hammer:       'Assets/raft/hammer.png',
  workbench:    'Assets/raft/workbench.png',
  scrap_metal:  'Assets/raft/scrap_metal.png',
  raw_potato:    'Assets/raft/raw_potato.png',
  cooked_potato: 'Assets/raft/cooked_potato.png',
  netting:       'Assets/raft/netting.png?v=2',
};

// tileSize: how many tiles the structure spans (1 = normal, 2 = 2-tile along rotation axis)
const STRUCTURE_TILE_SIZE = { sleeping_bag: 2 };

const PLACEABLE_TYPES = new Set(['campfire', 'chest', 'sleeping_bag', 'workbench']);

// tier 1 recipes require a placed workbench
const TIER1_RECIPES = new Set(['campfire', 'cup', 'chest', 'sleeping_bag', 'netting']);

// Raft structures: items placed on raft tiles
let raftStructures = []; // { gridX, gridY, type, localX, localY, rotation }
let structureSprites = []; // parallel Phaser sprites
let phaserScene = null; // set in create()

// Placement state
let placeRotation = 0;   // 0-3 quarter turns
let placeGhostImg = null; // Phaser image for live ghost preview

// Chest storages keyed by "gx,gy"
const chestStorages = {};
// --- Player stats ---
let statHealth    = 100;
let statHunger    = 100;
let statHydration = 100;
let statStamina   = 100;

let openChestKey  = null; // which chest is open
let openFurnaceId = null; // which campfire is open

// Per-campfire state: { food: {type,count}, fuel: {type,count}, output: {type,count}, cookProgress: 0, fuelLeft: 0 }
const furnaceStates = {};

const COOK_TIME  = 10; // seconds to cook one item
const FUEL_TIME  = 15; // seconds one wood burns
const COOKABLE   = { raw_potato: 'cooked_potato' }; // food -> output
// Eating: type -> { hunger, health, stamina, hydration }
const FOOD_VALUES = {
  cooked_potato: { hunger: 45, health: 20, stamina: 35, hydration: 10 },
};

// slot data: { type: null | 'wood'|'plastic'|'palm'|'cask', count: 0 }
let hotbarData = Array.from({length: HOTBAR_SLOTS}, () => ({ type: null, count: 0 }));
let invData    = Array.from({length: INV_COLS * INV_ROWS},  () => ({ type: null, count: 0 }));

let heldItem = null;  // { type, count }
let heldFrom = null;  // { source: 'hotbar'|'inv', index }
let splitTarget = null; // { source, index } for split dialog

// Add items into inventory (hotbar first, then unlocked inv rows)
// Returns how many items could NOT fit (overflow).
function addToInventory(type, amount) {
  const targets = [
    ...hotbarData.map((s,i) => ({s, src:'hotbar', i})),
    ...invData.slice(0, INV_UNLOCKED_ROWS * INV_COLS).map((s,i) => ({s, src:'inv', i}))
  ];
  let rem = amount;
  // fill existing partial stacks
  for (const {s} of targets) {
    if (!rem) break;
    if (s.type === type && s.count < STACK_MAX) {
      const add = Math.min(STACK_MAX - s.count, rem);
      s.count += add; rem -= add;
    }
  }
  // fill empty slots
  for (const {s} of targets) {
    if (!rem) break;
    if (!s.type) {
      s.type = type; s.count = Math.min(STACK_MAX, rem); rem -= s.count;
    }
  }
  renderInventory();
  if (type === 'wood') checkHammerAutoCraft();
  return rem; // leftover that didn't fit
}

function checkHammerAutoCraft() {
  if (DEV_UNLIMITED) return; // dev mode starts with hammer already
  const realHammer = [...hotbarData, ...invData].reduce((n,s) => n + (s.type==='hammer' ? s.count : 0), 0);
  if (realHammer > 0) return;
  const realWood = [...hotbarData, ...invData].reduce((n,s) => n + (s.type==='wood' ? s.count : 0), 0);
  if (realWood < 10) return;
  removeItems('wood', 4);
  addToInventory('hammer', 1);
  showCaskPopup('Hammer crafted!');
}

// Refund a materials map { type: amount }. Overflow drops near the player.
function refundItems(materials) {
  for (const [type, amount] of Object.entries(materials)) {
    const overflow = addToInventory(type, amount);
    for (let i = 0; i < overflow; i++) {
      dropItemNearPlayer(type);
    }
  }
}

function dropItemNearPlayer(type) {
  if (!phaserScene) return;
  const angle = Math.random() * Math.PI * 2;
  const dist  = 10 + Math.random() * 10;
  const x = player.x + Math.cos(angle) * dist;
  const y = player.y + Math.sin(angle) * dist;
  const key  = type === 'wood' ? 'plank' : type;
  const size = type === 'plastic' ? 12 : 16;
  const gfx  = phaserScene.add.image(x, y, key).setDisplaySize(size, size).setDepth(0);
  gfx.rotation = type === 'scrap_metal' ? 0 : Math.random() * Math.PI * 2;
  floatingItems.push({ gfx, type, vx: 0, vy: 0, physX: x, physY: y, bobPhase: Math.random() * Math.PI * 2 });
}

const DEV_UNLIMITED = true;

function countItem(type) {
  if (DEV_UNLIMITED) return 9999;
  return [...hotbarData, ...invData].reduce((n, s) => n + (s.type === type ? s.count : 0), 0);
}

function removeItems(type, amount) {
  if (DEV_UNLIMITED) return;
  let rem = amount;
  for (const s of [...hotbarData, ...invData]) {
    if (!rem) break;
    if (s.type === type) {
      const take = Math.min(s.count, rem);
      s.count -= take; rem -= take;
      if (!s.count) s.type = null;
    }
  }
  renderInventory();
}

function renderSlot(el, slot) {
  // keep ::after overlays (selected/hover) intact — only touch data children
  let img = el.querySelector('.slot-icon');
  let cnt = el.querySelector('.slot-count');
  if (slot.type) {
    if (!img) { img = document.createElement('img'); img.className = 'slot-icon'; el.appendChild(img); }
    if (!cnt) { cnt = document.createElement('span'); cnt.className = 'slot-count'; el.appendChild(cnt); }
    img.src = ITEM_SPRITES[slot.type];
    cnt.textContent = slot.count > 1 ? slot.count : '';
  } else {
    img && img.remove();
    cnt && cnt.remove();
  }
}

function renderInventory() {
  document.querySelectorAll('.hotbar-slot').forEach((el, i) => renderSlot(el, hotbarData[i]));
  document.querySelectorAll('.inv-slot').forEach((el, i) => renderSlot(el, invData[i]));
  if (buildMode) { updateBuildIndicator(); updateCraftPanel(); updateTileModeIndicator(); }
  if (openChestKey)  renderChest();
  if (openFurnaceId) renderFurnace();
}

function updateBuildIndicator() {
  const wc = countItem('wood');
  const pc = countItem('plastic');
  const needW = Math.max(0, 10 - wc);
  const needP = Math.max(0, 2  - pc);
  const canAfford = needW === 0 && needP === 0;

  const icon = (src) => `<img src="${src}" style="width:16px;height:16px;image-rendering:pixelated;vertical-align:middle;margin:0 2px">`;

  let costLine =
    `<span style="color:${wc>=10?'#aaffaa':'#ff6666'}">${icon('Assets/raft/plank.png')} 10</span>` +
    `&nbsp;+&nbsp;` +
    `<span style="color:${pc>=2?'#aaffaa':'#ff6666'}">${icon('Assets/raft/plastic.png')} 2</span>`;

  let shortLine = '';
  if (!canAfford) {
    const parts = [];
    if (needW > 0) parts.push(`<span style="color:#ff6666">${needW} more ${icon('Assets/raft/plank.png')} Plank</span>`);
    if (needP > 0) parts.push(`<span style="color:#ff6666">${needP} more ${icon('Assets/raft/plastic.png')} Plastic</span>`);
    shortLine = `&nbsp;&nbsp;— Need: ${parts.join(' &amp; ')}`;
  }

  buildIndicator.innerHTML = `Raft Tile &nbsp;·&nbsp; ${costLine}${shortLine}`;
}

function updateTileModeIndicator() {
  const el = document.getElementById('tile-mode-indicator');
  if (!el) return;
  if (!buildMode) { el.style.display = 'none'; return; }
  const icon = (src) => `<img src="${src}" style="width:14px;height:14px;image-rendering:pixelated;vertical-align:middle;margin:0 2px">`;
  if (tilePlaceMode === 'catcher') {
    const nc = countItem('netting'), wc = countItem('wood');
    el.innerHTML = `${icon('Assets/raft/catcher.png')} CATCHER MODE &nbsp;·&nbsp; `
      + `<span style="color:${nc>=1?'#aaffaa':'#ff6666'}">${icon('Assets/raft/netting.png')} 1</span>`
      + ` + <span style="color:${wc>=10?'#aaffaa':'#ff6666'}">${icon('Assets/raft/plank.png')} 10</span>`
      + `<span style="color:#888;font-size:10px"> &nbsp;[N] to switch</span>`;
    el.style.color = '#6ecf6e';
  } else {
    el.innerHTML = `${icon('Assets/raft/plank.png')} RAFT MODE`
      + `<span style="color:#888;font-size:10px"> &nbsp;[N] for catcher</span>`;
    el.style.color = '#ddcc88';
  }
  el.style.display = 'block';
}

// --- Held item cursor ---
const heldEl = document.getElementById('held-item');
const heldImg = heldEl.querySelector('img');
const heldCnt = heldEl.querySelector('span');
document.addEventListener('mousemove', (e) => {
  if (heldItem) { heldEl.style.left = e.clientX + 'px'; heldEl.style.top = e.clientY + 'px'; }
});
function updateHeldCursor() {
  if (heldItem) {
    heldEl.style.display = 'block';
    heldImg.src = ITEM_SPRITES[heldItem.type];
    heldCnt.textContent = heldItem.count > 1 ? heldItem.count : '';
  } else {
    heldEl.style.display = 'none';
  }
}

// ============================================================
// CRAFTING SYSTEM
// ============================================================
const ITEM_SPRITES_EXT = Object.assign({}, ITEM_SPRITES, { rope: 'Assets/raft/rope.png' });

const RECIPES = {
  // Tier 0 — by hand
  rope:         { inputs: { palm: 5 },                   outputs: { rope: 1 },         label: 'Rope' },
  workbench:    { inputs: { wood: 10, rope: 1, scrap_metal: 2 }, outputs: { workbench: 1 }, label: 'Workbench' },
  // Tier 1 — requires placed workbench
  campfire:     { inputs: { wood: 10 },                  outputs: { campfire: 1 },     label: 'Campfire' },
  cup:          { inputs: { plastic: 10 },               outputs: { cup: 1 },          label: 'Cup' },
  chest:        { inputs: { wood: 10, rope: 2 },         outputs: { chest: 1 },        label: 'Small Chest' },
  sleeping_bag: { inputs: { rope: 2, palm: 10 },         outputs: { sleeping_bag: 1 }, label: 'Sleeping Bag' },
  netting:      { inputs: { rope: 5, wood: 10, plastic: 5, scrap_metal: 1 }, outputs: { netting: 1 }, label: 'Netting' },
};

function hasPlacedWorkbench() {
  return raftStructures.some(s => s.type === 'workbench');
}

function canCraft(id) {
  if (TIER1_RECIPES.has(id) && !hasPlacedWorkbench()) return false;
  const recipe = RECIPES[id];
  return Object.entries(recipe.inputs).every(([type, amt]) => countItem(type) >= amt);
}

function craftRecipe(id) {
  if (!canCraft(id)) return;
  const recipe = RECIPES[id];
  Object.entries(recipe.inputs).forEach(([type, amt]) => removeItems(type, amt));
  Object.entries(recipe.outputs).forEach(([type, amt]) => addToInventory(type, amt));
  playSoundCraft();
  updateCraftPanel();
}

const CENTER_ONLY_TYPES = new Set(['workbench', 'campfire']);
function stLocalX(st) { return CENTER_ONLY_TYPES.has(st.type) ? TILE_SIZE / 2 : (st.localX !== undefined ? st.localX : TILE_SIZE / 2); }
function stLocalY(st) { return CENTER_ONLY_TYPES.has(st.type) ? TILE_SIZE / 2 : (st.localY !== undefined ? st.localY : TILE_SIZE / 2); }

function cancelMove() {
  if (!movingStructure) return;
  raftStructures.push({ ...movingStructure });
  rebuildStructureSprites();
  movingStructure = null;
}

const craftPanel = document.getElementById('craft-panel');

function updateCraftPanel() {
  const wb = hasPlacedWorkbench();
  document.getElementById('tier1-recipes').classList.toggle('locked', !wb);

  for (const [id, recipe] of Object.entries(RECIPES)) {
    const affordable = canCraft(id);
    const row = document.getElementById(`recipe-${id}`);
    const btn = document.getElementById(`craft-${id}-btn`);
    if (!row) continue;
    row.classList.toggle('cant-afford', !affordable);
    btn.disabled = !affordable;
    for (const [type, needed] of Object.entries(recipe.inputs)) {
      const el = document.getElementById(`recipe-${id}-${type}`);
      if (el) el.textContent = `${countItem(type)} / ${needed}`;
    }
    // Place button state
  }
}

// --- Hammer cursor ---
const hammerCursor = document.getElementById('hammer-cursor');
document.addEventListener('mousemove', (e) => {
  hammerCursor.style.left = e.clientX + 'px';
  hammerCursor.style.top  = e.clientY + 'px';
});
craftPanel.addEventListener('mouseenter', () => { hammerCursor.style.visibility = 'hidden'; });
craftPanel.addEventListener('mouseleave', () => { hammerCursor.style.visibility = 'visible'; });

// Drop held item on right-click
document.addEventListener('contextmenu', (e) => {
  if (heldItem) { e.preventDefault(); heldItem = null; heldFrom = null; updateHeldCursor(); }
});

// --- Slot click handler ---
function handleSlotClick(source, index, e) {
  const data = source === 'hotbar' ? hotbarData : invData;
  const slot  = data[index];

  // Shift-click: move item to open chest
  if (e && e.shiftKey && openChestKey && slot.type && !heldItem) {
    const chestSlots = chestStorages[openChestKey];
    let rem = slot.count;
    // fill partial stacks first
    for (const cs of chestSlots) {
      if (!rem) break;
      if (cs.type === slot.type && cs.count < STACK_MAX) {
        const add = Math.min(STACK_MAX - cs.count, rem);
        cs.count += add; rem -= add;
      }
    }
    // fill empty slots
    for (const cs of chestSlots) {
      if (!rem) break;
      if (!cs.type) { cs.type = slot.type; cs.count = Math.min(STACK_MAX, rem); rem -= cs.count; }
    }
    slot.count = rem;
    if (!rem) slot.type = null;
    renderInventory(); renderChest();
    return;
  }
  if (heldItem) {
    if (!slot.type) {
      // place into empty slot
      slot.type = heldItem.type; slot.count = heldItem.count;
      heldItem = null; heldFrom = null;
    } else if (slot.type === heldItem.type && slot.count < STACK_MAX) {
      // merge same type
      const add = Math.min(STACK_MAX - slot.count, heldItem.count);
      slot.count += add; heldItem.count -= add;
      if (!heldItem.count) { heldItem = null; heldFrom = null; }
    } else {
      // swap
      const tmp = { type: slot.type, count: slot.count };
      slot.type = heldItem.type; slot.count = heldItem.count;
      heldItem = tmp; heldFrom = { source, index };
    }
  } else if (slot.type) {
    heldItem = { type: slot.type, count: slot.count };
    heldFrom = { source, index };
    slot.type = null; slot.count = 0;
  }
  renderInventory();
  updateHeldCursor();
}

// --- Split dialog ---
const splitDialog  = document.getElementById('split-dialog');
const splitRange   = document.getElementById('split-range');
const splitVal     = document.getElementById('split-val');
const splitLabel   = document.getElementById('split-label');
splitRange.addEventListener('input', () => { splitVal.textContent = splitRange.value; });
document.getElementById('split-confirm').addEventListener('click', () => {
  if (!splitTarget) return;
  const data  = splitTarget.source === 'hotbar' ? hotbarData : invData;
  const slot  = data[splitTarget.index];
  const amt   = parseInt(splitRange.value);
  if (!slot.type || amt <= 0 || amt >= slot.count) { splitDialog.style.display = 'none'; splitTarget = null; return; }
  slot.count -= amt;
  // put split amount into held
  heldItem = { type: slot.type, count: amt };
  heldFrom = null;
  renderInventory();
  updateHeldCursor();
  splitDialog.style.display = 'none';
  splitTarget = null;
});
document.getElementById('split-cancel').addEventListener('click', () => {
  splitDialog.style.display = 'none'; splitTarget = null;
});

function openSplitDialog(source, index) {
  const data = source === 'hotbar' ? hotbarData : invData;
  const slot  = data[index];
  if (!slot.type || slot.count < 2) return;
  splitTarget = { source, index };
  splitLabel.textContent = `Split  ×${slot.count}`;
  splitRange.max   = slot.count - 1;
  splitRange.value = Math.floor(slot.count / 2);
  splitVal.textContent = splitRange.value;
  splitDialog.style.display = 'block';
}

// Q to drop item in hovered/active slot — track last hovered slot
let lastHoveredSlot = null;

// --- Hook state ---
let hookState    = 'idle'; // 'idle' | 'charging' | 'flying' | 'landed' | 'reeling'
let hookedItems  = { wood: 0, plastic: 0, palm: 0, cask: 0, scrap_metal: 0 };
let chargeTime   = 0;
let hookX = 0,  hookY = 0;
let hookStartX = 0, hookStartY = 0;
let hookEndX = 0,   hookEndY = 0;
let hookT        = 0;   // 0..1 arc progress
let hookDuration = 0;   // seconds for full arc
let hookArcHeight = 0;  // peak height of the lob
let hookGfx, hookLineGfx, hookSprite;
let hookedWoodSprites = [], hookedPlasticSprites = [], hookedPalmSprites = [], hookedCaskSprites = [], hookedScrapSprites = [];
let spaceKey;
let sndWoosh, sndSplash, sndReel, sndPickup, sndPop;
let reelPlaying = false;

// ── Synthesized UI sounds ─────────────────────────────────────
let _ac = null;
function _getAC() {
  if (!_ac) _ac = new (window.AudioContext || window.webkitAudioContext)();
  return _ac;
}
function _note(freq, endFreq, type, vol, dur, startOffset = 0) {
  const ac  = _getAC();
  const osc = ac.createOscillator();
  const env = ac.createGain();
  osc.connect(env); env.connect(ac.destination);
  osc.type = type;
  const t = ac.currentTime + startOffset;
  osc.frequency.setValueAtTime(freq, t);
  if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(vol, t + 0.005);
  env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.start(t); osc.stop(t + dur + 0.02);
}
function playSoundBuildMode() {
  // Two quick wooden knocks — low thud + mid tap
  _note(180, 90,  'triangle', 0.35, 0.12, 0);
  _note(260, 140, 'triangle', 0.25, 0.10, 0.08);
}
function playSoundPlace() {
  // Soft woody plop — freq drops fast like something settling
  _note(200, 70, 'triangle', 0.4, 0.18, 0);
  _note(400, 200,'sine',     0.15, 0.08, 0);
}
function playSoundCraft() {
  // Rising chime — three ascending sine tones
  _note(523, null, 'sine', 0.28, 0.15, 0);
  _note(659, null, 'sine', 0.24, 0.15, 0.1);
  _note(784, null, 'sine', 0.20, 0.20, 0.2);
}
let splashGfx, splashT = 0, splashX = 0, splashY = 0;
let chargeBarGfx;

// ============================================================
// PRELOAD
// ============================================================
function preload() {
  this.load.audio('ocean',   'Assets/sounds/oceansound.mp3');
  this.load.audio('song1',   'Assets/sounds/song1.mp3');
  this.load.audio('woosh',   'Assets/sounds/cast woosh.mp3');
  this.load.audio('splash',  'Assets/sounds/water splash.mp3');
  this.load.audio('reel',    'Assets/sounds/reelnoise.mp3');
  this.load.audio('pickup',  'Assets/sounds/item pickup.mp3');
  this.load.audio('seagull', 'Assets/sounds/seagull1.mp3');
  this.load.audio('pop1',    'Assets/sounds/pop1.mp3');
  this.load.spritesheet('water_sheet', 'Assets/water/Water_tiles.png', {
    frameWidth: 16, frameHeight: 16
  });
  this.load.image('hook', 'Assets/raft/hook.png');
  this.load.image('raft_tile', 'Assets/raft/raft.png');
  this.load.image('plank',   'Assets/raft/plank.png');
  this.load.image('plastic', 'Assets/raft/plastic.png');
  this.load.image('palm',    'Assets/raft/palm.png');
  this.load.image('cask',    'Assets/raft/Cask 0011.png');
  this.load.image('cup',           'Assets/raft/cup.png');
  this.load.image('chest',         'Assets/raft/chest.png');
  this.load.image('sleeping_bag',  'Assets/raft/sleeping_bag.png');
  this.load.image('hammer',        'Assets/raft/hammer.png');
  this.load.image('workbench',     'Assets/raft/workbench.png');
  this.load.image('scrap_metal',   'Assets/raft/scrap_metal.png');
  this.load.image('raw_potato',    'Assets/raft/raw_potato.png');
  this.load.image('cooked_potato', 'Assets/raft/cooked_potato.png');
  this.load.image('netting',       'Assets/raft/netting.png?v=2');
  this.load.image('catcher',       'Assets/raft/catcher.png');
  this.load.image('campfire_icon', 'Assets/raft/campfire_icon.png');
  const PC = 'Assets/Pixel Crawler - Free Pack 2.0.4/Pixel Crawler - Free Pack';
  this.load.spritesheet('campfire', PC + '/Environment/Structures/Stations/Bonfire/Bonfire_01-Sheet.png',
    { frameWidth: 32, frameHeight: 32 });

  this.load.spritesheet('char_idle_down', 'Assets/char/idle_down.png', { frameWidth: 64, frameHeight: 64 });
  this.load.spritesheet('char_idle_side', 'Assets/char/idle_side.png', { frameWidth: 64, frameHeight: 64 });
  this.load.spritesheet('char_idle_up',   'Assets/char/idle_up.png',   { frameWidth: 64, frameHeight: 64 });
  this.load.spritesheet('char_walk_down', 'Assets/char/walk_down.png', { frameWidth: 64, frameHeight: 64 });
  this.load.spritesheet('char_walk_side', 'Assets/char/walk_side.png', { frameWidth: 64, frameHeight: 64 });
  this.load.spritesheet('char_walk_up',   'Assets/char/walk_up.png',   { frameWidth: 64, frameHeight: 64 });
}

// ============================================================
// CREATE
// ============================================================
function create() {
  phaserScene = this;

  this.physics.world.setBounds(0, 0, WORLD_SIZE, WORLD_SIZE);

  this.anims.create({
    key: 'campfire_burn',
    frames: this.anims.generateFrameNumbers('campfire', { start: 0, end: 3 }),
    frameRate: 6,
    repeat: -1
  });

  waterBg = this.add.tileSprite(0, 0, WORLD_SIZE, WORLD_SIZE, 'water_sheet', 277)
    .setOrigin(0, 0).setTileScale(4, 4).setDepth(-1);

  raftTiles = [
    { gridX: 0, gridY: 0 },
    { gridX: 1, gridY: 0 },
  ];
  raftContainer = this.add.container(WORLD_SIZE / 2, WORLD_SIZE / 2).setDepth(1);
  buildRaft.call(this, raftTiles, raftContainer);

  player = this.physics.add.sprite(
    raftContainer.x + TILE_SIZE,
    raftContainer.y + TILE_SIZE / 2,
    'char_idle_down'
  );
  player.setScale(0.5);
  player.body.setSize(10, 14, true); // tight hitbox for small raft
  player.setCollideWorldBounds(true);
  player.setDepth(3);

  this.anims.create({ key: 'idle_down', frames: this.anims.generateFrameNumbers('char_idle_down', { start: 0, end: 3 }), frameRate: 6,  repeat: -1 });
  this.anims.create({ key: 'idle_side', frames: this.anims.generateFrameNumbers('char_idle_side', { start: 0, end: 3 }), frameRate: 6,  repeat: -1 });
  this.anims.create({ key: 'idle_up',   frames: this.anims.generateFrameNumbers('char_idle_up',   { start: 0, end: 3 }), frameRate: 6,  repeat: -1 });
  this.anims.create({ key: 'walk_down', frames: this.anims.generateFrameNumbers('char_walk_down', { start: 0, end: 5 }), frameRate: 10, repeat: -1 });
  this.anims.create({ key: 'walk_side', frames: this.anims.generateFrameNumbers('char_walk_side', { start: 0, end: 5 }), frameRate: 10, repeat: -1 });
  this.anims.create({ key: 'walk_up',   frames: this.anims.generateFrameNumbers('char_walk_up',   { start: 0, end: 5 }), frameRate: 10, repeat: -1 });

  player.anims.play('idle_down');

  wasd = this.input.keyboard.addKeys({
    up:    Phaser.Input.Keyboard.KeyCodes.W,
    down:  Phaser.Input.Keyboard.KeyCodes.S,
    left:  Phaser.Input.Keyboard.KeyCodes.A,
    right: Phaser.Input.Keyboard.KeyCodes.D
  });

  this.input.keyboard.on('keydown-B', function () {
    const hasHammer = [...hotbarData, ...invData].some(s => s.type === 'hammer' && s.count > 0);
    if (!hasHammer) return;
    buildMode = !buildMode;
    if (buildMode) { playSoundBuildMode(); updateBuildIndicator(); updateCraftPanel(); tilePlaceMode = 'normal'; updateTileModeIndicator(); }
    else { ghostGfx.clear(); placeRotation = 0; placeGhostImg.setVisible(false); cancelMove(); hideDeleteConfirm(); tilePlaceMode = 'normal'; updateTileModeIndicator(); }
    buildIndicator.style.display = buildMode ? 'block' : 'none';
    hammerCursor.style.display   = buildMode ? 'block' : 'none';
    craftPanel.style.display     = buildMode ? 'block' : 'none';
    document.body.classList.toggle('build-mode', buildMode);
  });

  this.input.keyboard.on('keydown-N', function () {
    if (!buildMode) return;
    tilePlaceMode = tilePlaceMode === 'normal' ? 'catcher' : 'normal';
    updateTileModeIndicator();
  });

  this.cameras.main.setBounds(0, 0, WORLD_SIZE, WORLD_SIZE);
  this.cameras.main.setZoom(3);
  this.cameras.main.centerOn(player.x, player.y);
  this.cameras.main.startFollow(player, false, 0.12, 0.12);


  // --- Build mode setup ---
  // Give player starting hammer (build tool)
  hotbarData[0] = { type: 'hammer', count: 1 };
  renderInventory();
  ghostGfx = this.add.graphics().setDepth(10);
  placeGhostImg = this.add.image(0, 0, 'chest').setDepth(11).setAlpha(0.55).setVisible(false);

  this.input.on('pointerdown', (pointer) => {
    const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const gx = Math.floor((world.x - raftContainer.x) / TILE_SIZE);
    const gy = Math.floor((world.y - raftContainer.y) / TILE_SIZE);
    const occupied = new Set([...raftTiles, ...catcherTiles].map(t => `${t.gridX},${t.gridY}`));

    if (!buildMode) {
      let nearest = null, nearDist = 22, nearType = null;
      for (const st of raftStructures) {
        if (st.type !== 'chest' && st.type !== 'campfire') continue;
        const lx = stLocalX(st);
        const ly = stLocalY(st);
        const wx2 = raftContainer.x + st.gridX * TILE_SIZE + lx;
        const wy2 = raftContainer.y + st.gridY * TILE_SIZE + ly;
        const d = Math.hypot(world.x - wx2, world.y - wy2);
        if (d < nearDist) { nearDist = d; nearest = st; nearType = st.type; }
      }
      if (nearest) {
        if (nearType === 'chest') openChest(nearest.id);
        else if (nearType === 'campfire') openFurnace(nearest.id);
        return;
      }
      // Check catcher tiles
      for (const ct of catcherTiles) {
        const wx2 = raftContainer.x + ct.gridX * TILE_SIZE + TILE_SIZE / 2;
        const wy2 = raftContainer.y + ct.gridY * TILE_SIZE + TILE_SIZE / 2;
        if (Math.hypot(world.x - wx2, world.y - wy2) < 22) {
          openCatcher(ct.id);
          return;
        }
      }
      return;
    }

    // Right-click: cancel move, or remove structure, then tile
    if (pointer.rightButtonDown()) {
      if (movingStructure) { cancelMove(); return; }
      let nearSt = null, nearDist = 14;
      for (const st of raftStructures) {
        const lx = stLocalX(st);
        const ly = stLocalY(st);
        const wx2 = raftContainer.x + st.gridX * TILE_SIZE + lx;
        const wy2 = raftContainer.y + st.gridY * TILE_SIZE + ly;
        const d = Math.hypot(world.x - wx2, world.y - wy2);
        if (d < nearDist) { nearDist = d; nearSt = st; }
      }
      if (nearSt) { showDeleteConfirm(nearSt); return; }
      // Remove catcher tile
      const catchIdx = catcherTiles.findIndex(t => t.gridX === gx && t.gridY === gy);
      if (catchIdx !== -1) {
        const ct = catcherTiles[catchIdx];
        catcherTiles.splice(catchIdx, 1);
        delete catcherStorages[ct.id];
        if (openCatcherId == ct.id) closeCatcher();
        addToInventory('netting', 1);
        addToInventory('wood', 10);
        rebuildCatcherSprites.call(this);
        return;
      }
      const idx = raftTiles.findIndex(t => t.gridX === gx && t.gridY === gy);
      if (idx !== -1 && raftTiles.length > 1) {
        raftTiles.splice(idx, 1);
        refundItems({ wood: 10, plastic: 2 });
        raftContainer.removeAll(true);
        buildRaft.call(this, raftTiles, raftContainer);
        rebuildStructureSprites();
      }
      return;
    }

    // Left-click on existing structure: pick it up to move
    if (!movingStructure) {
      let nearSt = null, nearDist = 14;
      for (const st of raftStructures) {
        const lx = stLocalX(st);
        const ly = stLocalY(st);
        const wx2 = raftContainer.x + st.gridX * TILE_SIZE + lx;
        const wy2 = raftContainer.y + st.gridY * TILE_SIZE + ly;
        const d = Math.hypot(world.x - wx2, world.y - wy2);
        if (d < nearDist) { nearDist = d; nearSt = st; }
      }
      if (nearSt) {
        // Lift the structure: remove from world, keep all its data
        movingStructure = { ...nearSt };
        const idx = raftStructures.indexOf(nearSt);
        if (idx !== -1) raftStructures.splice(idx, 1);
        rebuildStructureSprites();
        placeRotation = nearSt.rotation || 0;
        return;
      }
    }

    // Place a structure that's being moved
    if (movingStructure) {
      if (!occupied.has(`${gx},${gy}`)) return;
      const span = STRUCTURE_TILE_SIZE[movingStructure.type] || 1;
      if (span === 2) {
        const [dx2, dy2] = placeRotation % 2 === 0 ? [1, 0] : [0, 1];
        const gx2 = gx + dx2, gy2 = gy + dy2;
        if (!occupied.has(`${gx2},${gy2}`)) return;
      }
      const mid = TILE_SIZE / 2;
      let localX = mid, localY = mid;
      if (movingStructure.type === 'chest') {
        const raw_lx = Phaser.Math.Clamp(world.x - (raftContainer.x + gx * TILE_SIZE), 0, TILE_SIZE);
        const raw_ly = Phaser.Math.Clamp(world.y - (raftContainer.y + gy * TILE_SIZE), 0, TILE_SIZE);
        const h = TILE_SIZE * 0.375, z = TILE_SIZE / 3;
        const inLeft = raw_lx < z, inRight = raw_lx > TILE_SIZE - z;
        const inTop  = raw_ly < z, inBottom = raw_ly > TILE_SIZE - z;
        if      (inLeft)   { localX = h;             localY = mid; }
        else if (inRight)  { localX = TILE_SIZE - h; localY = mid; }
        else if (inTop)    { localX = mid;            localY = h; }
        else if (inBottom) { localX = mid;            localY = TILE_SIZE - h; }
        else               { localX = mid;            localY = mid; }
      }
      // Re-insert with new position, preserving id and storage
      raftStructures.push({ ...movingStructure, gridX: gx, gridY: gy, localX, localY, rotation: placeRotation });
      if (sndPop) sndPop.play();
      rebuildStructureSprites();
      movingStructure = null;
      return;
    }

    // Check if hotbar has a placeable item selected
    const hotSlot = hotbarData[hotbarSelected];
    if (hotSlot.type && PLACEABLE_TYPES.has(hotSlot.type)) {
      if (!occupied.has(`${gx},${gy}`)) return;
      // 2-tile structures: check second tile based on rotation
      const span = STRUCTURE_TILE_SIZE[hotSlot.type] || 1;
      if (span === 2) {
        const [dx2, dy2] = placeRotation % 2 === 0 ? [1, 0] : [0, 1];
        const gx2 = gx + dx2, gy2 = gy + dy2;
        if (!occupied.has(`${gx2},${gy2}`)) return;
        if (getStructuresOnTile(gx, gy, hotSlot.type).length || getStructuresOnTile(gx2, gy2, hotSlot.type).length) return;
      }
      // Snap localX/localY: chests use 5-position edge snap, everything else centers on tile
      const mid = TILE_SIZE / 2;
      let localX = mid, localY = mid;
      if (hotSlot.type === 'chest') {
        const raw_lx = Phaser.Math.Clamp(world.x - (raftContainer.x + gx * TILE_SIZE), 0, TILE_SIZE);
        const raw_ly = Phaser.Math.Clamp(world.y - (raftContainer.y + gy * TILE_SIZE), 0, TILE_SIZE);
        const h = TILE_SIZE * 0.375;
        const z = TILE_SIZE / 3;
        const inLeft = raw_lx < z, inRight = raw_lx > TILE_SIZE - z;
        const inTop  = raw_ly < z, inBottom = raw_ly > TILE_SIZE - z;
        if      (inLeft)   { localX = h;             localY = mid; }
        else if (inRight)  { localX = TILE_SIZE - h; localY = mid; }
        else if (inTop)    { localX = mid;            localY = h; }
        else if (inBottom) { localX = mid;            localY = TILE_SIZE - h; }
        else               { localX = mid;            localY = mid; }
      }
      if (placeStructure(gx, gy, hotSlot.type, localX, localY, placeRotation)) {
        hotSlot.count--;
        if (!hotSlot.count) hotSlot.type = null;
        renderInventory();
      }
      return;
    }

    // Normal / catcher tile placement
    if (occupied.has(`${gx},${gy}`)) return;
    const adjacent = [[1,0],[-1,0],[0,1],[0,-1]]
      .some(([dx, dy]) => occupied.has(`${gx + dx},${gy + dy}`));
    if (!adjacent) return;

    // Catcher tile mode (N key toggle)
    if (tilePlaceMode === 'catcher') {
      if (countItem('netting') < 1 || countItem('wood') < 10) return;
      removeItems('netting', 1);
      removeItems('wood', 10);
      const catchId = Date.now() + Math.random();
      catcherTiles.push({ gridX: gx, gridY: gy, id: catchId });
      catcherStorages[catchId] = [];
      if (sndPop) sndPop.play();
      rebuildCatcherSprites.call(this);
      renderInventory();
      return;
    }

    if (countItem('wood') < 10 || countItem('plastic') < 2) return;
    removeItems('wood', 10);
    removeItems('plastic', 2);

    raftTiles.push({ gridX: gx, gridY: gy });
    if (sndPop) sndPop.play();
    raftContainer.removeAll(true);
    buildRaft.call(this, raftTiles, raftContainer);
    rebuildStructureSprites();
  });

  // --- Hook setup ---
  spaceKey     = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
  chargeBarGfx = this.add.graphics().setDepth(6);
  hookGfx      = this.add.graphics().setDepth(5);
  hookLineGfx = this.add.graphics().setDepth(4);
  hookSprite  = this.add.image(0, 0, 'hook').setDepth(5).setVisible(false).setDisplaySize(8, 8);

  // Sprite pools for items riding the hook (max 5 of each)
  for (let i = 0; i < 5; i++) {
    hookedWoodSprites.push(this.add.image(0, 0, 'plank').setDisplaySize(10, 10).setDepth(5).setVisible(false));
    hookedPlasticSprites.push(this.add.image(0, 0, 'plastic').setDisplaySize(10, 10).setDepth(5).setVisible(false));
    hookedPalmSprites.push(this.add.image(0, 0, 'palm').setDisplaySize(10, 10).setDepth(5).setVisible(false));
    hookedCaskSprites.push(this.add.image(0, 0, 'cask').setDisplaySize(12, 12).setDepth(5).setVisible(false));
    hookedScrapSprites.push(this.add.image(0, 0, 'scrap_metal').setDisplaySize(10, 10).setDepth(5).setVisible(false));
  }
  splashGfx   = this.add.graphics().setDepth(3.5);

  window.addEventListener('resize', () => {
    game.scale.resize(window.innerWidth, window.innerHeight);
  });

  // Fire on space release
  this.input.keyboard.on('keyup-SPACE', function () {
    if (buildMode || hookState !== 'charging') return;
    chargeBarGfx.clear();

    const pointer = this.input.mousePointer;
    const worldPt = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const dx = worldPt.x - player.x;
    const dy = worldPt.y - player.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1) { hookState = 'idle'; chargeTime = 0; return; }

    const ratio    = chargeTime / MAX_CHARGE_TIME;
    const dist     = MIN_HOOK_DIST + ratio * (MAX_HOOK_DIST - MIN_HOOK_DIST);
    const hand     = getHandPos();
    hookStartX = hookX = hand.x;
    hookStartY = hookY = hand.y;
    hookEndX   = Phaser.Math.Clamp(player.x + (dx / len) * dist, 0, WORLD_SIZE);
    hookEndY   = Phaser.Math.Clamp(player.y + (dy / len) * dist, 0, WORLD_SIZE);
    hookT         = 0;
    hookDuration  = 0.35 + ratio * 0.45; // 0.35–0.8s
    hookArcHeight = 18 + ratio * 22;     // bigger lob on fuller charge
    hookState     = 'flying';
    chargeTime    = 0;
    if (sndWoosh) sndWoosh.play();
  }, this);


  // --- Audio (starts on first input to satisfy browser autoplay policy) ---
  const startAudio = () => {
    if (this.sound.get('ocean')) return;
    this.sound.add('ocean', { loop: true, volume: 0.18 }).play();
    this.sound.add('song1', { loop: true, volume: 0.45 }).play();
    sndWoosh  = this.sound.add('woosh',  { volume: 0.55 });
    sndSplash = this.sound.add('splash', { volume: 0.4  });
    sndReel   = this.sound.add('reel',   { loop: true, volume: 0.3 });
    sndPickup  = this.sound.add('pickup',  { volume: 0.7  });
    sndPop     = this.sound.add('pop1',    { volume: 0.9  });
    sndSeagull = this.sound.add('seagull', { volume: 0.5  });
  };
  this.input.once('pointerdown', startAudio);
  this.input.keyboard.once('keydown', startAudio);

  // Seed the world with debris already in transit — all off-screen, staggered distances
  // so they arrive spread out rather than all at once
  const seedCam  = this.cameras.main;
  const seedHalfW = (seedCam.width  / seedCam.zoom) / 2;
  const seedHalfH = (seedCam.height / seedCam.zoom) / 2;
  const seedEdge  = Math.sqrt(seedHalfW * seedHalfW + seedHalfH * seedHalfH) + 20;
  for (let i = 0; i < 5; i++) {
    const fanOffset  = ((i / 4) - 0.5) * (Math.PI * 0.44);
    const groupAngle = driftAngle + Math.PI + fanOffset;
    const dist = seedEdge + i * 45;
    spawnGroupAt.call(this, groupAngle, dist);
  }

  // Load saved game (must be last — overwrites defaults set above)
  loadGame.call(this);

  // Autosave every 60 seconds
  this.time.addEvent({ delay: 60000, loop: true, callback: () => { saveGame(); showSaveIndicator(); } });
  window.addEventListener('beforeunload', saveGame);
}

// ============================================================
// FLOATING ITEMS
// ============================================================

/**
 * Spawn a group from upstream at a safe off-screen distance (regular timer use).
 */
function spawnGroup() {
  const cam   = this.cameras.main;
  const halfW = (cam.width  / cam.zoom) / 2;
  const halfH = (cam.height / cam.zoom) / 2;
  const edge  = Math.sqrt(halfW * halfW + halfH * halfH) + 20;
  const dist  = edge + Math.random() * 50;
  spawnGroupAt.call(this, driftAngle + Math.PI, dist);
}

/**
 * Spawn a loose cluster from a given direction and distance.
 * @param {number} fromAngle - world angle the group comes FROM (upstream direction)
 * @param {number} dist      - world-px distance from raft center
 */
function spawnGroupAt(fromAngle, dist) {
  const count = 3 + Math.floor(Math.random() * 4); // 3–6 items per group

  const cx = raftContainer.x + Math.cos(fromAngle) * dist;
  const cy = raftContainer.y + Math.sin(fromAngle) * dist;

  const perpAngle  = fromAngle + Math.PI / 2;
  const groupWidth = 25 + Math.random() * 35; // 25–60 px — tighter, feels like same current stream

  for (let i = 0; i < count; i++) {
    const lateral = (Math.random() - 0.5) * groupWidth;
    const depth   = (Math.random() - 0.5) * 24;
    const x = cx + Math.cos(perpAngle) * lateral + Math.cos(fromAngle) * depth;
    const y = cy + Math.sin(perpAngle) * lateral + Math.sin(fromAngle) * depth;
    spawnItemAt.call(this, x, y);
  }
}

/**
 * Spawn a single debris item at world position (x, y) moving with the ocean current.
 */
function spawnItemAt(x, y) {
  const caskOnScreen = floatingItems.some(it => it.type === 'cask');
  const roll = Math.random();
  const type = (!caskOnScreen && roll > 0.96) ? 'cask'
             : roll < 0.52 ? 'wood'
             : roll < 0.68 ? 'plastic'
             : roll < 0.92 ? 'palm'
             : 'scrap_metal';
  const key  = type === 'wood' ? 'plank' : type;
  const size = type === 'plastic' ? 12 : 16;

  const gfx = this.add.image(x, y, key).setDisplaySize(size, size).setDepth(0);
  gfx.rotation = type === 'scrap_metal' ? 0 : Math.random() * Math.PI * 2;

  // Aim toward the raft with slight spread — guarantees debris passes through the play area
  const toRaft = Math.atan2(raftContainer.y - y, raftContainer.x - x);
  const spread = (Math.random() - 0.5) * 0.55; // ±~16° so groups fan out naturally
  const speed  = CURRENT_SPEED * (0.8 + Math.random() * 0.4);

  floatingItems.push({
    gfx, type,
    vx: Math.cos(toRaft + spread) * speed,
    vy: Math.sin(toRaft + spread) * speed,
    physX: x, physY: y,
    bobPhase: Math.random() * Math.PI * 2
  });
}


/**
 * Returns the axis-aligned bounding box of all raft tiles in world space.
 */
function getRaftBounds() {
  const T = TILE_SIZE;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const tile of raftTiles) {
    const tx = raftContainer.x + tile.gridX * T;
    const ty = raftContainer.y + tile.gridY * T;
    minX = Math.min(minX, tx);     minY = Math.min(minY, ty);
    maxX = Math.max(maxX, tx + T); maxY = Math.max(maxY, ty + T);
  }
  return { minX, minY, maxX, maxY };
}

// ============================================================
// UPDATE
// ============================================================
function update(time, delta) {
  const dt = delta / 1000;

  // --- Build mode ---
  if (buildMode) {
    renderInventory(); // keeps build cost colours fresh
    drawGhostTiles(this.input.mousePointer, this.cameras.main);
  }

  // --- Furnace tick ---
  tickFurnaces(dt);
  tickCatchers();

  // --- Stats tick ---
  tickStats(dt);

  // --- Drift ---
  driftAngle += DRIFT_TURN * dt;
  const driftDX = Math.cos(driftAngle) * DRIFT_SPEED * dt;
  const driftDY = Math.sin(driftAngle) * DRIFT_SPEED * dt;

  const clampedRX = Phaser.Math.Clamp(raftContainer.x + driftDX, WORLD_MARGIN, WORLD_SIZE - WORLD_MARGIN);
  const clampedRY = Phaser.Math.Clamp(raftContainer.y + driftDY, WORLD_MARGIN, WORLD_SIZE - WORLD_MARGIN);
  const actualDX  = clampedRX - raftContainer.x;
  const actualDY  = clampedRY - raftContainer.y;
  raftContainer.x = clampedRX;
  raftContainer.y = clampedRY;
  player.x += actualDX;
  player.y += actualDY;

  // Water scrolls with ocean current
  waterBg.tilePositionX += Math.cos(driftAngle) * CURRENT_SPEED * dt * 0.18 + actualDX * 0.05;
  waterBg.tilePositionY += Math.sin(driftAngle) * CURRENT_SPEED * dt * 0.18 + actualDY * 0.05;

  // --- Seagull ambiance ---
  seagullTimer -= dt;
  if (seagullTimer <= 0) {
    if (sndSeagull) sndSeagull.play();
    seagullTimer = 120 + Math.random() * 120; // next call in 2–4 min
  }

  // --- Current shift ---
  currentShiftTimer -= dt;
  if (currentShiftTimer <= 0) {
    // Rotate current 60–150° so the new groups visibly come from a different direction
    const shift = (Math.PI / 3) + Math.random() * (Math.PI / 3);
    driftAngle += Math.random() < 0.5 ? shift : -shift;
    currentShiftTimer = 25 + Math.random() * 20; // next shift in 25–45 s
  }

  // --- Wave spawner: burst of groups, then calm gap ---
  if (waveGroupsLeft > 0) {
    waveGroupTimer -= dt;
    if (waveGroupTimer <= 0) {
      spawnGroup.call(this);
      waveGroupsLeft--;
      waveGroupTimer = WAVE_SUBGROUP_GAP + Math.random() * 0.6;
    }
  } else {
    waveTimer -= dt;
    if (waveTimer <= 0) {
      waveGroupsLeft = 2 + Math.floor(Math.random() * 4); // 2–5 groups per wave
      waveGroupTimer = 0;
      waveTimer = WAVE_INTERVAL_MIN + Math.random() * (WAVE_INTERVAL_MAX - WAVE_INTERVAL_MIN);
    }
  }


  // --- Player movement (locked only while hook is flying) ---
  const canMove = hookState !== 'flying';
  player.setVelocity(0);

  if (canMove) {
    let vx = 0, vy = 0;
    if (wasd.left.isDown)       vx = -PLAYER_SPEED;
    else if (wasd.right.isDown) vx =  PLAYER_SPEED;
    if (wasd.up.isDown)         vy = -PLAYER_SPEED;
    else if (wasd.down.isDown)  vy =  PLAYER_SPEED;
    if (vx !== 0 && vy !== 0)  { vx *= 0.7071; vy *= 0.7071; } // normalize diagonal

    const nx = player.x + vx * dt;
    const ny = player.y + vy * dt;
    const feet = 8;
    if      (isOnRaft(nx, ny + feet))         { player.x = nx; player.y = ny; }
    else if (isOnRaft(nx, player.y + feet))   { player.x = nx; }
    else if (isOnRaft(player.x, ny + feet))   { player.y = ny; }
  }

  // Chest collision runs every frame (covers both movement and raft drift)
  resolveChestCollision();

  // --- Floating items ---
  const raftBounds = getRaftBounds();
  const pad = 6; // item half-size buffer
  const cam = this.cameras.main;
  const halfW = (cam.width  / cam.zoom) / 2;
  const halfH = (cam.height / cam.zoom) / 2;
  const maxDist = Math.sqrt(halfW * halfW + halfH * halfH) + 60;

  for (let i = floatingItems.length - 1; i >= 0; i--) {
    const item = floatingItems[i];
    const nx = item.physX + item.vx * dt;
    const ny = item.physY + item.vy * dt;

    item.physX = nx;
    item.physY = ny;

    // Visual bob (doesn't affect physics position)
    item.gfx.x = item.physX;
    item.gfx.y = item.physY + Math.sin(time * 0.0015 + item.bobPhase) * 1.5;

    // Recycle when off-screen
    const dx = item.physX - raftContainer.x;
    const dy = item.physY - raftContainer.y;
    if (dx * dx + dy * dy > maxDist * maxDist) {
      item.gfx.destroy();
      floatingItems.splice(i, 1);
      // No 1:1 replacement — group timer handles replenishment
    }
  }

  // --- Hook --- (disabled in build mode)
  if (!buildMode && hookState === 'idle' && Phaser.Input.Keyboard.JustDown(spaceKey)) {
    hookState = 'charging';
  }

  if (hookState === 'charging') {
    chargeTime = Math.min(chargeTime + dt, MAX_CHARGE_TIME);
    const ratio = chargeTime / MAX_CHARGE_TIME;
    const barW = 30, barH = 4, barX = player.x - barW / 2, barY = player.y - 22;
    const fillColor = ratio < 0.5 ? 0x44dd44 : ratio < 0.85 ? 0xffaa00 : 0xff3300;
    chargeBarGfx.clear();
    chargeBarGfx.fillStyle(0x000000, 0.55);
    chargeBarGfx.fillRect(barX, barY, barW, barH);
    chargeBarGfx.fillStyle(fillColor, 1);
    chargeBarGfx.fillRect(barX, barY, barW * ratio, barH);
    // Face the mouse while charging
    const ptr = this.cameras.main.getWorldPoint(this.input.mousePointer.x, this.input.mousePointer.y);
    faceToward(ptr.x, ptr.y);
  }

  if (hookState === 'reeling') {
    // Face toward the hook while reeling
    faceToward(hookX, hookY);
  }

  if (hookState === 'flying') {
    hookT += dt / hookDuration;
    if (hookT >= 1) {
      hookT  = 1;
      hookX  = hookEndX;
      hookY  = hookEndY;
      hookState = 'landed';
      splashX = hookX; splashY = hookY; splashT = 1.0;
      if (sndSplash) sndSplash.play();
    } else {
      hookX = hookStartX + (hookEndX - hookStartX) * hookT;
      hookY = hookStartY + (hookEndY - hookStartY) * hookT - hookArcHeight * Math.sin(hookT * Math.PI);
    }

    // Snag debris in the last 40% of the arc (hook descending toward water)
    if (hookT >= 0.6) hookCollect.call(this);
  }

  // While landed: fresh space press starts reel; passive collection while waiting
  if (hookState === 'landed') {
    hookCollect.call(this);
    if (Phaser.Input.Keyboard.JustDown(spaceKey)) hookState = 'reeling';
  }

  if (hookState === 'reeling') {
    const dx = player.x - hookX, dy = player.y - hookY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 6) {
      if (sndReel && reelPlaying) { sndReel.stop(); reelPlaying = false; }
      addToInventory('wood',       hookedItems.wood);
      addToInventory('plastic',    hookedItems.plastic);
      addToInventory('palm',       hookedItems.palm);
      addToInventory('scrap_metal', hookedItems.scrap_metal);
      if (hookedItems.cask > 0) {
        const caskWood    = Math.floor(Math.random() * 6) + 3;
        const caskPlastic = Math.floor(Math.random() * 6) + 3;
        const caskPalm    = Math.floor(Math.random() * 6) + 3;
        const caskPotato  = Math.random() < 0.5 ? Math.floor(Math.random() * 2) + 1 : 0;
        addToInventory('wood',    caskWood);
        addToInventory('plastic', caskPlastic);
        addToInventory('palm',    caskPalm);
        if (caskPotato) addToInventory('raw_potato', caskPotato);
        if (sndPop) sndPop.play();
        showCaskPopup(caskWood, caskPlastic, caskPalm, caskPotato);
      }
      hookedItems  = { wood: 0, plastic: 0, palm: 0, cask: 0, scrap_metal: 0 };
      hookState    = 'idle';
      hookGfx.clear();
      hookLineGfx.clear();
      hookSprite.setVisible(false);
      hookedWoodSprites.forEach(s => s.setVisible(false));
      hookedPlasticSprites.forEach(s => s.setVisible(false));
      hookedPalmSprites.forEach(s => s.setVisible(false));
      hookedCaskSprites.forEach(s => s.setVisible(false));
      hookedScrapSprites.forEach(s => s.setVisible(false));
    } else {
      const autoReel = dist < 28;
      if (!spaceKey.isDown && !autoReel) {
        hookState = 'landed';
        if (sndReel && reelPlaying) { sndReel.stop(); reelPlaying = false; }
      } else {
        if (sndReel && !reelPlaying) { sndReel.play(); reelPlaying = true; }
        const s = REEL_SPEED * dt / dist;
        hookX += dx * s;
        hookY += dy * s;
        hookCollect.call(this);
      }
    }
  } else if (reelPlaying) {
    if (sndReel) sndReel.stop();
    reelPlaying = false;
  }

  // --- Splash animation ---
  if (splashT > 0) {
    splashT -= dt / SPLASH_DURATION;
    splashGfx.clear();
    if (splashT > 0) {
      const prog = 1 - splashT;
      splashGfx.lineStyle(1.5, 0xaaddff, splashT * 0.8);
      splashGfx.strokeCircle(splashX, splashY, prog * 12);
      splashGfx.lineStyle(1, 0xffffff, splashT * 0.35);
      splashGfx.strokeCircle(splashX, splashY, prog * 6);
    }
  }

  // Draw hook + line whenever it's out
  if (hookState !== 'idle' && hookState !== 'charging') {
    const hand = getHandPos();
    hookLineGfx.clear();
    hookLineGfx.lineStyle(1, 0xdddddd, 0.85);

    const airScale = hookState === 'flying' ? 1 + 0.6 * Math.sin(hookT * Math.PI) : 1;
    const bobY     = hookState === 'landed' ? Math.sin(time * 0.003) * 1.5 : 0;
    const drawY    = hookY + bobY;

    if (hookState === 'flying') {
      // Sagging arc line while in the air
      const segs = 8;
      let prevX = hand.x, prevY = hand.y;
      for (let s = 1; s <= segs; s++) {
        const f  = s / segs;
        const lx = hand.x + (hookX - hand.x) * f;
        const ly = hand.y + (hookY - hand.y) * f - 6 * Math.sin(f * Math.PI);
        hookLineGfx.lineBetween(prevX, prevY, lx, ly);
        prevX = lx; prevY = ly;
      }
    } else {
      // Straight line while landed / reeling (bob affects visual endpoint)
      hookLineGfx.lineBetween(hand.x, hand.y, hookX, drawY);
    }
    hookGfx.clear();

    // Position hooked item sprites stacked above the hook
    let stackOffset = 8;
    hookedWoodSprites.forEach((s, i) => {
      if (i < hookedItems.wood) { s.setPosition(hookX, drawY - stackOffset - i * 11).setVisible(true); }
      else { s.setVisible(false); }
    });
    stackOffset += hookedItems.wood * 11;
    hookedPlasticSprites.forEach((s, i) => {
      if (i < hookedItems.plastic) { s.setPosition(hookX, drawY - stackOffset - i * 11).setVisible(true); }
      else { s.setVisible(false); }
    });
    stackOffset += hookedItems.plastic * 11;
    hookedPalmSprites.forEach((s, i) => {
      if (i < hookedItems.palm) { s.setPosition(hookX, drawY - stackOffset - i * 11).setVisible(true); }
      else { s.setVisible(false); }
    });
    stackOffset += hookedItems.palm * 11;
    hookedCaskSprites.forEach((s, i) => {
      if (i < hookedItems.cask) { s.setPosition(hookX, drawY - stackOffset - i * 13).setVisible(true); }
      else { s.setVisible(false); }
    });
    stackOffset += hookedItems.cask * 13;
    hookedScrapSprites.forEach((s, i) => {
      if (i < hookedItems.scrap_metal) { s.setPosition(hookX, drawY - stackOffset - i * 11).setVisible(true); }
      else { s.setVisible(false); }
    });

    const hookAngle = Math.atan2(hookEndY - hookStartY, hookEndX - hookStartX);
    hookSprite.setPosition(hookX, drawY).setScale(airScale).setRotation(hookAngle - Math.PI / 2).setVisible(true);
  }

  // --- Animation ---
  if (!canMove) {
    // Locked while hook is flying — hold idle facing direction
    player.anims.play('idle_' + lastDir, true);
  } else if (wasd.left.isDown) {
    lastDir = 'side'; player.setFlipX(true);
    player.anims.play('walk_side', true);
  } else if (wasd.right.isDown) {
    lastDir = 'side'; player.setFlipX(false);
    player.anims.play('walk_side', true);
  } else if (wasd.up.isDown) {
    lastDir = 'up'; player.setFlipX(false);
    player.anims.play('walk_up', true);
  } else if (wasd.down.isDown) {
    lastDir = 'down'; player.setFlipX(false);
    player.anims.play('walk_down', true);
  } else {
    player.anims.play('idle_' + lastDir, true);
  }
}

// ============================================================
// HOOK HELPERS
// ============================================================

/**
 * Returns the world position of the player's casting hand.
 * Offsets are tuned for the 64px sprite at 0.5 scale (32px rendered).
 */
function getHandPos() {
  // Belly/waist — feet are at +8, so +3 sits at the mid-lower torso.
  return { x: player.x, y: player.y + 3 };
}

/**
 * Updates lastDir and flipX so the player faces a world point.
 */
function faceToward(wx, wy) {
  const angle = Math.atan2(wy - player.y, wx - player.x);
  if      (angle > -Math.PI / 4  && angle <= Math.PI / 4)  { lastDir = 'side'; player.setFlipX(false); }
  else if (angle > Math.PI / 4   && angle <= 3*Math.PI/4)  { lastDir = 'down'; player.setFlipX(false); }
  else if (angle < -Math.PI / 4  && angle >= -3*Math.PI/4) { lastDir = 'up';   player.setFlipX(false); }
  else                                                       { lastDir = 'side'; player.setFlipX(true);  }
}

// ============================================================
// HOOK COLLECT
// ============================================================

function hookCollect() {
  for (let i = floatingItems.length - 1; i >= 0; i--) {
    const item = floatingItems[i];
    const dx = hookX - item.physX, dy = hookY - item.physY;
    if (dx * dx + dy * dy < 8 * 8) {
      item.gfx.destroy();
      floatingItems.splice(i, 1);
      if (hookedItems[item.type] !== undefined) hookedItems[item.type]++;
      else addToInventory(item.type, 1); // fallback: goes straight to inventory
      if (sndPickup) sndPickup.play();
    }
  }
}

// ============================================================
// HELPERS
// ============================================================

/**
 * Checks whether a world-space point is on a walkable raft tile.
 * Handles both square and triangle tile types.
 */
function isOnRaft(wx, wy) {
  const T = TILE_SIZE;
  for (const tile of [...raftTiles, ...catcherTiles]) {
    const lx = wx - (raftContainer.x + tile.gridX * T);
    const ly = wy - (raftContainer.y + tile.gridY * T);
    if (lx < 0 || lx >= T || ly < 0 || ly >= T) continue;
    const type = tile.type || 'square';
    if (type === 'square')                      return true;
    if (type === 'tri-TL' && lx + ly <= T)     return true; // top-left  half
    if (type === 'tri-BR' && lx + ly >= T)     return true; // bottom-right half
    if (type === 'tri-TR' && ly <= lx)         return true; // top-right half
    if (type === 'tri-BL' && ly >= lx)         return true; // bottom-left half
  }
  return false;
}


function drawGhostTiles(pointer, camera) {
  ghostGfx.clear();
  const T = TILE_SIZE;

  // 1. Snap mouse to grid
  const world = camera.getWorldPoint(pointer.x, pointer.y);
  const gx = Math.floor((world.x - raftContainer.x) / T);
  const gy = Math.floor((world.y - raftContainer.y) / T);

  const occupied = new Set(raftTiles.map(t => `${t.gridX},${t.gridY}`));
  const wx = raftContainer.x + gx * T;
  const wy = raftContainer.y + gy * T;

  // Use moving structure as the ghost source if one is held
  const ghostType = movingStructure ? movingStructure.type : (hotbarData[hotbarSelected].type && PLACEABLE_TYPES.has(hotbarData[hotbarSelected].type) ? hotbarData[hotbarSelected].type : null);

  // If hotbar has a placeable, show ghost at cursor position within tile
  const hotSlot = hotbarData[hotbarSelected];
  if (ghostType) {
    placeGhostImg.setVisible(false);
    if (!occupied.has(`${gx},${gy}`)) return;

    const span = STRUCTURE_TILE_SIZE[ghostType] || 1;

    if (span === 2) {
      // 2-tile ghost: show both tiles highlighted + centered sprite
      const horiz = placeRotation % 2 === 0;
      const gx2 = gx + (horiz ? 1 : 0);
      const gy2 = gy + (horiz ? 0 : 1);
      const valid = occupied.has(`${gx2},${gy2}`);
      const col = valid ? 0x44ff44 : 0xff3333;
      ghostGfx.lineStyle(1.5, col, 0.8);
      ghostGfx.fillStyle(col, 0.2);
      ghostGfx.fillRect(wx, wy, T, T);
      ghostGfx.strokeRect(wx, wy, T, T);
      const wx2 = raftContainer.x + gx2 * T;
      const wy2 = raftContainer.y + gy2 * T;
      ghostGfx.fillRect(wx2, wy2, T, T);
      ghostGfx.strokeRect(wx2, wy2, T, T);
      // Sprite centered across both tiles
      const cxG = horiz ? wx + T : wx + T / 2;
      const cyG = horiz ? wy + T / 2 : wy + T;
      const dispW = horiz ? T * 2 : T;
      const dispH = horiz ? T : T * 2;
      placeGhostImg.setTexture('sleeping_bag')
        .setPosition(cxG, cyG)
        .setDisplaySize(dispW, dispH)
        .setRotation(0)
        .setVisible(true);
      return;
    }

    // Tile outline
    ghostGfx.lineStyle(1.5, 0x44ff44, 0.7);
    ghostGfx.strokeRect(wx, wy, T, T);

    {
      // All structures snap to tile center; chests use 5-position edge snap
      let lx = T / 2, ly = T / 2;
      if (ghostType === 'chest') {
        const raw_lx = Phaser.Math.Clamp(world.x - raftContainer.x - gx * T, 0, T);
        const raw_ly = Phaser.Math.Clamp(world.y - raftContainer.y - gy * T, 0, T);
        const h = T * 0.375;
        const mid = T / 2;
        const z = T / 3;
        const inLeft = raw_lx < z, inRight = raw_lx > T - z;
        const inTop  = raw_ly < z, inBottom = raw_ly > T - z;
        if      (inLeft)   { lx = h;     ly = mid; }
        else if (inRight)  { lx = T - h; ly = mid; }
        else if (inTop)    { lx = mid;   ly = h;   }
        else if (inBottom) { lx = mid;   ly = T - h; }
        else               { lx = mid;   ly = mid; }
      }
      const ghostX = raftContainer.x + gx * T + lx;
      const ghostY = raftContainer.y + gy * T + ly;
      const dispSize = ghostType === 'chest' ? T * 0.75 : T;
      const texKey = ghostType === 'campfire' ? 'campfire_icon' : ghostType;
      placeGhostImg.setTexture(texKey)
        .setPosition(ghostX, ghostY)
        .setDisplaySize(dispSize, dispSize)
        .setRotation(placeRotation * Math.PI / 2)
        .setVisible(true);
    }
    return;
  }
  placeGhostImg.setVisible(false);

  placeGhostImg.setVisible(false);
  // Normal / catcher tile ghost — must be unoccupied and adjacent
  if (occupied.has(`${gx},${gy}`)) return;
  const adjacent = [[1,0],[-1,0],[0,1],[0,-1]]
    .some(([dx, dy]) => occupied.has(`${gx + dx},${gy + dy}`));
  if (!adjacent) return;

  const canAfford = tilePlaceMode === 'catcher'
    ? countItem('netting') >= 1 && countItem('wood') >= 10
    : countItem('wood') >= 10 && countItem('plastic') >= 2;
  const col = canAfford ? 0x44ff44 : 0xff3333;
  ghostGfx.fillStyle(col, 0.25);
  ghostGfx.lineStyle(1.5, col, 0.9);
  ghostGfx.fillRect(wx, wy, T, T);
  ghostGfx.strokeRect(wx, wy, T, T);

  if (tilePlaceMode === 'catcher') {
    placeGhostImg.setTexture('catcher')
      .setPosition(wx + T / 2, wy + T / 2)
      .setDisplaySize(T, T)
      .setRotation(0)
      .setVisible(true);
  }
}

// ── Player Stats ─────────────────────────────────────────────

function tickStats(dt) {
  const isActive = hookState === 'charging' || hookState === 'reeling';
  const isMoving = wasd.left.isDown || wasd.right.isDown || wasd.up.isDown || wasd.down.isDown;

  // Stamina: drain while casting/reeling, regen when idle
  if (isActive) {
    statStamina -= 2.5 * dt;
  } else {
    statStamina += 1.5 * dt;
  }
  statStamina = Phaser.Math.Clamp(statStamina, 0, 100);

  // Hunger: slow passive drain, slightly faster when active/moving
  const hungerDrain = 0.08 + (isActive ? 0.12 : 0) + (isMoving ? 0.04 : 0);
  statHunger -= hungerDrain * dt;
  statHunger = Phaser.Math.Clamp(statHunger, 0, 100);

  // Hydration: slightly faster passive drain than hunger
  const hydrationDrain = 0.1 + (isActive ? 0.1 : 0) + (isMoving ? 0.03 : 0);
  statHydration -= hydrationDrain * dt;
  statHydration = Phaser.Math.Clamp(statHydration, 0, 100);

  // Health: drain when hungry or dehydrated, regen when both are OK
  const hungryDamage    = statHunger    < 20 ? (0.3 * (1 - statHunger    / 20)) * dt : 0;
  const dehydrateDamage = statHydration < 20 ? (0.4 * (1 - statHydration / 20)) * dt : 0;
  const healthRegen     = (statHunger > 60 && statHydration > 60) ? 0.08 * dt : 0;
  statHealth -= hungryDamage + dehydrateDamage;
  statHealth += healthRegen;
  statHealth = Phaser.Math.Clamp(statHealth, 0, 100);

  // Update bars
  document.getElementById('bar-health-fill').style.width    = statHealth    + '%';
  document.getElementById('bar-hunger-fill').style.width    = statHunger    + '%';
  document.getElementById('bar-hydration-fill').style.width = statHydration + '%';
  document.getElementById('bar-stamina-fill').style.width   = statStamina   + '%';

  // Tint bars red when critically low
  document.getElementById('bar-hunger-fill').style.backgroundColor    = statHunger    < 25 ? '#e84040' : '#e8a030';
  document.getElementById('bar-hydration-fill').style.backgroundColor = statHydration < 25 ? '#e84040' : '#3090e8';
  document.getElementById('bar-stamina-fill').style.backgroundColor   = statStamina   < 20 ? '#e8a030' : '#50d050';
}

// ── Structure Collision ──────────────────────────────────────
// AABB push-out for solid structures (chest, workbench).
function resolveChestCollision() {
  const P_HALF_W   = 5;
  const P_HALF_H   = 4;
  const P_Y_OFFSET = 4;

  const SOLID_HALF = {
    chest:     TILE_SIZE * 0.35, // 75% chest
    workbench: TILE_SIZE * 0.48, // full tile
  };
  // Per-type center offsets to align hitbox with the visual sprite
  const SOLID_OFFSET = {
    workbench: { x: -3, y: 0 },
  };

  for (const st of raftStructures) {
    const half = SOLID_HALF[st.type];
    if (!half) continue;
    const lx = stLocalX(st);
    const ly = stLocalY(st);
    const off = SOLID_OFFSET[st.type] || { x: 0, y: 0 };
    const cx = raftContainer.x + st.gridX * TILE_SIZE + lx + off.x;
    const cy = raftContainer.y + st.gridY * TILE_SIZE + ly + off.y;

    const px = player.x;
    const py = player.y + P_Y_OFFSET;

    const overlapX = (P_HALF_W + half) - Math.abs(px - cx);
    const overlapY = (P_HALF_H + half) - Math.abs(py - cy);

    if (overlapX <= 0 || overlapY <= 0) continue;

    if (overlapX < overlapY) {
      player.x += px < cx ? -overlapX : overlapX;
    } else {
      player.y += py < cy ? -overlapY : overlapY;
    }
  }
}

// ── Raft Structures ──────────────────────────────────────────
let catcherSprites = [];
function rebuildCatcherSprites() {
  catcherSprites.forEach(s => s.destroy());
  catcherSprites = [];
  const T = TILE_SIZE;
  for (const ct of catcherTiles) {
    const spr = phaserScene.add.image(
      ct.gridX * T + T / 2,
      ct.gridY * T + T / 2,
      'catcher'
    ).setDisplaySize(T, T).setDepth(1);
    raftContainer.add(spr);
    catcherSprites.push(spr);
  }
}

function tickCatchers() {
  const T = TILE_SIZE;
  for (let i = floatingItems.length - 1; i >= 0; i--) {
    const item = floatingItems[i];
    if (item.type === 'cask') continue; // casks not caught
    for (const ct of catcherTiles) {
      const wx = raftContainer.x + ct.gridX * T + T / 2;
      const wy = raftContainer.y + ct.gridY * T + T / 2;
      if (Math.hypot(item.physX - wx, item.physY - wy) > T) continue;
      // In range — try to store
      const store = catcherStorages[ct.id];
      const total = store.reduce((n, s) => n + s.count, 0);
      if (total >= CATCHER_CAPACITY) continue;
      const existing = store.find(s => s.type === item.type);
      if (existing) existing.count++;
      else store.push({ type: item.type, count: 1 });
      item.gfx.destroy();
      floatingItems.splice(i, 1);
      if (openCatcherId == ct.id) renderCatcher();
      break;
    }
  }
}

function openCatcher(id) {
  openCatcherId = id;
  if (openChestKey) closeChest();
  if (openFurnaceId) closeFurnace();
  renderCatcher();
  document.getElementById('catcher-panel').style.display = 'block';
}
function closeCatcher() {
  openCatcherId = null;
  document.getElementById('catcher-panel').style.display = 'none';
}
function renderCatcher() {
  if (!openCatcherId) return;
  const store = catcherStorages[openCatcherId] || [];
  const total = store.reduce((n, s) => n + s.count, 0);
  document.getElementById('catcher-capacity').textContent = `${total} / ${CATCHER_CAPACITY}`;
  const list = document.getElementById('catcher-item-list');
  list.innerHTML = '';
  if (store.length === 0) {
    list.innerHTML = '<div style="color:#888;font-size:11px;text-align:center;padding:8px">Empty</div>';
    return;
  }
  for (const slot of store) {
    const row = document.createElement('div');
    row.className = 'catcher-row';
    row.innerHTML = `<img src="${ITEM_SPRITES[slot.type]}" style="width:16px;height:16px;image-rendering:pixelated">
      <span>${slot.type.replace(/_/g,' ')} ×${slot.count}</span>
      <button onclick="catcherTakeItem('${slot.type}')">Take</button>
      <button onclick="catcherTakeAll('${slot.type}')">All</button>`;
    list.appendChild(row);
  }
}
function catcherTakeItem(type) {
  if (!openCatcherId) return;
  const store = catcherStorages[openCatcherId];
  const slot = store.find(s => s.type === type);
  if (!slot) return;
  const overflow = addToInventory(type, 1);
  if (overflow === 0) {
    slot.count--;
    if (slot.count <= 0) store.splice(store.indexOf(slot), 1);
  }
  renderCatcher();
}
function catcherTakeAll(type) {
  if (!openCatcherId) return;
  const store = catcherStorages[openCatcherId];
  const slot = store.find(s => s.type === type);
  if (!slot) return;
  const overflow = addToInventory(type, slot.count);
  slot.count = overflow;
  if (slot.count <= 0) store.splice(store.indexOf(slot), 1);
  renderCatcher();
}

function rebuildStructureSprites() {
  structureSprites.forEach(s => s.destroy());
  structureSprites = [];
  // (no physics bodies needed — collision is manual AABB)

  const T = TILE_SIZE;
  for (const st of raftStructures) {
    const lx = st.gridX * T + stLocalX(st);
    const ly = st.gridY * T + stLocalY(st);
    const rot = (st.rotation || 0) * Math.PI / 2;
    let spr;
    if (st.type === 'campfire') {
      spr = phaserScene.add.sprite(lx, ly, 'campfire').setDepth(2).setDisplaySize(T, T);
      spr.play('campfire_burn');
    } else if (st.type === 'workbench') {
      spr = phaserScene.add.image(lx, ly, 'workbench').setDepth(2).setDisplaySize(T - 2, T - 2);
    } else if (st.type === 'sleeping_bag') {
      // Spans 2 tiles — position at center between anchor and second tile
      const horiz = (st.rotation || 0) % 2 === 0;
      const cx = st.gridX * T + (horiz ? T : T / 2);
      const cy = st.gridY * T + (horiz ? T / 2 : T);
      const w = horiz ? T * 2 : T;
      const h = horiz ? T : T * 2;
      spr = phaserScene.add.image(cx, cy, 'sleeping_bag').setDepth(2).setDisplaySize(w, h);
    } else {
      const dispSize = st.type === 'chest' ? T * 0.75 : T - 2;
      spr = phaserScene.add.image(lx, ly, st.type).setDepth(2).setDisplaySize(dispSize, dispSize);
    }
    if (st.type !== 'sleeping_bag') spr.setRotation(rot);
    raftContainer.add(spr);
    structureSprites.push(spr);

    // Chest collision handled via manual AABB in update()
  }
}

function placeStructure(gx, gy, type, localX, localY, rotation) {
  if (!raftTiles.some(t => t.gridX === gx && t.gridY === gy)) return false;
  const id = Date.now() + Math.random();
  raftStructures.push({ gridX: gx, gridY: gy, type, localX, localY, rotation, id });
  if (type === 'chest') chestStorages[id] = Array.from({length: 20}, () => ({type: null, count: 0}));
  if (sndPop) sndPop.play();
  rebuildStructureSprites();
  return true;
}

function showDeleteConfirm(st) {
  pendingDelete = st;
  const panel = document.getElementById('delete-confirm');
  document.getElementById('delete-confirm-name').textContent = st.type.replace(/_/g, ' ').toUpperCase();
  panel.style.display = 'flex';
}

function hideDeleteConfirm() {
  pendingDelete = null;
  document.getElementById('delete-confirm').style.display = 'none';
}

function removeStructureById(id) {
  const idx = raftStructures.findIndex(s => s.id === id);
  if (idx === -1) return;
  const st = raftStructures[idx];
  raftStructures.splice(idx, 1);
  if (chestStorages[id]) delete chestStorages[id];
  // Refund the recipe inputs (or the item itself if no recipe)
  const recipe = Object.values(RECIPES).find(r => r.outputs[st.type]);
  refundItems(recipe ? recipe.inputs : { [st.type]: 1 });
  rebuildStructureSprites();
}

function getStructureAt(gx, gy) {
  return raftStructures.find(s => s.gridX === gx && s.gridY === gy) || null;
}

// Returns all structures of a given type whose footprint covers tile (gx, gy)
function getStructuresOnTile(gx, gy, type) {
  return raftStructures.filter(s => {
    if (type && s.type !== type) return false;
    if (s.gridX === gx && s.gridY === gy) return true;
    // Check second tile for 2-tile structures
    const span = STRUCTURE_TILE_SIZE[s.type] || 1;
    if (span === 2) {
      const horiz = (s.rotation || 0) % 2 === 0;
      const gx2 = s.gridX + (horiz ? 1 : 0);
      const gy2 = s.gridY + (horiz ? 0 : 1);
      return gx2 === gx && gy2 === gy;
    }
    return false;
  });
}

// ── Chest UI ─────────────────────────────────────────────────
const chestPanel = document.getElementById('chest-panel');

function openChest(key) {
  openChestKey = key;
  chestPanel.style.display = 'block';
  chestPanel.classList.add('chest-open');
  inventoryPanel.style.display = 'block';
  inventoryPanel.classList.add('chest-open');
  renderChest();
}

function closeChest() {
  openChestKey = null;
  chestPanel.style.display = 'none';
  chestPanel.classList.remove('chest-open');
  inventoryPanel.classList.remove('chest-open');
  inventoryPanel.style.display = inventoryOpen ? 'block' : 'none';
}

function renderChest() {
  if (!openChestKey) return;
  const slots = chestStorages[openChestKey];
  document.querySelectorAll('.chest-slot').forEach((el, i) => renderSlot(el, slots[i]));
}

function handleChestSlotClick(index, e) {
  if (!openChestKey) return;
  const slots = chestStorages[openChestKey];
  const slot  = slots[index];

  // Shift-click: move item to player inventory
  if (e && e.shiftKey && slot.type && !heldItem) {
    const overflow = addToInventory(slot.type, slot.count);
    slot.count = overflow;
    if (!overflow) slot.type = null;
    renderChest(); renderInventory();
    return;
  }
  if (heldItem) {
    if (!slot.type) {
      slot.type = heldItem.type; slot.count = heldItem.count;
      heldItem = null; heldFrom = null;
    } else if (slot.type === heldItem.type && slot.count < STACK_MAX) {
      const add = Math.min(STACK_MAX - slot.count, heldItem.count);
      slot.count += add; heldItem.count -= add;
      if (!heldItem.count) { heldItem = null; heldFrom = null; }
    } else {
      const tmp = { type: slot.type, count: slot.count };
      slot.type = heldItem.type; slot.count = heldItem.count;
      heldItem = tmp; heldFrom = { source: 'chest', index };
    }
  } else if (slot.type) {
    heldItem = { type: slot.type, count: slot.count };
    heldFrom = { source: 'chest', index };
    slot.type = null; slot.count = 0;
  }
  renderChest();
  renderInventory();
  updateHeldCursor();
}

// ── Furnace / Campfire ───────────────────────────────────────

function getFurnaceState(id) {
  if (!furnaceStates[id]) {
    furnaceStates[id] = {
      food:         { type: null, count: 0 },
      fuel:         { type: null, count: 0 },
      output:       { type: null, count: 0 },
      cookProgress: 0,
      fuelLeft:     0,
    };
  }
  return furnaceStates[id];
}

function openFurnace(id) {
  openFurnaceId = id;
  document.getElementById('furnace-panel').style.display = 'block';
  renderFurnace();
}

function closeFurnace() {
  openFurnaceId = null;
  document.getElementById('furnace-panel').style.display = 'none';
}

function renderFurnace() {
  if (!openFurnaceId) return;
  const fs = getFurnaceState(openFurnaceId);
  renderSlot(document.getElementById('furnace-food-slot'),   fs.food);
  renderSlot(document.getElementById('furnace-fuel-slot'),   fs.fuel);
  renderSlot(document.getElementById('furnace-output-slot'), fs.output);
  const flameH  = fs.fuelLeft > 0 ? (fs.fuelLeft / FUEL_TIME) * 100 : 0;
  const arrowW  = fs.fuelLeft > 0 ? (fs.cookProgress / COOK_TIME) * 100 : 0;
  document.getElementById('furnace-flame-bar').style.height = flameH + '%';
  document.getElementById('furnace-arrow-bar').style.width  = arrowW + '%';
}

function tickFurnaces(dt) {
  let anyOpen = false;
  for (const id of Object.keys(furnaceStates)) {
    const fs = furnaceStates[id];
    const outputType = fs.food.type ? COOKABLE[fs.food.type] : null;
    const canCook = outputType && fs.fuelLeft > 0 && (fs.output.type === null || (fs.output.type === outputType && fs.output.count < STACK_MAX));

    if (fs.fuelLeft <= 0 && fs.fuel.type === 'wood' && fs.fuel.count > 0 && outputType) {
      // consume one wood
      fs.fuel.count--;
      if (!fs.fuel.count) fs.fuel.type = null;
      fs.fuelLeft = FUEL_TIME;
    }

    if (canCook) {
      fs.fuelLeft     -= dt;
      fs.cookProgress += dt;
      if (fs.cookProgress >= COOK_TIME) {
        fs.cookProgress = 0;
        fs.food.count--;
        if (!fs.food.count) fs.food.type = null;
        if (!fs.output.type) { fs.output.type = outputType; fs.output.count = 0; }
        fs.output.count++;
      }
    } else {
      if (fs.fuelLeft > 0) fs.fuelLeft -= dt;
      if (fs.fuelLeft < 0) fs.fuelLeft = 0;
    }

    // eslint-disable-next-line eqeqeq
    if (openFurnaceId == id) { anyOpen = true; renderFurnace(); }
  }
}

function handleFurnaceSlotClick(slotName, e) {
  if (!openFurnaceId) return;
  const fs = getFurnaceState(openFurnaceId);
  const slot = fs[slotName];

  // Shift-click output: move to inventory
  if (e && e.shiftKey && slotName === 'output' && slot.type) {
    const overflow = addToInventory(slot.type, slot.count);
    slot.count = overflow;
    if (!overflow) slot.type = null;
    renderFurnace(); renderInventory(); return;
  }

  // Place held item into slot
  if (heldItem) {
    const valid = (slotName === 'fuel' && heldItem.type === 'wood') ||
                  (slotName === 'food' && COOKABLE[heldItem.type]) ||
                  (slotName === 'output' && !slot.type);
    if (!valid) return;
    if (slot.type && slot.type !== heldItem.type) return; // different item
    if (slotName === 'output') return; // can't place into output

    const add = Math.min(heldItem.count, STACK_MAX - slot.count);
    if (!slot.type) slot.type = heldItem.type;
    slot.count += add;
    heldItem.count -= add;
    if (!heldItem.count) { heldItem = null; heldFrom = null; }
    renderFurnace(); renderInventory(); updateHeldCursor(); return;
  }

  // Pick up from slot
  if (slot.type) {
    heldItem = { type: slot.type, count: slot.count };
    heldFrom = { source: 'furnace', slot: slotName };
    slot.type = null; slot.count = 0;
    renderFurnace(); updateHeldCursor(); return;
  }
}

function showCaskPopup(wood, plastic, palm, potato = 0) {
  const popup = document.getElementById('cask-popup');
  document.getElementById('cask-wood-amt').textContent    = '+' + wood;
  document.getElementById('cask-plastic-amt').textContent = '+' + plastic;
  document.getElementById('cask-palm-amt').textContent    = '+' + palm;
  const potatoRow = document.getElementById('cask-potato-row');
  if (potatoRow) {
    potatoRow.style.display = potato > 0 ? 'flex' : 'none';
    document.getElementById('cask-potato-amt').textContent = '+' + potato;
  }
  popup.style.opacity   = '1';
  popup.style.transform = 'translateX(-50%) translateY(0px)';
  clearTimeout(popup._hideTimer);
  popup._hideTimer = setTimeout(() => {
    popup.style.opacity   = '0';
    popup.style.transform = 'translateX(-50%) translateY(-12px)';
  }, 1500);
}

// ── Save / Load ───────────────────────────────────────────────

const SAVE_KEY = 'raftGame_v1';

function saveGame() {
  const data = {
    raftTiles:      raftTiles.map(({ gridX, gridY }) => ({ gridX, gridY })),
    raftStructures: raftStructures.map(({ gridX, gridY, type, localX, localY, rotation, id }) =>
                      ({ gridX, gridY, type, localX, localY, rotation, id })),
    catcherTiles:    catcherTiles.map(({ gridX, gridY, id }) => ({ gridX, gridY, id })),
    catcherStorages,
    chestStorages,
    furnaceStates,
    hotbarData,
    invData,
    stats: { health: statHealth, hunger: statHunger, hydration: statHydration, stamina: statStamina },
    playerX: player.x,
    playerY: player.y,
    raftX:   raftContainer.x,
    raftY:   raftContainer.y,
  };
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch(e) {}
}

function loadGame() {
  let data;
  try { data = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch(e) {}
  if (!data) return;

  // Restore raft tiles
  raftTiles = data.raftTiles || raftTiles;
  raftContainer.x = data.raftX ?? raftContainer.x;
  raftContainer.y = data.raftY ?? raftContainer.y;
  raftContainer.removeAll(true);
  buildRaft.call(this, raftTiles, raftContainer);

  // Restore structures
  raftStructures = [];
  for (const s of (data.raftStructures || [])) {
    raftStructures.push({ ...s });
    if (s.type === 'chest' && !chestStorages[s.id])
      chestStorages[s.id] = Array.from({ length: 20 }, () => ({ type: null, count: 0 }));
  }
  if (data.chestStorages) Object.assign(chestStorages, data.chestStorages);
  if (data.furnaceStates) Object.assign(furnaceStates, data.furnaceStates);
  rebuildStructureSprites();

  // Restore catchers
  catcherTiles = data.catcherTiles || [];
  if (data.catcherStorages) Object.assign(catcherStorages, data.catcherStorages);
  rebuildCatcherSprites.call(this);

  // Restore inventory
  if (data.hotbarData) data.hotbarData.forEach((s, i) => { hotbarData[i] = s; });
  if (data.invData)    data.invData.forEach((s, i)    => { invData[i]    = s; });
  renderInventory();

  // Restore stats
  if (data.stats) {
    statHealth    = data.stats.health    ?? 100;
    statHunger    = data.stats.hunger    ?? 100;
    statHydration = data.stats.hydration ?? 100;
    statStamina   = data.stats.stamina   ?? 100;
  }

  // Restore player position
  if (data.playerX !== undefined) { player.x = data.playerX; player.y = data.playerY; }
  this.cameras.main.centerOn(player.x, player.y);
}

function showSaveIndicator() {
  const el = document.getElementById('save-indicator');
  if (!el) return;
  el.style.opacity = '1';
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.opacity = '0'; }, 1500);
}

function buildRaft(tiles, container) {
  const T = TILE_SIZE;

  for (const tile of tiles) {
    const img = this.add.image(
      tile.gridX * T + T / 2,
      tile.gridY * T + T / 2,
      'raft_tile'
    ).setDisplaySize(T, T).setDepth(1);
    container.add(img);
  }
}
