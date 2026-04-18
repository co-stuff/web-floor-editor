import CDMapFile from './CDMapFile.js';
import CMapRenderer from './CMapRenderer.js';
import COverlay from './COverlay.js';
import CSelectionBits from './CSelectionBits.js';

const viewport = document.getElementById('viewport');
const overlayCanvas = document.getElementById('overlayCanvas');
const fileIn = document.getElementById('fileIn');

let g_pDmap = null;
let g_renderer = new CMapRenderer(viewport);
let g_overlay = new COverlay(overlayCanvas);
let g_selBits = new CSelectionBits();

let g_nHoverX = -1, g_nHoverY = -1;
let g_nSelectedX = -1, g_nSelectedY = -1;
let g_bShowGrid = true, g_bShowElev = true, g_bShowBlocked = true;
let g_bDirty = true;

let g_bIsDragging = false;
let g_flDragStartX = 0, g_flDragStartY = 0;
let g_bIsSelecting = false;
let g_flSelSX = 0, g_flSelSY = 0, g_flSelEX = 0, g_flSelEY = 0;
let g_nSelStartCX = 0, g_nSelStartCY = 0, g_nSelEndCX = 0, g_nSelEndCY = 0;

let g_flLastTime = 0, g_nFrames = 0, g_flFpsAccum = 0, g_flFPS = 0;

let g_openMenu = null;

async function OpenFile(file, szNameOverride) {
  const pDmap = new CDMapFile();
  if (!(await pDmap.Load(file))) return;
  if (szNameOverride) pDmap.m_szFilename = szNameOverride;

  g_pDmap = pDmap;
  g_selBits.Init(pDmap.GetWidth(), pDmap.GetHeight());
  g_nSelectedX = -1;
  g_nSelectedY = -1;
  g_nHoverX = -1;
  g_nHoverY = -1;

  g_renderer.BuildMapTexture(pDmap, g_bShowBlocked);
  g_renderer.CenterOnCell((pDmap.GetWidth() / 2) | 0, (pDmap.GetHeight() / 2) | 0);
  g_renderer.SetCamera(g_renderer.m_flCamX, g_renderer.m_flCamY, 1.0);

  document.getElementById('noFile').style.display = 'none';
  EnableMenus(true);
  g_bDirty = true;
  UpdatePanel();
  UpdateStatus();
}

function SaveFile() {
  if (!g_pDmap) return;
  const blob = g_pDmap.Save();
  if (!blob) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = g_pDmap.GetFilename() || 'map.dmap';
  a.click();
  URL.revokeObjectURL(a.href);
  UpdatePanel();
}

function GoToCell(nX, nY) {
  if (!g_pDmap) return;
  nX = Math.max(0, Math.min(g_pDmap.GetWidth() - 1, nX));
  nY = Math.max(0, Math.min(g_pDmap.GetHeight() - 1, nY));
  g_renderer.CenterOnCell(nX, nY);
  g_bDirty = true;
}

function CenterMap() {
  if (!g_pDmap) return;
  GoToCell((g_pDmap.GetWidth() / 2) | 0, (g_pDmap.GetHeight() / 2) | 0);
}

function FitToView() {
  if (!g_pDmap) return;
  const nVW = viewport.clientWidth;
  const nVH = viewport.clientHeight;
  const nMapW = g_pDmap.GetWidth();
  const nMapH = g_pDmap.GetHeight();
  let flZoom;
  if (g_renderer.m_bIsIso) {
    const flDiamondW = nMapW + nMapH;
    const flDiamondH = (nMapW + nMapH) / 2;
    flZoom = Math.min(nVW / flDiamondW, nVH / flDiamondH) * 0.9;
  } else {
    flZoom = Math.min(nVW / nMapW, nVH / nMapH) * 0.95;
  }
  g_renderer.CenterOnCell((nMapW / 2) | 0, (nMapH / 2) | 0);
  g_renderer.SetCamera(g_renderer.m_flCamX, g_renderer.m_flCamY, flZoom);
  g_bDirty = true;
  UpdateStatus();
}

