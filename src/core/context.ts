// Small shared factories used by both the real app (main.ts) and sandbox pages.
import * as THREE from 'three';
import type { AppEvent, Emitter, Globals } from '../contracts.ts';

export function createEmitter(): Emitter {
  const map = new Map<string, Set<(e: any) => void>>();
  return {
    on(type, fn) {
      let s = map.get(type);
      if (!s) map.set(type, (s = new Set()));
      s.add(fn as any);
      return () => s!.delete(fn as any);
    },
    emit(e: AppEvent) {
      map.get(e.type)?.forEach((fn) => fn(e));
    },
  };
}

export function createGlobals(): Globals {
  return {
    uTime: { value: 0 },
    uDrift: { value: 0 },
    uViewMode: { value: 0 },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunColor: { value: new THREE.Color(1, 1, 1) },
    uSkyAmbient: { value: new THREE.Color(0.3, 0.4, 0.6) },
    uGroundAmbient: { value: new THREE.Color(0.15, 0.12, 0.1) },
    uFogColor: { value: new THREE.Color(0.6, 0.7, 0.85) },
    uFogDensity: { value: 0.00008 },
    uPlumeLight: { value: new THREE.Color(1, 0.6, 0.3) },
    uPlumeAxisA: { value: new THREE.Vector3() },
    uPlumeAxisB: { value: new THREE.Vector3() },
    uCameraPos: { value: new THREE.Vector3() },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uFrame: { value: 0 },
  };
}
