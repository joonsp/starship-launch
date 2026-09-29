// Minimal touch fallback for walk / fly: a virtual joystick in the lower-left quarter of the screen. Looking is done by
// dragging anywhere else on the canvas (handled by CameraController). This is the ONLY DOM the controls module builds.
// OWNER: src/controls.

export class VirtualJoystick {
  /** Stick deflection, each axis -1..1 (x right, y down: push up = negative y = forward). */
  readonly value = { x: 0, y: 0 };
  private readonly zone: HTMLDivElement;
  private readonly base: HTMLDivElement;
  private readonly knob: HTMLDivElement;
  private pointerId = -1;
  private cx = 0;
  private cy = 0;
  private readonly radius = 56;

  constructor(private readonly root: HTMLElement) {
    const z = (this.zone = document.createElement('div'));
    z.setAttribute('aria-hidden', 'true');
    z.dataset.controls = 'joystick';
    // z-index -1: below the UI shell (which is click-transparent except for its own controls), so the dock stays tappable
    z.style.cssText = 'position:fixed;left:0;bottom:0;width:46vw;height:46vh;touch-action:none;pointer-events:auto;display:none;z-index:-1;user-select:none;-webkit-user-select:none';
    const b = (this.base = document.createElement('div'));
    b.style.cssText = `position:absolute;width:${this.radius * 2}px;height:${this.radius * 2}px;left:calc(24px + env(safe-area-inset-left,0px));bottom:calc(96px + env(safe-area-inset-bottom,0px));border-radius:50%;border:2px solid rgba(255,255,255,.35);background:rgba(255,255,255,.08);backdrop-filter:blur(2px);pointer-events:none`;
    const k = (this.knob = document.createElement('div'));
    k.style.cssText = 'position:absolute;left:50%;top:50%;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;background:rgba(255,255,255,.5);box-shadow:0 1px 6px rgba(0,0,0,.35);pointer-events:none';
    b.appendChild(k);
    z.appendChild(b);
    root.appendChild(z);
    z.addEventListener('pointerdown', this.down);
    z.addEventListener('pointermove', this.move);
    z.addEventListener('pointerup', this.up);
    z.addEventListener('pointercancel', this.up);
  }

  setVisible(v: boolean): void {
    this.zone.style.display = v ? 'block' : 'none';
    if (!v) this.reset();
  }

  private centre(): void {
    const r = this.base.getBoundingClientRect();
    this.cx = r.left + r.width / 2;
    this.cy = r.top + r.height / 2;
  }

  private readonly down = (e: PointerEvent): void => {
    if (this.pointerId !== -1) return;
    this.pointerId = e.pointerId;
    this.zone.setPointerCapture(e.pointerId);
    this.centre();
    this.move(e);
    e.preventDefault();
  };

  private readonly move = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId) return;
    let dx = e.clientX - this.cx, dy = e.clientY - this.cy;
    const len = Math.hypot(dx, dy);
    if (len > this.radius) { dx = (dx / len) * this.radius; dy = (dy / len) * this.radius; }
    this.knob.style.transform = `translate(${dx}px,${dy}px)`;
    // Small dead zone, then a linear ramp to full deflection.
    const m = Math.min(1, len / this.radius);
    const s = m < 0.12 ? 0 : (m - 0.12) / 0.88;
    this.value.x = len > 1e-6 ? (dx / Math.min(len, this.radius)) * s : 0;
    this.value.y = len > 1e-6 ? (dy / Math.min(len, this.radius)) * s : 0;
  };

  private readonly up = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId) return;
    this.reset();
  };

  private reset(): void {
    this.pointerId = -1;
    this.value.x = 0; this.value.y = 0;
    this.knob.style.transform = '';
  }

  dispose(): void {
    this.zone.remove();
  }
}
