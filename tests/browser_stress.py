"""Reproduce the opaque-origin 100,000-row Canvas2D + worker stress check.
Run: python tests/browser_stress.py
Requires Playwright for Python and Chromium at /usr/bin/chromium.
This does not benchmark hardware WebGPU or measure FPS.
"""
import json,time
from pathlib import Path
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
(root/'test-results').mkdir(exist_ok=True)
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
 page=b.new_page(viewport={'width':1600,'height':1000});errors=[]
 page.on('pageerror',lambda e:errors.append(str(e)))
 page.set_content((root/'dist/lattice.html').read_text())
 page.wait_for_function('window.latticeDebug && latticeDebug.results.size===4')
 page.locator('[data-menu="data"]').click();start=time.perf_counter()
 page.locator('.context-menu button',has_text='Generate 100,000-row sample').click()
 page.wait_for_function('latticeDebug.results.get(latticeDebug.workbook.active.id)?.model.records.length===100000',timeout=60000)
 query_ready=time.perf_counter()-start
 page.wait_for_timeout(1200)
 stats=page.evaluate('latticeDebug.results.get(latticeDebug.workbook.active.id).result.stats')
 page.wait_for_timeout(4600)  # Let genuine notification toasts expire before the screenshot.
 page.screenshot(path=str(root/'test-results/scatter-100k.png'),full_page=True)
 report={'rows':100000,'marks':page.evaluate('latticeDebug.results.get(latticeDebug.workbook.active.id).model.records.length'),'queryStats':stats,'generationThroughModelSeconds':round(query_ready,3),'mode':page.evaluate('latticeDebug.renderer'),'hardwareWebGPUVerified':False,'pageErrors':errors}
 print(json.dumps(report,indent=2));(root/'test-results/stress-report.json').write_text(json.dumps(report,indent=2))
 b.close()