function ClearSelection() {
  g_selBits.ClearSelection();
  g_nSelectedX = -1;
  g_nSelectedY = -1;
  g_bDirty = true;
  UpdatePanel();
  UpdateStatus();
}

function SelectAll() {
  if (!g_pDmap) return;
  g_selBits.SelectAll();
  g_bDirty = true;
  UpdatePanel();
  UpdateStatus();
}

viewport.addEventListener('mousedown', (e) => {
  if (!g_pDmap) return;
  const rect = viewport.getBoundingClientRect();
  const flX = e.clientX - rect.left;
  const flY = e.clientY - rect.top;

  if (e.button === 2) {
    g_bIsDragging = true;
    g_flDragStartX = e.clientX;
    g_flDragStartY = e.clientY;
    viewport.style.cursor = 'grabbing';
    return;
  }

  if (e.button === 0) {
    if (e.ctrlKey) {
      g_bIsSelecting = true;
      g_flSelSX = flX; g_flSelSY = flY;
      g_flSelEX = flX; g_flSelEY = flY;
      const c = g_renderer.ScreenToCell(flX, flY);
      g_nSelStartCX = c.nX; g_nSelStartCY = c.nY;
      g_nSelEndCX = c.nX; g_nSelEndCY = c.nY;
    } else {
      const c = g_renderer.ScreenToCell(flX, flY);
      if (c.nX >= 0 && c.nX < g_pDmap.GetWidth() && c.nY >= 0 && c.nY < g_pDmap.GetHeight()) {
        if (!e.shiftKey) g_selBits.ClearSelection();
        g_selBits.SelectCell(c.nX, c.nY);
        g_nSelectedX = c.nX;
        g_nSelectedY = c.nY;
        g_bDirty = true;
        UpdatePanel();
        UpdateStatus();
      }
    }
  }
});

viewport.addEventListener('mousemove', (e) => {
  if (!g_pDmap) return;
  const rect = viewport.getBoundingClientRect();
  const flX = e.clientX - rect.left;
  const flY = e.clientY - rect.top;

  if (g_bIsDragging) {
    const flDx = (e.clientX - g_flDragStartX) / g_renderer.m_flZoom;
    const flDy = (e.clientY - g_flDragStartY) / g_renderer.m_flZoom;
    g_flDragStartX = e.clientX;
    g_flDragStartY = e.clientY;
    g_renderer.SetCamera(
      g_renderer.m_flCamX - flDx,
      g_renderer.m_flCamY + flDy,
      g_renderer.m_flZoom
    );
    g_bDirty = true;
    return;
  }

  if (g_bIsSelecting) {
    g_flSelEX = flX; g_flSelEY = flY;
    const c = g_renderer.ScreenToCell(flX, flY);
    g_nSelEndCX = c.nX; g_nSelEndCY = c.nY;
    g_bDirty = true;
    return;
  }

  const c = g_renderer.ScreenToCell(flX, flY);
  if (c.nX >= 0 && c.nX < g_pDmap.GetWidth() && c.nY >= 0 && c.nY < g_pDmap.GetHeight()) {
    if (g_nHoverX !== c.nX || g_nHoverY !== c.nY) {
      g_nHoverX = c.nX;
      g_nHoverY = c.nY;
      g_bDirty = true;
      UpdateStatus();
    }
  } else {
    if (g_nHoverX !== -1) {
      g_nHoverX = -1; g_nHoverY = -1;
      g_bDirty = true;
      UpdateStatus();
    }
  }
});

