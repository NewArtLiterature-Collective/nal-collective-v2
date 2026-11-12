// media.js —— 文件上传与图片地址（Cloudflare R2，2026-11 起取代 Supabase Storage）
// 浏览器不持有 R2 密钥：上传、删除、私有图片签名都经后端 /api/v1/media/*；
// 公开的展厅图片直接从 R2 公开桶的自定义域名加载。
import { supabase } from './supabaseClient';
import { API_BASE, MEDIA_BASE_URL } from './config';

async function authHeaders(extra = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error('登录已失效，请重新登录。');
  return { ...extra, Authorization: `Bearer ${token}` };
}

async function errorText(resp) {
  try {
    const j = await resp.json();
    return (typeof j?.detail === 'string' ? j.detail : j?.detail?.message) || `请求失败（${resp.status}）`;
  } catch {
    return `请求失败（${resp.status}）`;
  }
}

// 展厅图片公开地址：数据库 pages 里存的是 "<作品ID>/<页>.jpg"
export const showcaseUrl = (path) => (path && MEDIA_BASE_URL ? `${MEDIA_BASE_URL}/showcase/${path}` : '');

// 日常评审：上传一张图片到私有桶，返回限时链接（交给评审接口读取）
export async function uploadEvalImage(file) {
  const form = new FormData();
  form.append('file', file);
  const resp = await fetch(`${API_BASE}/api/v1/media/eval-upload`, { method: 'POST', headers: await authHeaders(), body: form });
  if (!resp.ok) throw new Error(`图片“${file.name}”上传失败：${await errorText(resp)}`);
  return (await resp.json()).url;
}

// 管理员：为参赛配图签发限时链接 → { 对象名或旧网址: 签名链接 }
export async function adminSignContest(names) {
  if (!names.length) return {};
  const resp = await fetch(`${API_BASE}/api/v1/media/admin/sign-contest`, {
    method: 'POST', headers: await authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ names }),
  });
  if (!resp.ok) throw new Error(await errorText(resp));
  return (await resp.json()).data || {};
}

// 管理员：展厅图片上传 / 删除 / 取回原图
export async function showcaseUpload(path, blob) {
  const form = new FormData();
  form.append('path', path);
  form.append('file', blob, path.split('/').pop());
  const resp = await fetch(`${API_BASE}/api/v1/media/showcase/upload`, { method: 'POST', headers: await authHeaders(), body: form });
  if (!resp.ok) throw new Error(await errorText(resp));
}

export async function showcaseDelete(paths) {
  if (!paths || !paths.length) return;
  const resp = await fetch(`${API_BASE}/api/v1/media/showcase/delete`, {
    method: 'POST', headers: await authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ paths }),
  });
  if (!resp.ok) throw new Error(await errorText(resp));
}

export async function showcaseRaw(path) {
  const resp = await fetch(`${API_BASE}/api/v1/media/showcase/raw?path=${encodeURIComponent(path)}`, { headers: await authHeaders() });
  if (!resp.ok) throw new Error(await errorText(resp));
  return await resp.blob();
}
