import pathlib
from playwright.sync_api import sync_playwright
SRC = pathlib.Path(__file__).parent.resolve(); OUT = SRC.parent
pages = ['01-login','02-register-step1','03-register-step2','04-check-email']
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--font-render-hinting=none'])
    ctx = b.new_context(viewport={'width':390,'height':844}, device_scale_factor=2)
    pg = ctx.new_page()
    for n in pages:
        pg.goto((SRC/f'{n}.html').as_uri()); pg.wait_for_load_state('networkidle'); pg.evaluate('document.fonts.ready')
        # overflow check
        info = pg.evaluate('''() => { const c=document.querySelector('.content'); const kids=[...c.children];
          const last=kids[kids.length-1].getBoundingClientRect(); return {scrollH:c.scrollHeight, clientH:c.clientHeight, lastBottom:last.bottom,
          fonts:[...new Set([...document.querySelectorAll('h1,.input,.btn')].map(e=>getComputedStyle(e).fontFamily.split(',')[0]))]} }''')
        print(n, info)
        pg.screenshot(path=str(OUT/f'{n}.png'))
    ctx2 = b.new_context(viewport={'width':1920,'height':1000}, device_scale_factor=1)
    p2 = ctx2.new_page(); p2.goto((SRC/'overview.html').as_uri()); p2.wait_for_load_state('networkidle')
    p2.screenshot(path=str(OUT/'overview.png'), full_page=True)
    b.close()
print('done')
