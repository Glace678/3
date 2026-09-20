import ctypes,time,sys,runpy
u=ctypes.windll.user32;k=ctypes.windll.kernel32;u.SetProcessDPIAware()
u.FindWindowW.argtypes=[ctypes.c_wchar_p,ctypes.c_wchar_p];u.FindWindowW.restype=ctypes.c_void_p
h=u.FindWindowW(None,'MU Online');fg=u.GetForegroundWindow();ft=u.GetWindowThreadProcessId(fg,None);gt=u.GetWindowThreadProcessId(h,None);ct=k.GetCurrentThreadId()
u.ShowWindow(h,9);u.AttachThreadInput(ct,ft,True);u.AttachThreadInput(ct,gt,True);u.SetWindowPos(h,-1,0,0,0,0,0x43);u.SetForegroundWindow(h);u.SetFocus(h)
def key(v):
 if u.GetForegroundWindow()!=h:raise RuntimeError('Focus changed; stopped UI input')
 u.keybd_event(v,0,0,0);time.sleep(.08);u.keybd_event(v,0,2,0);time.sleep(.4)
def shot(name):
 sys.argv=['print_game.py','ui-repair/'+name];runpy.run_path('ui-repair/print_game.py',run_name='__main__')
try:
 key(ord('C'));shot('attributes.png');key(ord('C'))
 key(ord('I'));shot('inventory.png');key(ord('I'))
 key(0x1b);shot('menu.png')
finally:
 u.SetWindowPos(h,-2,0,0,0,0,0x13);u.AttachThreadInput(ct,gt,False);u.AttachThreadInput(ct,ft,False)
