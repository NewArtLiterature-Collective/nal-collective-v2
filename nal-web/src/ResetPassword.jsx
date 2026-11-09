// ResetPassword.jsx —— 设置新密码页
// 用户在"忘记密码"邮件里点链接 → Supabase 验证后带着临时会话跳回本页（/reset-password）
// → 在这里输入新密码 → updateUser({ password }) → 退出临时会话 → 回登录页用新密码登录。
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, INITIAL_URL_HASH } from './supabaseClient';
import logo from './assets/nal_logo.png';

// 新版邮件模板的链接形如 /reset-password?token_hash=xxx&type=recovery：
// 打开页面时【不】消耗令牌，用户点"确认修改"时才验证。邮箱的安全扫描（如 Outlook / Hotmail
// 的 Safe Links）会预先打开链接，旧式链接因此被提前用掉、报 otp_expired；这种方式不受影响。
function readTokenHash() {
  const q = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
  return q.get('type') === 'recovery' ? (q.get('token_hash') || '') : '';
}

// 链接过期 / 已用过时，Supabase 会在网址 # 后面带上 error_code，这里翻译成中文
function readLinkError() {
  const params = new URLSearchParams((INITIAL_URL_HASH || '').replace(/^#/, ''));
  const code = params.get('error_code');
  if (!code && !params.get('error')) return '';
  if (code === 'otp_expired') return '重置链接已过期或已被使用，请回到登录页重新申请。';
  return '重置链接无效：' + (params.get('error_description') || code || params.get('error')).replace(/\+/g, ' ');
}

export default function ResetPassword() {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);
  const [hasSession, setHasSession] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [done, setDone] = useState(false);
  const linkError = readLinkError();
  const [tokenHash] = useState(readTokenHash);

  useEffect(() => {
    let alive = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!alive) return;
      setHasSession(!!data?.session);
      setChecking(false);
    });
    // 链接里的令牌可能稍晚才换成会话：收到 PASSWORD_RECOVERY / SIGNED_IN 时再确认一次
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!alive) return;
      if (session && (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN' || event === 'INITIAL_SESSION')) {
        setHasSession(true);
        setChecking(false);
      }
    });
    return () => { alive = false; subscription.unsubscribe(); };
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    if (password.length < 6) return setErrorMsg('新密码至少 6 位字符');
    if (password !== confirmPassword) return setErrorMsg('两次输入的密码不一致，请重新检查');
    setLoading(true);
    try {
      // 新版链接：此刻才用 token_hash 换取临时会话（打开页面不消耗令牌）
      if (tokenHash) {
        const { error: vErr } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'recovery' });
        if (vErr) {
          throw new Error(/expired|invalid/i.test(vErr.message || '')
            ? 'LINK_EXPIRED' : vErr.message);
        }
      }
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      // 改完即退出临时会话，让用户用新密码正式登录
      await supabase.auth.signOut();
      setDone(true);
    } catch (err) {
      const msg = err?.message || '';
      if (msg === 'LINK_EXPIRED') setErrorMsg('重置链接已过期或已被使用，请回到登录页重新申请。');
      else if (/different from the old password|same.*password/i.test(msg)) setErrorMsg('新密码不能与旧密码相同');
      else if (/session|expired|jwt/i.test(msg)) setErrorMsg('重置会话已失效，请回到登录页重新申请重置邮件。');
      else setErrorMsg('修改失败：' + (msg || '请重试'));
    } finally {
      setLoading(false);
    }
  };

  const goLogin = () => navigate('/login', { replace: true });

  let body;
  if (done) {
    body = (
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '56px', marginBottom: '16px' }}>✅</div>
        <h2 style={styles.title}>密码已重置</h2>
        <p style={{ ...styles.subtitle, lineHeight: '1.8', marginTop: '12px' }}>请使用新密码登录。</p>
        <button onClick={goLogin} style={{ ...styles.submitBtn, width: '100%', marginTop: '28px' }}>前往登录</button>
      </div>
    );
  } else if (checking && !linkError && !tokenHash) {
    body = <p style={{ ...styles.subtitle, textAlign: 'center' }}>正在验证重置链接…</p>;
  } else if (linkError || (!hasSession && !tokenHash)) {
    body = (
      <div style={{ textAlign: 'center' }}>
        <h2 style={styles.title}>无法重置密码</h2>
        <div style={{ ...styles.errorBox, marginTop: '20px', textAlign: 'left' }}>
          {linkError || '重置链接无效或已过期。请回到登录页，点击"忘记密码？"重新申请，并使用最新一封邮件里的链接。'}
        </div>
        <button onClick={goLogin} style={{ ...styles.submitBtn, width: '100%', marginTop: '24px' }}>回到登录页</button>
      </div>
    );
  } else {
    body = (
      <>
        <div style={styles.header}>
          <h2 style={styles.title}>设置新密码</h2>
          <p style={styles.subtitle}>请输入新的登录密码</p>
        </div>
        <form onSubmit={handleSubmit} style={styles.form}>
          <div style={styles.inputGroup}>
            <label style={styles.label}>新密码</label>
            <input type={show ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)}
              style={styles.input} placeholder="至少 6 位字符" autoComplete="new-password" required />
          </div>
          <div style={styles.inputGroup}>
            <label style={styles.label}>确认新密码</label>
            <input type={show ? 'text' : 'password'} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
              style={styles.input} placeholder="请再次输入新密码" autoComplete="new-password" required />
          </div>
          <label style={{ fontSize: '13px', color: '#6b7280', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
            <input type="checkbox" checked={show} onChange={e => setShow(e.target.checked)} /> 显示密码
          </label>
          {errorMsg && <div style={styles.errorBox}>{errorMsg}</div>}
          <button type="submit" disabled={loading} style={styles.submitBtn}>{loading ? '处理中...' : '确认修改'}</button>
        </form>
      </>
    );
  }

  return (
    <div style={styles.container}>
      <nav style={styles.navbar}>
        <div style={styles.navLogoContainer} onClick={() => navigate('/')}>
          <img src={logo} alt="NAL Logo" style={styles.navLogoImg} />
          <div style={styles.logo}>NAL Collective</div>
        </div>
      </nav>
      <div style={styles.authCard}>{body}</div>
    </div>
  );
}

