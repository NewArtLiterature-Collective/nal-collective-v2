// Showcase.jsx —— 陈伯吹新儿童文学绘本插画大赛厅（常年开放，展示历届绘本、插画的 AI 评审佳作）
// 数据：showcase_works 表（仅读取已发布作品，RLS 保证）；图片：showcase 公开桶
// · 绘本：按翻书格式阅读（宽屏两页并排、首页为封面单页；窄屏单页；跨页合图每张占一屏）
// · 插画：按页面显示图片；组图可左右翻看
// · 每件作品只显示：作品名称（署名选填）+ 简短判词
// · 防下载：图片已在上传时烧入水印；展示时禁止右键、拖拽、长按保存（只能挡住一般操作，挡不住截图）
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from './supabaseClient';

// 展厅图片在 Cloudflare R2 公开桶（showcase/ 目录），地址由 media.js 拼出
export { showcaseUrl } from './media';
import { showcaseUrl } from './media';

// 作品名统一去掉书名号，显示时再加一对
export const cleanTitle = (t) => (t || '').replace(/[《》]/g, '').replace(/^绘本/, '').trim();

// 防下载：屏蔽右键菜单与拖拽（作用在展厅和阅读器的外层容器上）
const blockSave = (e) => e.preventDefault();
const protectProps = { onContextMenu: blockSave, onDragStart: blockSave };

// 受保护的图片：不响应指针（右键 / 长按落在外层容器上被屏蔽），不可拖拽、不可选中
function ProtectedImg({ style, ...rest }) {
  return <img {...rest} draggable={false} style={{ ...style, ...noSave }} />;
}
const noSave = { pointerEvents: 'none', userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none' };

function useIsWide(breakpoint = 900) {
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && window.innerWidth >= breakpoint);
  useEffect(() => {
    const onResize = () => setWide(window.innerWidth >= breakpoint);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [breakpoint]);
  return wide;
}

// 把页面切成"一屏"：宽屏单页模式 → [封面]、[2,3]、[4,5]…；跨页合图或窄屏 → 每页一屏
function buildSpreads(pages, pageFormat, wide) {
  if (pageFormat === 'spread' || !wide || pages.length <= 1) return pages.map(p => [p]);
  const out = [[pages[0]]];
  for (let i = 1; i < pages.length; i += 2) out.push(pages.slice(i, i + 2));
  return out;
}

// ---------------- 翻书阅读器 ----------------
function FlipBook({ work, onClose }) {
  const wide = useIsWide();
  const pages = (work.pages || []).map(showcaseUrl);
  const spreads = buildSpreads(pages, work.page_format, wide);
  const [idx, setIdx] = useState(0);
  const [dir, setDir] = useState(0);          // 翻页方向，用于动画
  const touchX = useRef(null);

  useEffect(() => { setIdx(i => Math.min(i, spreads.length - 1)); }, [spreads.length]);

  const go = useCallback((d) => {
    setIdx(i => {
      const n = Math.max(0, Math.min(spreads.length - 1, i + d));
      if (n !== i) setDir(d);
      return n;
    });
  }, [spreads.length]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, onClose]);

  // 预载前后两屏
  useEffect(() => {
    [idx - 1, idx + 1, idx + 2].forEach(k => (spreads[k] || []).forEach(src => { const im = new Image(); im.src = src; }));
  }, [idx, spreads]);

  const cur = spreads[idx] || [];
  const pageNos = (() => {
    if (work.page_format === 'spread' || !wide) return `${idx + 1} / ${spreads.length}`;
    const first = idx === 0 ? 1 : idx * 2;
    const last = first + cur.length - 1;
    return `${first === last ? first : `${first}–${last}`} / ${pages.length}`;
  })();
  const isCover = wide && work.page_format !== 'spread' && idx === 0;

  return (
    <div style={st.overlay} onClick={onClose} {...protectProps}>
      <div style={st.bookWrap} onClick={e => e.stopPropagation()}
        onTouchStart={e => { touchX.current = e.touches[0].clientX; }}
        onTouchEnd={e => {
          if (touchX.current == null) return;
          const dx = e.changedTouches[0].clientX - touchX.current;
          if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1);
          touchX.current = null;
        }}>
        <button style={st.close} onClick={onClose} aria-label="关闭">×</button>

        <div style={st.stage}>
          <button style={{ ...st.navBtn, left: 0, visibility: idx > 0 ? 'visible' : 'hidden' }} onClick={() => go(-1)} aria-label="上一页">‹</button>
          <div key={idx} style={{ ...st.spread, animation: dir === 0 ? 'none' : `${dir > 0 ? 'turnNext' : 'turnPrev'} .45s ease` }}>
            {cur.map((src, i) => (
              <div key={src} style={{
                ...st.page,
                ...(cur.length === 2 ? { ...(i === 0 ? st.pageLeft : st.pageRight), maxWidth: '50%' } : { maxWidth: '100%' }),
                ...(isCover ? st.cover : {}),
              }}>
                <ProtectedImg src={src} alt={`第 ${idx + 1} 屏`} style={st.pageImg} />
              </div>
            ))}
          </div>
          <button style={{ ...st.navBtn, right: 0, visibility: idx < spreads.length - 1 ? 'visible' : 'hidden' }} onClick={() => go(1)} aria-label="下一页">›</button>
        </div>

        <div style={st.bookFooter}>
          <div style={st.pageNo}>{pageNos}</div>
          <h3 style={st.viewerTitle}>《{cleanTitle(work.title)}》{work.byline && <span style={st.viewerByline}>{work.byline}</span>}</h3>
          {work.verdict && <p style={st.viewerVerdict}>{work.verdict}</p>}
        </div>
      </div>
    </div>
  );
}

