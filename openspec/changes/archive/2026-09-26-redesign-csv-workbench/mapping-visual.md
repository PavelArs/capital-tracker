# CSV mapping visual review

Reviewed all 14 `csv-mapping-*.png` viewport segments in the requested Chromium artifact directory: light and dark themes at 360 px (3 segments each), 768 px (2 each), and 1440 px (2 each). This is a static visual review of the mapping step only.

Verdict: layout is orderly at all three widths and both themes. Source-column fields stack at 360 px, use two columns at 768 px and three at 1440 px; instrument/side mappings and number/time settings remain clearly separated. Labels and explanatory copy are readable, borders and control spacing remain distinct, the checkbox and primary “Проверить импорт” action are visible and comfortably targetable at the bottom of the mobile sequence, and the “Загрузить ещё…” button wraps cleanly without overlap. No clipped fieldset edges, collisions, or overlapping controls observed.

One usability limitation: at 360 px the selected instrument option is visibly ellipsized/truncated in the closed native select, so the UUID is not readable there. The UI does explain that names do not replace UUIDs, but users cannot visually verify the selected UUID until opening the native option list. The timestamp mode select is also horizontally truncated at mobile widths, though its label and nearby explanation remain legible and opening the select should reveal choices. Explanatory text is necessarily tall on mobile but does not collide with adjacent controls.

No implementation or runtime claims are made from these screenshots. Parent-reported CSV journey pass information was not independently verified in this visual-only task.
