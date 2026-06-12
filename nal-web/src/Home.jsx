import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import logo from './assets/nal_logo.png'; 
import { supabase } from './supabaseClient'; 

export default function Home() {
  const navigate = useNavigate();
  
  // 🌟 状态扩展：除了开关，同时容纳赛事的名称与文案
  const [isContestActive, setIsContestActive] = useState(true);
  const [contestName, setContestName] = useState('');
  const [contestDescription, setContestDescription] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchSiteSettings = async () => {
      try {
        const { data, error } = await supabase
          .from('site_settings')
          .select('is_contest_active, contest_name, contest_description')
          .single();
          
        if (!error && data) {
          setIsContestActive(data.is_contest_active);
          setContestName(data.contest_name || 'NAL 年度精选文学赏');
          setContestDescription(data.contest_description || '');
        }
      } catch (err) {
        console.error("⚠️ 首页获取全局赛事配置失败:", err);
      } finally {
        setIsLoading(false);
      }
    };
    
    fetchSiteSettings();
  }, []);

  return (
    <div style={styles.container}>
      {/* 🧱 积木 1：顶部导航栏 */}
      <nav style={styles.navbar}>
        <div style={styles.navLogoContainer} onClick={() => window.location.reload()}>
          <img src={logo} alt="NAL Logo" style={styles.navLogoImg} />
          <div style={styles.logo}>NAL Collective</div>
        </div>
        <div style={styles.navLinks}>
          {/* 🚨 核心改动：解除隐藏封印，永远展示大赛动态入口 */}
          <span style={{...styles.navLink, color: '#fbbf24', fontWeight: 'bold'}}>大赛动态</span>
          
          <span 
            onClick={() => navigate('/gallery')} 
            style={{...styles.navLink, color: '#4f46e5', fontWeight: 'bold', cursor: 'pointer'}}
          >
            作品展厅
          </span>
          <button onClick={() => navigate('/login')} style={styles.loginBtn}>
            登录 / 注册
          </button>
        </div>
      </nav>
  
      {/* 🧱 积木 2：首屏视觉区 (Hero) */}
      <header style={styles.hero}>
        <img src={logo} alt="New Art Literature Collective" style={styles.heroLogoImg} />
        
        <h1 style={styles.heroTitle}>
          汇聚先进技术和人类智慧<br/>
          为童书创作保驾护航
        </h1>
        <p style={styles.heroSubtitle}>
          NewArtLiterature - Collective 新艺文社数字化平台
        </p>
      </header>

      {/* 🧱 积木 2.5：🌟 全局常驻的大赛动态门户 (Contest Portal) 🌟 */}
      <section style={{ padding: '80px 20px', backgroundColor: '#0a0a0a', color: '#fff', textAlign: 'center' }}>
        <div style={{ maxWidth: '800px', margin: '0 auto' }}>
          
          {isLoading ? (
            <div style={{ padding: '40px', color: '#64748b' }}>
              <span style={{ animation: 'pulse 1.5s infinite' }}>📡 正在同步 NAL 最新赛事数据...</span>
            </div>
          ) : (
            <>
              {/* 核心逻辑 1：无论赛事是否激活，永远高亮展示主赛事名称 */}
              <h2 style={{ fontSize: '38px', color: '#fbbf24', marginBottom: '30px', fontWeight: '900', letterSpacing: '-1px' }}>
                {contestName || 'NAL 年度精选文学赏'}
              </h2>

              {isContestActive ? (
                /* 核心逻辑 2：激活状态（展示火热的标签、具体章程与入口） */
                <div style={{
                  backgroundColor: '#111827', border: '1px solid #374151', borderRadius: '16px', 
                  padding: '40px', boxShadow: '0 10px 40px rgba(0,0,0,0.5)', transition: 'all 0.3s ease'
                }}>
                  <div style={{ display: 'inline-block', padding: '6px 16px', background: '#ef4444', color: '#fff', fontSize: '14px', fontWeight: 'bold', borderRadius: '6px', marginBottom: '25px' }}>
                    🔥 官方征稿火热进行中
                  </div>
                  
                  <div style={{
                    fontSize: '16px', lineHeight: '2.0', color: '#d8dee9', textAlign: 'left', 
                    whiteSpace: 'pre-wrap', marginBottom: '35px', backgroundColor: 'rgba(0,0,0,0.2)', 
                    padding: '25px', borderRadius: '12px'
                  }}>
                    {contestDescription}
                  </div>
                  
                  <button
                    onClick={() => navigate('/login?intent=contestant')}
                    style={{
                      padding: '16px 40px', backgroundColor: '#10b981', color: '#fff',
                      border: 'none', borderRadius: '8px', fontSize: '18px', fontWeight: 'bold',
                      cursor: 'pointer', boxShadow: '0 4px 15px rgba(16, 185, 129, 0.3)'
                    }}
                  >
                    🚀 进入系统 · 立即投稿
                  </button>
                </div>
              ) : (
                /* 核心逻辑 3：休眠状态（隐藏章程，显示高冷占位提示） */
                <div style={{
                  backgroundColor: 'rgba(255,255,255,0.02)', border: '1px dashed #333', 
                  borderRadius: '16px', padding: '50px 30px'
                }}>
                  <div style={{ fontSize: '20px', color: '#6b7280', marginBottom: '15px', fontWeight: 'bold' }}>
                    🌙 赛事周期已休眠 / 筹备中
                  </div>
                  <p style={{ color: '#4b5563', lineHeight: '1.8', margin: '0 auto', maxWidth: '500px' }}>
                    本届文学赛事目前暂未开放征稿。详情章程与评审通道已封存。<br/>
                    请持续关注 NAL 评审委员会的官方公告，新的文学纪元正在酝酿。
                  </p>
                  <button
                    onClick={() => navigate('/login')}
                    style={{
                      marginTop: '30px', padding: '12px 28px', backgroundColor: 'transparent',
                      color: '#6b7280', border: '1px solid #4b5563', borderRadius: '8px',
                      cursor: 'pointer', fontSize: '15px', fontWeight: 'bold'
                    }}
                  >
                    前往个人中心
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </section>

      {/* 🧱 积木 3：核心价值区 (Features) */}
      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>突破传统，重塑童心叙事</h2>
        <div style={styles.grid}>
          <div style={styles.featureCard}>
            <div style={styles.featureIcon}><span role="img" aria-label="text">📝</span></div>
            <h3 style={styles.featureTitle}>深度文本评审</h3>
            <p style={styles.featureDesc}>精准识别刻板说教与“人造儿童”现象，提供具有双重阅读价值的文学修改建议。</p>
          </div>
          <div style={styles.featureCard}>
            <div style={styles.featureIcon}><span role="img" aria-label="paint">🎨</span></div>
            <h3 style={styles.featureTitle}>绘本分镜解析</h3>
            <p style={styles.featureDesc}>多维度评估插画视觉张力与图文互文效果，打破“弱文本”的绘本创作瓶颈。</p>
          </div>
          <div style={styles.featureCard}>
            <div style={styles.featureIcon}><span role="img" aria-label="brain">🧠</span></div>
            <h3 style={styles.featureTitle}>七大专家模型</h3>
            <p style={styles.featureDesc}>独家内置“首席专家锐评”、“宽泛理论”等 7 个垂直学术模型，多视角交叉会诊。</p>
          </div>
        </div>
      </section>

      {/* 🧱 积木 4：版本对比区 (Pricing) */}
      <section style={{...styles.section, backgroundColor: '#f3f4f6'}}>
        <h2 style={styles.sectionTitle}>选择您的创作通行证</h2>
        <div style={styles.pricingGrid}>
          
          {/* 普通用户卡片 */}
          <div style={styles.pricingCard}>
            <h3 style={styles.planName}><span role="img" aria-label="free">☕</span> 普通用户</h3>
            <div style={styles.planPrice}>免费体验</div>
            <ul style={styles.planFeatures}>
              <li>✓ 默认赠送 5 次基础算力</li>
              <li>✓ 支持 50KB Word 文档</li>
              <li>✓ 单次最多 2 张评审图片 (限1MB)</li>
              <li>✓ 仅限使用 2 个通用模型</li>
              <li>✗ 仅提供大纲，无高光片段试写</li>
            </ul>
            <button onClick={() => navigate('/login')} style={styles.planBtnFree}>立即注册</button>
          </div>

          {/* 参赛选手卡片 */}
          {isContestActive && (
            <div style={{...styles.pricingCard, border: '2px solid #4f46e5', transform: 'scale(1.05)', zIndex: 10}}>
              <div style={styles.popularBadge}>2026 评审季推荐</div>
              <h3 style={styles.planName}><span role="img" aria-label="contestant">🏆</span> 参赛选手</h3>
              <div style={styles.planPrice}>￥10 <span style={styles.priceUnit}>/ 报名费</span></div>
              <ul style={styles.planFeatures}>
                <li>✓ 获得大赛官方作品提交资格</li>
                <li>✓ 赠送高级权益 5 次</li>
                <li>✓ 解锁 <b>高级文学引擎</b></li>
                <li>✓ 支持 150KB 文档 / 5张图片</li>
                <li>✓ 提供约 300 字高光片段试写</li>
              </ul>
              <button onClick={() => navigate('/login?intent=contestant')} style={styles.planBtnContest}>立即报名参赛</button>
            </div>
          )}

          {/* 专业会员卡片 */}
          <div style={{...styles.pricingCard, background: '#111827', color: 'white'}}>
            <h3 style={{...styles.planName, color: '#a78bfa'}}><span role="img" aria-label="pro">✨</span> 专业会员</h3>
            <div style={styles.planPrice}>￥500 <span style={{...styles.priceUnit, color: '#9ca3af'}}>/ 年</span></div>
            <ul style={{...styles.planFeatures, color: '#d1d5db'}}>
              <li>✓ <b>{isContestActive ? "包含参赛资格及所有评审功能" : "完全解锁全场景深度视觉与文本评审"}</b></li>
              <li>✓ 解锁 <b>文学专业旗舰算力</b></li>
              <li>✓ 解锁全部 7 个细分学术模型</li>
              <li>✓ 支持 100MB 巨型文档 / 50张图片</li>
              <li>✓ 提供约 800 字深度高光片段试写</li>
            </ul>
            <button onClick={() => navigate('/login?intent=pro')} style={styles.planBtnPro}>升级专业会员</button>
          </div>

        </div>
      </section>

      {/* 🧱 积木 5：页脚 */}
      <footer style={styles.footer}>
        <p>© 2026 NewArtLiterature Collective. All rights reserved.</p>
        <p style={{fontSize: '12px', marginTop: '8px', color: '#6b7280'}}>数字时代的文学审美与插画艺术先锋</p>
      </footer>

      {/* 内部闪烁效果 CSS */}
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
  container: { fontFamily: 'system-ui, sans-serif', color: '#111827', overflowX: 'hidden' },
  
  // 🏢 导航栏
  navbar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '15px 50px', backgroundColor: 'rgba(255,255,255,0.9)', backdropFilter: 'blur(10px)', position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100, borderBottom: '1px solid #f3f4f6' },
  navLogoContainer: { display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer' },
  navLogoImg: { height: '38px', width: 'auto', objectFit: 'contain' },
  logo: { fontSize: '22px', fontWeight: 'bold', color: '#4f46e5', letterSpacing: '-0.5px' },
  navLinks: { display: 'flex', gap: '30px', alignItems: 'center' },
  navLink: { color: '#4b5563', fontWeight: '500', cursor: 'pointer', fontSize: '15px', transition: 'color 0.2s' },
  loginBtn: { padding: '10px 24px', backgroundColor: '#111827', color: 'white', borderRadius: '10px', border: 'none', fontWeight: 'bold', cursor: 'pointer', fontSize: '14px' },
  
  // 🚀 主视觉迎宾区
  hero: { minHeight: '85vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f9fafb', paddingTop: '100px', padding: '20px', textAlign: 'center' },
  heroLogoImg: { width: '180px', height: 'auto', marginBottom: '24px', objectFit: 'contain' },
  heroTitle: { fontSize: '54px', fontWeight: '800', lineHeight: '1.2', marginBottom: '24px', maxWidth: '900px', background: 'linear-gradient(to right, #111827, #4f46e5)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', letterSpacing: '-1px' },
  heroSubtitle: { fontSize: '22px', color: '#6b7280', fontWeight: '500', letterSpacing: '1px' },
  
  // 🧩 特性版块
  section: { padding: '100px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', backgroundColor: 'white' },
  sectionTitle: { fontSize: '36px', fontWeight: 'bold', marginBottom: '60px', textAlign: 'center' },
  grid: { display: 'flex', gap: '30px', maxWidth: '1200px', width: '100%', flexWrap: 'wrap', justifyContent: 'center' },
  featureCard: { flex: '1 1 300px', padding: '40px 30px', backgroundColor: '#f9fafb', borderRadius: '16px', border: '1px solid #f3f4f6', cursor: 'default' },
  featureIcon: { fontSize: '40px', marginBottom: '20px' },
  featureTitle: { fontSize: '22px', fontWeight: 'bold', marginBottom: '15px' },
  featureDesc: { color: '#6b7280', lineHeight: '1.6' },
  
  // 💰 计费版块
  pricingGrid: { display: 'flex', gap: '30px', maxWidth: '1100px', width: '100%', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap' },
  pricingCard: { flex: '1 1 300px', padding: '40px', backgroundColor: 'white', borderRadius: '24px', border: '1px solid #e5e7eb', position: 'relative', transition: 'all 0.3s ease' },
  popularBadge: { position: 'absolute', top: '-15px', left: '50%', transform: 'translateX(-50%)', backgroundColor: '#4f46e5', color: 'white', padding: '6px 16px', borderRadius: '20px', fontSize: '12px', fontWeight: 'bold' },
  planName: { fontSize: '20px', fontWeight: 'bold', marginBottom: '15px' },
  planPrice: { fontSize: '36px', fontWeight: '900', marginBottom: '30px' },
  priceUnit: { fontSize: '16px', fontWeight: 'normal', color: '#6b7280' },
  planFeatures: { listStyle: 'none', padding: 0, margin: '0 0 30px 0', lineHeight: '2.4', color: '#4b5563', fontSize: '14px' },
  planBtnFree: { width: '100%', padding: '14px', backgroundColor: '#f3f4f6', color: '#111827', border: 'none', borderRadius: '12px', fontWeight: 'bold', cursor: 'pointer' },
  planBtnContest: { width: '100%', padding: '14px', backgroundColor: '#4f46e5', color: 'white', border: 'none', borderRadius: '12px', fontWeight: 'bold', cursor: 'pointer' },
  planBtnPro: { width: '100%', padding: '14px', backgroundColor: 'transparent', color: '#a78bfa', border: '2px solid #a78bfa', borderRadius: '12px', fontWeight: 'bold', cursor: 'pointer' },
  
  // 🗺️ 页脚
  footer: { padding: '60px 40px', textAlign: 'center', backgroundColor: '#111827', color: '#9ca3af', borderTop: '1px solid #374151' }
};