// 与 Auth.jsx 保持同一套视觉
const styles = {
  container: { display: 'flex', flexDirection: 'column', height: '100vh', backgroundColor: '#f9fafb', fontFamily: 'system-ui' },
  navbar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 50px', position: 'absolute', top: 0, left: 0, right: 0 },
  navLogoContainer: { display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer' },
  navLogoImg: { height: '38px', width: 'auto', objectFit: 'contain' },
  logo: { fontSize: '22px', fontWeight: 'bold', color: '#4f46e5', cursor: 'pointer' },
  authCard: { margin: 'auto', width: '100%', maxWidth: '420px', backgroundColor: 'white', borderRadius: '24px', padding: '40px', boxShadow: '0 10px 25px rgba(0,0,0,0.05)', border: '1px solid #f3f4f6', boxSizing: 'border-box' },
  header: { textAlign: 'center', marginBottom: '30px' },
  title: { fontSize: '28px', fontWeight: 'bold', color: '#111827', margin: '0' },
  subtitle: { fontSize: '14px', color: '#6b7280', marginTop: '10px' },
  form: { display: 'flex', flexDirection: 'column', gap: '20px' },
  inputGroup: { display: 'flex', flexDirection: 'column', gap: '8px' },
  label: { fontSize: '14px', fontWeight: '600', color: '#374151' },
  input: { padding: '12px 16px', borderRadius: '12px', border: '1px solid #d1d5db', fontSize: '15px', outline: 'none', color: '#1f2937' },
  submitBtn: { padding: '14px', backgroundColor: '#111827', color: 'white', border: 'none', borderRadius: '12px', fontSize: '16px', fontWeight: 'bold', cursor: 'pointer' },
  errorBox: { padding: '12px', backgroundColor: '#fef2f2', color: '#b91c1c', borderRadius: '8px', fontSize: '13px' },
};
