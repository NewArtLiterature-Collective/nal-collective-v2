// Auth.jsx 修改版 (SVG 图标版)
import React, { useState } from 'react';
import { supabase } from './supabaseClient';
import { useSearchParams, useNavigate } from 'react-router-dom';
import logo from './assets/nal_logo.png';

// --- 提取通用的 SVG 图标组件，保持代码整洁 ---
const EyeOpenIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
    <circle cx="12" cy="12" r="3"></circle>
  </svg>
);

const EyeClosedIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
    <line x1="1" y1="1" x2="23" y2="23"></line>
  </svg>
);

export default function Auth() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const intent = searchParams.get('intent'); 

  // --- 状态管理 ---
  const [authMode, setAuthMode] = useState('login'); // 'login', 'signup', 'reset'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  
  // 控制密码显示的 state
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // --- 核心逻辑 ---
  const handleAuth = async (e) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg('');
    setSuccessMsg('');

    // 注册时的双重密码校验
    if (authMode === 'signup' && password !== confirmPassword) {
      setErrorMsg('两次输入的密码不一致，请重新检查');
      setLoading(false);
      return;
    }

    try {
      if (authMode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else if (authMode === 'signup') {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        
        setSuccessMsg('🎉 账号创建成功！请前往您的邮箱点击激活链接，然后回来登录。');
        setPassword('');
        setConfirmPassword('');
      } else if (authMode === 'reset') {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/login`,
        });
        if (error) throw error;
        setSuccessMsg('📧 重置邮件已发送！请检查您的收件箱。');
      }
    } catch (error) {
      if (error.message.includes("Invalid login credentials")) {
        setErrorMsg('未注册用户，请先注册');
      } else {
        setErrorMsg(error.message || '操作失败，请重试');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      <nav style={styles.navbar}>
        <div style={styles.navLogoContainer} onClick={() => navigate('/')}>
          <img src={logo} alt="NAL Logo" style={styles.navLogoImg} />
          <div style={styles.logo}>NAL Collective</div>
        </div>
        <button onClick={() => navigate('/')} style={styles.navBackBtn}>← 返回首页</button>
      </nav>

      <div style={styles.authCard}>
        <div style={styles.header}>
          <h2 style={styles.title}>
            {authMode === 'login' ? '欢迎回来' : (authMode === 'signup' ? '创建创作者账号' : '重置密码')}
          </h2>
          <p style={styles.subtitle}>
            {intent === 'pro' && <span style={{color:'#8b5cf6', fontWeight:'bold'}}>✨ 即将为您解锁专业会员特权</span>}
            {intent === 'contestant' && <span style={{color:'#4f46e5', fontWeight:'bold'}}>🏆 即将为您开启赛事报名通道</span>}
          </p>
        </div>

        <form onSubmit={handleAuth} style={styles.form}>
          <div style={styles.inputGroup}>
            <label style={styles.label}>邮箱地址</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={styles.input} placeholder="you@example.com" required />
          </div>

          {authMode !== 'reset' && (
            <>
              <div style={styles.inputGroup}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <label style={styles.label}>输入密码</label>
                  {authMode === 'login' && <button type="button" onClick={() => setAuthMode('reset')} style={styles.inlineLink}>忘记密码？</button>}
                </div>
                
                <div style={{ position: 'relative', width: '100%' }}>
                  <input 
                    type={showPassword ? "text" : "password"} 
                    value={password} 
                    onChange={(e) => setPassword(e.target.value)} 
                    style={{ ...styles.input, width: '100%', boxSizing: 'border-box', paddingRight: '40px' }} 
                    placeholder="至少 6 位字符" 
                    required 
                  />
                  {/* 🚨 修改：替换为 SVG 图标 */}
                  <button 
                    type="button" 
                    onClick={() => setShowPassword(!showPassword)}
                    style={styles.eyeBtn}
                    title={showPassword ? "隐藏密码" : "显示密码"}
                  >
                    {showPassword ? <EyeClosedIcon /> : <EyeOpenIcon />}
                  </button>
                </div>
              </div>

              {authMode === 'signup' && (
                <div style={styles.inputGroup}>
                  <label style={styles.label}>确认密码</label>
                  <div style={{ position: 'relative', width: '100%' }}>
                    <input 
                      type={showConfirmPassword ? "text" : "password"} 
                      value={confirmPassword} 
                      onChange={(e) => setConfirmPassword(e.target.value)} 
                      style={{ ...styles.input, width: '100%', boxSizing: 'border-box', paddingRight: '40px' }} 
                      placeholder="请再次输入密码" 
                      required 
                    />
                    {/* 🚨 修改：替换为 SVG 图标 */}
                    <button 
                      type="button" 
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      style={styles.eyeBtn}
                      title={showConfirmPassword ? "隐藏密码" : "显示密码"}
                    >
                      {showConfirmPassword ? <EyeClosedIcon /> : <EyeOpenIcon />}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {errorMsg && <div style={styles.errorBox}>{errorMsg}</div>}
          {successMsg && <div style={styles.successBox}>{successMsg}</div>}

          <button type="submit" disabled={loading} style={styles.submitBtn}>
            {loading ? '处理中...' : (authMode === 'login' ? '立即登录' : (authMode === 'signup' ? '免费注册' : '发送邮件'))}
          </button>
        </form>

        <div style={styles.footer}>
          <button 
            onClick={() => { 
              setAuthMode(authMode === 'login' ? 'signup' : 'login'); 
              setErrorMsg(''); 
              setPassword('');
              setConfirmPassword('');
              setShowPassword(false);
              setShowConfirmPassword(false);
            }} 
            style={styles.switchBtn}
          >
            {authMode === 'login' ? '还没有账号？免费注册' : '已有账号？直接登录'}
          </button>
        </div>
      </div>
    </div>
  );
}

const styles = {
  container: { display: 'flex', flexDirection: 'column', height: '100vh', backgroundColor: '#f9fafb', fontFamily: 'system-ui' },
  navbar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 50px', position: 'absolute', top: 0, left: 0, right: 0 },
  navLogoContainer: { display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer' },
  navLogoImg: { height: '38px', width: 'auto', objectFit: 'contain' },
  logo: { fontSize: '22px', fontWeight: 'bold', color: '#4f46e5', cursor: 'pointer' },
  navBackBtn: { background: '#f3f4f6', border: 'none', color: '#4b5563', padding: '8px 16px', borderRadius: '8px', cursor: 'pointer', fontWeight: '600' },
  authCard: { margin: 'auto', width: '100%', maxWidth: '420px', backgroundColor: 'white', borderRadius: '24px', padding: '40px', boxShadow: '0 10px 25px rgba(0,0,0,0.05)', border: '1px solid #f3f4f6' },
  header: { textAlign: 'center', marginBottom: '30px' },
  title: { fontSize: '28px', fontWeight: 'bold', color: '#111827', margin: '0' },
  subtitle: { fontSize: '14px', color: '#6b7280', marginTop: '10px' },
  form: { display: 'flex', flexDirection: 'column', gap: '20px' },
  inputGroup: { display: 'flex', flexDirection: 'column', gap: '8px' },
  label: { fontSize: '14px', fontWeight: '600', color: '#374151' },
  input: { padding: '12px 16px', borderRadius: '12px', border: '1px solid #d1d5db', fontSize: '15px', outline: 'none', color: '#1f2937' },
  inlineLink: { background: 'none', border: 'none', color: '#4f46e5', fontSize: '12px', cursor: 'pointer' },
  submitBtn: { padding: '14px', backgroundColor: '#111827', color: 'white', border: 'none', borderRadius: '12px', fontSize: '16px', fontWeight: 'bold', cursor: 'pointer' },
  errorBox: { padding: '12px', backgroundColor: '#fef2f2', color: '#b91c1c', borderRadius: '8px', fontSize: '13px' },
  successBox: { padding: '12px', backgroundColor: '#ecfdf5', color: '#047857', borderRadius: '8px', fontSize: '13px' },
  footer: { marginTop: '25px', textAlign: 'center' },
  switchBtn: { background: 'none', border: 'none', color: '#4f46e5', fontWeight: 'bold', cursor: 'pointer', fontSize: '14px' },
  // 🚨 样式微调：为了让 SVG 完美居中并具有良好的交互反馈
  eyeBtn: { 
    position: 'absolute', 
    right: '12px', 
    top: '50%', 
    transform: 'translateY(-50%)', 
    background: 'none', 
    border: 'none', 
    cursor: 'pointer', 
    padding: '4px',
    display: 'flex', 
    alignItems: 'center', 
    justifyContent: 'center',
    outline: 'none'
  }
};