window.addEventListener('mouseup', (e) => {
  if (e.button === 2 && g_bIsDragging) {
    g_bIsDragging = false;
    viewport.style.cursor = 'crosshair';
    return;
  }
  if (e.button === 0 && g_bIsSelecting) {
    g_bIsSelecting = false;
    if (!e.shiftKey) g_selBits.ClearSelection();
    const nMinX = Math.max(0, Math.min(g_nSelStartCX, g_nSelEndCX));
    const nMaxX = Math.min(g_pDmap.GetWidth() - 1, Math.max(g_nSelStartCX, g_nSelEndCX));
    const nMinY = Math.max(0, Math.min(g_nSelStartCY, g_nSelEndCY));
    const nMaxY = Math.min(g_pDmap.GetHeight() - 1, Math.max(g_nSelStartCY, g_nSelEndCY));
    for (let nY = nMinY; nY <= nMaxY; nY++)
      for (let nX = nMinX; nX <= nMaxX; nX++)
        g_selBits.SelectCell(nX, nY);
    if (g_selBits.GetSelectedCount() > 0 && g_nSelectedX < 0) {
      g_nSelectedX = nMinX; g_nSelectedY = nMinY;
    }
    g_bDirty = true;
    UpdatePanel();
    UpdateStatus();
  }
});

viewport.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (!g_pDmap || !e.ctrlKey) return;
  let flFactor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
  if (e.shiftKey) flFactor = e.deltaY < 0 ? 1.5 : 1 / 1.5;

  const rect = viewport.getBoundingClientRect();
  const flSx = e.clientX - rect.left;
  const flSy = e.clientY - rect.top;

  const wBefore = g_renderer.ScreenToWorld(flSx, flSy);

  let flNewZoom = g_renderer.m_flZoom * flFactor;
  flNewZoom = Math.max(0.05, Math.min(128, flNewZoom));

  const nVW = viewport.clientWidth;
  const nVH = viewport.clientHeight;
  const flNewCamX = wBefore.flX - (flSx - nVW / 2) / flNewZoom;
  const flNewCamY = wBefore.flY + (flSy - nVH / 2) / flNewZoom;

  g_renderer.SetCamera(flNewCamX, flNewCamY, flNewZoom);
  g_bDirty = true;
  UpdateStatus();
}, { passive: false });

viewport.addEventListener('contextmenu', (e) => e.preventDefault());

document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (e.key === 'Escape') { ClearSelection(); return; }
  if (e.ctrlKey && e.key === 'g') { e.preventDefault(); ShowGoTo(); return; }
  if (e.ctrlKey && e.key === 'o') { e.preventDefault(); fileIn.click(); return; }
  if (e.ctrlKey && e.key === 's') { e.preventDefault(); SaveFile(); return; }
  if (e.ctrlKey && e.key === 'a') { e.preventDefault(); SelectAll(); return; }
  if (e.key === 'f' || e.key === 'F') { if (g_nSelectedX >= 0) GoToCell(g_nSelectedX, g_nSelectedY); return; }
  if (e.key === 'Home') { CenterMap(); return; }
  if (e.key === '0') { FitToView(); return; }
});

fileIn.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  await OpenFile(file);
  fileIn.value = '';
});

function EnableMenus(bEnabled) {
  document.querySelector('[data-action="save"]').disabled = !bEnabled;
  document.querySelector('[data-action="saveAs"]').disabled = !bEnabled;
  document.querySelector('[data-action="clearSel"]').disabled = !bEnabled;
  document.querySelector('[data-action="selectAll"]').disabled = !bEnabled;
  document.querySelector('[data-action="goTo"]').disabled = !bEnabled;
  document.querySelector('[data-action="centerMap"]').disabled = !bEnabled;
  document.querySelector('[data-action="fitView"]').disabled = !bEnabled;
}

document.querySelectorAll('.menu-item').forEach(item => {
  const label = item.querySelector('.menu-label');
  label.addEventListener('click', (e) => {
    e.stopPropagation();
    if (g_openMenu === item) { CloseMenus(); } else { CloseMenus(); item.classList.add('open'); g_openMenu = item; }
  });
  label.addEventListener('mouseenter', () => {
    if (g_openMenu && g_openMenu !== item) { CloseMenus(); item.classList.add('open'); g_openMenu = item; }
  });
});
document.addEventListener('click', () => CloseMenus());
function CloseMenus() { document.querySelectorAll('.menu-item').forEach(i => i.classList.remove('open')); g_openMenu = null; }

