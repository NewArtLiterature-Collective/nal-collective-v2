// WritingHallAdmin.jsx —— 管理后台：陈伯吹新儿童文学创作大赛厅布展
// 录入历届文字创作的 AI 评审佳作：作品封面（一张图）+ 正文（约 1000 字）+ 作品名称、届次、署名（选填）、评语（选填）。
// 封面在浏览器内压缩（长边 ≤ 2400px，JPEG）并【烧入水印】后，经后端上传到 R2 公开桶 showcase/，存为 <作品ID>/cover_xxx.jpg。
// 只有管理员（JWT app_metadata.role = 'admin'）可写，见 writing_hall.sql。
import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import { showcaseUrl, showcaseUpload, showcaseDelete } from './media';
import { compressImage } from './ShowcaseAdmin';
import { cleanWritingTitle } from './WritingHall';

const WRITING_WATERMARK = '陈伯吹新儿童文学创作大赛 · 新艺文社';
const TEXT_MAX = 5000;      // 正文上限（与数据库约束一致）；建议约 1000 字

const emptyForm = { id: null, edition: '', title: '', byline: '', content: '', verdict: '', sort_order: 0, publish: true };
const countChars = (t) => (t || '').replace(/\s/g, '').length;

export default function WritingHallAdmin({ addLog = () => {} }) {
  const [works, setWorks] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [coverFile, setCoverFile] = useState(null);
  const [coverPreview, setCoverPreview] = useState('');
  const [busy, setBusy] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [hallOpen, setHallOpen] = useState(true);     // site_settings.is_writing_hall_active

  const loadSetting = async () => {
    const { data, error } = await supabase.from('site_settings').select('is_writing_hall_active').eq('id', 1).maybeSingle();
    if (error) { addLog(`⚠️ 读取创作大赛厅开关失败（请确认已运行 writing_hall.sql）: ${error.message}`); return; }
    setHallOpen(data?.is_writing_hall_active !== false);
  };
  const toggleHall = async () => {
    const next = !hallOpen;
    if (!next && !window.confirm('锁定后，访客将看不到本厅任何展品（管理员仍可预览）。确定锁定？')) return;
    const { data, error } = await supabase.from('site_settings').update({ is_writing_hall_active: next }).eq('id', 1).select();
    if (error) return alert('操作失败：' + error.message);
    if (!data || data.length === 0) return alert('操作未生效：请检查管理员权限。');
    setHallOpen(data[0].is_writing_hall_active !== false);
    addLog(`🎛️ 陈伯吹新儿童文学创作大赛厅已${next ? '开放' : '锁定'}`);
  };

  const load = async () => {
    const { data, error } = await supabase.from('writing_works').select('*')
      .order('sort_order', { ascending: false }).order('created_at', { ascending: false });
    if (error) { addLog(`❌ 陈伯吹新儿童文学创作大赛厅读取失败: ${error.message}（如提示表不存在，请先运行 writing_hall.sql）`); return; }
    setWorks(data || []);
  };
  useEffect(() => { load(); loadSetting(); }, []);

  // 封面本地预览
  useEffect(() => {
    if (!coverFile) { setCoverPreview(''); return; }
    const u = URL.createObjectURL(coverFile);
    setCoverPreview(u);
    return () => URL.revokeObjectURL(u);
  }, [coverFile]);

  const pickCover = (e) => {
    const f = (e.target.files || [])[0];
    e.target.value = '';
    if (!f) return;
    if (!/^image\/(jpeg|png)$/.test(f.type)) return alert('封面只接受 JPG / PNG。');
    setCoverFile(f);
  };

  const startNew = () => { setForm(emptyForm); setCoverFile(null); setShowForm(true); };
  const startEdit = (w) => {
    setForm({ id: w.id, edition: w.edition || '', title: cleanWritingTitle(w.title), byline: w.byline || '',
      content: w.content || '', verdict: w.verdict || '', sort_order: w.sort_order || 0, publish: w.is_published });
    setCoverFile(null); setShowForm(true);
    window.scrollTo({ top: document.getElementById('writing-hall-admin')?.offsetTop || 0, behavior: 'smooth' });
  };

  const uploadCover = async (id, file) => {
    setBusy('正在压缩封面并加水印…');
    const blob = await compressImage(file, WRITING_WATERMARK);
    const path = `${id}/cover_${Date.now()}.jpg`;
    setBusy('正在上传封面…');
    await showcaseUpload(path, blob);
    return path;
  };

  const save = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) return alert('请填写作品名称。');
    if (!form.content.trim()) return alert('请填写正文。');
    if (form.content.length > TEXT_MAX) return alert(`正文不得超过 ${TEXT_MAX} 字。`);
    if (!form.id && !coverFile) return alert('请选择作品封面。');
    const row = {
      edition: form.edition.trim() || null, title: cleanWritingTitle(form.title),
      byline: form.byline.trim() || null, content: form.content.replace(/\s+$/, ''),
      verdict: form.verdict.trim() || null,
      sort_order: parseInt(form.sort_order, 10) || 0, is_published: !!form.publish,
    };
    let newCover = null;
    try {
      if (form.id) {
        const old = works.find(w => w.id === form.id);
        if (coverFile) { newCover = await uploadCover(form.id, coverFile); row.cover = newCover; }
        setBusy('正在保存…');
        const { data, error } = await supabase.from('writing_works').update(row).eq('id', form.id).select();
        if (error) throw error;
        if (!data || data.length === 0) throw new Error('数据库未更新任何记录，请检查管理员权限');
        if (newCover && old?.cover && old.cover !== newCover) await showcaseDelete([old.cover]).catch(() => {});
        addLog(`✅ 陈伯吹新儿童文学创作大赛厅：已更新《${row.title}》`);
      } else {
        const id = crypto.randomUUID();
        newCover = await uploadCover(id, coverFile);
        setBusy('正在保存…');
        const { error } = await supabase.from('writing_works').insert({ id, ...row, cover: newCover });
        if (error) throw error;
        addLog(`✅ 陈伯吹新儿童文学创作大赛厅：已录入《${row.title}》（${countChars(row.content)} 字）`);
      }
      setShowForm(false); setForm(emptyForm); setCoverFile(null);
      load();
    } catch (err) {
      if (newCover) await showcaseDelete([newCover]).catch(() => {});   // 保存失败：删掉刚传的封面，不留孤儿文件
      alert('保存失败：' + err.message);
      addLog(`❌ 陈伯吹新儿童文学创作大赛厅保存失败: ${err.message}`);
    } finally {
      setBusy('');
    }
  };

  const togglePublish = async (w) => {
    const { error } = await supabase.from('writing_works').update({ is_published: !w.is_published }).eq('id', w.id);
    if (error) return alert('操作失败：' + error.message);
    addLog(`🎛️ 《${cleanWritingTitle(w.title)}》已${w.is_published ? '撤下' : '发布'}`);
    load();
  };
  const remove = async (w) => {
    if (!window.confirm(`确定删除《${cleanWritingTitle(w.title)}》？封面图会一并删除，不可恢复。`)) return;
    const { error } = await supabase.from('writing_works').delete().eq('id', w.id);
    if (error) return alert('删除失败：' + error.message);
    if (w.cover) await showcaseDelete([w.cover]).catch(e => addLog(`⚠️ 封面删除失败（记录已删）: ${e.message}`));
    addLog(`🗑️ 已删除《${cleanWritingTitle(w.title)}》`);
    load();
  };

  const inp = { width: '100%', padding: '8px', background: '#222', color: '#fff', border: '1px solid #444', borderRadius: '4px', boxSizing: 'border-box', fontFamily: 'inherit' };
  const lbl = { display: 'block', marginBottom: '5px', color: '#888', fontSize: '13px' };
  const n = countChars(form.content);
  const existingCover = form.id ? (works.find(w => w.id === form.id) || {}).cover : null;

  return (
    <div id="writing-hall-admin" style={{ padding: '20px', background: '#111', border: '1px solid #222', borderRadius: '4px', textAlign: 'left' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px', flexWrap: 'wrap', gap: '10px' }}>
        <div>
          <h3 style={{ margin: '0 0 6px', color: '#a3be8c' }}>✍️ 陈伯吹新儿童文学创作大赛厅布展（共 {works.length} 件，已发布 {works.filter(w => w.is_published).length} 件）</h3>
          <p style={{ margin: 0, color: '#64748b', fontSize: '12px' }}>录入历届文字创作佳作：作品封面 + 正文（约 1000 字）。本厅常年开放，可单独锁定；封面上传时自动加水印。</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <span style={{ color: '#888', fontSize: '13px' }}>
            本厅状态：<strong style={{ color: hallOpen ? '#a3be8c' : '#bf616a' }}>{hallOpen ? '🟢 开放中' : '🔴 已锁定'}</strong>
          </span>
          <button onClick={toggleHall} style={{ padding: '8px 16px', backgroundColor: hallOpen ? '#bf616a' : '#a3be8c', color: hallOpen ? '#fff' : '#000', border: 'none', cursor: 'pointer', fontWeight: 'bold', borderRadius: '4px' }}>
            {hallOpen ? '🔒 锁定本厅' : '📢 开放本厅'}
          </button>
          <a href="/gallery?hall=writing" title="在当前页面打开（登录状态只在本标签页有效）" style={{ color: '#ebcb8b', fontSize: '13px' }}>👁️ 预览展厅</a>
          <button onClick={() => (showForm ? setShowForm(false) : startNew())} style={{ padding: '8px 16px', backgroundColor: '#5e81ac', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 'bold', borderRadius: '4px' }}>
            {showForm ? '收起' : '➕ 录入佳作'}
          </button>
        </div>
      </div>

      {showForm && (
        <form onSubmit={save} style={{ borderTop: '1px dashed #333', paddingTop: '18px', marginBottom: '20px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px' }}>
          <div>
            <label style={lbl}>届次（分组标题）</label>
            <input value={form.edition} onChange={e => setForm({ ...form, edition: e.target.value })} placeholder="例如：第五届" style={inp} />
          </div>
          <div>
            <label style={lbl}>作品名称（不用加书名号）</label>
            <input value={form.title} maxLength={100} onChange={e => setForm({ ...form, title: e.target.value })} style={inp} />
          </div>
          <div>
            <label style={lbl}>署名（选填，需作者授权）</label>
            <input value={form.byline} onChange={e => setForm({ ...form, byline: e.target.value })} placeholder="例如：文 / 某某" style={inp} />
          </div>
          <div>
            <label style={lbl}>排序权重（大的靠前）</label>
            <input type="number" value={form.sort_order} onChange={e => setForm({ ...form, sort_order: e.target.value })} style={inp} />
          </div>

          <div style={{ gridColumn: '1 / -1', display: 'flex', gap: '16px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div>
              <label style={lbl}>{form.id ? '作品封面（不选则保留原封面）' : '作品封面（一张，JPG / PNG；建议竖版 3:4）'}</label>
              <input type="file" accept=".jpg,.jpeg,.png,image/jpeg,image/png" onChange={pickCover} style={{ color: '#ccc' }} />
            </div>
            {(coverPreview || existingCover) && (
              <img src={coverPreview || showcaseUrl(existingCover)} alt="封面预览"
                style={{ width: '96px', height: '128px', objectFit: 'cover', border: '1px solid #444', borderRadius: '4px' }} />
            )}
            {coverPreview && <span style={{ color: '#888', fontSize: '12px', alignSelf: 'center' }}>（预览为原图，上传时会自动加水印）</span>}
          </div>

          <div style={{ gridColumn: '1 / -1' }}>
            <label style={lbl}>
              正文（换行与空行原样保留）
              <span style={{ color: n > 1300 || (n > 0 && n < 700) ? '#ebcb8b' : '#a3be8c' }}>当前 {n} 字</span>
              <span style={{ color: '#666' }}>（建议约 1000 字，上限 {TEXT_MAX}）</span>
            </label>
            <textarea value={form.content} maxLength={TEXT_MAX} onChange={e => setForm({ ...form, content: e.target.value })} rows={16}
              style={{ ...inp, lineHeight: 1.8, fontSize: '14px' }} />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={lbl}>评语（选填，显示在正文之后）</label>
            <textarea value={form.verdict} onChange={e => setForm({ ...form, verdict: e.target.value })} rows={3} style={inp} />
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
                <th style={{ padding: '8px' }}>封面</th><th style={{ padding: '8px' }}>届次</th><th style={{ padding: '8px' }}>作品</th>
                <th style={{ padding: '8px' }}>字数</th><th style={{ padding: '8px' }}>权重</th><th style={{ padding: '8px' }}>状态</th><th style={{ padding: '8px' }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {works.map(w => (
                <tr key={w.id} style={{ borderBottom: '1px solid #222', verticalAlign: 'top' }}>
                  <td style={{ padding: '8px' }}>
                    {w.cover ? <img src={showcaseUrl(w.cover)} alt="" style={{ width: '45px', height: '60px', objectFit: 'cover', border: '1px solid #333' }} /> : '—'}
                  </td>
                  <td style={{ padding: '8px' }}>{w.edition || '—'}</td>
                  <td style={{ padding: '8px', maxWidth: '380px' }}>
                    <div style={{ color: '#eceff4' }}>《{cleanWritingTitle(w.title)}》<span style={{ color: '#888' }}>{w.byline ? `　${w.byline}` : ''}</span></div>
                    <div style={{ color: '#888', fontSize: '12px', marginTop: '4px', lineHeight: 1.5 }}>{(w.content || '').replace(/\s+/g, '').slice(0, 60)}……</div>
                  </td>
                  <td style={{ padding: '8px' }}>{countChars(w.content)}</td>
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

const actBtn = { marginRight: '6px', padding: '3px 10px', background: 'transparent', color: '#88c0d0', border: '1px solid #88c0d0', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' };
