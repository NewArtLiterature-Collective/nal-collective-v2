// WritingHall.jsx —— 陈伯吹新儿童文学创作大赛厅（常年开放，展示历届文字创作的 AI 评审佳作）
// 数据：writing_works 表（访客只能读到已发布作品，RLS 保证）；封面图：R2 公开桶 showcase/ 目录（上传时已烧入水印）
// · 展厅：封面卡片网格，按届次分组
// · 阅读：点开作品 → 宽屏左封面、右正文；窄屏封面在上、正文在下
// · 防复制：正文不可选中、复制；图片不可右键、拖拽、长按保存（只能挡住一般操作，挡不住截图）
import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import { showcaseUrl } from './media';

export const cleanWritingTitle = (t) => (t || '').replace(/[《》]/g, '').trim();

const block = (e) => e.preventDefault();
const protectProps = { onContextMenu: block, onDragStart: block, onCopy: block, onCut: block };
const noSelect = { userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none' };

function ProtectedImg({ style, ...rest }) {
  return <img {...rest} draggable={false} style={{ ...style, ...noSelect, pointerEvents: 'none' }} />;
}

function useIsWide(breakpoint = 900) {
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && window.innerWidth >= breakpoint);
  useEffect(() => {
    const onResize = () => setWide(window.innerWidth >= breakpoint);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [breakpoint]);
  return wide;
}

// ---------------- 阅读器 ----------------
function Reader({ work, onClose }) {
  const wide = useIsWide();
  const cover = showcaseUrl(work.cover);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  return (
    <div style={st.overlay} onClick={onClose} {...protectProps}>
      <div style={{ ...st.reader, flexDirection: wide ? 'row' : 'column' }} onClick={e => e.stopPropagation()}>
        <button style={st.close} onClick={onClose} aria-label="关闭">×</button>
        {cover && (
          <div style={wide ? st.readerCoverWide : st.readerCoverNarrow}>
            <ProtectedImg src={cover} alt={cleanWritingTitle(work.title)} style={wide ? st.readerCoverImg : { ...st.readerCoverImg, height: 'auto', maxHeight: '60vh' }} />
          </div>
        )}
        <div style={{ ...st.readerText, ...(wide ? { overflowY: 'auto' } : { padding: '28px 22px 32px' }) }}>
          {work.edition && <div style={st.readerEdition}>{work.edition}</div>}
          <h2 style={st.readerTitle}>《{cleanWritingTitle(work.title)}》</h2>
          {work.byline && <div style={st.readerByline}>{work.byline}</div>}
          <div style={st.readerBody}>{work.content}</div>
          {work.verdict && (
            <div style={st.readerVerdict}>
              <div style={{ color: '#ebcb8b', fontSize: '13px', fontWeight: 'bold', marginBottom: '6px' }}>评语</div>
              {work.verdict}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------- 展厅主体 ----------------
export default function WritingHall() {
  const [works, setWorks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(null);
  const [locked, setLocked] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    (async () => {
      // 锁定开关：site_settings.is_writing_hall_active（缺省视为开放）
      const { data: setting } = await supabase
        .from('site_settings').select('is_writing_hall_active').eq('id', 1).maybeSingle();
      const isLocked = setting?.is_writing_hall_active === false;
      const { data: { session } } = await supabase.auth.getSession();
      const admin = session?.user?.app_metadata?.role === 'admin';
      setLocked(isLocked); setIsAdmin(admin);
      if (isLocked && !admin) { setLoading(false); return; }

      const { data, error: e } = await supabase
        .from('writing_works')
        .select('id, edition, title, byline, content, verdict, cover, sort_order, created_at')
        .eq('is_published', true)
        .order('sort_order', { ascending: false })
        .order('created_at', { ascending: false });
      if (e) { console.error('陈伯吹新儿童文学创作大赛厅加载失败:', e); setError('展品加载失败，请稍后重试。'); }
      setWorks(data || []);
      setLoading(false);
    })();
  }, []);

  // 按届次分组，保持查询顺序
  const groups = [];
  works.forEach(w => {
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
      <p style={st.intro}>陈伯吹新儿童文学创作大赛历届文字作品中，经 AI 终审横向比较选出的佳作。点开作品可阅读全文。</p>

      {loading ? (
        <div style={st.status}>📡 正在布展…</div>
      ) : error ? (
        <div style={st.status}>{error}</div>
      ) : works.length === 0 ? (
        <div style={st.status}>📭 本厅暂无展品，敬请期待。</div>
      ) : groups.map(g => (
        <section key={g.key} style={{ marginBottom: '50px' }}>
          {g.key && <h2 style={st.edition}>{g.key}</h2>}
          <div style={st.grid}>
            {g.items.map(w => {
              const cover = showcaseUrl(w.cover);
              const excerpt = (w.content || '').replace(/\s+/g, '').slice(0, 70);
              return (
                <button key={w.id} style={st.card} onClick={() => setOpen(w)}>
                  <div style={st.coverBox}>
                    {cover
                      ? <ProtectedImg src={cover} alt={cleanWritingTitle(w.title)} style={st.coverImg} loading="lazy" />
                      : <div style={st.coverPlaceholder}>《{cleanWritingTitle(w.title)}》</div>}
                    <span style={st.badge}>阅读 · 约 {(w.content || '').replace(/\s/g, '').length} 字</span>
                  </div>
                  <div style={st.cardBody}>
                    <div style={st.cardTitle}>《{cleanWritingTitle(w.title)}》</div>
                    {w.byline && <div style={st.cardByline}>{w.byline}</div>}
                    <p style={st.cardExcerpt}>{excerpt}{(w.content || '').length > 70 ? '……' : ''}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      ))}

      {open && <Reader work={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

const st = {
  previewBar: { textAlign: 'center', background: 'rgba(191,97,106,.15)', color: '#ebcb8b', border: '1px solid #bf616a', borderRadius: '8px', padding: '10px 16px', marginBottom: '24px', fontSize: '14px' },
  intro: { textAlign: 'center', color: '#6b7280', fontSize: '14px', margin: '0 0 40px' },
  status: { textAlign: 'center', padding: '80px 20px', color: '#9ca3af', background: '#111', borderRadius: '12px', border: '1px dashed #333', maxWidth: '600px', margin: '0 auto' },
  edition: { color: '#ebcb8b', fontSize: '20px', borderBottom: '1px solid #222', paddingBottom: '10px', margin: '0 0 24px', letterSpacing: '2px', textAlign: 'left' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '28px' },
  card: { textAlign: 'left', padding: 0, background: '#111827', border: '1px solid #1f2937', borderRadius: '12px', overflow: 'hidden', cursor: 'pointer', color: 'inherit', font: 'inherit', boxShadow: '0 4px 10px rgba(0,0,0,.3)' },
  coverBox: { position: 'relative', aspectRatio: '3 / 4', background: '#000' },
  coverImg: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
  coverPlaceholder: { width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ebcb8b', fontSize: '20px', padding: '20px', boxSizing: 'border-box', textAlign: 'center', background: 'linear-gradient(160deg,#1f2937,#111827)' },
  badge: { position: 'absolute', right: '10px', bottom: '10px', background: 'rgba(0,0,0,.7)', color: '#ebcb8b', fontSize: '12px', padding: '4px 10px', borderRadius: '999px' },
  cardBody: { padding: '16px 18px 20px' },
  cardTitle: { fontSize: '17px', fontWeight: 'bold', color: '#f3f4f6' },
  cardByline: { fontSize: '13px', color: '#9ca3af', marginTop: '4px' },
  cardExcerpt: { fontSize: '13px', lineHeight: '1.8', color: '#9ca3af', margin: '10px 0 0', ...noSelect },

  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.92)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px', overflowY: 'auto' },
  reader: { position: 'relative', display: 'flex', width: '100%', maxWidth: '1180px', maxHeight: 'calc(100vh - 32px)', background: '#fbf8f1', borderRadius: '10px', overflow: 'auto', boxShadow: '0 20px 50px rgba(0,0,0,.6)', margin: 'auto' },
  close: { position: 'absolute', top: '8px', right: '12px', background: 'rgba(255,255,255,.85)', border: 'none', color: '#374151', fontSize: '30px', cursor: 'pointer', zIndex: 2, lineHeight: 1, width: '40px', height: '40px', borderRadius: '50%' },
  readerCoverWide: { flex: '0 0 42%', background: '#111', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  readerCoverNarrow: { background: '#111', display: 'flex', justifyContent: 'center' },
  readerCoverImg: { display: 'block', width: '100%', height: '100%', maxHeight: 'calc(100vh - 32px)', objectFit: 'contain' },
  readerText: { flex: 1, padding: '44px 48px 48px', boxSizing: 'border-box', textAlign: 'left', color: '#1f2937', ...noSelect },
  readerEdition: { color: '#b45309', fontSize: '13px', fontWeight: 'bold', letterSpacing: '2px', marginBottom: '8px' },
  readerTitle: { margin: '0 0 8px', fontSize: '26px', color: '#111827', lineHeight: 1.4, fontFamily: '"Songti SC","STSong","Noto Serif SC","SimSun",serif' },
  readerByline: { color: '#6b7280', fontSize: '14px', marginBottom: '24px' },
  readerBody: { fontSize: '17px', lineHeight: 2.1, whiteSpace: 'pre-wrap', textAlign: 'justify', wordBreak: 'break-word', fontFamily: '"Songti SC","STSong","Noto Serif SC","SimSun",serif', color: '#1f2937' },
  readerVerdict: { marginTop: '32px', padding: '16px 18px', background: '#1f2937', color: '#d1d5db', borderRadius: '8px', fontSize: '14px', lineHeight: 1.8, textAlign: 'justify' },
};