// ---------------- 插画查看器 ----------------
function IllustrationViewer({ work, onClose }) {
  const pages = (work.pages || []).map(showcaseUrl);
  const [idx, setIdx] = useState(0);
  const go = useCallback(d => setIdx(i => Math.max(0, Math.min(pages.length - 1, i + d))), [pages.length]);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, onClose]);
  return (
    <div style={st.overlay} onClick={onClose} {...protectProps}>
      <div style={st.bookWrap} onClick={e => e.stopPropagation()}>
        <button style={st.close} onClick={onClose} aria-label="关闭">×</button>
        <div style={st.stage}>
          {pages.length > 1 && <button style={{ ...st.navBtn, left: 0, visibility: idx > 0 ? 'visible' : 'hidden' }} onClick={() => go(-1)}>‹</button>}
          <ProtectedImg key={idx} src={pages[idx]} alt={cleanTitle(work.title)} style={st.illusImg} />
          {pages.length > 1 && <button style={{ ...st.navBtn, right: 0, visibility: idx < pages.length - 1 ? 'visible' : 'hidden' }} onClick={() => go(1)}>›</button>}
        </div>
        <div style={st.bookFooter}>
          {pages.length > 1 && <div style={st.pageNo}>{idx + 1} / {pages.length}</div>}
          <h3 style={st.viewerTitle}>《{cleanTitle(work.title)}》{work.byline && <span style={st.viewerByline}>{work.byline}</span>}</h3>
          {work.verdict && <p style={st.viewerVerdict}>{work.verdict}</p>}
        </div>
      </div>
    </div>
  );
}