document.querySelector('[data-action="open"]').addEventListener('click', () => { CloseMenus(); fileIn.click(); });
document.querySelector('[data-action="save"]').addEventListener('click', () => { CloseMenus(); SaveFile(); });
document.querySelector('[data-action="saveAs"]').addEventListener('click', () => { CloseMenus(); SaveFile(); });
document.querySelector('[data-action="clearSel"]').addEventListener('click', () => { CloseMenus(); ClearSelection(); });
document.querySelector('[data-action="selectAll"]').addEventListener('click', () => { CloseMenus(); SelectAll(); });
document.querySelector('[data-action="toggleGrid"]').addEventListener('click', (e) => {
  g_bShowGrid = !g_bShowGrid;
  e.target.classList.toggle('checked');
  document.getElementById('cGrid').checked = g_bShowGrid;
  g_renderer.SetGridVisible(g_bShowGrid);
  g_bDirty = true;
});
document.querySelector('[data-action="toggleElev"]').addEventListener('click', (e) => {
  g_bShowElev = !g_bShowElev;
  e.target.classList.toggle('checked');
  document.getElementById('cElev').checked = g_bShowElev;
  g_bDirty = true;
});
document.querySelector('[data-action="toggleBlk"]').addEventListener('click', (e) => {
  g_bShowBlocked = !g_bShowBlocked;
  e.target.classList.toggle('checked');
  document.getElementById('cBlk').checked = g_bShowBlocked;
  if (g_pDmap) { g_renderer.RefreshMapTexture(g_pDmap, g_bShowBlocked); g_bDirty = true; }
});
document.querySelector('[data-action="toggleIso"]').addEventListener('click', (e) => {
  g_renderer.SetIsometric(!g_renderer.m_bIsIso);
  e.target.classList.toggle('checked');
  if (g_pDmap) CenterMap();
  g_bDirty = true;
  UpdateStatus();
});
document.querySelector('[data-action="goTo"]').addEventListener('click', () => { CloseMenus(); ShowGoTo(); });
document.querySelector('[data-action="centerMap"]').addEventListener('click', () => { CloseMenus(); CenterMap(); });
document.querySelector('[data-action="fitView"]').addEventListener('click', () => { CloseMenus(); FitToView(); });
document.querySelector('[data-action="about"]').addEventListener('click', () => { CloseMenus(); document.getElementById('dlgAbout').showModal(); });

document.getElementById('cGrid').addEventListener('change', (e) => { g_bShowGrid = e.target.checked; g_renderer.SetGridVisible(g_bShowGrid); g_bDirty = true; });
document.getElementById('cElev').addEventListener('change', (e) => { g_bShowElev = e.target.checked; g_bDirty = true; });
document.getElementById('cBlk').addEventListener('change', (e) => {
  g_bShowBlocked = e.target.checked;
  if (g_pDmap) { g_renderer.RefreshMapTexture(g_pDmap, g_bShowBlocked); g_bDirty = true; }
});

document.getElementById('aBlk').addEventListener('click', () => {
  if (!g_pDmap) return;
  const nVal = parseInt(document.getElementById('eBlk').value) ? 1 : 0;
  ApplyToSelected((nX, nY) => {
    g_pDmap.SetCellBlocked(nX, nY, nVal);
  });
  g_renderer.RefreshMapTexture(g_pDmap, g_bShowBlocked);
  UpdatePanel();
});
document.getElementById('aSrf').addEventListener('click', () => {
  if (!g_pDmap) return;
  const nVal = Math.max(0, Math.min(65535, parseInt(document.getElementById('eSrf').value) || 0));
  ApplyToSelected((nX, nY) => {
    g_pDmap.SetCellSurface(nX, nY, nVal);
  });
  g_renderer.RefreshMapTexture(g_pDmap, g_bShowBlocked);
  UpdatePanel();
});
document.getElementById('aElv').addEventListener('click', () => {
  if (!g_pDmap) return;
  const nVal = Math.max(-32768, Math.min(32767, parseInt(document.getElementById('eElv').value) || 0));
  ApplyToSelected((nX, nY) => {
    g_pDmap.SetCellElevation(nX, nY, nVal);
  });
  UpdatePanel();
});

