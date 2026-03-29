import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';

const SCREENSHOTS = './audit_screenshots';
mkdirSync(SCREENSHOTS, { recursive: true });

const issues = [];
const notes = [];
let shotIndex = 0;

async function shot(page, label) {
  const file = `${SCREENSHOTS}/${String(shotIndex++).padStart(2, '0')}_${label.replace(/\s+/g, '_')}.png`;
  await page.screenshot({ path: file, fullPage: false });
  console.log(`  📸 ${label}`);
  return file;
}

function flag(category, severity, msg) {
  const entry = `[${severity.toUpperCase()}] ${category}: ${msg}`;
  issues.push(entry);
  console.log(`  ⚠  ${entry}`);
}

function note(category, msg) {
  const entry = `${category}: ${msg}`;
  notes.push(entry);
  console.log(`  ✓  ${entry}`);
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 80 });
  const ctx    = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page   = await ctx.newPage();

  // Capture console errors
  const consoleErrors = [];
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', err => consoleErrors.push(err.message));

  console.log('\n=== RAFT GAME AUDIT ===\n');

  // ── 1. LOAD ───────────────────────────────────────────────────────────────
  console.log('1. Loading game...');
  await page.goto('http://localhost:3000');
  await sleep(3000);
  await shot(page, 'initial_load');

  // Check canvas rendered
  const canvas = await page.$('canvas');
  if (!canvas) flag('Rendering', 'critical', 'No canvas element found');
  else note('Rendering', 'Canvas rendered successfully');

  // Check status bars visible
  const statusBars = await page.$('#status-bars');
  const statusVisible = statusBars ? await statusBars.isVisible() : false;
  if (!statusVisible) flag('UI', 'medium', '#status-bars not visible on load');
  else note('UI', 'Status bars visible');

  // Check hotbar visible
  const hotbar = await page.$('#hotbar');
  if (!hotbar || !(await hotbar.isVisible())) flag('UI', 'medium', 'Hotbar not visible');
  else note('UI', 'Hotbar visible');

  // ── 2. BASIC MOVEMENT ─────────────────────────────────────────────────────
  console.log('\n2. Testing movement (WASD)...');
  await page.locator('canvas').click(); // focus

  // Get player position before move
  const posBefore = await page.evaluate(() => {
    if (typeof player !== 'undefined') return { x: player.x, y: player.y };
    return null;
  });

  // Walk in each direction
  for (const key of ['w', 'a', 's', 'd']) {
    await page.keyboard.down(key.toUpperCase());
    await sleep(400);
    await page.keyboard.up(key.toUpperCase());
    await sleep(100);
  }
  await sleep(500);

  const posAfter = await page.evaluate(() => {
    if (typeof player !== 'undefined') return { x: player.x, y: player.y };
    return null;
  });

  if (posBefore && posAfter) {
    const moved = Math.hypot(posAfter.x - posBefore.x, posAfter.y - posBefore.y);
    if (moved < 1) flag('Movement', 'high', 'Player did not move with WASD');
    else note('Movement', `Player moved (delta ~${moved.toFixed(1)}px after WASD loop)`);
  }
  await shot(page, 'after_movement');

  // ── 3. HOOK ───────────────────────────────────────────────────────────────
  console.log('\n3. Testing hook (Space)...');
  await page.keyboard.down('Space');
  await sleep(600);
  await shot(page, 'hook_charging');
  await page.keyboard.up('Space');
  await sleep(1500);
  await shot(page, 'hook_thrown');

  const hookState = await page.evaluate(() => typeof hookState !== 'undefined' ? hookState : 'unknown');
  note('Hook', `Hook state after throw: ${hookState}`);

  // Wait for reel-in
  await sleep(3000);
  await shot(page, 'hook_reeled');

  // ── 4. INVENTORY ──────────────────────────────────────────────────────────
  console.log('\n4. Testing inventory (I)...');
  await page.keyboard.press('i');
  await sleep(400);
  const invPanel = await page.$('#inventory-panel');
  const invVisible = invPanel ? await invPanel.isVisible() : false;
  if (!invVisible) flag('Inventory', 'high', 'Inventory panel did not open with I key');
  else note('Inventory', 'Inventory panel opens');
  await shot(page, 'inventory_open');

  await page.keyboard.press('Escape');
  await sleep(300);
  const invAfterClose = invPanel ? await invPanel.isVisible() : false;
  if (invAfterClose) flag('Inventory', 'medium', 'Inventory did not close with Escape');
  else note('Inventory', 'Inventory closes with Escape');

  // ── 5. BUILD MODE ─────────────────────────────────────────────────────────
  console.log('\n5. Testing build mode (B)...');
  // Check if hammer is in inventory (DEV_UNLIMITED means nothing, but hammer needs to be there)
  const hasHammer = await page.evaluate(() => {
    const all = [...hotbarData, ...invData];
    return all.some(s => s.type === 'hammer' && s.count > 0);
  });

  if (!hasHammer) {
    flag('Build Mode', 'high', 'No hammer in inventory — build mode cannot be opened (hammer not spawned by default?)');
  } else {
    note('Build Mode', 'Hammer found in inventory');
    await page.keyboard.press('b');
    await sleep(400);
    const buildOn = await page.evaluate(() => buildMode);
    if (!buildOn) flag('Build Mode', 'high', 'Build mode did not activate with B');
    else note('Build Mode', 'Build mode activates');

    const craftPanel = await page.$('#craft-panel');
    const craftVisible = craftPanel ? await craftPanel.isVisible() : false;
    if (!craftVisible) flag('Build Mode', 'medium', 'Craft panel not visible in build mode');
    else note('Build Mode', 'Craft panel visible');

    await shot(page, 'build_mode_on');

    // Exit build mode
    await page.keyboard.press('b');
    await sleep(300);
    const buildOff = await page.evaluate(() => !buildMode);
    if (!buildOff) flag('Build Mode', 'medium', 'Build mode did not toggle off');
    else note('Build Mode', 'Build mode toggles off');
    await shot(page, 'build_mode_off');
  }

  // ── 6. HOTBAR SLOT SELECTION ──────────────────────────────────────────────
  console.log('\n6. Testing hotbar 1–8 keys...');
  let hotbarOk = true;
  for (let i = 1; i <= 8; i++) {
    await page.keyboard.press(String(i));
    await sleep(80);
    const sel = await page.evaluate(() => hotbarSelected);
    if (sel !== i - 1) { flag('Hotbar', 'medium', `Key ${i} set hotbarSelected to ${sel} (expected ${i-1})`); hotbarOk = false; break; }
  }
  if (hotbarOk) note('Hotbar', 'Keys 1–8 correctly set hotbarSelected');

  // ── 7. STAT BARS ──────────────────────────────────────────────────────────
  console.log('\n7. Checking stat values...');
  const stats = await page.evaluate(() => ({
    health: statHealth, hunger: statHunger,
    hydration: statHydration, stamina: statStamina
  }));
  console.log(`  Stats: health=${stats.health.toFixed(1)}, hunger=${stats.hunger.toFixed(1)}, hydration=${stats.hydration.toFixed(1)}, stamina=${stats.stamina.toFixed(1)}`);

  if (Object.values(stats).some(v => v < 0 || v > 100)) {
    flag('Stats', 'high', `Stat out of 0–100 range: ${JSON.stringify(stats)}`);
  } else note('Stats', 'All stats within valid 0–100 range');

  // Check bar widths reflect values
  const healthBarW = await page.evaluate(() => {
    const el = document.querySelector('#bar-health');
    return el ? el.style.width : 'N/A';
  });
  if (healthBarW === 'N/A') flag('Stats UI', 'medium', '#bar-health element not found');
  else note('Stats UI', `#bar-health width: ${healthBarW}`);

  // ── 8. SAVE / LOAD ────────────────────────────────────────────────────────
  console.log('\n8. Testing save (Ctrl+S)...');
  await page.keyboard.press('Control+s');
  await sleep(600);
  const saveIndicator = await page.$('#save-indicator');
  const saveFlash = saveIndicator ? await saveIndicator.isVisible() : false;
  // flash is brief, might miss it — check localStorage instead
  const hasSave = await page.evaluate(() => !!localStorage.getItem('raftGame_v1'));
  if (!hasSave) flag('Save', 'high', 'Ctrl+S did not write to localStorage');
  else note('Save', 'localStorage save key present after Ctrl+S');
  await shot(page, 'after_save');

  // ── 9. CONSOLE ERRORS ─────────────────────────────────────────────────────
  console.log('\n9. Console errors during session...');
  if (consoleErrors.length === 0) {
    note('Console', 'No JS errors during session');
  } else {
    for (const e of consoleErrors) flag('Console', 'high', e);
  }

  // ── 10. FEEL / UX OBSERVATIONS ───────────────────────────────────────────
  console.log('\n10. Gameplay feel observations...');
  const raftTileCount = await page.evaluate(() => raftTiles.length);
  note('World', `Raft starts with ${raftTileCount} tile(s)`);

  const structureCount = await page.evaluate(() => raftStructures.length);
  note('World', `${structureCount} structure(s) placed on raft`);

  const debrisCount = await page.evaluate(() => typeof debrisItems !== 'undefined' ? debrisItems.length : 'unknown');
  note('World', `${debrisCount} debris items active`);

  // Final screenshot
  await sleep(1000);
  await shot(page, 'final_state');

  // ── REPORT ────────────────────────────────────────────────────────────────
  const report = [
    '# RAFT GAME AUDIT REPORT',
    `Generated: ${new Date().toISOString()}`,
    '',
    '## ISSUES',
    issues.length ? issues.map(i => `- ${i}`).join('\n') : '- None found',
    '',
    '## NOTES (passing checks)',
    notes.map(n => `- ${n}`).join('\n'),
    '',
    '## CONSOLE ERRORS',
    consoleErrors.length ? consoleErrors.map(e => `- ${e}`).join('\n') : '- None',
  ].join('\n');

  writeFileSync('./audit_report.md', report);
  console.log('\n=== AUDIT COMPLETE ===');
  console.log(`Issues found: ${issues.length}`);
  console.log(`Passing checks: ${notes.length}`);
  console.log('Report written to audit_report.md');
  console.log('Screenshots in audit_screenshots/');

  await sleep(2000);
  await browser.close();
})();
