import React, { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient'; // 替换为你自己的 supabase 初始化路径

export default function AdminGuard({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  
  // 登录表单状态
  const [email, setEmail] = useState('');
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
    const { error } = await supabase.auth.signInWithPassword({
      email: email,
      password: password,
    });
    
    if (error) {
      setErrorMsg("登录失败：账号或密码错误");
    }
  };

  if (loading) return <div style={{ padding: '50px', textAlign: 'center' }}>核验安保身份中...</div>;

  // 如果没有 session，说明没登录，展示登录框
  if (!session) {
    return (
      <div style={{ maxWidth: '400px', margin: '100px auto', padding: '30px', border: '1px solid #333', borderRadius: '8px' }}>
        <h2 style={{ textAlign: 'center', marginBottom: '20px' }}>NAL 中央控制台</h2>
        {errorMsg && <div style={{ color: 'red', marginBottom: '15px', fontSize: '14px' }}>{errorMsg}</div>}
        
        <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
          <input 
            type="email" 
            placeholder="Admin Email" 
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{ padding: '10px', background: '#111', color: '#fff', border: '1px solid #444' }}
            required
          />
          <input 
            type="password" 
            placeholder="Password" 
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{ padding: '10px', background: '#111', color: '#fff', border: '1px solid #444' }}
            required
          />
          <button type="submit" style={{ padding: '10px', background: '#fff', color: '#000', fontWeight: 'bold', cursor: 'pointer' }}>
            系统登入
          </button>
        </form>
      </div>
    );
  }

  // 验证通过，渲染真正的后台界面 (AdminDashboard)
  return children;
}
