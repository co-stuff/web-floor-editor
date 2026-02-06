import * as THREE from 'three';
import { g_surfaceColors, g_blockedColorRGB, g_bgColorRGB } from './CSurfaceColors.js';

const VERT_SHADER = `
varying vec2 vWorldPos;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xy;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const FRAG_SHADER = `
uniform sampler2D uMap;
uniform vec2 uSize;
uniform bool uGrid;
uniform bool uIso;
varying vec2 vWorldPos;
void main() {
  float cx, cy;
  if (uIso) {
    cx = vWorldPos.x * 0.5 - vWorldPos.y + uSize.x * 0.5;
    cy = -vWorldPos.x * 0.5 - vWorldPos.y + uSize.y * 0.5;
  } else {
    cx = vWorldPos.x + uSize.x * 0.5;
    cy = -vWorldPos.y + uSize.y * 0.5;
  }
  if (cx < 0.0 || cx >= uSize.x || cy < 0.0 || cy >= uSize.y) {
    gl_FragColor = vec4(0.118, 0.118, 0.118, 1.0);
    return;
  }
  vec2 uv = vec2(cx / uSize.x, 1.0 - cy / uSize.y);
  vec4 c = texture2D(uMap, uv);
  if (uGrid) {
    vec2 f = vec2(fract(cx), fract(cy));
    float t = 0.08;
    if (f.x < t || f.x > (1.0 - t) || f.y < t || f.y > (1.0 - t)) {
      c.rgb *= 0.5;
    }
  }
  gl_FragColor = c;
}`;

export default class CMapRenderer {
  constructor(container) {
    this.m_container = container;
    this.m_nMapW = 0;
    this.m_nMapH = 0;
    this.m_bIsIso = false;
    this.m_bShowGrid = true;
    this.m_bDirty = true;

    this.m_flCamX = 0;
    this.m_flCamY = 0;
    this.m_flZoom = 1.0;

    this.m_mapTexData = null;
    this.m_mapTexture = null;
    this.m_mapMesh = null;
    this.m_uniforms = null;

    const nW = container.clientWidth;
    const nH = container.clientHeight;

    this.m_renderer = new THREE.WebGLRenderer({ antialias: false });
    this.m_renderer.setSize(nW, nH);
    this.m_renderer.setPixelRatio(1);
    this.m_renderer.setClearColor(0x1E1E1E);
    container.insertBefore(this.m_renderer.domElement, container.firstChild);

    this.m_camera = new THREE.OrthographicCamera(-nW / 2, nW / 2, nH / 2, -nH / 2, 0.1, 10);
    this.m_camera.position.set(0, 0, 5);

    this.m_scene = new THREE.Scene();
    this.m_scene.background = new THREE.Color(0x1E1E1E);
  }

  BuildMapTexture(pDmap, bShowBlocked) {
    const nW = pDmap.GetWidth();
    const nH = pDmap.GetHeight();
    this.m_nMapW = nW;
    this.m_nMapH = nH;

    this.m_mapTexData = new Uint8Array(nW * nH * 4);
    this.UpdateMapTexture(pDmap, bShowBlocked);

    this.m_mapTexture = new THREE.DataTexture(this.m_mapTexData, nW, nH, THREE.RGBAFormat);
    this.m_mapTexture.minFilter = THREE.NearestFilter;
    this.m_mapTexture.magFilter = THREE.NearestFilter;
    this.m_mapTexture.needsUpdate = true;

    if (this.m_mapMesh) {
      this.m_scene.remove(this.m_mapMesh);
      this.m_mapMesh.geometry.dispose();
      this.m_mapMesh.material.dispose();
    }

    this.m_uniforms = {
      uMap: { value: this.m_mapTexture },
      uSize: { value: new THREE.Vector2(nW, nH) },
      uGrid: { value: true },
      uIso: { value: this.m_bIsIso }
    };

    const nGeoW = nW + nH + 4;
    const nGeoH = Math.max(nH, (nW + nH) / 2) + 4;
    const geo = new THREE.PlaneGeometry(nGeoW, nGeoH);
    const mat = new THREE.ShaderMaterial({
      uniforms: this.m_uniforms,
      vertexShader: VERT_SHADER,
      fragmentShader: FRAG_SHADER
    });
    this.m_mapMesh = new THREE.Mesh(geo, mat);
    this.m_scene.add(this.m_mapMesh);
    this.m_bDirty = true;
  }

  UpdateMapTexture(pDmap, bShowBlocked) {
    const nW = pDmap.GetWidth();
    const nH = pDmap.GetHeight();
    const d = this.m_mapTexData;
    const blocked = pDmap.m_blocked;
    const surface = pDmap.m_surface;

    for (let nY = 0; nY < nH; nY++) {
      const nSrcRow = nY * nW;
      const nDstRow = ((nH - 1) - nY) * nW;
      for (let nX = 0; nX < nW; nX++) {
        const nSrcIdx = nSrcRow + nX;
        const nDstIdx = (nDstRow + nX) * 4;
        let rgb;
        if (blocked[nSrcIdx]) {
          rgb = bShowBlocked ? g_blockedColorRGB : g_bgColorRGB;
        } else {
          rgb = g_surfaceColors[surface[nSrcIdx] % 10];
        }
        d[nDstIdx] = rgb[0];
        d[nDstIdx + 1] = rgb[1];
        d[nDstIdx + 2] = rgb[2];
        d[nDstIdx + 3] = 255;
      }
    }
  }

  RefreshMapTexture(pDmap, bShowBlocked) {
    if (!this.m_mapTexData) return;
    this.UpdateMapTexture(pDmap, bShowBlocked);
    this.m_mapTexture.needsUpdate = true;
    this.m_bDirty = true;
  }

  SetIsometric(bIso) {
    if (this.m_bIsIso === bIso) return;
    this.m_bIsIso = bIso;
    if (this.m_uniforms) {
      this.m_uniforms.uIso.value = bIso;
    }
    this.m_bDirty = true;
  }

  SetGridVisible(bVisible) {
    this.m_bShowGrid = bVisible;
    this.m_bDirty = true;
  }

  SetCamera(flX, flY, flZoom) {
    this.m_flCamX = flX;
    this.m_flCamY = flY;
    this.m_flZoom = flZoom;
    this.m_bDirty = true;
  }

  Resize() {
    const nW = this.m_container.clientWidth;
    const nH = this.m_container.clientHeight;
    this.m_renderer.setSize(nW, nH);
    this.m_bDirty = true;
  }

  Render() {
    if (!this.m_bDirty) return;
    this.m_bDirty = false;

    const nW = this.m_container.clientWidth;
    const nH = this.m_container.clientHeight;
    const flHalfW = nW / (2 * this.m_flZoom);
    const flHalfH = nH / (2 * this.m_flZoom);

    this.m_camera.left = -flHalfW;
    this.m_camera.right = flHalfW;
    this.m_camera.top = flHalfH;
    this.m_camera.bottom = -flHalfH;
    this.m_camera.position.set(this.m_flCamX, this.m_flCamY, 5);
    this.m_camera.updateProjectionMatrix();

    if (this.m_uniforms) {
      this.m_uniforms.uGrid.value = this.m_bShowGrid && this.m_flZoom >= 4.0;
    }

    this.m_renderer.render(this.m_scene, this.m_camera);
  }

  CellCenterWorld(nCx, nCy) {
    if (this.m_bIsIso) {
      return {
        flX: (nCx - nCy) - (this.m_nMapW - this.m_nMapH) / 2,
        flY: -(nCx + nCy + 1) / 2 + (this.m_nMapW + this.m_nMapH) / 4
      };
    }
    return {
      flX: nCx - this.m_nMapW / 2 + 0.5,
      flY: this.m_nMapH / 2 - nCy - 0.5
    };
  }

  ScreenToWorld(flSx, flSy) {
    const nVW = this.m_container.clientWidth;
    const nVH = this.m_container.clientHeight;
    return {
      flX: this.m_flCamX + (flSx - nVW / 2) / this.m_flZoom,
      flY: this.m_flCamY + (nVH / 2 - flSy) / this.m_flZoom
    };
  }

  WorldToScreen(flWx, flWy) {
    const nVW = this.m_container.clientWidth;
    const nVH = this.m_container.clientHeight;
    return {
      flX: (flWx - this.m_flCamX) * this.m_flZoom + nVW / 2,
      flY: nVH / 2 - (flWy - this.m_flCamY) * this.m_flZoom
    };
  }

  WorldToCell(flWx, flWy) {
    let flCx, flCy;
    if (this.m_bIsIso) {
      flCx = flWx / 2 - flWy + this.m_nMapW / 2;
      flCy = -flWx / 2 - flWy + this.m_nMapH / 2;
    } else {
      flCx = flWx + this.m_nMapW / 2;
      flCy = -flWy + this.m_nMapH / 2;
    }
    return { nX: Math.floor(flCx), nY: Math.floor(flCy) };
  }

  ScreenToCell(flSx, flSy) {
    const w = this.ScreenToWorld(flSx, flSy);
    return this.WorldToCell(w.flX, w.flY);
  }

  CellToScreen(nCx, nCy) {
    const w = this.CellCenterWorld(nCx, nCy);
    return this.WorldToScreen(w.flX, w.flY);
  }

  CenterOnCell(nCx, nCy) {
    const w = this.CellCenterWorld(nCx, nCy);
    this.m_flCamX = w.flX;
    this.m_flCamY = w.flY;
    this.m_bDirty = true;
  }

  MarkDirty() { this.m_bDirty = true; }
}
