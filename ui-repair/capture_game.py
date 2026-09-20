import ctypes,time,sys
from ctypes import wintypes
from pathlib import Path
from PIL import ImageGrab
u=ctypes.windll.user32;u.SetProcessDPIAware()
h=u.FindWindowW(None,'MU Online')
if not h: raise SystemExit('Game window not found')
u.ShowWindow(h,9);u.SetWindowPos(h,-1,0,0,0,0,0x43);u.SetForegroundWindow(h)
r=wintypes.RECT();u.GetClientRect(h,ctypes.byref(r));p=wintypes.POINT();u.ClientToScreen(h,ctypes.byref(p))
if len(sys.argv)>2:
 action=sys.argv[2]
 if action=='move':
  u.SetCursorPos(p.x+int(sys.argv[3]),p.y+int(sys.argv[4]))
 elif action=='click':
  u.SetCursorPos(p.x+int(sys.argv[3]),p.y+int(sys.argv[4]));time.sleep(.2);u.mouse_event(2,0,0,0,0);time.sleep(.15);u.mouse_event(4,0,0,0,0)
 elif action=='key':
  key=int(sys.argv[3],0);u.keybd_event(key,0,0,0);time.sleep(.15);u.keybd_event(key,0,2,0)
time.sleep(1)
path=Path(__file__).parent/sys.argv[1]
ImageGrab.grab(bbox=(p.x,p.y,p.x+r.right,p.y+r.bottom)).save(path)
u.SetWindowPos(h,-2,0,0,0,0,0x13)
print(str(path.resolve()),'size',r.right,r.bottom)
