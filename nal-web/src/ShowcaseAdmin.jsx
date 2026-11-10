// ShowcaseAdmin.jsx —— 管理后台：陈伯吹新儿童文学绘本插画大赛厅布展
// 录入陈伯吹新儿童文学绘本插画大赛历届绘本 / 插画的 AI 评审佳作：作品名称、届次、署名（选填）、简短判词、页面图片。
// 图片在浏览器内压缩（长边 ≤ 2400px，JPEG）并【烧入水印】后上传到 showcase 公开桶，按顺序存为 <作品ID>/001.jpg …
// 桶里只存带水印的版本，原图不上传——即使有人拿到图片直链，下载到的也是带水印的图。
// 只有管理员（JWT app_metadata.role = 'admin'）可写，见 showcase_hall.sql。
import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import { SHOWCASE_BUCKET, showcaseUrl, cleanTitle } from './Showcase';

const MAX_EDGE = 2400;
const JPEG_QUALITY = 0.88;

// ---- 水印（如需调整文字或浓淡，改这里）----
export const WATERMARK_TEXT = '陈伯吹新儿童文学绘本插画大赛 · 新艺文社';
export const WATERMARK_SUB = 'www.nal-ai.org';
const WM_TILE_ALPHA = 0.10;    // 斜向平铺的淡水印（覆盖全图，防裁切）
const WM_CORNER_ALPHA = 0.80;  // 右下角署名水印

