import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from './supabaseClient';

const Gallery = ({ session }) => {
  const navigate = useNavigate();
  const user = session?.user || null;

  const [loading, setLoading] = useState(true);
  const [works, setWorks] = useState([]);

  useEffect(() => {
    fetchGalleryWorks();
  }, []);

  const fetchGalleryWorks = async () => {
    setLoading(true);
    try {
      // 🚨 核心修改：直接从数据库读取入选作品
      const { data, error } = await supabase
        .from('contest_submissions')
        .select('id, text_content, image_urls, ai_total_score, created_at')
        .eq('status', 'success') // 只抓取入选的作品
        .order('created_at', { ascending: false });

      if (error) throw error;
      if (data) setWorks(data);
    } catch (err) {
      console.error("加载展厅失败:", err.message);
    } finally {
      setLoading(false);
    }
  };

  const renderNavButtons = () => {
    if (user) {
      return (
        <button onClick={() => navigate('/dashboard')} style={styles.navBtn}>
          <span style={{ marginRight: '8px' }}>🏛️</span> 返回工作台
        </button>
      );
    }
    return (
      <div style={{ display: 'flex', gap: '15px' }}>
        <button onClick={() => navigate('/')} style={styles.textBtn}>← 返回首页</button>
        <button onClick={() => navigate('/login')} style={styles.primaryBtn}>登录/参与投稿</button>
      </div>
    );
  };

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#fafaf9', color: '#1c1917' }}>
      <header style={styles.header}>
        {renderNavButtons()}
        <h1 style={styles.title}>NAL EXHIBITION</h1>
        <div style={{ width: '100px' }}></div>
      </header>

      <main style={styles.container}>
        {loading ? (
          <div style={styles.emptyState}>🏛️ 正在布置 NAL 文学展厅...</div>
        ) : works.length === 0 ? (
          <div style={styles.emptyState}>暂无入选作品，评审 Agent 正在交叉会诊中...</div>
        ) : (
          /* 🎨 渲染作品网格 */
          <div style={styles.grid}>
            {works.map((work) => (
              <div key={work.id} style={styles.card}>
                {work.image_urls && work.image_urls[0] && (
                  <img src={work.image_urls[0]} alt="作品插画" style={styles.image} />
                )}
                <div style={styles.cardContent}>
                  <div style={styles.cardHeader}>
                    <span style={styles.workId}>ID: {work.id.substring(0, 8)}</span>
                    <span style={styles.score}>⭐ {work.score || work.ai_total_score?.toFixed(1) || 'N/A'}</span>
                  </div>
                  <p style={styles.excerpt}>
                    {work.text_content.substring(0, 100)}...
                  </p>
                  <div style={styles.cardFooter}>
                    {new Date(work.created_at).toLocaleDateString()} · NAL 馆藏
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
};

const styles = {
  header: { padding: '20px 40px', borderBottom: '1px solid #e7e5e4', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#fff', position: 'sticky', top: 0, zIndex: 10 },
  title: { fontSize: '1.25rem', fontWeight: '300', letterSpacing: '0.2em' },
  navBtn: { background: 'none', border: 'none', cursor: 'pointer', color: '#57534e', fontSize: '14px', display: 'flex', alignItems: 'center' },
  textBtn: { background: 'none', border: 'none', cursor: 'pointer', color: '#78716c' },
  primaryBtn: { backgroundColor: '#1c1917', color: 'white', padding: '6px 16px', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '13px' },
  container: { maxWidth: '1200px', margin: '0 auto', padding: '60px 20px' },
  emptyState: { textAlign: 'center', color: '#a8a29e', marginTop: '100px', padding: '40px', border: '1px dashed #e7e5e4' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '30px' },
  card: { backgroundColor: '#fff', border: '1px solid #e7e5e4', borderRadius: '8px', overflow: 'hidden', transition: 'transform 0.2s' },
  image: { width: '100%', height: '200px', objectFit: 'cover', borderBottom: '1px solid #e7e5e4' },
  cardContent: { padding: '20px' },
  cardHeader: { display: 'flex', justifyContent: 'space-between', marginBottom: '10px' },
  workId: { fontSize: '12px', color: '#a8a29e', fontFamily: 'monospace' },
  score: { fontSize: '14px', fontWeight: 'bold', color: '#10b981' },
  excerpt: { fontSize: '14px', lineHeight: '1.6', color: '#444', height: '68px', overflow: 'hidden' },
  cardFooter: { marginTop: '15px', paddingTop: '15px', borderTop: '1px solid #f5f5f4', fontSize: '11px', color: '#a8a29e' }
};

export default Gallery;
