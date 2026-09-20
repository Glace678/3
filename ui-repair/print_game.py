import ctypes,sys
from ctypes import wintypes as W
from PIL import Image
u=ctypes.windll.user32;g=ctypes.windll.gdi32;u.SetProcessDPIAware()
u.FindWindowW.argtypes=[ctypes.c_wchar_p,ctypes.c_wchar_p];u.FindWindowW.restype=ctypes.c_void_p
h=u.FindWindowW(None,'MU Online');u.ShowWindow(h,9);r=W.RECT();u.GetClientRect(h,ctypes.byref(r));w,hgt=r.right,r.bottom
u.GetDC.restype=W.HDC;u.ReleaseDC.argtypes=[W.HWND,W.HDC];g.CreateCompatibleDC.restype=W.HDC;g.CreateCompatibleDC.argtypes=[W.HDC];g.CreateCompatibleBitmap.restype=W.HBITMAP;g.CreateCompatibleBitmap.argtypes=[W.HDC,ctypes.c_int,ctypes.c_int];g.SelectObject.restype=W.HANDLE;g.SelectObject.argtypes=[W.HDC,W.HANDLE];u.PrintWindow.argtypes=[W.HWND,W.HDC,W.UINT];g.GetDIBits.argtypes=[W.HDC,W.HBITMAP,W.UINT,W.UINT,ctypes.c_void_p,ctypes.c_void_p,W.UINT];g.DeleteObject.argtypes=[W.HANDLE];g.DeleteDC.argtypes=[W.HDC]
hdc=u.GetDC(h);dc=g.CreateCompatibleDC(hdc);bm=g.CreateCompatibleBitmap(hdc,w,hgt);old=g.SelectObject(dc,bm)
print('Print',u.PrintWindow(h,dc,3),'size',w,hgt)
class BI(ctypes.Structure):
 _fields_=[('size',W.DWORD),('width',W.LONG),('height',W.LONG),('planes',W.WORD),('bits',W.WORD),('compression',W.DWORD),('imagesize',W.DWORD),('xppm',W.LONG),('yppm',W.LONG),('used',W.DWORD),('important',W.DWORD)]
info=BI(ctypes.sizeof(BI),w,-hgt,1,32,0,0,0,0,0,0);buf=ctypes.create_string_buffer(w*hgt*4)
g.GetDIBits(dc,bm,0,hgt,buf,ctypes.byref(info),0)
Image.frombuffer('RGB',(w,hgt),buf,'raw','BGRX',0,1).save(sys.argv[1] if len(sys.argv)>1 else 'ui-repair/selection-print.png')
g.SelectObject(dc,old);g.DeleteObject(bm);g.DeleteDC(dc);u.ReleaseDC(h,hdc)
