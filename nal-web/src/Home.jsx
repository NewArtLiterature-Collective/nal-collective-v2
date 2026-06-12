import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import logo from './assets/nal_logo.png'; 
import { supabase } from './supabaseClient'; 

export default function Home() {
  const navigate = useNavigate();
  
  // 核心控制状态
  const [isContestActive, setIsContestActive] = useState(true);
  const [contestName, setContestName] = useState('');
  const [contestDescription, setContestDescription] = useState('');
  
  // 控制右上角动态下拉菜单的展开与收起
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  useEffect(() => {
    const fetchSiteSettings = async () => {
      try {
        // 🚨 阶梯 1：从总控配置中拉取信号指针
        const { data: settings, error: sErr } = await supabase
          .from('site_settings')
          .select('is_contest_active, current_contest_id')
          .eq('id', 1)
          .maybeSingle();
          
        if (!sErr && settings) {
          setIsContestActive(settings.is_contest_active);
          
          // 🚨 阶梯 2：如果有当前主赛季指针，立刻去全新的 contests 赛事表中抓取核心资产
          if (settings.current_contest_id) {
            const { data: contestData, error: cErr } = await supabase
              .from('contests')
              .select('name, description')
              .eq('id', settings.current_contest_id)
              .maybeSingle();
              
            if (!cErr && contestData) {
              setContestName(contestData.name || 'NAL 官方征文大赛');
              setContestDescription(contestData.description || '暂无详细征稿章程大纲描述。');
            }
          } else {
            setContestName('NAL 官方征文大赛');
            setContestDescription('暂无详细征稿章程大纲描述。');
          }
        }
      } catch (err) {
        console.error("⚠️ 首页联合检索全局赛事配置失败:", err);
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
          
          {/* 大赛动态绝对定位下拉容器 */}
          <div style={{ position: 'relative' }}>
            <span 
              onClick={() => setIsDropdownOpen(!isDropdownOpen)} 
              style={{ 
                ...styles.navLink, 
                color: isContestActive ? '#fbbf24' : '#4b5563', 
                fontWeight: 'bold',
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}
            >
              大赛动态 <span style={{ fontSize: '10px' }}>{isDropdownOpen ? '▲' : '▼'}</span>
            </span>

            {/* 下拉菜单面板 */}
            {isDropdownOpen && (
              <div style={styles.dropdownMenu}>
                {/* 已经完美关联上新创赛事表的数据标题 */}
                <h4 style={styles.dropdownTitle}>
                  {contestName}
                </h4>
                
                {isContestActive ? (
                  /* 激活状态 */
                  <>
                    <div style={styles.dropdownDivider}></div>
                    <p style={styles.dropdownDesc}>
                      {contestDescription}
                    </p>
                    <button 
                      onClick={() => { setIsDropdownOpen(false); navigate('/login?intent=contestant'); }}
                      style={styles.dropdownBtn}
                    >
                      🚀 立即报名参赛
                    </button>
                  </>
                ) : (
                  /* 历史或筹备状态 */
                  <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '6px' }}>
                    🌙 赛事通道已封存休眠
                  </div>
                )}
              </div>
            )}
          </div>
          
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

      <footer style={styles.footer}>
        <p>© 2026 NewArtLiterature Collective. All rights reserved.</p>
        <p style={{fontSize: '12px', marginTop: '8px', color: '#6b7280'}}>数字时代的文学审美与插画艺术先锋</p>
      </footer>
    </div>
  );
}

const styles = {
  container: { fontFamily: 'system-ui, sans-serif', color: '#111827', overflowX: 'hidden' },
  navbar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '15px 50px', backgroundColor: 'rgba(255,255,255,0.9)', backdropFilter: 'blur(10px)', position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100, borderBottom: '1px solid #f3f4f6' },
  navLogoContainer: { display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer' },
  navLogoImg: { height: '38px', width: 'auto', objectFit: 'contain' },
  logo: { fontSize: '22px', fontWeight: 'bold', color: '#4f46e5', letterSpacing: '-0.5px' },
  navLinks: { display: 'flex', gap: '30px', alignItems: 'center' },
  navLink: { color: '#4b5563', fontWeight: '500', cursor: 'pointer', fontSize: '15px', userSelect: 'none' },
  loginBtn: { padding: '10px 24px', backgroundColor: '#111827', color: 'white', borderRadius: '10px', border: 'none', fontWeight: 'bold', cursor: 'pointer', fontSize: '14px' },
  hero: { minHeight: '85vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f9fafb', paddingTop: '100px', padding: '20px', textAlign: 'center' },
  heroLogoImg: { width: '180px', height: 'auto', marginBottom: '24px', objectFit: 'contain' },
  heroTitle: { fontSize: '54px', fontWeight: '800', lineHeight: '1.2', marginBottom: '24px', maxWidth: '900px', background: 'linear-gradient(to right, #111827, #4f46e5)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', letterSpacing: '-1px' },
  heroSubtitle: { fontSize: '22px', color: '#6b7280', fontWeight: '500', letterSpacing: '1px' },
  section: { padding: '100px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', backgroundColor: 'white' },
  sectionTitle: { fontSize: '36px', fontWeight: 'bold', marginBottom: '60px', textAlign: 'center' },
  grid: { display: 'flex', gap: '30px', maxWidth: '1200px', width: '100%', flexWrap: 'wrap', justifyContent: 'center' },
  featureCard: { flex: '1 1 300px', padding: '40px 30px', backgroundColor: '#f9fafb', borderRadius: '16px', border: '1px solid #f3f4f6', cursor: 'default' },
  featureIcon: { fontSize: '40px', marginBottom: '20px' },
  featureTitle: { fontSize: '22px', fontWeight: 'bold', marginBottom: '15px' },
  featureDesc: { color: '#6b7280', lineHeight: '1.6' },
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
  footer: { padding: '60px 40px', textAlign: 'center', backgroundColor: '#111827', color: '#9ca3af', borderTop: '1px solid #374151' },

  dropdownMenu: { 
    position: 'absolute', 
    top: 'calc(100% + 15px)', 
    right: '0', 
    backgroundColor: '#111827', 
    border: '1px solid #374151', 
    borderRadius: '12px', 
    padding: '18px', 
    width: '320px', 
    boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 10px 10px -5px rgba(0, 0, 0, 0.4)', 
    zIndex: 500,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start'
  },
  dropdownTitle: { margin: 0, fontSize: '15px', color: '#fbbf24', fontWeight: 'bold', textAlign: 'left', lineHeight: '1.4' },
  dropdownDivider: { width: '100%', height: '1px', backgroundColor: '#1f2937', margin: '10px 0' },
  dropdownDesc: { margin: '0 0 14px 0', color: '#d8dee9', fontSize: '12px', lineHeight: '1.6', textAlign: 'left', whiteSpace: 'pre-wrap', maxHeight: '180px', overflowY: 'auto', width: '100%' },
  dropdownBtn: { width: '100%', padding: '10px', backgroundColor: '#10b981', color: 'white', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer', fontSize: '13px', textAlign: 'center', boxShadow: '0 4px 12px rgba(16, 185, 129, 0.15)' }
};
