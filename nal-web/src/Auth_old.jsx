import React, { useState } from 'react';
import { supabase } from './supabaseClient';

export default function Auth() {
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLogin, setIsLogin] = useState(true);
  const [message, setMessage] = useState({ text: '', type: '' });

  const handleAuth = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage({ text: '', type: '' });

    try {
      if (isLogin) {
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        setMessage({ text: '✅ 登录成功！正在进入 NAL 工作台...', type: 'success' });
      } else {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
        });
        if (error) throw error;
        setMessage({ text: '🎉 注册成功！请直接尝试登录。', type: 'success' });
      }
    } catch (error) {
      setMessage({ text: `❌ 发生错误: ${error.message || error.error_description}`, type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: '400px', margin: '100px auto', fontFamily: 'sans-serif', padding: '20px', border: '1px solid #eaeaea', borderRadius: '10px', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }}>
      <div style={{ textAlign: 'center', marginBottom: '20px' }}>
        <h2>NewArtLiterature Collective</h2>
        <p style={{ color: '#666' }}>新艺文社数字化平台</p>
      </div>

      <form onSubmit={handleAuth} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
        <input
          type="email"
          placeholder="请输入常用邮箱"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          style={{ padding: '10px', borderRadius: '5px', border: '1px solid #ccc' }}
        />
        <input
          type="password"
          placeholder="请输入密码 (至少6位)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          style={{ padding: '10px', borderRadius: '5px', border: '1px solid #ccc' }}
        />
        
        <button type="submit" disabled={loading} style={{ padding: '10px', backgroundColor: '#000', color: '#fff', border: 'none', borderRadius: '5px', cursor: 'pointer', fontWeight: 'bold' }}>
          {loading ? '处理中...' : (isLogin ? '立即登录' : '免费注册')}
        </button>
      </form>

      {message.text && (
        <div style={{ marginTop: '15px', padding: '10px', borderRadius: '5px', backgroundColor: message.type === 'error' ? '#ffebee' : '#e8f5e9', color: message.type === 'error' ? '#c62828' : '#2e7d32', fontSize: '14px' }}>
          {message.text}
        </div>
      )}

      <div style={{ marginTop: '20px', textAlign: 'center', fontSize: '14px', color: '#555' }}>
        {isLogin ? "还没有账号？ " : "已有 NAL 账号？ "}
        <button 
          onClick={() => setIsLogin(!isLogin)} 
          style={{ background: 'none', border: 'none', color: '#0070f3', textDecoration: 'underline', cursor: 'pointer' }}
        >
          {isLogin ? '去注册' : '去登录'}
        </button>
      </div>
    </div>
  );
}