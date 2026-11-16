import sys,re,html
def conv(txt):
    fg=bg=None;ul=False;rev=False;bold=False
    out=[]
    for line in txt.split('\n'):
        res=[];pos=0
        def span(t):
            if not t:return
            f,b=fg,bg
            if rev:f,b=(bg or '#14161b'),(fg or '#e0e2ea')
            st=[]
            if f:st.append('color:'+f)
            if b:st.append('background:'+b)
            if ul:st.append('text-decoration:underline')
            if bold:st.append('font-weight:700')
            res.append('<span style="%s">%s</span>'%(';'.join(st),html.escape(t)))
        for m in re.finditer(r'\x1b\[([0-9;:]*)m',line):
            span(line[pos:m.start()]);pos=m.end()
            p=m.group(1).split(';') if m.group(1) else ['0'];i=0
            while i<len(p):
                c=p[i]
                if c in('0',''):fg=bg=None;ul=rev=bold=False
                elif c=='1':bold=True
                elif c=='4':ul=True
                elif c=='24':ul=False
                elif c=='7':rev=True
                elif c=='27':rev=False
                elif c=='39':fg=None
                elif c=='49':bg=None
                elif c in('38','48','58') and p[i+1]=='2':
                    col='rgb(%s,%s,%s)'%(p[i+2],p[i+3],p[i+4]);i+=4
                    if c=='38':fg=col
                    elif c=='48':bg=col
                elif c in('38','48','58') and p[i+1]=='5':i+=2
                i+=1
        span(line[pos:]);out.append(''.join(res))
    return '\n'.join(out)
txt=open(sys.argv[1]).read();cap=sys.argv[3]
txt=re.sub(r'<[^ \n]*/out/(\.witness)',r'\1',txt)  # shorten the evidence path in the status line
print('''<html><body style="margin:0;background:#14161b"><div style="width:1180px;padding:0"><div style="background:#2a2d36;color:#fff;font:600 22px/1.3 sans-serif;padding:12px 18px;border-bottom:2px solid #8cf8f7">%s</div><pre style="margin:0;padding:10px 12px;font:15px/1.3 'DejaVu Sans Mono',monospace;color:#e0e2ea;background:#14161b;height:480px;overflow:hidden">%s</pre></div></body></html>'''%(html.escape(cap),conv(txt)),file=open(sys.argv[2],'w'))
