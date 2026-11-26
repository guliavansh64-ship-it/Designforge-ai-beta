import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { cx } from './ui';

/**
 * Secure preview for generated HTML.
 * - The frame loads /sandbox.html (its own narrow CSP header, see public/_headers) and receives the
 *   document via postMessage. We do NOT use srcdoc: srcdoc documents inherit the app's CSP, which would
 *   force us to weaken the app policy (inline scripts) to make Tailwind-based designs render.
 * - <iframe sandbox="allow-scripts"> WITHOUT allow-same-origin → opaque origin: generated code
 *   can't read DesignForge cookies/localStorage/DOM, can't navigate the top window, open popups or submit forms.
 * - Injected CSP: no network except the Tailwind runtime, Google Fonts and https images; connect-src 'none' blocks exfiltration.
 * - Editing happens through a tiny postMessage bridge injected into the document; the parent validates event.source.
 */

export type Device = 'DESKTOP' | 'TABLET' | 'MOBILE';
export const DEVICE_WIDTH: Record<Device, number> = { DESKTOP: 1280, TABLET: 834, MOBILE: 390 };

export interface Selection {
  path: string; tag: string; text: string; leaf: boolean; section?: string;
  styles: Record<string, string>;
}
export interface PreviewHandle {
  setStyle: (path: string, prop: string, value: string) => void;
  setText: (path: string, text: string) => void;
  replaceColor: (from: string, to: string) => void;
  replaceFont: (font: string) => void;
  remove: (path: string) => void;
  duplicate: (path: string) => void;
  serialize: () => Promise<string>;
  reload: () => void;
}

const CSP = "default-src 'none'; script-src 'unsafe-inline' https://cdn.tailwindcss.com; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com data:; img-src https: data: blob:; media-src https: data:; connect-src 'none'; form-action 'none'; frame-src 'none'; base-uri 'none'";