// ---------------- 展厅主体 ----------------
export default function ShowcaseHall() {
  const [works, setWorks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [cat, setCat] = useState('picturebook');
  const [open, setOpen] = useState(null);
  const [locked, setLocked] = useState(false);      // 本厅是否被管理员锁定
  const [isAdmin, setIsAdmin] = useState(false);    // 管理员在锁定期间仍可预览

  useEffect(() => {
    (async () => {
      // 锁定开关：site_settings.is_showcase_active（缺省视为开放）
      const { data: setting } = await supabase
        .from('site_settings').select('is_showcase_active').eq('id', 1).maybeSingle();
      const isLocked = setting?.is_showcase_active === false;
      const { data: { session } } = await supabase.auth.getSession();
      const admin = session?.user?.app_metadata?.role === 'admin';
      setLocked(isLocked); setIsAdmin(admin);
      if (isLocked && !admin) { setLoading(false); return; }

      const { data, error: e } = await supabase
        .from('showcase_works')
        .select('id, category, edition, title, byline, verdict, pages, cover_index, page_format, sort_order, created_at')
        .eq('is_published', true)
        .order('sort_order', { ascending: false })
        .order('created_at', { ascending: false });
      if (e) { console.error('陈伯吹新儿童文学绘本插画大赛厅加载失败:', e); setError('展品加载失败，请稍后重试。'); }
      setWorks(data || []);
      setLoading(false);
    })();
  }, []);

  const list = works.filter(w => w.category === cat);
  // 按届次分组，保持查询顺序
  const groups = [];
  list.forEach(w => {
    const key = w.edition || '';
    let g = groups.find(x => x.key === key);
    if (!g) { g = { key, items: [] }; groups.push(g); }
    g.items.push(w);
  });

  if (!loading && locked && !isAdmin) {
    return (
      <div style={st.status}>
        <div style={{ fontSize: '56px', marginBottom: '16px' }}>🔐</div>
        <div style={{ color: '#d8dee9', lineHeight: '1.8', fontSize: '16px' }}>本厅正在布展，暂未开放。<br />敬请期待。</div>
      </div>
    );
  }

  return (
    <div {...protectProps}>
      {locked && isAdmin && (
        <div style={st.previewBar}>🔒 本厅当前处于锁定状态，访客看不到展品。您以管理员身份预览中。</div>
      )}
      <div style={st.tabs}>
        {[['picturebook', '📖 绘本'], ['illustration', '🎨 插画']].map(([k, label]) => (
          <button key={k} onClick={() => setCat(k)} style={cat === k ? st.tabOn : st.tab}>{label}</button>
        ))}
      </div>
      <p style={st.intro}>
        {cat === 'picturebook'
          ? '陈伯吹新儿童文学绘本插画大赛历届绘本作品中，经 AI 终审横向比较选出的佳作。点开作品可按翻书方式阅读。'
          : '陈伯吹新儿童文学绘本插画大赛历届插画作品中，经 AI 终审横向比较选出的佳作。'}
      </p>

      {loading ? (
        <div style={st.status}>📡 正在布展…</div>
      ) : error ? (
        <div style={st.status}>{error}</div>
      ) : list.length === 0 ? (
        <div style={st.status}>📭 本厅暂无展品，敬请期待。</div>
      ) : groups.map(g => (
        <section key={g.key} style={{ marginBottom: '50px' }}>
          {g.key && <h2 style={st.edition}>{g.key}</h2>}
          <div style={st.grid}>
            {g.items.map(w => {
              const cover = showcaseUrl((w.pages || [])[w.cover_index || 0]);
              return (
                <button key={w.id} style={st.card} onClick={() => setOpen(w)}>
                  <div style={cat === 'picturebook' ? st.coverBox : st.illusBox}>
                    {cover && <ProtectedImg src={cover} alt={cleanTitle(w.title)} style={st.coverImg} loading="lazy" />}
                    {cat === 'picturebook' && <span style={st.badge}>翻阅 · {(w.pages || []).length} 页</span>}
                    {cat === 'illustration' && (w.pages || []).length > 1 && <span style={st.badge}>组图 · {(w.pages || []).length} 幅</span>}
                  </div>
                  <div style={st.cardBody}>
                    <div style={st.cardTitle}>《{cleanTitle(w.title)}》</div>
                    {w.byline && <div style={st.cardByline}>{w.byline}</div>}
                    {w.verdict && <p style={st.cardVerdict}>{w.verdict}</p>}
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      ))}

      {open && (open.category === 'picturebook'
        ? <FlipBook work={open} onClose={() => setOpen(null)} />
        : <IllustrationViewer work={open} onClose={() => setOpen(null)} />)}

      <style>{`
        @keyframes turnNext { from { opacity: 0; transform: perspective(1600px) rotateY(-12deg) translateX(40px); } to { opacity: 1; transform: none; } }
        @keyframes turnPrev { from { opacity: 0; transform: perspective(1600px) rotateY(12deg) translateX(-40px); } to { opacity: 1; transform: none; } }
      `}</style>
    </div>
  );
}

const st = {
  tabs: { display: 'flex', gap: '12px', justifyContent: 'center', marginBottom: '16px' },
  previewBar: { textAlign: 'center', background: 'rgba(191,97,106,.15)', color: '#ebcb8b', border: '1px solid #bf616a', borderRadius: '8px', padding: '10px 16px', marginBottom: '24px', fontSize: '14px' },
  tab: { padding: '10px 26px', background: 'transparent', color: '#9ca3af', border: '1px solid #333', borderRadius: '999px', cursor: 'pointer', fontSize: '15px', fontWeight: 'bold' },
  tabOn: { padding: '10px 26px', background: '#ebcb8b', color: '#111', border: '1px solid #ebcb8b', borderRadius: '999px', cursor: 'pointer', fontSize: '15px', fontWeight: 'bold' },
  intro: { textAlign: 'center', color: '#6b7280', fontSize: '14px', margin: '0 0 40px' },
  status: { textAlign: 'center', padding: '80px 20px', color: '#9ca3af', background: '#111', borderRadius: '12px', border: '1px dashed #333', maxWidth: '600px', margin: '0 auto' },
  edition: { color: '#ebcb8b', fontSize: '20px', borderBottom: '1px solid #222', paddingBottom: '10px', margin: '0 0 24px', letterSpacing: '2px' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '28px' },
  card: { textAlign: 'left', padding: 0, background: '#111827', border: '1px solid #1f2937', borderRadius: '12px', overflow: 'hidden', cursor: 'pointer', color: 'inherit', font: 'inherit', boxShadow: '0 4px 10px rgba(0,0,0,.3)' },
  coverBox: { position: 'relative', aspectRatio: '4 / 3', background: '#000' },
  illusBox: { position: 'relative', aspectRatio: '1 / 1', background: '#000' },
  coverImg: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
  badge: { position: 'absolute', right: '10px', bottom: '10px', background: 'rgba(0,0,0,.7)', color: '#ebcb8b', fontSize: '12px', padding: '4px 10px', borderRadius: '999px' },
  cardBody: { padding: '18px 20px 22px' },
  cardTitle: { fontSize: '18px', fontWeight: 'bold', color: '#f3f4f6' },
  cardByline: { fontSize: '13px', color: '#9ca3af', marginTop: '4px' },
  cardVerdict: { fontSize: '14px', lineHeight: '1.8', color: '#9ca3af', margin: '10px 0 0' },

  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.97)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' },
  bookWrap: { position: 'relative', width: '100%', maxWidth: '1400px', maxHeight: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' },
  close: { position: 'absolute', top: '-6px', right: '0', background: 'none', border: 'none', color: '#d1d5db', fontSize: '36px', cursor: 'pointer', zIndex: 2, lineHeight: 1 },
  stage: { position: 'relative', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '30px 48px 0', boxSizing: 'border-box' },
  navBtn: { position: 'absolute', top: '50%', transform: 'translateY(-50%)', width: '44px', height: '80px', background: 'rgba(255,255,255,.08)', border: 'none', color: '#fff', fontSize: '40px', cursor: 'pointer', borderRadius: '8px', zIndex: 1 },
  spread: { display: 'flex', justifyContent: 'center', alignItems: 'stretch', maxWidth: '100%', filter: 'drop-shadow(0 20px 40px rgba(0,0,0,.6))' },
  page: { background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  pageLeft: { boxShadow: 'inset -18px 0 24px -16px rgba(0,0,0,.45)' },
  pageRight: { boxShadow: 'inset 18px 0 24px -16px rgba(0,0,0,.45)' },
  cover: { borderRadius: '2px 6px 6px 2px' },
  pageImg: { display: 'block', maxHeight: 'calc(100vh - 220px)', maxWidth: '100%', objectFit: 'contain', userSelect: 'none' },
  illusImg: { display: 'block', maxHeight: 'calc(100vh - 220px)', maxWidth: '100%', objectFit: 'contain', boxShadow: '0 20px 40px rgba(0,0,0,.6)' },
  bookFooter: { textAlign: 'center', maxWidth: '760px', padding: '14px 16px 0' },
  pageNo: { color: '#6b7280', fontSize: '12px', fontFamily: 'monospace', marginBottom: '6px' },
  viewerTitle: { margin: 0, color: '#f3f4f6', fontSize: '18px' },
  viewerByline: { color: '#9ca3af', fontSize: '14px', fontWeight: 'normal', marginLeft: '10px' },
  viewerVerdict: { color: '#9ca3af', fontSize: '14px', lineHeight: '1.8', margin: '8px 0 0' },
};
