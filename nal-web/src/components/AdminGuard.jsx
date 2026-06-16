import React, { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient'; 

export default function AdminGuard({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  
  // 🌟 登录表单状态：改用 username 而不是 email
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    // 检查当前是否有登录会话
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    // 监听登录状态变化
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleLogin = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    
    // 🌟 核心暗箱操作：如果输入的是 admin，自动在底层映射为真实邮箱以获取数据库 RLS 权限
    let loginEmail = username.trim();
    if (loginEmail.toLowerCase() === 'admin') {
      loginEmail = 'admin@nal-ai.org';
    }

    const { error } = await supabase.auth.signInWithPassword({
      email: loginEmail,
      password: password,
    });
    
    if (error) {
      setErrorMsg("登录失败：识别码或密钥不正确");
    }
  };

  if (loading) return <div style={{ padding: '50px', textAlign: 'center', backgroundColor: '#0a0a0a', color: '#fff', height: '100vh', fontFamily: 'monospace' }}>核验安保身份中...</div>;

  // 如果没有 session，说明没登录，展示控制台专属暗黑登录框
  if (!session) {
    return (
      <div style={{ display: 'flex', height: '100vh', backgroundColor: '#0a0a0a', fontFamily: 'monospace' }}>
        <div style={{ width: '100%', maxWidth: '380px', margin: 'auto', padding: '40px', backgroundColor: '#111', border: '1px solid #333', borderRadius: '12px', boxShadow: '0 20px 40px rgba(0,0,0,0.8)' }}>
          <div style={{ textAlign: 'center', marginBottom: '30px' }}>
            <h2 style={{ color: '#fff', fontSize: '24px', margin: '0 0 10px 0', letterSpacing: '1px' }}>🏛️ NAL 中央控制台</h2>
            <p style={{ color: '#666', fontSize: '12px', margin: 0 }}>身份验证与加密接入</p>
          </div>
          
          {errorMsg && <div style={{ padding: '10px', backgroundColor: 'rgba(191, 97, 106, 0.1)', color: '#bf616a', border: '1px solid #bf616a', borderRadius: '6px', fontSize: '13px', marginBottom: '20px', textAlign: 'center' }}>{errorMsg}</div>}
          
          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div>
              <label style={{ display: 'block', color: '#888', fontSize: '12px', marginBottom: '8px' }}>管理账号 (Username)</label>
              <input 
                type="text" // 👈 已经去掉了 type="email" 限制，支持纯英文字母
                placeholder="请输入管理员账号" 
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                style={{ width: '100%', padding: '12px', background: '#000', color: '#a3be8c', border: '1px solid #333', borderRadius: '6px', outline: 'none', boxSizing: 'border-box', fontFamily: 'monospace' }}
                required
              />
            </div>
            
            <div>
              <label style={{ display: 'block', color: '#888', fontSize: '12px', marginBottom: '8px' }}>访问密钥 (Password)</label>
              <input 
                type="password" 
                placeholder="••••••••" 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={{ width: '100%', padding: '12px', background: '#000', color: '#a3be8c', border: '1px solid #333', borderRadius: '6px', outline: 'none', boxSizing: 'border-box', fontFamily: 'monospace', letterSpacing: '2px' }}
                required
              />
            </div>
            
            <button type="submit" style={{ width: '100%', padding: '14px', background: '#d08770', color: '#fff', fontWeight: 'bold', border: 'none', borderRadius: '6px', cursor: 'pointer', marginTop: '10px', fontSize: '15px' }}>
              ⚡ 接入系统
            </button>
          </form>
          
          <div style={{ textAlign: 'center', marginTop: '25px', color: '#444', fontSize: '11px' }}>
            Powered by NAL Collective Engine
          </div>
        </div>
      </div>
    );
  }

  // 验证通过，渲染真正的后台界面 (AdminDashboard)
  return children;
}