const BRIDGE = `(function(){
  var sel=null, P=window.parent;
  function post(m){ P.postMessage(Object.assign({__df:1},m),'*'); }
  function pathOf(el){ var p=[]; while(el && el!==document.body){ var i=0,s=el; while((s=s.previousElementSibling)) i++; p.unshift(i); el=el.parentElement; } return p.join('>'); }
  function byPath(p){ var el=document.body; if(!p) return el; p.split('>').forEach(function(i){ el = el && el.children[+i]; }); return el; }
  function sectionOf(el){ var s=el.closest('section,header,footer,nav,aside,main,form'); if(!s) return undefined; var h=s.querySelector('h1,h2,h3'); return s.id || s.getAttribute('aria-label') || (h && h.textContent.trim().slice(0,40)) || s.tagName.toLowerCase(); }
  var st=document.createElement('style'); st.setAttribute('data-df-editor','1');
  st.textContent='[data-df-hover]{outline:2px dashed rgba(124,92,255,.7)!important;outline-offset:2px}[data-df-sel]{outline:2px solid #7c5cff!important;outline-offset:2px}';
  document.head.appendChild(st);
  var editing = document.documentElement.getAttribute('data-df-edit')==='1';
  document.addEventListener('click',function(e){ var a=e.target.closest('a,button,[type=submit]'); if(a) e.preventDefault(); if(!editing) return; e.preventDefault(); e.stopPropagation();
    if(sel) sel.removeAttribute('data-df-sel'); sel=e.target; sel.setAttribute('data-df-sel','');
    var cs=getComputedStyle(sel);
    post({type:'select',sel:{path:pathOf(sel),tag:sel.tagName.toLowerCase(),text:(sel.innerText||'').slice(0,500),leaf:sel.children.length===0,section:sectionOf(sel),
      styles:{color:cs.color,backgroundColor:cs.backgroundColor,fontSize:cs.fontSize,fontWeight:cs.fontWeight,fontFamily:cs.fontFamily,padding:cs.padding,margin:cs.margin,borderRadius:cs.borderRadius,textAlign:cs.textAlign,lineHeight:cs.lineHeight,letterSpacing:cs.letterSpacing}}});
  },true);
  document.addEventListener('submit',function(e){ e.preventDefault(); },true);
  document.addEventListener('mouseover',function(e){ if(!editing) return; e.target.setAttribute('data-df-hover',''); },true);
  document.addEventListener('mouseout',function(e){ e.target.removeAttribute && e.target.removeAttribute('data-df-hover'); },true);
  window.addEventListener('error',function(e){ post({type:'error',message:String(e.message||e)}); });
  function rgbToHex(c){ var m=/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)(?:,\\s*([\\d.]+))?/.exec(c); if(!m || m[4]==='0') return null; return '#'+[m[1],m[2],m[3]].map(function(x){return (+x).toString(16).padStart(2,'0')}).join(''); }
  function theme(){ var counts={}, fonts={}; var els=document.body.querySelectorAll('*'); for(var i=0;i<els.length && i<3000;i++){ var cs=getComputedStyle(els[i]); [cs.color,cs.backgroundColor,cs.borderTopColor].forEach(function(c){ var h=rgbToHex(c); if(h) counts[h]=(counts[h]||0)+1; }); var f=cs.fontFamily.split(',')[0].replace(/["']/g,'').trim(); fonts[f]=(fonts[f]||0)+1; }
    post({type:'theme',colors:Object.keys(counts).sort(function(a,b){return counts[b]-counts[a]}).slice(0,12),fonts:Object.keys(fonts).sort(function(a,b){return fonts[b]-fonts[a]}).slice(0,4),
      sections:Array.prototype.map.call(document.querySelectorAll('header,nav,section,footer,aside,main > div'),function(s){ var h=s.querySelector('h1,h2,h3'); return {path:pathOf(s),label:s.id||s.getAttribute('aria-label')||(h&&h.textContent.trim().slice(0,40))||s.tagName.toLowerCase(),tag:s.tagName.toLowerCase()}; }).slice(0,40),
      images:Array.prototype.map.call(document.images,function(im){return {path:pathOf(im),src:im.currentSrc||im.src,alt:im.alt||''}}).slice(0,40)}); }
  window.addEventListener('load',function(){ setTimeout(theme,350); });
  window.addEventListener('message',function(e){ var m=e.data; if(!m||!m.__df) return; var el;
    if(m.type==='style'){ el=byPath(m.path); if(el) el.style.setProperty(m.prop,m.value,'important'); }
    else if(m.type==='text'){ el=byPath(m.path); if(el && el.children.length===0) el.textContent=m.text; }
    else if(m.type==='attr'){ el=byPath(m.path); if(el) el.setAttribute(m.name,m.value); }
    else if(m.type==='remove'){ el=byPath(m.path); if(el && el!==document.body) el.remove(); sel=null; }
    else if(m.type==='duplicate'){ el=byPath(m.path); if(el && el!==document.body) el.after(el.cloneNode(true)); }
    else if(m.type==='color'){ var f=m.from.toLowerCase(); var els=document.querySelectorAll('*'); for(var i=0;i<els.length;i++){ var cs=getComputedStyle(els[i]); ['color','background-color','border-color'].forEach(function(p){ var v=rgbToHex(cs.getPropertyValue(p)); if(v===f) els[i].style.setProperty(p,m.to); }); } document.querySelectorAll('style:not([data-df-editor])').forEach(function(s){ s.textContent=s.textContent.split(m.from).join(m.to); }); setTimeout(theme,50); }
    else if(m.type==='font'){ document.body.style.setProperty('font-family',m.font+', system-ui, sans-serif'); document.querySelectorAll('h1,h2,h3,h4,h5,h6,p,a,button,span,li,td,th,label,input').forEach(function(x){ x.style.setProperty('font-family','inherit'); }); setTimeout(theme,50); }
    else if(m.type==='scroll'){ el=byPath(m.path); if(el) el.scrollIntoView({behavior:'smooth',block:'center'}); }
    else if(m.type==='serialize'){ var c=document.documentElement.cloneNode(true); c.querySelectorAll('[data-df-editor]').forEach(function(n){n.remove()}); c.querySelectorAll('[data-df-sel],[data-df-hover]').forEach(function(n){n.removeAttribute('data-df-sel');n.removeAttribute('data-df-hover')}); c.removeAttribute('data-df-edit'); post({type:'html',id:m.id,html:'<!doctype html>\\n'+c.outerHTML}); }
  });
})();`;

export function buildSrcDoc(html: string, editable: boolean) {
  const meta = `<meta data-df-editor="1" http-equiv="Content-Security-Policy" content="${CSP}">`;
  const script = `<script data-df-editor="1">${BRIDGE}</script>`;
  let doc = html || '<!doctype html><html><body></body></html>';
  doc = /<head[^>]*>/i.test(doc) ? doc.replace(/<head([^>]*)>/i, `<head$1>${meta}`) : doc.replace(/<html([^>]*)>/i, `<html$1><head>${meta}</head>`);
  doc = doc.replace(/<html([^>]*)>/i, (_m, a) => `<html${a}${editable ? ' data-df-edit="1"' : ''}>`);
  doc = /<\/body>/i.test(doc) ? doc.replace(/<\/body>(?![\s\S]*<\/body>)/i, `${script}</body>`) : doc + script;
  return doc;
}

