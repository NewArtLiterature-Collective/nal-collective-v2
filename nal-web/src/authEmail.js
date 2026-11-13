// authEmail.js —— 注册确认邮件：重新发送（确认链接过期或没收到时使用）
import { supabase } from './supabaseClient';

export const RESEND_COOLDOWN = 60;   // 秒：两次发送之间的间隔，防止连点

// 返回给用户看的中文结果；ok=false 时 message 为原因
export async function resendConfirmation(email) {
  const addr = (email || '').trim();
  if (!addr) return { ok: false, message: '请输入注册时使用的邮箱。' };
  const { error } = await supabase.auth.resend({
    type: 'signup',
    email: addr,
    options: { emailRedirectTo: `${window.location.origin}/login` },
  });
  if (!error) return { ok: true, message: `确认邮件已重新发送到 ${addr}，请在 24 小时内点击邮件里的链接。没收到请查看垃圾邮件箱。` };
  const msg = error.message || '';
  if (/already|confirmed/i.test(msg)) return { ok: false, message: '该邮箱已完成确认，请直接登录。' };
  if (/rate|limit|seconds|security purposes/i.test(msg)) return { ok: false, message: '发送太频繁，请稍等一分钟后再试。' };
  return { ok: false, message: '发送失败：' + msg };
}
