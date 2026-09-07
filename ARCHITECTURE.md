# Architecture and engine contracts

## Separation of concerns

```text
DOM controls / gestures
        │
        ▼
Serializable workbook model + undo history
        │  chartQuery(sheet, source, selection)
        ▼
Explicit relational query specification
        │  RPC { id, method, args }
        ▼
Dedicated Worker: typed columns → filters → aggregation/projection
        │                     → having → stable sort → limit
        ▼
Query result + plan + measured diagnostics
        │  chartModel(...)
        ▼
Visual records → chart layout → primitive instances + hit-test grid
        │
        ├── WebGPU canvas: one instanced draw per chart
        ├── Canvas2D fallback: same geometry
        └── Axes/text canvas, tooltips, selection, vector SVG
```

The workbook is the semantic authority for sources, expressions, grouping definitions, shelves, filters, chart options, dashboard layout, and active context. It never stores pixel geometry. Query results and chart geometry are derived and disposable. Source identities and worksheet identities are stable strings and are persisted.

The worker owns all source tables and aggregation caches. UI interactions send a small query or transformation command. Requests have monotonically increasing IDs and a 120-second client deadline; replies carry either a value or a structured error. A UI query epoch prevents a response from an older render from replacing the latest workspace. It does **not** cancel CPU work already executing in the worker: requests are serialized on that worker's event loop.

## Columns and ingestion

Each column owns a typed array and a byte-per-row validity array. Number/date values use Float64Array; dates are UTC epoch milliseconds. Booleans use Uint8Array. Strings use Uint32Array dictionary codes, a string dictionary, and a Map from string to code. Capacity grows geometrically. Null is not encoded as a magic numerical or dictionary value.

Type inference examines the complete incoming field. Empty strings, null, and missing cells become null. Numeric identifiers with leading zeroes are kept as strings. ISO-formatted dates are inferred as dates; export emits ISO values. JSON accepts a record array or an object with a `rows`/`data` array. Nested cell values are serialized as JSON strings rather than recursively expanded into columns. CSV delimiter detection ignores separators in quoted headers, and the scanner supports escaped quotes and embedded newlines. Import currently materializes temporary record objects before packing columns; it is not streaming ingestion.

Append first validates base fields into temporary typed columns. Unknown fields are rejected instead of silently changing the schema. Existing source records are append-only during query-cache reuse. Derived columns are computed for the appended suffix in declaration order. An edit to a derived-field definition rebuilds the derived-column set and increments the source definition epoch. Failed definition compilation restores the previous columns and definitions.

The reported `columnBytes` sums typed-array allocations and estimated UTF-16 string dictionary content. It excludes Map/object overhead, source-import temporaries, cached results, chart records, hit-test entries, GPU allocations, and history. It is **not total JavaScript heap size**.

## Typed expression engine

`expression.js` implements a lexer, Pratt parser, type checker, stack bytecode compiler, and interpreter. Field lookups are explicit dependencies, not dynamic JavaScript property expressions. Nested syntax is bounded to 128 levels and input to 16,000 characters. Unsupported fields, function names, argument counts, operand types, and trailing tokens are errors with character positions. There is no `eval`, dynamic Function constructor, arbitrary property access, network primitive, or user-authored JavaScript execution.

Supported static types are number, string, boolean, and date, with nullable values. Arithmetic and comparisons propagate null; Boolean AND/OR have three-valued semantics. Division/remainder by zero and nonfinite final numeric results yield null. IF and IIF compile to branches and evaluate only the selected result. String concatenation uses CONCAT, not overloaded numeric addition. Date helpers operate in UTC. Unsupported date-part names yield null. Unary numeric signs bind more tightly than exponentiation in this dialect.

Function registry:

```text
ABS FLOOR CEIL SQRT LOG POWER ROUND MIN MAX
UPPER LOWER TRIM LEN CONTAINS STARTSWITH ENDSWITH CONCAT LEFT RIGHT REPLACE
STR FLOAT YEAR QUARTER MONTH DAY DATE DATETRUNC DATEDIFF
ISNULL IFNULL COALESCE IIF
```

