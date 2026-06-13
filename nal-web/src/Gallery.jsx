import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from './supabaseClient';
import logo from './assets/nal_logo.png';

export default function Gallery() {
  const navigate = useNavigate();
  
  // 核心状态矩阵
  const [works, setWorks] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  
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
        // 阶段 1：校验时空大闸与赛季状态
        // ==========================================
        const { data: settings, error: sErr } = await supabase
          .from('site_settings')
          .select('is_contest_active, current_contest_id, gallery_start_time, gallery_end_time')
          .eq('id', 1)
          .maybeSingle();

        if (sErr) throw sErr;

        let activeContestId = null;

        if (settings) {
          activeContestId = settings.current_contest_id;
          const now = new Date();
          const start = settings.gallery_start_time ? new Date(settings.gallery_start_time) : null;
          const end = settings.gallery_end_time ? new Date(settings.gallery_end_time) : null;

          // 时间逻辑门禁
          if (start && now < start) {
            setGalleryState({ isOpen: false, message: `⏳ 展厅尚未开放。\n本届展厅启封时间：${start.toLocaleDateString()}` });
            setIsLoading(false);
            return;
          }
          if (end && now > end) {
            setGalleryState({ isOpen: false, message: '🌙 本届数字展厅已闭馆，感谢您的关注。' });
            setIsLoading(false);
            return;
          }
        }

        // 提取当前赛季名称
        if (activeContestId) {
          const { data: contestData } = await supabase
            .from('contests')
            .select('name')
            .eq('id', activeContestId)
            .maybeSingle();
          if (contestData) {
            setGalleryState(prev => ({ ...prev, contestName: contestData.name }));
          }
        }

        // ==========================================
        // 阶段 2：策展门禁查询（🚨 纯正的双引擎混合工作流）
        // ==========================================
        const { data: submissions, error: subErr } = await supabase
          .from('contest_submissions')
          .select('id, text_content, image_urls, ai_total_score, is_manual_recommended, manual_rank, exhibition_ready, created_at')
          // 条件 1：必须是处理成功的作品
          .eq('status', 'success')
          // 条件 2：当前激活赛季的数据隔离
          .eq('contest_id', activeContestId)
          // 🚨 条件 3：混合双轨准入机制 —— 后台算力划定的 Top 5% 门槛，【或者】主编人工推举金标
          .or('exhibition_ready.eq.true,is_manual_recommended.eq.true')
          // 排序 1：优先按后台管理员手动赋予的 rank 权重排位
          .order('manual_rank', { ascending: false })
          // 排序 2：同等权重下，按 AI 分数从高到低自然排序
          .order('ai_total_score', { ascending: false });

        if (subErr) throw subErr;

        setWorks(submissions || []);
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
              📡 正在通过防火墙提取典藏作品序列...
            </span>
          </div>
        ) : !galleryState.isOpen ? (
          <div style={styles.statusBox}>
            <div style={{ fontSize: '24px', color: '#4c566a', marginBottom: '15px' }}>🔒</div>
            <div style={{ whiteSpace: 'pre-wrap', color: '#d8dee9', lineHeight: '1.6' }}>
              {galleryState.message}
            </div>
            <button onClick={() => navigate('/')} style={styles.homeBtn}>返回首页</button>
          </div>
        ) : works.length === 0 ? (
          <div style={styles.statusBox}>
            <div style={{ fontSize: '24px', color: '#4c566a', marginBottom: '15px' }}>📭</div>
            <div style={{ color: '#d8dee9' }}>
              当前展厅暂无展品。所有投稿均在进行严苛的算法共治与离线会诊中。
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
                    <img src={work.image_urls[0]} alt="作品插图" style={styles.cardImage} />
                    {/* 左上角特权角标 */}
                    {work.is_manual_recommended && (
                      <div style={styles.goldenBadge}>💎 主编特别推举</div>
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
                    <button style={styles.readMoreBtn}>📖 完整赏析</button>
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
  readMoreBtn: { background: 'none', border: 'none', color: '#818cf8', fontSize: '14px', fontWeight: 'bold', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px' }
};
