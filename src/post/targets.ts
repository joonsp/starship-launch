// Scene-linear radiance targets for the reference-photo palette. OWNER: post-processing module.
//
// Each entry is the scene-referred linear RGB (the values a shader writes into the HDR buffer)
// that the PHOTO preset's post chain (exposure 1, AgX, grade, photo-look LUT) maps onto the
// measured swatch of research/palette.json. They were found numerically in sandbox/post.ts
// (app.post.invert(): the real chain is run on a chart and inverted). Use them to set the sky,
// cloud, steam, ground and fire radiances of the scene modules: e.g. a sky-dome zenith of
// (0.0066, 0.13, 0.33) renders as the #127ebe of the photo.
//   err  = largest 8-bit channel error of the best solution (0-2: exact; larger: the swatch is at
//          the edge of what AgX can reach, e.g. the saturated fire edge).
// Regenerate whenever grade.ts / presets.ts change (see sandbox/post.ts).
export interface SwatchTarget { hex: string; linear: [number, number, number]; err: number }

export const PHOTO_SWATCH_RADIANCE: Record<string, SwatchTarget> = {
  sky_zenith_deep: { hex: '#127ebe', linear: [0.0062, 0.1247, 0.3107], err: 0 },
  sky_top_mid: { hex: '#1c74ad', linear: [0.0148, 0.107, 0.2455], err: 0 },
  sky_gap_left_upper: { hex: '#3184bc', linear: [0.0331, 0.1453, 0.3169], err: 0 },
  sky_upper_right_hazy: { hex: '#9ab2c9', linear: [0.2687, 0.4011, 0.625], err: 0 },
  sky_gap_mid_upper: { hex: '#7fa5c2', linear: [0.1627, 0.2993, 0.4866], err: 0 },
  sky_gap_right_mid: { hex: '#91b1c3', linear: [0.2232, 0.3872, 0.5421], err: 0 },
  sky_horizon_left: { hex: '#8bb4bc', linear: [0.1912, 0.4177, 0.4994], err: 0 },
  sky_below_cloud_centre: { hex: '#9caeaf', linear: [0.2659, 0.3835, 0.4065], err: 0 },
  cirrus_streak: { hex: '#7897b4', linear: [0.145, 0.234, 0.3719], err: 0 },
  cloud_highlight_warm: { hex: '#e4d6c1', linear: [1.3015, 1.0224, 0.6975], err: 0 },
  cloud_highlight_centre: { hex: '#e4d4bc', linear: [1.254, 0.953, 0.6066], err: 0 },
  cloud_brightest: { hex: '#e8d6bd', linear: [1.409, 1.0027, 0.6179], err: 0 },
  cloud_shadow_neutral: { hex: '#797978', linear: [0.138, 0.1434, 0.1463], err: 0 },
  cloud_belly: { hex: '#6a6c69', linear: [0.1036, 0.113, 0.1106], err: 0 },
  cloud_shadow_lilac: { hex: '#776568', linear: [0.13, 0.0988, 0.1094], err: 0 },
  plume_billow_white_left: { hex: '#8598a5', linear: [0.1817, 0.2477, 0.3111], err: 0 },
  plume_billow_shadow_left: { hex: '#718593', linear: [0.1258, 0.1734, 0.2211], err: 0 },
  plume_billow_blue_right: { hex: '#5d6572', linear: [0.0815, 0.0944, 0.1207], err: 0 },
  plume_billow_dark_right: { hex: '#666367', linear: [0.0956, 0.0932, 0.1033], err: 0 },
  plume_cream_left: { hex: '#d3c0a6', linear: [0.7708, 0.5858, 0.3813], err: 0 },
  plume_peach_left: { hex: '#cbac81', linear: [0.6012, 0.3909, 0.1838], err: 0 },
  plume_orange_lit_right: { hex: '#d4a164', linear: [0.6501, 0.318, 0.0952], err: 0 },
  plume_orange_top_right: { hex: '#cd975d', linear: [0.5358, 0.2608, 0.0869], err: 0 },
  plume_orange_mid_left: { hex: '#d89451', linear: [0.6027, 0.2467, 0.0674], err: 0 },
  plume_wall_dark_base: { hex: '#412f2c', linear: [0.0409, 0.0265, 0.0246], err: 0 },
  plume_base_grey_brown: { hex: '#805a48', linear: [0.1393, 0.0805, 0.0587], err: 0 },
  fire_hot_core: { hex: '#fbf7a3', linear: [3.6408, 4.0835, 0.0048], err: 7 },
  fire_yellow_base: { hex: '#f7e693', linear: [2.5277, 1.7327, 0.0025], err: 6 },
  fire_orange_edge: { hex: '#f5960e', linear: [0.7737, 0.2568, 0.0001], err: 14 },
  plume_glow_lower_tower_lit: { hex: '#ea9d6d', linear: [0.9423, 0.2697, 0.1031], err: 0 },
  plume_column_pink_white: { hex: '#f5e4e7', linear: [2.6974, 1.4648, 2.2291], err: 0 },
  plume_column_upper: { hex: '#f7e3e7', linear: [3.0048, 1.4191, 2.2857], err: 0 },
  booster_body_lit: { hex: '#9f9080', linear: [0.2655, 0.2233, 0.1772], err: 0 },
  booster_body_dark: { hex: '#434345', linear: [0.045, 0.0465, 0.0495], err: 0 },
  booster_low_pink: { hex: '#99877a', linear: [0.2377, 0.1916, 0.1599], err: 0 },
  ship_black: { hex: '#1d1b1a', linear: [0.0127, 0.0118, 0.0103], err: 0 },
  tower_red: { hex: '#7b5958', linear: [0.1333, 0.0765, 0.0785], err: 0 },
  tower_top: { hex: '#755e5c', linear: [0.1224, 0.0856, 0.0867], err: 0 },
  ocean_far: { hex: '#45626d', linear: [0.052, 0.089, 0.1085], err: 0 },
  ocean_left: { hex: '#547884', linear: [0.0718, 0.1339, 0.1643], err: 0 },
  ocean_right: { hex: '#66797d', linear: [0.0989, 0.1407, 0.1536], err: 0 },
  pool_orange_refl: { hex: '#966438', linear: [0.1941, 0.1011, 0.0413], err: 0 },
  pool_sky_refl_bottom_right: { hex: '#717b84', linear: [0.1219, 0.1464, 0.1734], err: 0 },
  pool_left_dark: { hex: '#32251d', linear: [0.028, 0.019, 0.0136], err: 0 },
  marsh_olive_dark: { hex: '#483b24', linear: [0.0481, 0.0397, 0.0205], err: 0 },
  tidal_flat_brown: { hex: '#34251e', linear: [0.0291, 0.019, 0.0139], err: 0 },
  tidal_flat_mid: { hex: '#422e24', linear: [0.0416, 0.0267, 0.0193], err: 0 },
  pad_concrete_warm: { hex: '#55403e', linear: [0.0646, 0.0429, 0.0423], err: 0 },
  asphalt_left: { hex: '#15191a', linear: [0.0078, 0.0101, 0.01], err: 0 },
  sandbank_dark: { hex: '#2d2b2a', linear: [0.0244, 0.0236, 0.0226], err: 0 },
};
