import React, { useState, useEffect } from 'react'; // ✅ 确保导入了 hooks
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from './supabaseClient';

const Gallery = ({ session }) => {
  const navigate = useNavigate();
  const location = useLocation();
  
  // 1. 核心状态：直接从 prop 获取 user，不需要重复定义 useState
  const user = session?.user || null;

  // 2. 展厅数据状态
  const [loading, setLoading] = useState(true);
  const [works, setWorks] = useState([]);

  useEffect(() => {
    // 模拟或实际拉取数据
    const fetchWorks = async () => {
      setLoading(true);
      // 这里未来可以放置你的 Supabase 查询逻辑
      setLoading(false);
    };
    fetchWorks();
  }, []);

  // 动态处理返回/进入按钮逻辑
  const renderNavButtons = () => {
    if (user) {
      // 场景 A：用户已登录，显示返回工作台
      return (
        <button 
          onClick={() => navigate('/dashboard')} 
          className="text-stone-600 hover:text-indigo-600 transition-colors flex items-center"
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSzie: '14px' }}
        >
          <span className="mr-2">🏛️</span> 返回工作台 (Dashboard)
        </button>
      );
    } else {
      // 场景 B：访客身份，显示返回首页和登录
      return (
        <div style={{ display: 'flex', gap: '15px' }}>
          <button 
            onClick={() => navigate('/')} 
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#78716c' }}
          >
            ← 返回首页
          </button>
          <button 
            onClick={() => navigate('/login')} 
            style={{ backgroundColor: '#1c1917', color: 'white', padding: '6px 12px', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '13px' }}
          >
            登录/参与投稿
          </button>
        </div>
      );
    }
  };

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#fafaf9' }}>
      {/* 顶部导航栏 */}
      <header style={{ padding: '20px 40px', borderBottom: '1px solid #e7e5e4', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#fff' }}>
        {renderNavButtons()}
        <h1 style={{ fontSize: '1.25rem', fontWeight: '300', letterSpacing: '0.1em', margin: 0 }}>NAL EXHIBITION</h1>
        <div style={{ width: '100px' }}></div> {/* 抵消左侧按钮宽度，保持标题居中 */}
      </header>

      {/* 展厅主内容区 */}
      <main style={{ maxWidth: '1200px', margin: '0 auto', padding: '60px 20px' }}>
        {loading ? (
          <div style={{ textAlign: 'center', color: '#a8a29e', marginTop: '100px' }}>🏛️ 正在布置 NAL 文学展厅...</div>
        ) : (
          <section>
            {/* 这里放置你之前的 grid 布局逻辑来展示作品 */}
            <div style={{ textAlign: 'center', color: '#d6d3d1', padding: '100px', border: '1px dashed #e7e5e4' }}>
              暂无入选作品，评审 Agent 正在交叉会诊中...
            </div>
          </section>
        )}
      </main>
    </div>
  );
};

export default Gallery;
