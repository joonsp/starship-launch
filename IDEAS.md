# Ideas for later

## Living Omarchy wallpaper (requested 2026-09-29)
Turn the freeze-frame into a living desktop wallpaper on Omarchy (Hyprland):
- Use "slow drift" mode with a slow orbiting or breathing camera and a very low frame rate.
- Candidate routes:
  - (a) render a seamless looping video (headless capture) and play it with a video-wallpaper tool such as mpvpaper;
  - (b) a layer-shell webview that runs the actual three.js scene, with a battery-aware low-quality preset.
- Could follow the time of day: sunrise look in the morning, night-launch look at night.
- Check how Omarchy manages backgrounds (the omarchy skill / ~/.config/omarchy) before choosing.

## Photo mode with configurable lenses (requested 2026-09-29)
A "camera mode" for taking photographs of the frozen moment with real-camera controls:
- Physical lens model: focal length (14–600 mm), aperture (f/1.4–f/22), focus distance, sensor size (full frame / APS-C / drone 1").
- Depth of field is driven by the physical circle of confusion. The use case is focusing on part of the rocket (e.g. the engines or grid fins) while the fireball and clouds fall out of focus.
- Tap or click to focus (depth pick), with a focus-peaking overlay.
- Bokeh: shaped by the aperture blades, and it must work with the HDR plume and fireball highlights. Also a DoF-aware volume composite: the steam needs a depth, so use the volume's weighted depth or T=0.5 depth.
- Exposure triangle (ISO/shutter as exposure only, since the scene is frozen), a histogram, grid/level overlays, and a shutter sound and flash animation.
- Save at high resolution through the existing exportStill path, plus a gallery of shots taken this session. Could embed EXIF-like metadata (lens, f-stop, T+ time).
- Builds on the existing lens panel (FOV, dolly zoom, roll, tilt-shift) and the post chain. Replace or augment tilt-shift with a true DoF effect (pmndrs DepthOfFieldEffect, or a custom CoC gather with near/far fields).
