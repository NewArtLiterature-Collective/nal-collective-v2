import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from './supabaseClient';
import logo from './assets/nal_logo.png';

export default function Gallery() {
  const navigate = useNavigate();
  
  // 核心状态矩阵
  const [works, setWorks] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  
  // 用于存储当前正在“完整赏析”的作品对象
  const [selectedWork, setSelectedWork] = useState(null);
  
  // 展厅时空大闸状态
  const [galleryState, setGalleryState] = useState({
    isOpen: false,
    message: '展厅正在校验时空坐标...',
    contestName: 'NAL 数字文学展厅'
  });

  useEffect(() => {
    const fetchGalleryData = async () => {
      try {
        // ==========================================
        // 阶段 1：获取当前主赛场指针 & 全局大闸状态
        // ==========================================
        const { data: settings, error: sErr } = await supabase
          .from('site_settings')
          .select('is_contest_active, current_contest_id, is_gallery_active')
          .eq('id', 1)
          .maybeSingle();

        if (sErr) throw sErr;

        let activeContestId = settings?.current_contest_id;

        // 🚨 大闸拦截：如果管理员在后台没有开启 is_gallery_active，直接锁死展厅！
        if (!settings?.is_gallery_active) {
          setGalleryState({ 
            isOpen: false, 
            message: '🔒 展厅大门尚未全网开启。\n目前正处于内部策展与布展阶段，请耐心等待官方放行。' 
          });
          setIsLoading(false);
          return;
        }

        if (!activeContestId) {
          setGalleryState({ isOpen: false, message: '🌙 当前没有正在展出的赛季档案。' });
          setIsLoading(false);
          return;
        }

        // ==========================================
        // 阶段 2：校验具体赛季的时空大闸与名称
        // ==========================================
        const { data: contestData, error: cErr } = await supabase
          .from('contests')
          .select('name, gallery_start_time, gallery_end_time')
          .eq('id', activeContestId)
          .maybeSingle();

        if (cErr) throw cErr;

        if (contestData) {
          setGalleryState(prev => ({ ...prev, contestName: contestData.name }));
          
          const now = new Date();
          const start = contestData.gallery_start_time ? new Date(contestData.gallery_start_time) : null;
          const end = contestData.gallery_end_time ? new Date(contestData.gallery_end_time) : null;

          // 时间逻辑门禁
          if (start && now < start) {
            setGalleryState(prev => ({ ...prev, isOpen: false, message: `⏳ 展厅尚未开放。\n本届展厅启封时间：${start.toLocaleDateString()}` }));
            setIsLoading(false);
            return;
          }
          if (end && now > end) {
            setGalleryState(prev => ({ ...prev, isOpen: false, message: '🌙 本届数字展厅已闭馆，感谢您的关注。' }));
            setIsLoading(false);
            return;
          }
        }

        // ==========================================
        // 阶段 3：策展门禁查询（万无一失的前端绝对过滤法）
        // ==========================================
        // 提取该赛季所有 status 为 success 的作品
        const { data: submissions, error: subErr } = await supabase
          .from('contest_submissions')
          .select('id, text_content, image_urls, ai_total_score, is_manual_recommended, manual_rank, exhibition_ready, created_at')
          .eq('status', 'success')
          .eq('contest_id', activeContestId)
          .order('manual_rank', { ascending: false })
          .order('ai_total_score', { ascending: false });

        if (subErr) throw subErr;

        // 🚨 核心修复：防丢失过滤。只要 exhibition_ready 或 is_manual_recommended 有一个是 true，就绝对放行。
        const exhibitedWorks = (submissions || []).filter(work => 
          work.exhibition_ready === true || work.is_manual_recommended === true
        );

        setWorks(exhibitedWorks);
        setGalleryState(prev => ({ ...prev, isOpen: true }));

      } catch (err) {
        console.error("🚨 展厅数据加载崩溃:", err);
        setGalleryState({ isOpen: false, message: '数据阵列加载异常，请稍后重试。' });
      } finally {
        setIsLoading(false);
      }
    };

    fetchGalleryData();
  }, []);

  return (
    <div style={styles.container}>
      {/* 🚨 沉浸式赏析弹窗 (点击背景或关闭按钮均可退出) */}
      {selectedWork && (
        <div style={styles.modalOverlay} onClick={() => setSelectedWork(null)}>
          <div style={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <h2 style={styles.modalTitle}>
                📖 完整赏析档案 <span style={styles.modalId}>[{selectedWork.id.substring(0, 8)}]</span>
              </h2>
              <button onClick={() => setSelectedWork(null)} style={styles.closeBtn}>×</button>
            </div>
            
            <div style={styles.modalBody}>
              <div style={styles.modalScoreBar}>
                <span style={styles.scoreBadge}>AI 综合评级: {selectedWork.ai_total_score?.toFixed(1)}</span>
                {selectedWork.is_manual_recommended && (
                  <span style={styles.goldenBadgeInline}>💎 主编特别推举</span>
                )}
              </div>

              {/* 完整正文渲染 */}
              <div style={styles.modalTextContent}>
                {selectedWork.text_content || <span style={{color: '#6b7280', fontStyle: 'italic'}}>[暂无正文内容]</span>}
              </div>

              {/* 完整插画瀑布流 */}
              {selectedWork.image_urls && selectedWork.image_urls.length > 0 && (
                <div style={styles.modalImageGallery}>
                  {selectedWork.image_urls.map((url, idx) => (
                    <div key={idx} style={styles.modalImageWrapper}>
                      <img src={url} alt={`作品原图 ${idx + 1}`} style={styles.modalImage} loading="lazy" />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 极简顶导 */}
      <nav style={styles.navbar}>
        <div style={styles.navLogoContainer} onClick={() => navigate('/')}>
          <img src={logo} alt="NAL Logo" style={styles.navLogoImg} />
          <div style={styles.logo}>NAL Collective</div>
        </div>
        <button onClick={() => navigate('/dashboard')} style={styles.backBtn}>
          返回控制中心
        </button>
      </nav>

      {/* 展厅主视觉区 */}
      <header style={styles.hero}>
        <h1 style={styles.heroTitle}>🏛️ 典藏文学展厅</h1>
        <p style={styles.heroSubtitle}>{galleryState.contestName}</p>
      </header>

      <main style={styles.main}>
        {isLoading ? (
          <div style={styles.statusBox}>
            <span style={{ animation: 'pulse 1.5s infinite', color: '#88c0d0' }}>
              📡 正在提取典藏作品序列...
            </span>
          </div>
        ) : !galleryState.isOpen ? (
          <div style={styles.statusBox}>
            <div style={{ fontSize: '64px', marginBottom: '20px' }}>🔐</div>
            <div style={{ whiteSpace: 'pre-wrap', color: '#d8dee9', lineHeight: '1.8', fontSize: '16px' }}>
              {galleryState.message}
            </div>
            <button onClick={() => navigate('/dashboard')} style={styles.homeBtn}>返回工作区</button>
          </div>
        ) : works.length === 0 ? (
          <div style={styles.statusBox}>
            <div style={{ fontSize: '48px', marginBottom: '20px' }}>📭</div>
            <div style={{ color: '#d8dee9', lineHeight: '1.8', fontSize: '15px' }}>
              当前展厅暂无展品。<br/>所有投稿均在进行严苛的算法共治与离线会诊中。
            </div>
          </div>
        ) : (
          /* 展厅瀑布流网格 */
          <div style={styles.grid}>
            {works.map((work) => (
              <div key={work.id} style={styles.card}>
                
                {/* 如果有插画则展示插画 */}
                {work.image_urls && work.image_urls.length > 0 && (
                  <div style={styles.imageContainer}>
                    <img src={work.image_urls[0]} alt="作品插图预览" style={styles.cardImage} loading="lazy" />
                    {/* 左上角特权角标 */}
                    {work.is_manual_recommended && (
                      <div style={styles.goldenBadge}>💎 主编推举</div>
                    )}
                  </div>
                )}

                <div style={styles.cardBody}>
                  {/* 分数与 ID 抬头 */}
                  <div style={styles.cardHeader}>
                    <span style={styles.workId}>UUID: {work.id.substring(0, 8)}</span>
                    <span style={styles.scoreBadge}>
                      评级: {work.ai_total_score?.toFixed(1)}
                    </span>
                  </div>
                  
                  {/* 文字截断预览 */}
                  <p style={styles.cardText}>
                    {work.text_content?.substring(0, 120)}
                    {work.text_content?.length > 120 ? '...' : ''}
                  </p>
                  
                  <div style={styles.cardFooter}>
                    {/* 🚨 触发弹窗的赏析入口 */}
                    <button onClick={() => setSelectedWork(work)} style={styles.readMoreBtn}>
                      📖 完整赏析
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      <style>{`
        @keyframes pulse {
          0% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(1.05); }
          100% { opacity: 1; transform: scale(1); }
        }
        
        /* 针对弹窗正文的滚动条美化 */
        .custom-scrollbar::-webkit-scrollbar {
          width: 8px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: #1f2937;
          border-radius: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #4b5563;
          border-radius: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #6b7280;
        }
      `}</style>
    </div>
  );
}

const styles = {
  container: { fontFamily: 'system-ui, sans-serif', backgroundColor: '#0a0a0a', minHeight: '100vh', color: '#e0e0e0', paddingBottom: '60px' },
  
  navbar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '15px 40px', backgroundColor: 'rgba(10, 10, 10, 0.8)', backdropFilter: 'blur(10px)', borderBottom: '1px solid #222', position: 'sticky', top: 0, zIndex: 100 },
  navLogoContainer: { display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer' },
  navLogoImg: { height: '32px', width: 'auto', objectFit: 'contain' },
  logo: { fontSize: '20px', fontWeight: 'bold', color: '#e0e0e0', letterSpacing: '-0.5px' },
  backBtn: { padding: '8px 16px', backgroundColor: 'transparent', color: '#888', border: '1px solid #333', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer', transition: 'all 0.2s' },

  hero: { padding: '80px 20px 40px', textAlign: 'center', borderBottom: '1px solid #111' },
  heroTitle: { fontSize: '42px', fontWeight: '900', color: '#ebcb8b', margin: '0 0 15px 0', letterSpacing: '2px' },
  heroSubtitle: { fontSize: '16px', color: '#888', letterSpacing: '1px' },

  main: { maxWidth: '1200px', margin: '0 auto', padding: '40px 20px' },
  statusBox: { textAlign: 'center', padding: '80px 20px', backgroundColor: '#111', borderRadius: '12px', border: '1px dashed #333', maxWidth: '600px', margin: '0 auto' },
  homeBtn: { marginTop: '20px', padding: '10px 24px', backgroundColor: '#4c566a', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' },

  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '30px' },
  
  card: { backgroundColor: '#111827', borderRadius: '12px', overflow: 'hidden', border: '1px solid #1f2937', transition: 'transform 0.2s, boxShadow 0.2s', boxShadow: '0 4px 6px rgba(0, 0, 0, 0.3)' },
  imageContainer: { position: 'relative', width: '100%', height: '220px', backgroundColor: '#000' },
  cardImage: { width: '100%', height: '100%', objectFit: 'cover', opacity: 0.9 },
  goldenBadge: { position: 'absolute', top: '15px', left: '15px', backgroundColor: '#fbbf24', color: '#000', padding: '6px 12px', fontSize: '11px', fontWeight: 'bold', borderRadius: '4px', boxShadow: '0 2px 10px rgba(0,0,0,0.5)' },
  
  cardBody: { padding: '24px' },
  cardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' },
  workId: { fontSize: '12px', color: '#6b7280', fontFamily: 'monospace' },
  scoreBadge: { fontSize: '13px', fontWeight: 'bold', color: '#10b981', backgroundColor: 'rgba(16, 185, 129, 0.1)', padding: '4px 10px', borderRadius: '20px', border: '1px solid rgba(16, 185, 129, 0.2)' },
  
  cardText: { fontSize: '14px', lineHeight: '1.8', color: '#9ca3af', marginBottom: '25px', textAlign: 'justify' },
  
  cardFooter: { borderTop: '1px solid #1f2937', paddingTop: '15px', display: 'flex', justifyContent: 'flex-end' },
  readMoreBtn: { background: 'none', border: 'none', color: '#818cf8', fontSize: '14px', fontWeight: 'bold', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px' },

  // ====================================
  // 🚨 弹窗专属样式 (Modal Styles)
  // ====================================
  modalOverlay: {
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    display: 'flex', justifyContent: 'center', alignItems: 'center',
    zIndex: 9999,
    backdropFilter: 'blur(5px)',
    padding: '20px'
  },
  modalContent: {
    backgroundColor: '#111827',
    border: '1px solid #374151',
    borderRadius: '16px',
    width: '100%',
    maxWidth: '900px',
    maxHeight: '90vh',
    display: 'flex',
    flexDirection: 'column',
    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7)'
  },
  modalHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '20px 30px',
    borderBottom: '1px solid #1f2937'
  },
  modalTitle: { margin: 0, fontSize: '20px', color: '#f3f4f6', display: 'flex', alignItems: 'center', gap: '10px' },
  modalId: { fontSize: '14px', color: '#6b7280', fontFamily: 'monospace', fontWeight: 'normal' },
  closeBtn: { background: 'none', border: 'none', color: '#9ca3af', fontSize: '28px', cursor: 'pointer', lineHeight: 1 },
  
  modalBody: {
    padding: '30px',
    overflowY: 'auto',
    className: 'custom-scrollbar'
  },
  modalScoreBar: {
    display: 'flex', gap: '15px', alignItems: 'center', marginBottom: '25px',
    backgroundColor: '#1f2937', padding: '12px 20px', borderRadius: '8px'
  },
  goldenBadgeInline: {
    backgroundColor: '#fbbf24', color: '#78350f', padding: '4px 10px',
    fontSize: '12px', fontWeight: 'bold', borderRadius: '4px', border: '1px solid #f59e0b'
  },
  
  modalTextContent: {
    fontSize: '16px',
    lineHeight: '2.0',
    color: '#d1d5db',
    whiteSpace: 'pre-wrap',
    textAlign: 'justify',
    marginBottom: '40px',
    padding: '0 10px'
  },
  
  modalImageGallery: {
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
    borderTop: '1px dashed #374151',
    paddingTop: '30px'
  },
  modalImageWrapper: {
    width: '100%',
    backgroundColor: '#000',
    borderRadius: '8px',
    overflow: 'hidden',
    border: '1px solid #1f2937'
  },
  modalImage: {
    width: '100%',
    height: 'auto',
    display: 'block'
  }
};