function ApplyToSelected(fn) {
  if (!g_pDmap) return;
  const nW = g_pDmap.GetWidth();
  const nH = g_pDmap.GetHeight();
  for (let nY = 0; nY < nH; nY++)
    for (let nX = 0; nX < nW; nX++)
      if (g_selBits.IsCellSelected(nX, nY)) fn(nX, nY);
  g_bDirty = true;
}

document.getElementById('bClearSel').addEventListener('click', ClearSelection);
document.getElementById('bGoSel').addEventListener('click', () => { if (g_nSelectedX >= 0) GoToCell(g_nSelectedX, g_nSelectedY); });
document.getElementById('bGo').addEventListener('click', () => {
  GoToCell(parseInt(document.getElementById('gX').value) || 0, parseInt(document.getElementById('gY').value) || 0);
});

function ShowGoTo() {
  if (!g_pDmap) return;
  document.getElementById('dMapSize').textContent = `Map size: ${g_pDmap.GetWidth()} x ${g_pDmap.GetHeight()}`;
  document.getElementById('dlgGoTo').showModal();
}
document.getElementById('dGo').addEventListener('click', () => {
  GoToCell(parseInt(document.getElementById('dGX').value) || 0, parseInt(document.getElementById('dGY').value) || 0);
  document.getElementById('dlgGoTo').close();
});
document.getElementById('dCenter').addEventListener('click', () => { CenterMap(); document.getElementById('dlgGoTo').close(); });
document.getElementById('dCancel').addEventListener('click', () => { document.getElementById('dlgGoTo').close(); });
document.getElementById('dAboutOk').addEventListener('click', () => { document.getElementById('dlgAbout').close(); });

function UpdatePanel() {
  const panelHint = document.getElementById('panelHint');
  const panelSel = document.getElementById('panelSel');
  const nCount = g_selBits.GetSelectedCount();

  if (nCount > 0 && g_pDmap) {
    panelHint.style.display = 'none';
    panelSel.style.display = 'block';
    let szInfo = `Selected: ${nCount} cells`;
    if (nCount === 1 && g_nSelectedX >= 0) {
      const nX = g_nSelectedX, nY = g_nSelectedY;
      szInfo += `<br>Cell: (${nX}, ${nY})`;
      szInfo += `<br>Blocked: ${g_pDmap.GetBlocked(nX, nY) ? 'Yes' : 'No'}`;
      szInfo += `<br>Surface: ${g_pDmap.GetSurface(nX, nY)}`;
      szInfo += `<br>Elevation: ${g_pDmap.GetElevation(nX, nY)}`;
      document.getElementById('eBlk').value = g_pDmap.GetBlocked(nX, nY) ? 1 : 0;
      document.getElementById('eSrf').value = g_pDmap.GetSurface(nX, nY);
      document.getElementById('eElv').value = g_pDmap.GetElevation(nX, nY);
    }
    document.getElementById('selInfo').innerHTML = szInfo;
  } else {
    panelHint.style.display = 'block';
    panelSel.style.display = 'none';
  }

  const fStatus = document.getElementById('fStatus');
  if (g_pDmap) {
    const bDirty = g_pDmap.IsDirty();
    fStatus.innerHTML = `File: ${g_pDmap.GetFilename()}<br><span class="${bDirty ? 'modified' : 'saved'}">${bDirty ? 'Modified' : 'Saved'}</span>`;
  } else {
    fStatus.textContent = 'No file open';
  }
}