Expressions are row-level. Aggregation belongs in the explicit query. This avoids ambiguous mixed aggregate/nonaggregate expression semantics. Calculated columns may depend on earlier calculated/grouped columns; forward references and cycles cannot be resolved and are rejected as unknown fields when the ordered definition set is compiled. The current VM fetches fields by name and allocates a stack per evaluation, rather than using generated vectorized kernels.

## Query API and plan

The core can be used without the UI:

```js
import { AnalyticsEngine } from './src/core.js';

const engine = new AnalyticsEngine();
engine.add('orders', 'Orders', [
  { Region: 'West', Sales: 100, Profit: 10 },
  { Region: 'East', Sales: 200, Profit: 40 },
  { Region: 'West', Sales: 50, Profit: -5 },
]);
engine.table('orders').setDefinitions([
  { kind: 'calculation', name: 'Margin', expression: '[Profit] / [Sales]' },
]);

const spec = {
  tableId: 'orders',
  dimensions: ['Region'],
  measures: [
    { field: 'Sales', op: 'sum', as: 'sales' },
    { field: 'Profit', op: 'sum', as: 'profit' },
    { field: '*', op: 'count', as: 'orders' },
  ],
  filters: [{ field: 'Sales', op: 'gt', value: 0 }],
  sort: [{ field: 'sales', direction: 'desc' }],
  limit: 1000,
};

const first = engine.query(spec);
// East: sales=200, profit=40, orders=1
// West: sales=150, profit=5, orders=2
console.table(first.rows);
console.log(first.plan, first.stats);

engine.table('orders').append([{ Region: 'West', Sales: 100, Profit: 20 }]);
const second = engine.query(spec);
// West: sales=250, profit=25, orders=3; one newly scanned source row.
console.log(second.stats.mode, second.stats.scannedRows); // incremental, 1
```

The inspectable plan contains Scan, optional ComputedColumns and Filter, either HashAggregate or Project, optional Having, StableSort, and Limit. ComputedColumns is descriptive: those columns have already been materialized, rather than recalculated by every query. The plan is an explicit logical sequence implemented directly by the executor, not a cost-based optimizer with interchangeable physical operator objects. The same specification drives the plan and execution; diagnostics are not random or simulated.

Filter operators are in, notin, between, eq, neq, contains, gt, lt, notnull, and isnull, plus nested and/or groups. UI numeric/date filters apply before aggregation. The core also supports postaggregate `having` predicates; a separate having editor is not exposed. Equality with null in the filter API is an explicit JavaScript-value comparison, unlike SQL `= NULL`; the expression VM retains null comparison propagation. Stable sorting supports multiple keys, puts nulls last, and uses numeric comparison or locale numeric string comparison. Sort keys should refer to result fields. Raw projection preserves one record per source row and adds `__rowId`.

### Aggregation and incremental invariant

The hash key is a JSON-encoded tuple of typed dimension values. Each group has one accumulator per measure. SUM uses compensated summation; AVG retains sum/count, never averages previously averaged values. STDEV uses Welford's update and sample variance (n−1). MIN/MAX and COUNT use scalar state; COUNTD retains an exact Set, so high-cardinality distinct counts can consume significant memory. Null measure values are ignored. Empty SUM/AVG/MIN/MAX/STDEV yields null and COUNT yields zero. COUNT(*) counts rows.

The reusable state key includes source identity, definition epoch, dimensions, measure descriptors, predicates, and raw/grouped mode. The state records `processed`, the exclusive source index already incorporated. If definitions and query semantics are unchanged, append processes only `[processed, table.length)`. A repeated query without appended rows scans zero source rows. Sorting, having, and limit are applied after reusable state is materialized, so they do not invalidate aggregation. This is append-incremental aggregation, **not** arbitrary row-update/deletion maintenance or cross-predicate aggregate reuse.

LRU eviction is bounded to 32 entries and an approximate 64 MiB retained-state budget. The estimate includes raw record slots, group state, and distinct sets, not exact engine heap measurements. Oversized results are returned but not retained in the cache. A later identical query may therefore rescan a source after eviction. Finalization, sorting, message cloning, visual model creation, and drawing can still cost time even on a zero-scan cache hit.

### Joins

