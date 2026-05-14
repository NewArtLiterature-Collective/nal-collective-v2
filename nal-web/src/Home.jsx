import React from 'react';
import { useNavigate } from 'react-router-dom';

export default function Home() {
  const navigate = useNavigate();

  return (
    <div style={styles.container}>
      {/* 1. 顶部导航栏 */}
      <nav style={styles.navbar}>
        <div style={styles.logo}>NAL Collective</div>
        <div style={styles.navLinks}>
          <span style={styles.navLink}>大赛动态</span>
          {/* ✅ 修复：点击进入展厅 */}
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
  
      {/* 2. 首屏视觉区 (Hero) */}
      <header style={styles.hero}>
        <h1 style={styles.heroTitle}>
          汇聚先进技术和人类智慧<br/>
          为童书创作保驾护航
        </h1>
        <p style={styles.heroSubtitle}>
          NewArtLiterature - Collective 新艺文社数字化平台
        </p>
        {/* ✅ 修复：Hero 区的大按钮入口 */}
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

      {/* 3. 核心价值区 (Features) - 完整保留 */}
      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>突破传统，重塑童心叙事</h2>
        <div style={styles.grid}>
          <div style={styles.featureCard}>
            <div style={styles.featureIcon}>📝</div>
            <h3 style={styles.featureTitle}>深度文本评审</h3>
            <p style={styles.featureDesc}>精准识别刻板说教与“人造儿童”现象，提供具有双重阅读价值的文学修改建议。</p>
          </div>
          <div style={styles.featureCard}>
            <div style={styles.featureIcon}>🎨</div>
            <h3 style={styles.featureTitle}>绘本分镜解析</h3>
            <p style={styles.featureDesc}>多维度评估插画视觉张力与图文互文效果，打破“弱文本”的绘本创作瓶颈。</p>
          </div>
          <div style={styles.featureCard}>
            <div style={styles.featureIcon}>🧠</div>
            <h3 style={styles.featureTitle}>七大专家模型</h3>
            <p style={styles.featureDesc}>独家内置“首席专家锐评”、“宽泛理论”等 7 个垂直学术模型，多视角交叉会诊。</p>
          </div>
        </div>
      </section>

      {/* 4. 版本对比区 (Pricing) - 完整保留 */}
      <section style={{...styles.section, backgroundColor: '#f3f4f6'}}>
        <h2 style={styles.sectionTitle}>选择您的创作通行证</h2>
        <div style={styles.pricingGrid}>
          <div style={styles.pricingCard}>
            <h3 style={styles.planName}>☕ 普通用户</h3>
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

          <div style={{...styles.pricingCard, border: '2px solid #4f46e5', transform: 'scale(1.05)', zIndex: 10}}>
            <div style={styles.popularBadge}>2026 评审季推荐</div>
            <h3 style={styles.planName}>🏆 参赛选手</h3>
            <div style={styles.planPrice}>￥10 <span style={styles.priceUnit}>/ 报名费</span></div>
            <ul style={styles.planFeatures}>
              <li>✓ 获得大赛官方作品提交资格</li>
              <li>✓ 赠送各项高级权益各 5 次</li>
              <li>✓ 解锁 <b>高级文学引擎</b></li>
              <li>✓ 支持 150KB 文档 / 5张图片</li>
              <li>✓ 提供约 300 字高光片段试写</li>
            </ul>
            <button onClick={() => navigate('/login?intent=contestant')} style={styles.planBtnContest}>立即报名参赛</button>
          </div>

          <div style={{...styles.pricingCard, background: '#111827', color: 'white'}}>
            <h3 style={{...styles.planName, color: '#a78bfa'}}>✨ 专业会员</h3>
            <div style={styles.planPrice}>￥500 <span style={{...styles.priceUnit, color: '#9ca3af'}}>/ 年</span></div>
            <ul style={{...styles.planFeatures, color: '#d1d5db'}}>
              <li>✓ <b>包含参赛资格及所有评审功能</b></li>
              <li>✓ 解锁 <b>文学专业旗舰算力</b></li>
              <li>✓ 解锁全部 7 个细分学术模型</li>
              <li>✓ 支持 200MB 巨型文档 / 50张图片</li>
              <li>✓ 提供约 800 字深度高光片段试写</li>
            </ul>
            <button onClick={() => navigate('/login?intent=pro')} style={styles.planBtnPro}>升级专业会员</button>
          </div>
        </div>
      </section>

      {/* 5. 页脚 */}
      <footer style={styles.footer}>
        <div style={{ marginBottom: '20px', display: 'flex', justifyContent: 'center', gap: '30px' }}>
          <span onClick={() => navigate('/gallery')} style={{ cursor: 'pointer', fontSize: '14px' }}>作品展厅</span>
        </div>
        <p>© 2026 NewArtLiterature Collective. All rights reserved.</p>
        <p style={{fontSize: '12px', marginTop: '8px', color: '#6b7280'}}>数字时代的文学审美与插画艺术先锋</p>
      </footer>
    </div>
  );
}

// 样式对象 (包含所有必要样式)
const styles = {
  container: { fontFamily: 'system-ui, sans-serif', color: '#111827', overflowX: 'hidden' },
  navbar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 50px', backgroundColor: 'rgba(255,255,255,0.9)', backdropFilter: 'blur(10px)', position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100, borderBottom: '1px solid #f3f4f6' },
  logo: { fontSize: '22px', fontWeight: 'bold', color: '#4f46e5', letterSpacing: '-0.5px' },
  navLinks: { display: 'flex', gap: '30px', alignItems: 'center' },
  navLink: { color: '#4b5563', fontWeight: '500', cursor: 'pointer', fontSize: '15px' },
  loginBtn: { padding: '10px 24px', backgroundColor: '#111827', color: 'white', borderRadius: '10px', border: 'none', fontWeight: 'bold', cursor: 'pointer', fontSize: '14px' },
  hero: { minHeight: '80vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f9fafb', paddingTop: '60px', padding: '20px', textAlign: 'center' },
  heroTitle: { fontSize: '54px', fontWeight: '800', lineHeight: '1.2', marginBottom: '24px', maxWidth: '900px', background: 'linear-gradient(to right, #111827, #4f46e5)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', letterSpacing: '-1px' },
  heroSubtitle: { fontSize: '22px', color: '#6b7280', fontWeight: '500', letterSpacing: '1px' },
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