function UpdateStatus() {
  document.getElementById('sHover').textContent = `Hover: (${g_nHoverX}, ${g_nHoverY})`;
  document.getElementById('sSel').textContent = `Sel: ${g_selBits.GetSelectedCount()}`;
  document.getElementById('sZoom').textContent = `Zoom: ${g_renderer.m_flZoom.toFixed(1)}`;
  document.getElementById('sMode').textContent = g_renderer.m_bIsIso ? 'ISO' : '2D';
  document.getElementById('sFps').textContent = `FPS: ${Math.round(g_flFPS)}`;
}

function OnFrame(flTime) {
  if (g_flLastTime > 0) {
    g_flFpsAccum += (flTime - g_flLastTime);
    g_nFrames++;
    if (g_flFpsAccum >= 500) {
      g_flFPS = (g_nFrames / g_flFpsAccum) * 1000;
      g_nFrames = 0;
      g_flFpsAccum = 0;
      UpdateStatus();
    }
  }
  g_flLastTime = flTime;

  if (g_bDirty && g_pDmap) {
    g_renderer.Render();
    const nVW = viewport.clientWidth;
    const nVH = viewport.clientHeight;
    g_overlay.Resize(nVW, nVH);
    g_overlay.Render(g_renderer, g_selBits, g_nHoverX, g_nHoverY, g_pDmap, g_bShowElev);
    if (g_bIsSelecting) {
      const flMinX = Math.min(g_flSelSX, g_flSelEX);
      const flMinY = Math.min(g_flSelSY, g_flSelEY);
      const flMaxX = Math.max(g_flSelSX, g_flSelEX);
      const flMaxY = Math.max(g_flSelSY, g_flSelEY);
      g_overlay.RenderSelectionBox(flMinX, flMinY, flMaxX, flMaxY);
    }
    g_bDirty = false;
  }

  requestAnimationFrame(OnFrame);
}

window.addEventListener('resize', () => {
  g_renderer.Resize();
  g_bDirty = true;
});

document.querySelectorAll('.imgui-title').forEach(t => {
  t.addEventListener('click', () => t.parentElement.classList.toggle('collapsed'));
});

requestAnimationFrame(OnFrame);

async function LoadMapByName(szName) {
  try {
    const resp = await fetch('maps/' + szName + '.dmap');
    if (!resp.ok) { console.error('[LoadMapByName] not found:', szName); return false; }
    const buf = await resp.arrayBuffer();
    await OpenFile(buf, szName + '.dmap');
    return true;
  } catch (e) { console.error('[LoadMapByName]', e); return false; }
}

async function DiscoverMaps() {
  const params = new URLSearchParams(window.location.search);
  const szDirectMap = params.get('map');
  if (szDirectMap) { if (await LoadMapByName(szDirectMap)) return; }

  try {
    const resp = await fetch('maps/maps.json');
    if (!resp.ok) return;
    const vecMaps = await resp.json();
    if (!Array.isArray(vecMaps) || vecMaps.length === 0) return;

    const mapGroups = new Map();
    for (const szName of vecMaps) {
      const match = szName.match(/-(\d{3,})$/);
      const szGroup = match ? 'v' + match[1] : 'Others';
      if (!mapGroups.has(szGroup)) mapGroups.set(szGroup, []);
      mapGroups.get(szGroup).push(szName);
    }
    const vecGroupKeys = [...mapGroups.keys()].sort((a, b) => {
      if (a === 'Others') return 1;
      if (b === 'Others') return -1;
      return a.localeCompare(b);
    });

    const elDropdown = document.getElementById('mapsDropdown');
    const elEmpty = document.getElementById('mapsDropdownEmpty');
    elEmpty.style.display = 'none';
    for (const szGroup of vecGroupKeys) {
      const sep = document.createElement('div');
      sep.className = 'menu-dropdown-group';
      sep.textContent = szGroup;
      elDropdown.appendChild(sep);
      for (const szName of mapGroups.get(szGroup)) {
        const btn = document.createElement('button');
        btn.textContent = szName;
        btn.addEventListener('click', async () => { CloseMenus(); await LoadMapByName(szName); });
        elDropdown.appendChild(btn);
      }
    }
  } catch (e) {}
}

DiscoverMaps();
