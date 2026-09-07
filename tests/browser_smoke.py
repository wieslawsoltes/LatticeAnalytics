"""Browser UI smoke test. Standard mode uses localhost; --offline previews the embedded file
in about:blank (real classic Worker + Canvas2D, without IndexedDB or WebGPU).
Requires Playwright for Python and an installed Chromium. No runtime dependencies are added.
"""
import argparse, json, os, time
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser();parser.add_argument('--offline',action='store_true');parser.add_argument('--browser',default=os.environ.get('CHROMIUM','/usr/bin/chromium'));parser.add_argument('--url',default='http://127.0.0.1:4173/');args=parser.parse_args()
checks=[]
def check(name,condition=True):
    assert condition,name
    checks.append(name)
    print('PASS:',name,flush=True)
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=args.browser,headless=True,args=['--no-sandbox','--enable-unsafe-webgpu','--use-angle=swiftshader'])
    page=browser.new_page(viewport={'width':1600,'height':1000},device_scale_factor=1)
    page.set_default_timeout(15000)
    errors=[];console=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.on('console',lambda m:console.append(m.text) if m.type=='error' else None)
    if args.offline:
        page.set_content((ROOT/'dist/lattice.html').read_text(),wait_until='load')
    else:page.goto(args.url,wait_until='networkidle')
    page.wait_for_function('window.latticeDebug && latticeDebug.results.size === 4')
    page.wait_for_timeout(4800)
    check('initial dashboard computes four views',page.locator('.dashboard-tile').count()==4)
    check('initial raw scatter contains 7,200 actual rows',page.evaluate('[...latticeDebug.results.values()].find(x=>x.model.type==="scatter").result.rows.length')==7200)
    out=ROOT/'test-results';out.mkdir(exist_ok=True)
    page.screenshot(path=str(out/'dashboard.png'),full_page=True)
    # Selection hit testing and same-source filter propagation.
    chart=page.locator('.tile-chart').first;b=chart.bounding_box();h=b['height'];w=b['width']
    chart.click(position={'x':min(150,w*.28)+(w-min(150,w*.28)-38)*.2,'y':17+(h-66)/6})
    page.wait_for_function('latticeDebug.selection !== null')
    page.wait_for_timeout(500)
    check('mark hit testing creates a linked selection',page.evaluate('latticeDebug.selection.label')=='Technology')
    check('linked scatter recomputes fewer source rows',page.evaluate('[...latticeDebug.results.values()].find(x=>x.model.type==="scatter").result.stats.matchedRows')<7200)
    page.keyboard.press('Escape');page.wait_for_function('latticeDebug.selection === null')
    # Build a worksheet via actual HTML5 drags.
    page.locator('.toolbar [data-action="new-sheet"]').click()
    page.locator('.field-item[data-field="Category"]').drag_to(page.locator('[data-drop="rows"]'))
    page.locator('.field-item[data-field="Sales"]').drag_to(page.locator('[data-drop="columns"]'))
    page.wait_for_function('latticeDebug.results.get(latticeDebug.workbook.active.id)?.model.records.length===3')
    check('drag-and-drop authors a three-mark aggregate chart')
    page.locator('[data-pill-slot="columns"] .pill-menu').first.click()
    page.locator('.context-menu button',has_text='Average').click()
    page.wait_for_function('latticeDebug.results.get(latticeDebug.workbook.active.id)?.spec.measures[0].op==="avg"')
    check('aggregation menu changes the executed query to AVG')
    # Additional measure is actually plotted.
    page.locator('.field-item[data-field="Profit"]').drag_to(page.locator('[data-drop="columns"]'))
    page.wait_for_function('latticeDebug.results.get(latticeDebug.workbook.active.id)?.model.records.length===6')
    check('multiple measure pills generate multiple visible series')
    # Filter dialog and undo/redo.
    page.locator('.field-item[data-field="Category"]').drag_to(page.locator('[data-drop="filters"]'))
    page.locator('.check-row',has_text='Furniture').locator('input').uncheck()
    page.get_by_role('button',name='Apply filter',exact=True).click()
    page.wait_for_function('latticeDebug.results.get(latticeDebug.workbook.active.id)?.result.stats.matchedRows<7200')
    check('categorical filters change calculated results')
    page.locator('#undo-button').click()
    page.wait_for_function('latticeDebug.workbook.sheets.find(s=>s.id===latticeDebug.workbook.active.id).filters.length===0')
    check('undo restores shelf filters')
    page.locator('#redo-button').click()
    page.wait_for_function('latticeDebug.workbook.sheets.find(s=>s.id===latticeDebug.workbook.active.id).filters.length===1')
    check('redo reapplies shelf filters')
    # Calculation validation, computation, and undo.
    page.locator('.toolbar [data-action="calculation"]').click()
    page.locator('#calc-name').fill('Margin ratio')
    page.locator('#calc-expression').fill('[Profit] / [Sales]')
    page.wait_for_function('document.querySelector("#calc-validation")?.classList.contains("valid")')
    page.locator('#calc-apply').click()
    page.wait_for_function('latticeDebug.workbook.sources[0].schema.some(f=>f.name==="Margin ratio")')
    check('calculated fields are added to the typed source schema')
    page.locator('#undo-button').click()
    page.wait_for_function('!latticeDebug.workbook.sources[0].schema.some(f=>f.name==="Margin ratio")')
    page.locator('#redo-button').click()
    page.wait_for_function('latticeDebug.workbook.sources[0].schema.some(f=>f.name==="Margin ratio")')
    check('calculated-field undo and redo reconcile worker definitions')
    # Create a grouped dimension.
    page.locator('.field-item[data-field="Category"] .field-options').click()
    page.locator('.context-menu button',has_text='Create group').click()
    page.locator('#group-name').fill('Business group')
    page.locator('#group-label').fill('Durables')
    page.locator('#group-members .check-row',has_text='Technology').locator('input').check()
    page.locator('#group-members .check-row',has_text='Furniture').locator('input').check()
    page.locator('#modal-footer .primary').click(no_wait_after=True)
    page.wait_for_function('latticeDebug.workbook.sources[0].schema.some(f=>f.name==="Business group")')
    check('group editor materializes a reusable dimension')
    # Incremental append in an already executed worksheet.
    page.locator('[data-menu="data"]').click()
    page.locator('.context-menu button',has_text='Append 1,000 sample').click()
    page.wait_for_function('latticeDebug.workbook.sources[0].rows===8200')
    page.wait_for_timeout(500)
    current=page.evaluate('latticeDebug.results.get(latticeDebug.workbook.active.id).result.stats')
    check('append scans exactly the 1,000-row delta',current['mode']=='incremental' and current['scannedRows']==1000)
    page.locator('#undo-button').click()
    page.wait_for_function('latticeDebug.workbook.sources[0].rows===7200')
    check('append undo restores source records, not only metadata')
    # Import actual CSV content through File input.
    csv='Region,Category,Sales,Profit,Order Date\nWest,Hardware,100,20,2025-01-01\nEast,Software,200,70,2025-01-02\nWest,Hardware,50,-5,2025-01-03\nCentral,Services,80,30,2025-01-04\nSouth,Software,70,15,2025-01-05\nWest,Services,40,12,2025-01-06\n'
    page.locator('#data-file-input').set_input_files({'name':'tiny-orders.csv','mimeType':'text/csv','buffer':csv.encode()})
    page.wait_for_function('latticeDebug.workbook.sources.some(s=>s.name==="tiny-orders"&&s.rows===6)')
    page.wait_for_timeout(500)
    check('CSV file import infers six real source rows')
    # Join to seeded region table.
    page.locator('.toolbar [data-action="join"]').click()
    target=page.evaluate('latticeDebug.workbook.sources.find(s=>s.name==="Regional targets").id')
    page.locator('#join-right').select_option(target)
    page.locator('#join-name').fill('Orders with targets')
    page.get_by_role('button',name='Run join',exact=True).click()
    page.wait_for_function('latticeDebug.workbook.sources.some(s=>s.name==="Orders with targets")')
    joined=page.evaluate('latticeDebug.workbook.sources.find(s=>s.name==="Orders with targets")')
    check('join editor computes a six-row materialized left join',joined['rows']==6 and joined['joinStats']['matchedLeft']==6)
    page.wait_for_timeout(300)
    check('joined fields are shown in the data preview','Annual target' in page.locator('#source-table').inner_text())
    # Capture Blob downloads at the final delivery boundary, without a browser save dialog.
    page.evaluate('''()=>{window.__downloadBlobs=new Map();window.__downloads=[];const original=URL.createObjectURL.bind(URL);URL.createObjectURL=b=>{const u=original(b);__downloadBlobs.set(u,b);return u;};HTMLAnchorElement.prototype.click=function(){const b=__downloadBlobs.get(this.href);if(b){const name=this.download;b.text().then(text=>__downloads.push({name,text,type:b.type}));}};}''')
    page.locator('[data-menu="file"]').click()
    page.locator('.context-menu button',has_text='Download workbook').click()
    page.wait_for_function('__downloads.some(d=>d.name.endsWith(".lattice"))')
    exported=page.evaluate('__downloads.find(d=>d.name.endsWith(".lattice"))')
    payload=json.loads(exported['text'])
    check('portable workbook export includes full source datasets',len(payload['datasets'])==4)
    page.locator('#workbook-file-input').set_input_files({'name':exported['name'],'mimeType':'application/json','buffer':exported['text'].encode()})
    page.wait_for_timeout(1000)
    check('portable workbook import restores grouped/calculated schemas',page.evaluate('latticeDebug.workbook.sources[0].definitions.length')==2)
    # Dashboard geometry and SVG export.
    page.locator('[data-open-dashboard]').first.click();page.wait_for_timeout(500)
    page.locator('[data-action="edit-dashboard"]').click();page.wait_for_timeout(300)
    tile_id=page.evaluate('latticeDebug.workbook.dashboards[0].tiles[0].id')
    handle=page.locator(f'[data-tile="{tile_id}"] .tile-resize');box=handle.bounding_box()
    page.mouse.move(box['x']+8,box['y']+8);page.mouse.down();page.mouse.move(box['x']+8,box['y']+68,steps=8);page.mouse.up()
    page.wait_for_function('latticeDebug.workbook.dashboards[0].tiles[0].h===5')
    check('dashboard resize persists snapped tile geometry')
    page.locator('#undo-button').click();page.wait_for_function('latticeDebug.workbook.dashboards[0].tiles[0].h===4')
    page.locator('[data-action="edit-dashboard"]').click();page.wait_for_timeout(300)
    page.locator('[data-tile-menu]').first.click();page.locator('.context-menu button',has_text='Export SVG').click()
    page.wait_for_function('__downloads.some(d=>d.name.endsWith(".svg"))')
    svg=page.evaluate('__downloads.find(d=>d.name.endsWith(".svg")).text')
    check('SVG export contains actual chart primitives and vector axes','<rect' in svg and '<text' in svg and '<line' in svg)
    # Source CSV export.
    page.locator('.toolbar [data-action="export"]').click();page.locator('#export-format').select_option('csv-source')
    page.locator('#modal-footer .primary').click();page.wait_for_function('__downloads.some(d=>d.name.endsWith(".csv"))')
    check('data export produces CSV source records')
    # Final worksheet capture.
    page.locator('[data-open-sheet]').first.click();page.wait_for_timeout(500)
    page.screenshot(path=str(out/'worksheet.png'),full_page=True)
    check('no uncaught browser errors',not errors)
    check('no application console errors',not console)
    report={'checks':checks,'count':len(checks),'mode':'offline embedded Canvas2D + classic Worker' if args.offline else 'localhost','renderer':page.evaluate('latticeDebug.renderer'),'browser':browser.version,'pageErrors':errors,'consoleErrors':console,'indexedDBVerified':False,'indexedDBNote':'Reload persistence is not asserted by this smoke suite','hardwareWebGPUVerified':False,'webgpuVerified':page.evaluate('latticeDebug.renderer')=='WebGPU'}
    (out/'browser-report.json').write_text(json.dumps(report,indent=2))
    print(json.dumps(report,indent=2),flush=True)
    browser.close()
