import pathlib
OUT = pathlib.Path(__file__).parent
P = {
 'eye':'<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>',
 'fingerprint':'<path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4"/><path d="M14 13.12c0 2.38 0 6.38-1 8.88"/><path d="M17.29 21.02c.12-.6.43-2.3.5-3.02"/><path d="M2 12a10 10 0 0 1 18-6"/><path d="M2 16h.01"/><path d="M21.8 16c.2-2 .131-5.354 0-6"/><path d="M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2"/><path d="M8.65 22c.21-.66.45-1.32.57-2"/><path d="M9 6.8a6 6 0 0 1 9 5.2v2"/>',
 'mail':'<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
 'check':'<path d="M20 6 9 17l-5-5"/>',
 'arrow-left':'<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
 'arrow-right':'<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
 'lock':'<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
 'user':'<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
 'alert':'<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>',
 'gift':'<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13"/><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5"/>',
 'shield':'<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
 'rotate':'<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
 'pencil':'<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/>',
 'info':'<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
 'phone':'<rect width="14" height="20" x="5" y="2" rx="2" ry="2"/><path d="M12 18h.01"/>',
 'check-circle':'<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
}
def ic(name, cls='i', style=''):
    s = f' style="{style}"' if style else ''
    return f'<svg class="{cls}" viewBox="0 0 24 24"{s}>{P[name]}</svg>'

STATUS = '''<div class="status"><span>9:41</span><span class="sys">
<svg width="18" height="12" viewBox="0 0 18 12" fill="#f0e8dd"><rect x="0" y="8" width="3" height="4" rx="1"/><rect x="5" y="5.5" width="3" height="6.5" rx="1"/><rect x="10" y="3" width="3" height="9" rx="1"/><rect x="15" y="0" width="3" height="12" rx="1"/></svg>
<svg width="16" height="12" viewBox="0 0 16 12" fill="none" stroke="#f0e8dd" stroke-width="1.8" stroke-linecap="round"><path d="M1 4.2a10 10 0 0 1 14 0"/><path d="M3.6 7a6.2 6.2 0 0 1 8.8 0"/><circle cx="8" cy="10" r="1.2" fill="#f0e8dd" stroke="none"/></svg>
<svg width="27" height="13" viewBox="0 0 27 13"><rect x=".5" y=".5" width="23" height="12" rx="3.6" fill="none" stroke="#f0e8dd" stroke-opacity=".45"/><rect x="2.2" y="2.2" width="17" height="8.6" rx="2.2" fill="#f0e8dd"/><path d="M25 4.5v4c.8-.3 1.4-1.1 1.4-2s-.6-1.7-1.4-2z" fill="#f0e8dd" fill-opacity=".5"/></svg>
</span></div>'''

def page(title, body):
    return f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=390">
<title>{title}</title><link rel="stylesheet" href="styles.css"></head><body>
<div class="screen">{STATUS}<div class="content">{body}</div><div class="home-ind"></div></div></body></html>'''

def gap(px): return f'<div style="height:{px}px;flex:none"></div>'
FLEX = '<div style="flex:1;min-height:8px"></div>'

# ---------- 1. Login ----------
login = f'''
{gap(14)}
<div class="brand">
  <div class="logo-wrap"><img src="../logo-320.png" alt="MafitaPay"></div>
  <div class="wordmark">MAFITAPAY</div>
</div>
{gap(22)}
<h1 class="h-xl center">Welcome back</h1>
{gap(8)}
<p class="sub center">Sign in to send, receive and pay bills<br>from your secure wallet.</p>
{gap(22)}
<div class="seg"><div>{ic('mail')}Email code</div><div class="on">{ic('lock')}Password</div></div>
{gap(18)}
<div class="field">
  <div class="label">Email address</div>
  <div class="input">{ic('mail','i lead')}<span class="val">ada@example.com</span></div>
</div>
{gap(14)}
<div class="field">
  <div class="label">Password</div>
  <div class="input focus">{ic('lock','i lead')}<span class="val"><span class="dots">••••••••••</span><span class="caret"></span></span><span class="trail" style="color:var(--text2)">{ic('eye')}</span></div>
</div>
{gap(12)}
<div style="display:flex;justify-content:flex-end"><span class="link" style="font-size:14.5px">Forgot password?</span></div>
{gap(20)}
<div class="btn btn-gold">Sign in {ic('arrow-right')}</div>
{gap(14)}
<div class="divider">or</div>
{gap(14)}
<div class="btn btn-ghost">{ic('fingerprint','i',"width:22px;height:22px")}Unlock with fingerprint</div>
{FLEX}
<div class="footer">New to MafitaPay? <span class="link">Create account</span></div>
'''

# ---------- 2. Register step 1 ----------
def topnav(step, label, bars):
    return f'''