// 在画布上烧入水印：全图斜向淡色平铺 + 右下角署名。白字配深色描边，深浅底色上都看得见。
export function drawWatermark(ctx, w, h) {
  const base = Math.max(14, Math.round(Math.min(w, h) * 0.026));
  const family = '"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans CJK SC","Noto Sans SC",sans-serif';

  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate(-Math.PI / 6);
  ctx.font = `${base}px ${family}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(1, base / 10);
  ctx.fillStyle = `rgba(255,255,255,${WM_TILE_ALPHA})`;
  ctx.strokeStyle = `rgba(0,0,0,${WM_TILE_ALPHA * 0.6})`;
  const stepX = ctx.measureText(WATERMARK_TEXT).width + base * 5;
  const stepY = base * 7;
  const R = Math.sqrt(w * w + h * h) / 2 + stepX;
  let row = 0;
  for (let y = -R; y <= R; y += stepY, row++) {
    for (let x = -R + (row % 2) * (stepX / 2); x <= R; x += stepX) {
      ctx.strokeText(WATERMARK_TEXT, x, y);
      ctx.fillText(WATERMARK_TEXT, x, y);
    }
  }
  ctx.restore();

  ctx.save();
  const pad = Math.round(base * 0.9);
  ctx.textAlign = 'right';
  ctx.textBaseline = 'alphabetic';
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = Math.max(2, base / 4);
  ctx.fillStyle = `rgba(255,255,255,${WM_CORNER_ALPHA})`;
  ctx.font = `${Math.round(base * 0.75)}px ${family}`;
  ctx.fillText(WATERMARK_SUB, w - pad, h - pad);
  ctx.font = `bold ${base}px ${family}`;
  ctx.fillText(`© ${WATERMARK_TEXT}`, w - pad, h - pad - Math.round(base * 1.05));
  ctx.restore();
}

// 文件名自然排序：p2 排在 p10 前面
const naturalCompare = (a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true, sensitivity: 'base' });

// 浏览器内压缩为 JPEG
async function compressImage(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale), h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);      // PNG 透明底填白
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close && bitmap.close();
  drawWatermark(ctx, w, h);                               // 烧入水印
  return await new Promise((resolve, reject) =>
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('图片压缩失败'))), 'image/jpeg', JPEG_QUALITY));
}

const emptyForm = { id: null, category: 'picturebook', edition: '', title: '', byline: '', verdict: '', page_format: 'single', sort_order: 0, publish: true };

export default function ShowcaseAdmin({ addLog = () => {} }) {
  const [works, setWorks] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [hallOpen, setHallOpen] = useState(true);     // site_settings.is_showcase_active

  const loadSetting = async () => {
    const { data, error } = await supabase.from('site_settings').select('is_showcase_active').eq('id', 1).maybeSingle();
    if (error) { addLog(`⚠️ 读取本厅开关失败（请确认已运行 showcase_lock.sql）: ${error.message}`); return; }
    setHallOpen(data?.is_showcase_active !== false);
  };
  const toggleHall = async () => {
    const next = !hallOpen;
    if (!next && !window.confirm('锁定后，访客将看不到本厅任何展品（管理员仍可预览）。确定锁定？')) return;
    const { data, error } = await supabase.from('site_settings').update({ is_showcase_active: next }).eq('id', 1).select();
    if (error) return alert('操作失败：' + error.message);
    if (!data || data.length === 0) return alert('操作未生效：请检查管理员权限。');
    setHallOpen(data[0].is_showcase_active !== false);
    addLog(`🎛️ 陈伯吹新儿童文学绘本插画大赛厅已${next ? '开放' : '锁定'}`);
  };

  const load = async () => {
    const { data, error } = await supabase.from('showcase_works').select('*')
      .order('category').order('sort_order', { ascending: false }).order('created_at', { ascending: false });
    if (error) { addLog(`❌ 陈伯吹新儿童文学绘本插画大赛厅读取失败: ${error.message}`); return; }
    setWorks(data || []);
  };
  useEffect(() => { load(); loadSetting(); }, []);

  const pickFiles = (e) => {
    const picked = Array.from(e.target.files || []).filter(f => /^image\/(jpeg|png)$/.test(f.type)).sort(naturalCompare);
    if (picked.length < (e.target.files || []).length) alert('只接受 JPG / PNG，其他文件已忽略。');
    setFiles(picked);
    e.target.value = '';
  };
  const move = (i, d) => setFiles(prev => {
    const a = [...prev]; const j = i + d;
    if (j < 0 || j >= a.length) return a;
    [a[i], a[j]] = [a[j], a[i]]; return a;
  });

  const startNew = () => { setForm(emptyForm); setFiles([]); setShowForm(true); };
  const startEdit = (w) => {
    setForm({ id: w.id, category: w.category, edition: w.edition || '', title: cleanTitle(w.title), byline: w.byline || '',
      verdict: w.verdict || '', page_format: w.page_format || 'single', sort_order: w.sort_order || 0, publish: w.is_published });
    setFiles([]); setShowForm(true);
  };

  const save = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) return alert('请填写作品名称。');
    if (!form.verdict.trim()) return alert('请填写判词。');
    if (!form.id && files.length === 0) return alert('请选择作品图片。');
    const row = {
      category: form.category, edition: form.edition.trim() || null, title: cleanTitle(form.title),
      byline: form.byline.trim() || null, verdict: form.verdict.trim(),
      page_format: form.category === 'picturebook' ? form.page_format : 'single',
      sort_order: parseInt(form.sort_order, 10) || 0, is_published: !!form.publish,
    };
    try {
      if (form.id) {
        // 编辑：只改文字信息；如重新选了图片，则整体替换页面
        if (files.length > 0) {
          const old = works.find(w => w.id === form.id);
          const paths = await uploadPages(form.id, files);
          row.pages = paths; row.cover_index = 0;
          const stale = (old?.pages || []).filter(p => !paths.includes(p));
          if (stale.length) await supabase.storage.from(SHOWCASE_BUCKET).remove(stale);
        }
        const { error } = await supabase.from('showcase_works').update(row).eq('id', form.id);
        if (error) throw error;
        addLog(`✅ 陈伯吹新儿童文学绘本插画大赛厅：已更新《${row.title}》`);
      } else {
        const id = crypto.randomUUID();
        const paths = await uploadPages(id, files);
        const { error } = await supabase.from('showcase_works').insert({ id, ...row, pages: paths, cover_index: 0 });
        if (error) {
          await supabase.storage.from(SHOWCASE_BUCKET).remove(paths);
          throw error;
        }
        addLog(`✅ 陈伯吹新儿童文学绘本插画大赛厅：已录入《${row.title}》（${paths.length} 张图）`);
      }
      setShowForm(false); setForm(emptyForm); setFiles([]);
      load();
    } catch (err) {
      alert('保存失败：' + err.message);
      addLog(`❌ 陈伯吹新儿童文学绘本插画大赛厅保存失败: ${err.message}`);
    } finally {
      setBusy('');
    }
  };

  const uploadPages = async (id, list) => {
    const paths = [];
    for (let i = 0; i < list.length; i++) {
      setBusy(`正在压缩上传 ${i + 1} / ${list.length} …`);
      const blob = await compressImage(list[i]);
      const path = `${id}/${String(i + 1).padStart(3, '0')}_${Date.now()}.jpg`;
      const { error } = await supabase.storage.from(SHOWCASE_BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: true });
      if (error) {
        if (paths.length) await supabase.storage.from(SHOWCASE_BUCKET).remove(paths);
        throw new Error(`第 ${i + 1} 张上传失败：${error.message}`);
      }
      paths.push(path);
    }
    return paths;
  };

  const togglePublish = async (w) => {
    const { error } = await supabase.from('showcase_works').update({ is_published: !w.is_published }).eq('id', w.id);
    if (error) return alert('操作失败：' + error.message);
    addLog(`🎛️ 《${cleanTitle(w.title)}》已${w.is_published ? '撤下' : '发布'}`);
    load();
  };
  const setCover = async (w, i) => {
    const { error } = await supabase.from('showcase_works').update({ cover_index: i }).eq('id', w.id);
    if (error) return alert('操作失败：' + error.message);
    load();
  };
  const remove = async (w) => {
    if (!window.confirm(`确定删除《${cleanTitle(w.title)}》？图片会一并删除，不可恢复。`)) return;
    const { error } = await supabase.from('showcase_works').delete().eq('id', w.id);
    if (error) return alert('删除失败：' + error.message);
    if ((w.pages || []).length) await supabase.storage.from(SHOWCASE_BUCKET).remove(w.pages);
    addLog(`🗑️ 已删除《${cleanTitle(w.title)}》`);
    load();
  };

  const inp = { width: '100%', padding: '8px', background: '#222', color: '#fff', border: '1px solid #444', borderRadius: '4px', boxSizing: 'border-box', fontFamily: 'inherit' };
  const lbl = { display: 'block', marginBottom: '5px', color: '#888', fontSize: '13px' };

  return (
    <div style={{ padding: '20px', background: '#111', border: '1px solid #222', borderRadius: '4px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px', flexWrap: 'wrap', gap: '10px' }}>
        <div>
          <h3 style={{ margin: '0 0 6px', color: '#a3be8c' }}>📚 陈伯吹新儿童文学绘本插画大赛厅布展（共 {works.length} 件，已发布 {works.filter(w => w.is_published).length} 件）</h3>
          <p style={{ margin: 0, color: '#64748b', fontSize: '12px' }}>录入历届绘本、插画的 AI 评审佳作。本厅常年开放，不受新艺文社竞赛厅开关影响；布展或整改时可单独锁定本厅。作品发布后即可见，撤下后前台不再显示。</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <span style={{ color: '#888', fontSize: '13px' }}>
            本厅状态：<strong style={{ color: hallOpen ? '#a3be8c' : '#bf616a' }}>{hallOpen ? '🟢 开放中' : '🔴 已锁定'}</strong>
          </span>
          <button onClick={toggleHall} style={{ padding: '8px 16px', backgroundColor: hallOpen ? '#bf616a' : '#a3be8c', color: hallOpen ? '#fff' : '#000', border: 'none', cursor: 'pointer', fontWeight: 'bold', borderRadius: '4px' }}>
            {hallOpen ? '🔒 锁定本厅' : '📢 开放本厅'}
          </button>
          <a href="/gallery?hall=showcase" title="在当前页面打开（登录状态只在本标签页有效）" style={{ color: '#ebcb8b', fontSize: '13px' }}>👁️ 预览展厅</a>
          <button onClick={() => (showForm ? setShowForm(false) : startNew())} style={{ padding: '8px 16px', backgroundColor: '#5e81ac', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 'bold', borderRadius: '4px' }}>
            {showForm ? '收起' : '➕ 录入佳作'}
          </button>
        </div>
      </div>

      {showForm && (
        <form onSubmit={save} style={{ borderTop: '1px dashed #333', paddingTop: '18px', marginBottom: '20px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px' }}>
          <div>
            <label style={lbl}>类别</label>
            <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} style={inp}>
              <option value="picturebook">绘本（翻书阅读）</option>
              <option value="illustration">插画</option>
            </select>
          </div>
          <div>
            <label style={lbl}>届次（分组标题）</label>
            <input value={form.edition} onChange={e => setForm({ ...form, edition: e.target.value })} placeholder="例如：第二届" style={inp} />
          </div>
          <div>
            <label style={lbl}>作品名称（不用加书名号）</label>
            <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} style={inp} />
          </div>
          <div>
            <label style={lbl}>署名（选填，需作者授权）</label>
            <input value={form.byline} onChange={e => setForm({ ...form, byline: e.target.value })} placeholder="例如：文 / 某某　图 / 某某" style={inp} />
          </div>
          {form.category === 'picturebook' && (
            <div>
              <label style={lbl}>页面格式</label>
              <select value={form.page_format} onChange={e => setForm({ ...form, page_format: e.target.value })} style={inp}>
                <option value="single">单页（宽屏两页并排、首页为封面）</option>
                <option value="spread">跨页合图（每张图已是左右两页）</option>
              </select>
            </div>
          )}
          <div>
            <label style={lbl}>排序权重（大的靠前）</label>
            <input type="number" value={form.sort_order} onChange={e => setForm({ ...form, sort_order: e.target.value })} style={inp} />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={lbl}>简短判词</label>
            <textarea value={form.verdict} onChange={e => setForm({ ...form, verdict: e.target.value })} rows={3} style={inp}
              placeholder="一两句话，例如佳作报告里作品名后面的那句" />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={lbl}>{form.id ? '重新选择图片（不选则保留原图；新图会自动加水印）' : '作品图片（可多选，按文件名排序，可上下调整；上传时自动加水印）'}</label>
            <input type="file" multiple accept=".jpg,.jpeg,.png,image/jpeg,image/png" onChange={pickFiles} style={{ color: '#ccc' }} />
            {files.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '10px' }}>
                {files.map((f, i) => (
                  <div key={f.name + i} style={{ background: '#222', border: '1px solid #333', borderRadius: '4px', padding: '4px 8px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ color: '#ebcb8b' }}>{i + 1}</span>
                    <span style={{ maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                    <button type="button" onClick={() => move(i, -1)} style={miniBtn}>↑</button>
                    <button type="button" onClick={() => move(i, 1)} style={miniBtn}>↓</button>
                    <button type="button" onClick={() => setFiles(files.filter((_, k) => k !== i))} style={{ ...miniBtn, color: '#bf616a' }}>×</button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <label style={{ gridColumn: '1 / -1', color: '#d8dee9', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input type="checkbox" checked={form.publish} onChange={e => setForm({ ...form, publish: e.target.checked })} /> 保存后立即在展厅发布
          </label>
          <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: '15px' }}>
            <button type="submit" disabled={!!busy} style={{ padding: '8px 24px', backgroundColor: busy ? '#444' : '#a3be8c', color: '#000', border: 'none', cursor: busy ? 'wait' : 'pointer', fontWeight: 'bold', borderRadius: '4px' }}>
              {form.id ? '💾 保存修改' : '💾 保存作品'}
            </button>
            {busy && <span style={{ color: '#ebcb8b', fontSize: '13px' }}>{busy}</span>}
          </div>
        </form>
      )}

      {works.length === 0 ? (
        <div style={{ color: '#4c566a', padding: '20px 0' }}>&gt;_ 尚未录入作品。</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #333', color: '#888' }}>
                <th style={{ padding: '8px' }}>类别</th><th style={{ padding: '8px' }}>届次</th><th style={{ padding: '8px' }}>作品</th>
                <th style={{ padding: '8px' }}>封面（点缩略图设为封面）</th><th style={{ padding: '8px' }}>权重</th><th style={{ padding: '8px' }}>状态</th><th style={{ padding: '8px' }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {works.map(w => (
                <tr key={w.id} style={{ borderBottom: '1px solid #222', verticalAlign: 'top' }}>
                  <td style={{ padding: '8px' }}>{w.category === 'picturebook' ? '绘本' : '插画'}</td>
                  <td style={{ padding: '8px' }}>{w.edition || '—'}</td>
                  <td style={{ padding: '8px', maxWidth: '320px' }}>
                    <div style={{ color: '#eceff4' }}>《{cleanTitle(w.title)}》<span style={{ color: '#888' }}>{w.byline ? `　${w.byline}` : ''}</span></div>
                    <div style={{ color: '#888', fontSize: '12px', marginTop: '4px', lineHeight: 1.5 }}>{w.verdict}</div>
                  </td>
                  <td style={{ padding: '8px' }}>
                    <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', maxWidth: '260px' }}>
                      {(w.pages || []).slice(0, 12).map((p, i) => (
                        <img key={p} src={showcaseUrl(p)} alt="" onClick={() => setCover(w, i)} title={`第 ${i + 1} 张${i === (w.cover_index || 0) ? '（封面）' : ''}`}
                          style={{ width: '36px', height: '36px', objectFit: 'cover', cursor: 'pointer', border: i === (w.cover_index || 0) ? '2px solid #ebcb8b' : '1px solid #333' }} />
                      ))}
                      {(w.pages || []).length > 12 && <span style={{ color: '#888', fontSize: '11px' }}>共 {w.pages.length} 张</span>}
                    </div>
                  </td>
                  <td style={{ padding: '8px' }}>{w.sort_order}</td>
                  <td style={{ padding: '8px', color: w.is_published ? '#a3be8c' : '#bf616a' }}>{w.is_published ? '已发布' : '未发布'}</td>
                  <td style={{ padding: '8px', whiteSpace: 'nowrap' }}>
                    <button onClick={() => togglePublish(w)} style={actBtn}>{w.is_published ? '撤下' : '发布'}</button>
                    <button onClick={() => startEdit(w)} style={actBtn}>编辑</button>
                    <button onClick={() => remove(w)} style={{ ...actBtn, color: '#bf616a', borderColor: '#bf616a' }}>删除</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const miniBtn = { background: 'none', border: 'none', color: '#88c0d0', cursor: 'pointer', padding: '0 2px', fontSize: '12px' };
const actBtn = { marginRight: '6px', padding: '3px 10px', background: 'transparent', color: '#88c0d0', border: '1px solid #88c0d0', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' };
