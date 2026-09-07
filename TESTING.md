# Executed verification

Verification date: **2026-09-06**. The reports and screenshots in `test-results/` were produced by executing the shipped code, not fabricated fixtures.

## Results

| Suite | Result | Execution scope |
| --- | --- | --- |
| Engine + visual model | **30 passed, 0 failed** | Node.js 22.16.0 built-in test runner |
| Browser workflows | **25 passed, 0 failed** | Chromium 144.0.7559.96, 1600 × 1000, real classic Blob worker, Canvas2D |
| Dense-data check | **100,000 input rows → 100,000 scatter marks**, no uncaught page errors | Same embedded build, real worker/query/model/layout/rendering pipeline |
| WebGPU | **Not runtime-verified** | Source and WGSL pipeline are implemented; no compatible secure browser context was available for the executed tests |
| IndexedDB reload | **Not runtime-verified** | Available preview used an opaque origin, so storage was blocked; portable file export/import was tested instead |

The managed browser's policy prevented navigating to the localhost development server. The browser suites therefore loaded the generated HTML into an `about:blank` preview. They did not bypass that policy. The preview supports real classic Blob workers and Canvas2D but does not provide the secure context/storage used to test WebGPU and IndexedDB. This distinction is recorded in `browser-report.json`.

## Reproduce engine tests

```sh
npm test
```

The 21 engine tests exercise CSV parsing and delimiter handling; JSON ingestion; dictionary and typed column encodings; dates/nulls/booleans; SUM/AVG/COUNT; append-incremental queries; compound filters; typed expressions and invalid syntax; calculated-column materialization/undo; grouped fields; left/full/composite joins; invalid append atomicity; raw projections, sorting, count-distinct and sample standard deviation; empty aggregation; portable source reconstruction; reproducible sample calculations; and LRU/budget eviction.

The 9 model tests execute all four initial worksheet queries, check individual-row scatter, two-axis heatmap, continuous numeric color, actual multiple-measure series, same-source linked filter semantics, empty shelves, isolated undo snapshots, and invalid dashboard geometry rejection.

## Reproduce browser workflows

Browser tests are optional development tools. They require Python with Playwright and an installed Chromium; neither is a dependency of the application. Set `--browser` to the relevant executable on your machine.

```sh
npm run build
python tests/browser_smoke.py --offline --browser /usr/bin/chromium
python tests/browser_stress.py
```

Normal URL navigation is also supported:

```sh
# Terminal 1
npm start
# Terminal 2, with an otherwise fresh browser profile
python tests/browser_smoke.py --url http://127.0.0.1:4173/ --browser /path/to/chromium
```

The normal-origin command was **not executed** for this delivery. The smoke runner explicitly does not assert IndexedDB reload persistence, even in normal-origin mode. Add a reload/reopen test on target deployments before treating that capability as validated. Its optional WebGPU launch arguments may select a software GPU implementation: a `WebGPU` renderer badge in that run is not proof of hardware performance.

The 25 browser checks include initial real queries, individual scatter rows, mark hit testing, linked filtering, HTML5 field drags, AVG selection, multiple-measure plotting, categorical filters, undo and redo, typed calculated fields and their undo/redo, grouping, exact 1,000-row delta scanning after append, restoring original source records on undo, CSV file-input import, an actual joined data source, joined preview fields, portable workbook export/reimport with data and definitions, snapped dashboard resize, SVG primitive output, source CSV export, and absence of uncaught page/console errors.

For export assertions the test intercepts generated Blob contents at the final anchor-click boundary. It exercises file serialization and subsequent file-input reimport, without depending on browser download prompts or assuming the OS saved a file. The exported SVG is inspected for vector chart primitives and text, not a mocked download-success toast.

## Dense-data observation

The delivered run generated 100,000 synthetic transactions and produced 100,000 raw scatter marks without truncation. The report records a **37.3 ms worker query time**, and **0.917 seconds from the generate command through the ready visual model** in this particular container run. Those clocks have different scopes:

- Worker query time excludes data generation/ingestion, worker messaging, UI model generation, chart layout, and graphics submission.
- The end-to-model clock includes generation/ingestion, query, message delivery, and visual model availability. It is not a frame-present timestamp.
- The screenshot was captured after additional settling/notification-expiry time. There is no measured FPS, interaction latency percentile, energy budget, or hardware WebGPU benchmark.

`columnBytes` was 10,913,956 bytes for the generated source. This excludes JavaScript object/Map overhead, caches, copied messages, chart records, transient imports, history, and graphics resources. Do not interpret that number as peak process memory.

## Remaining verification work before production use

Exercise the WebGPU pipeline on real target hardware, resize and device-loss paths, GPU error scopes, and large-workbook memory pressure. Test IndexedDB autosave across reloads and browser restarts, quota failure, concurrent tabs, and corrupted persisted content. Expand input fuzzing, long-running stress, accessibility/keyboard coverage, cross-browser conformance, and security review. The supplied passing tests do not imply Tableau compatibility or an enterprise production certification.