<div class="topnav"><div class="iconbtn">{ic('arrow-left')}</div>
<div class="mini-brand"><img src="../logo-320.png" alt=""><span>MAFITAPAY</span></div>
<div style="width:42px"></div></div>
<div class="stepper"><div class="row"><b>Step {step} of 2</b><span>{label}</span></div><div class="bars">{bars}</div></div>'''

reg1 = f'''
{topnav(1,'Your details','<i class="full"></i><i></i>')}
{gap(18)}
<div class="invite"><div class="ico">{ic('gift')}</div>
  <div class="t"><b>You were invited by a friend 🎉</b>
  <div class="inv-row"><span>Referral code applied</span><span class="chip"><small>REF</small>ADA2026</span></div></div></div>
{gap(20)}
<h1 class="h-lg">Open your wallet<br>in 2 minutes</h1>
{gap(8)}
<p class="sub">Just a few details to get you started.</p>
{gap(20)}
<div class="field">
  <div class="label">Full name</div>
  <div class="input">{ic('user','i lead')}<span class="val">Ada Okafor</span></div>
</div>
{gap(14)}
<div class="field">
  <div class="label">Email address</div>
  <div class="input err">{ic('mail','i lead','color:#f07a5c')}<span class="val">ada@example</span><span class="trail" style="color:var(--red2)">{ic('alert')}</span></div>
  <div class="msg err">That email doesn't look right</div>
</div>
{gap(14)}
<div class="field">
  <div class="label">Phone number</div>
  <div class="input focus"><span class="prefix"><span class="flag">🇳🇬</span>+234</span><span class="val">803 123 4567<span class="caret"></span></span></div>
</div>
{FLEX}
<div class="btn btn-gold">Continue {ic('arrow-right')}</div>
{gap(18)}
<div class="footer">Already have an account? <span class="link">Sign in</span></div>
'''

# ---------- 3. Register step 2 ----------
reg2 = f'''
{topnav(2,'Security','<i class="full"></i><i class="part" style="--w:85%"></i>')}
{gap(28)}
<h1 class="h-lg">Secure your account</h1>
{gap(8)}
<p class="sub">Choose a strong password to protect your wallet and money.</p>
{gap(24)}
<div class="field">
  <div class="label">Create password</div>
  <div class="input focus">{ic('lock','i lead')}<span class="val"><span class="dots">••••••••••••</span><span class="caret"></span></span><span class="trail" style="color:var(--text2)">{ic('eye')}</span></div>
</div>
{gap(12)}
<div class="strength">
  <div class="top"><span>Password strength</span><b>{ic('shield','i','width:16px;height:16px')}Strong</b></div>
  <div class="meter"><i></i><i></i><i></i><i></i></div>
  <div class="checks">
    <span><em>{ic('check')}</em>8+ characters</span>
    <span><em>{ic('check')}</em>A letter</span>
    <span><em>{ic('check')}</em>A number</span>
  </div>
</div>
{gap(22)}
<div class="field">
  <div class="label">Confirm password</div>
  <div class="input ok">{ic('lock','i lead')}<span class="val"><span class="dots">••••••••••••</span></span><span class="trail" style="color:var(--green2)">{ic('check-circle')}</span></div>
  <div class="msg ok">{ic('check')}Passwords match</div>
</div>
{gap(24)}
<div class="terms"><div class="cbox">{ic('check')}</div>
<div>I agree to MafitaPay's <span class="link u">Terms of Service</span> and <span class="link u">Privacy Policy</span>.</div></div>
{FLEX}
<div class="btn btn-gold">Create account</div>
{gap(18)}
<div class="footer">Already have an account? <span class="link">Sign in</span></div>
'''

# ---------- 4. Check email ----------
check = f'''
<div class="topnav"><div class="iconbtn">{ic('arrow-left')}</div>
<div class="mini-brand"><img src="../logo-320.png" alt=""><span>MAFITAPAY</span></div>
<div style="width:42px"></div></div>
{FLEX}
<div class="success-ring"><div class="r1"></div><div class="r2">{ic('check')}</div><div class="badge">{ic('mail')}</div></div>
{gap(34)}
<h1 class="h-xl center">Check your inbox</h1>
{gap(12)}
<p class="sub center">We sent a link to</p>
{gap(10)}
<div style="text-align:center"><span class="email-pill">{ic('mail','i')}ada@example.com</span></div>
{gap(14)}
<p class="sub center" style="font-size:14.5px;color:var(--muted);padding:0 8px">Tap the link in the email to verify your address and finish opening your wallet.</p>
{FLEX}
<div class="tip">{ic('info')}<span>Can't find it? Check your spam or promotions folder.</span></div>
{gap(16)}
<div class="btn btn-gold">{ic('mail')}Open email app</div>
{gap(12)}
<div class="btn btn-disabled">{ic('rotate','i','width:18px;height:18px')}Resend link <span class="count">(in 0:45)</span></div>
{gap(20)}
<div class="footer">Wrong email? <span class="link">Change it</span></div>
'''

for fn, title, body in [('01-login','Login',login),('02-register-step1','Register step 1',reg1),
                        ('03-register-step2','Register step 2',reg2),('04-check-email','Check email',check)]:
    (OUT/f'{fn}.html').write_text(page(f'MafitaPay – {title}', body), encoding='utf-8')
print('built')
