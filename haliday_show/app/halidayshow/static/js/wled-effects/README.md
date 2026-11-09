# WLED's effects, for previews

This folder holds effects from [WLED](https://github.com/wled/WLED) 0.15.5, translated to JavaScript so
HA-liday Show's editor can preview a WLED's own effects as the WLED draws them. It also has the parts of
WLED and of the [FastLED](https://github.com/FastLED/FastLED) library (MIT) those effects use, and
WLED's palettes (most from [cpt-city](http://soliton.vm.bytemark.co.uk/pub/cpt-city/)).

**Licence:** everything in this folder is under the European Union Public Licence 1.2 (EUPL-1.2), WLED's
licence; see `LICENSE`. Copyright (c) 2016-present Christian Schwinne and individual WLED contributors,
and the authors credited in WLED's source. The rest of HA-liday Show is under the MIT licence; it only
calls into this folder (`index.js`).

- `engine.js`: WLED's segment, colour and maths helpers, and FastLED's.
- `palettes.js`: WLED's gradient palettes, generated from `wled00/palettes.h`.
- `effects.js`: the effects ported so far, keyed by WLED's effect id.
- `index.js`: runs an effect frame by frame up to the moment the editor asks for.
