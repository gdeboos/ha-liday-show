// Each WLED effect's own defaults for its extra sliders (c1-c3) and options (o1-o3), from the effect
// strings in WLED 0.15.5 wled00/FX.cpp. HA-liday Show asks the WLED to load these when it switches effect
// (fxdef), so the preview uses them too; anything not listed is WLED's segment default (128, 128, 16, off).
//
// SPDX-License-Identifier: EUPL-1.2
// Copyright (c) 2016-present Christian Schwinne and individual WLED contributors
export const EXTRAS = {
  40: { c1: 0 },
  60: { c1: 0 },
  65: { c1: 0, o1: 1, o2: 0, o3: 1 },
  66: { c2: 128 },
  121: { c1: 8 },
  122: { c1: 0 },
  139: { c1: 255, c2: 64 },
  140: { c2: 0 },
  144: { c2: 0 },
  148: { c2: 0 },
  167: { c3: 16 },
  168: { c1: 128, c2: 128, c3: 16 },
  176: { c3: 15 },
};
