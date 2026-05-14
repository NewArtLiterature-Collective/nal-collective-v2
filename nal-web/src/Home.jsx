import React from 'react';
import { useNavigate } from 'react-router-dom';

export default function Home() {
  const navigate = useNavigate();

  return (
    <div style={styles.container}>
      {/* 🧱 积木 1：顶部导航栏 */}
      <nav style={styles.navbar}>
        <div style={styles.logo}>NAL Collective</div>
        <div style={styles.navLinks}>
          <span style={styles.navLink}>大赛动态</span>
          {/* 🚨 修改点：添加点击跳转到展厅 */}
          <span 
            onClick={() => navigate('/gallery')} 
            style={{...styles.navLink, color: '#4f46e5', fontWeight: 'bold'}}
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
        <h1 style={styles.heroTitle}>
          汇聚先进技术和人类智慧<br/>
          为童书创作保驾护航
        </h1>
        <p style={styles.heroSubtitle}>
          NewArtLiterature - Collective 新艺文社数字化平台
        </p>
        
        {/* 🚨 新增：Hero 区的大按钮入口，引导直接进入展厅 */}
        <div style={{ marginTop: '40px', display: 'flex', gap: '20px' }}>
          <button 
            onClick={() => navigate('/gallery')} 
            style={styles.heroPrimaryBtn}
          >
            🏛️ 立即进入文学展厅
          </button>
          <button 
            onClick={() => navigate('/login?intent=contestant')} 
            style={styles.heroSecondaryBtn}
          >
            ✍️ 参与大赛投稿
          </button>
        </div>
      </header>

      {/* 🧱 积木 3：核心价值区 (Features) - 保持不变 */}
      {/* ... (中间代码省略，保持你原有的逻辑) ... */}

      {/* 🧱 积木 4：版本对比区 (Pricing) - 保持不变 */}
      {/* ... (中间代码省略，保持你原有的逻辑) ... */}

      {/* 🧱 积木 5：页脚 */}
      <footer style={styles.footer}>
        <div style={{ marginBottom: '20px', display: 'flex', justifyContent: 'center', gap: '30px' }}>
          <span onClick={() => navigate('/gallery')} style={{ cursor: 'pointer', fontSize: '14px' }}>作品展厅</span>
          <span style={{ fontSize: '14px' }}>关于我们</span>
          <span style={{ fontSize: '14px' }}>学术支持</span>
        </div>
        <p>© 2026 NewArtLiterature Collective. All rights reserved.</p>
        <p style={{fontSize: '12px', marginTop: '8px', color: '#6b7280'}}>数字时代的文学审美与插画艺术先锋</p>
      </footer>
    </div>
  );
}

// 🚨 样式补充：新增 Hero 按钮样式
const styles = {
  // ... (保留你原有的 styles) ...
  container: { fontFamily: 'system-ui, sans-serif', color: '#111827', overflowX: 'hidden' },
  navbar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 50px', backgroundColor: 'rgba(255,255,255,0.9)', backdropFilter: 'blur(10px)', position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100, borderBottom: '1px solid #f3f4f6' },
  logo: { fontSize: '22px', fontWeight: 'bold', color: '#4f46e5', letterSpacing: '-0.5px' },
  navLinks: { display: 'flex', gap: '30px', alignItems: 'center' },
  navLink: { color: '#4b5563', fontWeight: '500', cursor: 'pointer', fontSize: '15px', transition: 'color 0.2s' },
  loginBtn: { padding: '10px 24px', backgroundColor: '#111827', color: 'white', borderRadius: '10px', border: 'none', fontWeight: 'bold', cursor: 'pointer', fontSize: '14px' },
  
  hero: { minHeight: '80vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f9fafb', paddingTop: '60px', padding: '20px', textAlign: 'center' },
  heroTitle: { fontSize: '54px', fontWeight: '800', lineHeight: '1.2', marginBottom: '24px', maxWidth: '900px', background: 'linear-gradient(to right, #111827, #4f46e5)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', letterSpacing: '-1px' },
  heroSubtitle: { fontSize: '22px', color: '#6b7280', fontWeight: '500', letterSpacing: '1px' },

  // 🚨 新增样式
  heroPrimaryBtn: { padding: '16px 32px', backgroundColor: '#111827', color: 'white', borderRadius: '12px', border: 'none', fontWeight: 'bold', cursor: 'pointer', fontSize: '18px', boxShadow: '0 10px 20px rgba(0,0,0,0.1)' },
  heroSecondaryBtn: { padding: '16px 32px', backgroundColor: 'transparent', color: '#4f46e5', borderRadius: '12px', border: '2px solid #4f46e5', fontWeight: 'bold', cursor: 'pointer', fontSize: '18px' },

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

  footer: { padding: '60px 40px', textAlign: 'center', backgroundColor: '#111827', color: '#9ca3af', borderTop: '1px solid #374151' }
};
