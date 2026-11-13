// EmailConfirm.jsx —— 注册邮箱确认页（/auth/confirm）
// · 新版邮件链接：/auth/confirm?token_hash=xxx&type=email —— 打开页面不消耗令牌，点"确认邮箱"才验证，
//   因此 Outlook / Hotmail 等邮箱的链接安全扫描不会把链接提前用掉
// · 链接过期或已用过（含旧式链接带回的 #error_code=otp_expired）：显示原因，可直接重新发送确认邮件
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, INITIAL_URL_HASH } from './supabaseClient';
import { resendConfirmation, RESEND_COOLDOWN } from './authEmail';
import logo from './assets/nal_logo.png';

function readLinkError() {
  const p = new URLSearchParams((INITIAL_URL_HASH || '').replace(/^#/, ''));
  const code = p.get('error_code');
  if (!code && !p.get('error')) return '';
  if (code === 'otp_expired') return '确认链接已过期或已被使用。';
  return '确认链接无效：' + (p.get('error_description') || code || p.get('error')).replace(/\+/g, ' ');
}

export default function EmailConfirm() {
  const navigate = useNavigate();
  const q = new URLSearchParams(window.location.search);
  const tokenHash = q.get('token_hash') || '';
  const type = q.get('type') || 'email';
  const [state, setState] = useState(tokenHash ? 'ready' : (readLinkError() ? 'expired' : 'resend'));
  const [errorMsg, setErrorMsg] = useState(readLinkError());
  const [email, setEmail] = useState(q.get('email') || '');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const confirm = async () => {
    setBusy(true);
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: type === 'signup' ? 'signup' : 'email' });
    setBusy(false);
    if (error) {
      setErrorMsg(/expired|invalid/i.test(error.message || '') ? '确认链接已过期或已被使用。' : '确认失败：' + error.message);
      setState('expired');
      return;
    }
    // 与注册流程一致：确认后不自动进入工作台，请用户用邮箱和密码登录
    await supabase.auth.signOut().catch(() => {});
    setState('done');
  };

  const resend = async () => {
    setBusy(true); setNotice('');
    const r = await resendConfirmation(email);
    setBusy(false);
    setNotice(r.message);
    if (r.ok) setCooldown(RESEND_COOLDOWN);
  };

  let body;
  if (state === 'ready') {
    body = (
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '52px', marginBottom: '12px' }}>📧</div>
        <h2 style={st.title}>确认注册邮箱</h2>
        <p style={st.sub}>点击下方按钮，完成邮箱确认。</p>
        <button onClick={confirm} disabled={busy} style={{ ...st.btn, width: '100%', marginTop: '24px' }}>{busy ? '确认中…' : '确认邮箱'}</button>
      </div>
    );
  } else if (state === 'done') {
    body = (
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '52px', marginBottom: '12px' }}>✅</div>
        <h2 style={st.title}>邮箱已确认</h2>
        <p style={st.sub}>请使用注册时的邮箱和密码登录。</p>
        <button onClick={() => navigate('/login', { replace: true })} style={{ ...st.btn, width: '100%', marginTop: '24px' }}>前往登录</button>
      </div>
    );
  } else {
    body = (
      <>
        <div style={{ textAlign: 'center', marginBottom: '20px' }}>
          <h2 style={st.title}>{state === 'expired' ? '确认链接已失效' : '重新发送确认邮件'}</h2>
          <p style={st.sub}>{state === 'expired' ? '确认链接有时间限制，过期或用过一次后就会失效。' : '没收到确认邮件，或链接已过期？'}输入注册邮箱，我们会重新发送一封。</p>
        </div>
        {errorMsg && state === 'expired' && <div style={st.err}>{errorMsg}</div>}
        <label style={st.label}>注册邮箱</label>
        <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" style={st.input} />
        <button onClick={resend} disabled={busy || cooldown > 0} style={{ ...st.btn, width: '100%', marginTop: '16px', opacity: (busy || cooldown > 0) ? 0.6 : 1 }}>
          {busy ? '发送中…' : cooldown > 0 ? `${cooldown} 秒后可再次发送` : '重新发送确认邮件'}
        </button>
        {notice && <div style={/已重新发送/.test(notice) ? st.ok : st.err}>{notice}</div>}
        <div style={{ textAlign: 'center', marginTop: '20px', fontSize: '13px' }}>
          <button onClick={() => navigate('/login')} style={st.link}>已经确认过？前往登录</button>
          <span style={{ color: '#d1d5db', margin: '0 8px' }}>|</span>
          <button onClick={() => navigate('/login?mode=reset')} style={st.link}>忘记密码</button>
        </div>
      </>
    );
  }

  return (
    <div style={st.container}>
      <nav style={st.navbar}>
        <div style={st.navLogo} onClick={() => navigate('/')}>
          <img src={logo} alt="NAL Logo" style={{ height: '38px' }} />
          <div style={st.logo}>NAL Collective</div>
        </div>
      </nav>
      <div style={st.card}>{body}</div>
    </div>
  );
}

const st = {
  container: { display: 'flex', flexDirection: 'column', minHeight: '100vh', backgroundColor: '#f9fafb', fontFamily: 'system-ui' },
  navbar: { display: 'flex', alignItems: 'center', padding: '20px 24px' },
  navLogo: { display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer' },
  logo: { fontSize: '22px', fontWeight: 'bold', color: '#4f46e5' },
  card: { margin: 'auto', marginTop: '6vh', width: 'calc(100% - 32px)', maxWidth: '420px', backgroundColor: 'white', borderRadius: '24px', padding: '36px', boxShadow: '0 10px 25px rgba(0,0,0,0.05)', border: '1px solid #f3f4f6', boxSizing: 'border-box' },
  title: { fontSize: '26px', fontWeight: 'bold', color: '#111827', margin: 0 },
  sub: { fontSize: '14px', color: '#6b7280', marginTop: '10px', lineHeight: '1.7' },
  label: { display: 'block', fontSize: '14px', fontWeight: '600', color: '#374151', marginBottom: '8px' },
  input: { width: '100%', boxSizing: 'border-box', padding: '12px 16px', borderRadius: '12px', border: '1px solid #d1d5db', fontSize: '15px', outline: 'none' },
  btn: { padding: '14px', backgroundColor: '#111827', color: 'white', border: 'none', borderRadius: '12px', fontSize: '16px', fontWeight: 'bold', cursor: 'pointer' },
  err: { marginTop: '14px', padding: '12px', backgroundColor: '#fef2f2', color: '#b91c1c', borderRadius: '8px', fontSize: '13px', lineHeight: '1.6' },
  ok: { marginTop: '14px', padding: '12px', backgroundColor: '#ecfdf5', color: '#047857', borderRadius: '8px', fontSize: '13px', lineHeight: '1.6' },
  link: { background: 'none', border: 'none', color: '#4f46e5', cursor: 'pointer', fontSize: '13px' },
};