interface Props {
  html: string; device: Device; zoom: number | 'fit' | 'contain'; editable?: boolean; className?: string; title?: string;
  onSelect?: (s: Selection) => void; onTheme?: (t: { colors: string[]; fonts: string[]; sections: { path: string; label: string; tag: string }[]; images: { path: string; src: string; alt: string }[] }) => void;
  onError?: (msg: string) => void; onChange?: () => void;
}

export const Preview = forwardRef<PreviewHandle, Props>(function Preview({ html, device, zoom, editable, className, title = 'Design preview', onSelect, onTheme, onError, onChange }, ref) {
  const frame = useRef<HTMLIFrameElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [nonce, setNonce] = useState(0);
  const pending = useRef(new Map<string, (html: string) => void>());
  const doc = useRef('');
  const [renderKey, setRenderKey] = useState(0);
  const rendered = useRef(-1);
  // Any change of content/mode → fresh sandbox document (the bridge holds per-document state).
  useEffect(() => { doc.current = buildSrcDoc(html, !!editable); setRenderKey((k) => k + 1); }, [html, editable]);
  const width = DEVICE_WIDTH[device];

  useLayoutEffect(() => {
    const el = box.current; if (!el) return;
    const h = device === 'MOBILE' ? 844 : device === 'TABLET' ? 1112 : 800;
    // 'fit' = fit width (scroll vertically); 'contain' = whole device visible (full-screen preview).
    const ro = new ResizeObserver(() => setScale(zoom === 'fit' ? Math.min(1, (el.clientWidth - 32) / width) : zoom === 'contain' ? Math.min(1, (el.clientWidth - 32) / width, (el.clientHeight - 32) / h) : zoom));
    ro.observe(el);
    return () => ro.disconnect();
  }, [zoom, width, device]);

  useEffect(() => {
    const h = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow || !e.data?.__df) return;
      const m = e.data;
      if (m.type === 'sandbox-ready') {
        const k = renderKey * 1000 + nonce;
        if (rendered.current === k) return; // render exactly once per sandbox load
        rendered.current = k;
        frame.current?.contentWindow?.postMessage({ __dfRender: 1, html: doc.current || buildSrcDoc(html, !!editable) }, '*');
      } else if (m.type === 'select') onSelect?.(m.sel);
      else if (m.type === 'theme') onTheme?.(m);
      else if (m.type === 'error') onError?.(m.message);
      else if (m.type === 'html') { pending.current.get(m.id)?.(m.html); pending.current.delete(m.id); }
    };
    window.addEventListener('message', h);
    return () => window.removeEventListener('message', h);
  }, [onSelect, onTheme, onError, renderKey, nonce, html, editable]);

  const send = (m: Record<string, unknown>) => frame.current?.contentWindow?.postMessage({ __df: 1, ...m }, '*');
  useImperativeHandle(ref, () => ({
    setStyle: (path, prop, value) => { send({ type: 'style', path, prop, value }); onChange?.(); },
    setText: (path, text) => { send({ type: 'text', path, text }); onChange?.(); },
    replaceColor: (from, to) => { send({ type: 'color', from, to }); onChange?.(); },
    replaceFont: (font) => { send({ type: 'font', font }); onChange?.(); },
    remove: (path) => { send({ type: 'remove', path }); onChange?.(); },
    duplicate: (path) => { send({ type: 'duplicate', path }); onChange?.(); },
    serialize: () => new Promise((resolve, reject) => {
      const id = Math.random().toString(36).slice(2);
      pending.current.set(id, resolve);
      send({ type: 'serialize', id });
      setTimeout(() => { if (pending.current.has(id)) { pending.current.delete(id); reject(new Error('Preview did not respond')); } }, 4000);
    }),
    reload: () => setNonce((n) => n + 1),
  }));

  const height = device === 'MOBILE' ? 844 : device === 'TABLET' ? 1112 : 800;
  return (
    <div ref={box} className={cx('relative flex h-full w-full justify-center overflow-auto bg-grid-faint [background-size:24px_24px] p-4', className)}>
      <div style={{ width: width * scale, height: height * scale }} className="shrink-0">
        <div style={{ width, height, transform: `scale(${scale})`, transformOrigin: 'top left' }}
          className={cx('overflow-hidden bg-white shadow-2xl ring-1 ring-black/10', device === 'MOBILE' ? 'rounded-[36px] ring-8 ring-ink-900' : device === 'TABLET' ? 'rounded-[24px] ring-8 ring-ink-900' : 'rounded-xl')}>
          <iframe key={`${renderKey}-${nonce}`} ref={frame} title={title} sandbox="allow-scripts" referrerPolicy="no-referrer"
            src="/sandbox.html" className="h-full w-full border-0" />
        </div>
      </div>
    </div>
  );
});
