// Scene-linear radiance targets for the reference-photo palette. OWNER: post-processing module.
//
// Each entry is the scene-referred linear RGB (the values a shader writes into the HDR buffer)
// that the PHOTO preset's post chain (exposure 1, AgX, grade, photo-look LUT) maps onto the
// measured swatch of research/palette.json. They were found numerically in sandbox/post.ts
// (app.post.invert(): the real chain is run on a chart and inverted). Use them to set the sky,
// cloud, steam, ground and fire radiances of the scene modules: e.g. a sky-dome zenith of
// (0.014, 0.129, 0.297) renders as the #127ebe of the photo. Last regenerated for the polish-round-2 grade
// (PHOTO_PRESET grade + DEFAULT_PHOTO_LOOK), exposure 1.
//   err  = largest 8-bit channel error of the best solution (0-2: exact; larger: the swatch is at
//          the edge of what AgX can reach, e.g. the saturated fire edge).
// Regenerate whenever grade.ts / presets.ts change (see sandbox/post.ts).
export interface SwatchTarget { hex: string; linear: [number, number, number]; err: number }

export const PHOTO_SWATCH_RADIANCE: Record<string, SwatchTarget> = {
  sky_zenith_deep: { hex: '#127ebe', linear: [0.014, 0.1288, 0.2974], err: 0 },
  sky_top_mid: { hex: '#1c74ad', linear: [0.0227, 0.114, 0.2438], err: 0 },
  sky_gap_left_upper: { hex: '#3184bc', linear: [0.0437, 0.1512, 0.3104], err: 0 },
  sky_upper_right_hazy: { hex: '#9ab2c9', linear: [0.2777, 0.3924, 0.6043], err: 0 },
  sky_gap_mid_upper: { hex: '#7fa5c2', linear: [0.1775, 0.2995, 0.48], err: 0 },
  sky_gap_right_mid: { hex: '#91b1c3', linear: [0.2372, 0.3844, 0.5384], err: 0 },
  sky_horizon_left: { hex: '#8bb4bc', linear: [0.2074, 0.4117, 0.4958], err: 0 },
  sky_below_cloud_centre: { hex: '#9caeaf', linear: [0.2794, 0.3806, 0.4127], err: 0 },
  cirrus_streak: { hex: '#7897b4', linear: [0.1589, 0.238, 0.372], err: 0 },
  cloud_highlight_warm: { hex: '#e4d6c1', linear: [1.2159, 0.9642, 0.7178], err: 0 },
  cloud_highlight_centre: { hex: '#e4d4bc', linear: [1.1941, 0.9166, 0.6388], err: 0 },
  cloud_brightest: { hex: '#e8d6bd', linear: [1.3339, 0.9706, 0.6596], err: 0 },
  cloud_shadow_neutral: { hex: '#797978', linear: [0.1465, 0.1493, 0.1556], err: 0 },
  cloud_belly: { hex: '#6a6c69', linear: [0.112, 0.1181, 0.1184], err: 0 },
  cloud_shadow_lilac: { hex: '#776568', linear: [0.1367, 0.1035, 0.1158], err: 0 },
  plume_billow_white_left: { hex: '#8598a5', linear: [0.1902, 0.2499, 0.3137], err: 0 },
  plume_billow_shadow_left: { hex: '#718593', linear: [0.1369, 0.1801, 0.2268], err: 0 },
  plume_billow_blue_right: { hex: '#5d6572', linear: [0.09, 0.1012, 0.1286], err: 0 },
  plume_billow_dark_right: { hex: '#666367', linear: [0.1048, 0.1001, 0.1134], err: 0 },
  plume_cream_left: { hex: '#d3c0a6', linear: [0.7412, 0.5695, 0.4034], err: 0 },
  plume_peach_left: { hex: '#cbac81', linear: [0.5778, 0.3879, 0.2068], err: 0 },
  plume_orange_lit_right: { hex: '#d4a164', linear: [0.614, 0.318, 0.1183], err: 0 },
  plume_orange_top_right: { hex: '#cd975d', linear: [0.5224, 0.2674, 0.1066], err: 0 },
  plume_orange_mid_left: { hex: '#d89451', linear: [0.574, 0.2531, 0.0861], err: 0 },
  plume_wall_dark_base: { hex: '#412f2c', linear: [0.0468, 0.0306, 0.0286], err: 0 },
  plume_base_grey_brown: { hex: '#805a48', linear: [0.1465, 0.0881, 0.0683], err: 0 },
  fire_hot_core: { hex: '#fbf7a3', linear: [3.4348, 3.8287, 0.0496], err: 1 },
  fire_yellow_base: { hex: '#f7e693', linear: [2.2778, 1.618, 0.0448], err: 0 },
  fire_orange_edge: { hex: '#f5960e', linear: [0.6905, 0.2679, 0.0121], err: 0 },
  plume_glow_lower_tower_lit: { hex: '#ea9d6d', linear: [0.8828, 0.281, 0.1287], err: 0 },
  plume_column_pink_white: { hex: '#f5e4e7', linear: [2.4433, 1.3767, 2.2305], err: 0 },
  plume_column_upper: { hex: '#f7e3e7', linear: [2.6161, 1.309, 2.2163], err: 0 },
  booster_body_lit: { hex: '#9f9080', linear: [0.2698, 0.2272, 0.1896], err: 0 },
  booster_body_dark: { hex: '#434345', linear: [0.0523, 0.0514, 0.0556], err: 0 },
  booster_low_pink: { hex: '#99877a', linear: [0.244, 0.1952, 0.1717], err: 0 },
  ship_black: { hex: '#1d1b1a', linear: [0.017, 0.0142, 0.0124], err: 0 },
  tower_red: { hex: '#7b5958', linear: [0.1415, 0.0838, 0.0873], err: 0 },
  tower_top: { hex: '#755e5c', linear: [0.1288, 0.0923, 0.0949], err: 0 },
  ocean_far: { hex: '#45626d', linear: [0.0595, 0.0945, 0.1146], err: 0 },
  ocean_left: { hex: '#547884', linear: [0.0813, 0.1395, 0.1721], err: 0 },
  ocean_right: { hex: '#66797d', linear: [0.1084, 0.1464, 0.1628], err: 0 },
  pool_orange_refl: { hex: '#966438', linear: [0.1953, 0.1086, 0.052], err: 0 },
  pool_sky_refl_bottom_right: { hex: '#717b84', linear: [0.1312, 0.1523, 0.1799], err: 0 },
  pool_left_dark: { hex: '#32251d', linear: [0.0326, 0.0228, 0.0169], err: 0 },
  marsh_olive_dark: { hex: '#483b24', linear: [0.0545, 0.0446, 0.0255], err: 0 },
  tidal_flat_brown: { hex: '#34251e', linear: [0.0343, 0.0228, 0.0177], err: 0 },
  tidal_flat_mid: { hex: '#422e24', linear: [0.0475, 0.031, 0.024], err: 0 },
  pad_concrete_warm: { hex: '#55403e', linear: [0.073, 0.0494, 0.0491], err: 0 },
  asphalt_left: { hex: '#15191a', linear: [0.0119, 0.0128, 0.0124], err: 0 },
  sandbank_dark: { hex: '#2d2b2a', linear: [0.0298, 0.0275, 0.0264], err: 0 },
};
