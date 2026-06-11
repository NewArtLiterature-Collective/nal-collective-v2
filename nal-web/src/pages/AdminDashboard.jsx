// src/pages/AdminDashboard.jsx
import React from 'react';
import { supabase } from '../utils/supabaseClient';

export default function AdminDashboard() {
  
  // 提供一个登出按钮，方便测试
  const handleLogout = async () => {
    await supabase.auth.signOut();
    window.location.reload(); // 刷新页面，Guard 会自动把你踢回登录界面
  };

  return (
    <div style={{ padding: '40px', backgroundColor: '#f9f9f9', minHeight: '100vh', color: '#333' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #000', paddingBottom: '20px', marginBottom: '40px' }}>
        <h1>🏛️ NAL 中央管理台</h1>
        <button 
          onClick={handleLogout}
          style={{ padding: '8px 16px', backgroundColor: '#000', color: '#fff', border: 'none', cursor: 'pointer' }}
        >
          退出登录
        </button>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '20px' }}>
        <div style={{ padding: '20px', background: '#fff', border: '1px solid #ddd' }}>
          <h3>⏳ 赛事时空大闸</h3>
          <p>模块加载中...</p>
        </div>
        
        <div style={{ padding: '20px', background: '#fff', border: '1px solid #ddd' }}>
          <h3>⚡ 评审引擎中控</h3>
          <p>模块加载中...</p>
        </div>
        
        <div style={{ padding: '20px', background: '#fff', border: '1px solid #ddd' }}>
          <h3>🏆 展厅动态选拔</h3>
          <p>模块加载中...</p>
        </div>
      </div>
    </div>
  );
}