The worker builds a hash index over right-side composite keys, then probes it with left-side tuples. Both sides must have identical key types. Null-containing keys do not match. Duplicate keys generate all matching pairs. Inner, left outer, and full outer joins preserve the expected unmatched rows. Colliding right field names are qualified with the right source name. A result-size guard stops cardinality explosions at the source row limit.

Output is materialized as a new source. The source does not retain a live relational dependency on the two inputs. Re-execute the join to see subsequent input appends or derived-field changes. Join materialization currently creates row objects before packing the result into columns.

## Rendering and interaction

The layout engine produces rectangle, circle, and line-segment instances. Each GPU instance is 48 bytes: two vec2 coordinates, a vec4 color, and a vec4 of primitive parameters. Six generated vertices expand each instance into a quad. The shader transforms CSS-pixel coordinates with a viewport uniform. Circles use fragment distance coverage with derivative antialiasing; alpha is premultiplied. A shared asynchronous pipeline and device serve all charts. Each chart has its own context, uniform, and capacity-grown vertex buffer. Draws are invalidation-driven, not a perpetual animation loop.

The GPU path accelerates dense marks only. Chart layout, data transformations, filtering, aggregation, text formatting, axes, and labels are CPU/Canvas/DOM work. There is no claim of a GPU query engine or GPU-resident text system. The Canvas2D path consumes the same primitives and is indicated in the status bar rather than silently presented as WebGPU. Device loss replaces the GPU canvas and falls back. SVG export serializes actual vector primitives and axes, not a bitmap screenshot.

Hover and mark selection use a 32-pixel uniform spatial grid built with chart geometry. Scatter brushing generates source-field range predicates. Linked selection stores typed dimension tuples rather than display strings; multiple marks produce OR-of-AND predicates. Selections apply to other worksheets with the same source, not their origin. The original chart can therefore remain a selection control while target charts recompute. Dashboard tile move/resize snaps to the 12-column model, resolves overlaps by moving obstructing tiles downward, and records a single history operation per gesture.

Result rows cross the worker boundary by structured cloning. Geometry is then built on the UI thread. The current implementation does not use transferable column batches or zero-copy shared result buffers. The dense-data test exercises this actual pipeline, including its costs. It is not an abstract shader microbenchmark.

## Workbook persistence and history

A portable file has `{ format: 'lattice-workbook', version: 1, ...metadata, datasets }`. Dataset entries contain id, name, base schema, base records, and ordered derived definitions. The derived columns and all chart geometry are rebuilt on load. Restore builds a staging engine and commits only after every source/definition succeeds. `.lattice` files are readable JSON, not encrypted files.

Local persistence separates metadata and source snapshots in IndexedDB. Shelf/layout changes save metadata without repeatedly exporting all source records; imports, appends, and definition edits mark data dirty. Debouncing coalesces frequent edits. The UI reports storage errors and retains the portable file-export path. IndexedDB reload behavior has not been tested in this delivery environment.

History uses up to 60 deep-cloned metadata snapshots. Undo/redo reconciles derived definitions with worker columns. Append history additionally retains actual source records to restore data, not just the displayed row count. This is correct for the tested workflows but memory-expensive; it is not a compressed delta/WAL implementation. Session source tables are retained so undo of importing or joining can restore prior metadata and redo can reuse source identities. Full workbook reopening constructs a new staged source set and resets session history.

## Resource and deployment limits

Sources have 2,000,000-row and 512-field guards; uploaded data files have a 256 MiB UI guard. These are safety limits, not a benchmarked scalability promise. Final data import, joins, workbook export, history snapshots, and raw scatter metadata can require multiple representations simultaneously. Repeated changes can queue worker work; stale visual results are ignored rather than interrupted. CSV export may preserve formula-like strings that other spreadsheet applications execute; sanitization policy is a consumer decision.

The source server is intended for localhost development. Production hosting should define its own restrictive headers, including a CSP compatible with the selected distribution: the modular app uses a module worker, whereas the single-file app requires an embedded script and `blob:` worker permission. No security audit, cross-browser conformance run, accessibility certification, or sustained performance qualification has been performed. Validate hardware WebGPU and storage behavior on deployment targets.
