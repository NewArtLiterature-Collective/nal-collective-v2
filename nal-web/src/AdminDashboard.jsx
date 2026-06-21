import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient'; 

export default function AdminDashboard() {
  const API_BASE = 'https://nal-api-backend.onrender.com';
  
  // 1. 系统核心基础状态矩阵
  const [galleryTime, setGalleryTime] = useState({ start: '', end: '', deadline: '' });
  const [pendingCount, setPendingCount] = useState(0);
  const [isReviewing, setIsReviewing] = useState(false);
  const [isCurating, setIsCurating] = useState(false);
  const [works, setWorks] = useState([]);
  const [logMessages, setLogMessages] = useState([]);

  // 多赛季全生命周期管理状态
  const [contests, setContests] = useState([]); 
  const [selectedContestId, setSelectedContestId] = useState(''); 
  const [activeContestId, setActiveContestId] = useState(''); 
  const [isContestActive, setIsContestActive] = useState(false); 
  const [isGalleryActive, setIsGalleryActive] = useState(false);

  // 沉浸式作品审阅室与全景沙盘状态
  const [previewWork, setPreviewWork] = useState(null);
  const [showGalleryPreview, setShowGalleryPreview] = useState(false);

  const [newContestName, setNewContestName] = useState('');
  const [newContestDesc, setNewContestDesc] = useState('');
  const [showCreateForm, setShowCreateForm] = useState(false);

  // 2. 模拟终端日志打印器
  const addLog = (msg) => {
    const time = new Date().toLocaleTimeString();
    setLogMessages(prev => [`[${time}] ${msg}`, ...prev]);
  };

  // 3. 初始化实时监听与核心加载大阵
  useEffect(() => {
    fetchContestMetadata();
    
    const subscription = supabase
      .channel('contest-dashboard-radar')
      .on(
        'postgres_changes', 
        { event: 'UPDATE', schema: 'public', table: 'contest_submissions' }, 
        (payload) => {
          const targetId = payload.new.id.substring(0, 8);
          if (payload.old.status === 'pending' && payload.new.status === 'processing') {
             addLog(`⏳ [AI 引擎] 已锁定作品 ${targetId}，正在解析...`);
             fetchDashboardData(selectedContestId); 
          }
          if (payload.new.status === 'success' && payload.old.status !== 'success') {
             addLog(`✅ [实时战报] 作品 ${targetId} 评审完毕！入库成功。`);
             setTimeout(() => fetchDashboardData(selectedContestId), 500); 
          }
          if (payload.new.status === 'invalid') {
             addLog(`❌ [拦截] 作品 ${targetId} 未达参赛门槛，已自动拦截。`);
             fetchDashboardData(selectedContestId);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(subscription);
    };
  }, [selectedContestId]);

  const fetchContestMetadata = async () => {
    try {
      const { data: contestList, error: cErr } = await supabase
        .from('contests')
        .select('*')
        .order('created_at', { ascending: false });

      if (cErr) console.error("🚨 抓取赛事表发生错误:", cErr.message);

      const { data: settings, error: sErr } = await supabase
        .from('site_settings')
        .select('current_contest_id, is_contest_active, is_gallery_active')
        .eq('id', 1)
        .maybeSingle();

      if (settings) {
        setActiveContestId(settings.current_contest_id || '');
        setIsContestActive(settings.is_contest_active);
        setIsGalleryActive(settings.is_gallery_active || false);
      }

      if (contestList && contestList.length > 0) {
        setContests(contestList);
        if (!selectedContestId) {
          const defaultId = settings?.current_contest_id || contestList[0].id;
          setSelectedContestId(defaultId);
          fetchDashboardData(defaultId);
          syncTimeState(defaultId, contestList);
        } else {
          syncTimeState(selectedContestId, contestList);
        }
      } else {
        const fallbackList = [{ id: '2026_contest', name: '2026 第一届“童心”文学大赏' }];
        setContests(fallbackList);
        setSelectedContestId('2026_contest');
        fetchDashboardData('2026_contest');
      }
    } catch (err) {
      console.error('拉取赛季元数据失败:', err);
    }
  };

  const syncTimeState = (contestId, list) => {
    const target = list.find(c => c.id === contestId);
    if (target) {
      setGalleryTime({
        deadline: target.submission_deadline ? target.submission_deadline.substring(0, 10) : '',
        start: target.gallery_start_time ? target.gallery_start_time.substring(0, 10) : '',
        end: target.gallery_end_time ? target.gallery_end_time.substring(0, 10) : ''
      });
    }
  };

  const fetchDashboardData = async (contestId) => {
    if (!contestId) return;
    try {
      const { count: pendingCount, error: pendingError } = await supabase
        .from('contest_submissions')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending')
        .eq('contest_id', contestId); 
      
      if (pendingError) console.error("🚨 抓取待审被拦截:", pendingError.message);
      setPendingCount(pendingCount || 0);

      // 🚨 剔除与策展无关的 AI 声明字段，保持纯净
      const { data: submissions, error: successError } = await supabase
        .from('contest_submissions')
        .select('id, word_count, ai_total_score, ai_variance, is_manual_recommended, manual_rank, text_content, image_urls')
        .eq('status', 'success')
        .eq('contest_id', contestId) 
        .order('manual_rank', { ascending: false })
        .order('ai_total_score', { ascending: false });

      if (successError) console.error("🚨 抓取展厅数据被拦截:", successError.message);
      
      setWorks(submissions || []);
      
      // 更新单篇预览弹窗的内容
      if (previewWork && submissions) {
        const updatedWork = submissions.find(w => w.id === previewWork.id);
        if (updatedWork) setPreviewWork(updatedWork);
      }
    } catch (err) {
      console.error('管理台数据加载错误:', err);
    }
  };

  const handleCreateNewContest = async (e) => {
    e.preventDefault();
    if (!newContestName) return alert("官方赛季名称不得为空！");
    const systemGeneratedId = 'ct_' + Math.random().toString(36).substring(2, 10) + '_' + Date.now().toString().slice(-4);
    try {
      addLog(`🏗️ 正在云端自动化创生赛季: [${systemGeneratedId}]...`);
      const { error } = await supabase.from('contests').insert({
        id: systemGeneratedId, name: newContestName, description: newContestDesc
      });
      if (error) throw error;
      addLog(`✅ 赛季资产铸造成功！系统已锁定识别码: ${systemGeneratedId}`);
      setNewContestName(''); setNewContestDesc(''); setShowCreateForm(false);
      fetchContestMetadata();
    } catch (err) { alert("创生新赛季失败: " + err.message); }
  };

  const handleSwitchGlobalActiveContest = async () => {
    if (!selectedContestId) return;
    const targetContest = contests.find(c => c.id === selectedContestId);
    if (!targetContest) return;
    try {
      addLog(`🎯 正在执行全局赛季权力交割...`);
      const { data, error } = await supabase.from('site_settings').update({ 
        current_contest_id: selectedContestId, is_contest_active: true
      }).eq('id', 1).select();
      if (error) throw error;
      if (data && data.length > 0) {
        setActiveContestId(selectedContestId); setIsContestActive(true);
        addLog(`🎉 全网前台已同步聚焦于主赛场：【${targetContest.name}】`);
        alert(`已成功推举【${targetContest.name}】为主赛事！`);
      }
    } catch (err) { addLog(`❌ 交割失败: ${err.message}`); }
  };

  const handleToggleContestActive = async () => {
    const nextStatus = !isContestActive;
    try {
      addLog(`🎛️ 正在将当前主赛事准入大闸调整为: ${nextStatus ? '🟢 开启' : '🔴 关闭'}...`);
      const { data, error } = await supabase.from('site_settings').update({ is_contest_active: nextStatus }).eq('id', 1).select();
      if (error) throw error;
      if (data && data.length > 0) {
        setIsContestActive(data[0].is_contest_active);
        addLog(`✅ 大闸同步成功！当前全网状态：${data[0].is_contest_active ? '激活中' : '休眠中'}`);
      }
    } catch (err) { addLog(`❌ 切换失败: ${err.message}`); }
  };

  const handleToggleGalleryActive = async () => {
    const nextStatus = !isGalleryActive;
    try {
      addLog(`🎛️ 正在将全局展厅大闸调整为: ${nextStatus ? '🟢 正式开放' : '🔴 内部 Preview'}...`);
      const { data, error } = await supabase.from('site_settings').update({ is_gallery_active: nextStatus }).eq('id', 1).select();
      if (error) throw error;
      if (data && data.length > 0) {
        setIsGalleryActive(data[0].is_gallery_active);
        addLog(`✅ 展厅大闸同步成功！当前入展信息对全网作者：${data[0].is_gallery_active ? '可见' : '隐藏'}`);
        // 🚨 如果大闸被开启，自动关闭预览弹窗（防误操作）
        if (data[0].is_gallery_active) setShowGalleryPreview(false);
      }
    } catch (err) { addLog(`❌ 展厅开关切换失败: ${err.message}`); }
  };

  const handleSaveTime = async () => {
    try {
      addLog("⏳ 正在同步截稿时间与展厅大闸至云端...");
      const { error } = await supabase
        .from('contests')
        .update({
          submission_deadline: galleryTime.deadline ? new Date(galleryTime.deadline).toISOString() : null,
          gallery_start_time: galleryTime.start ? new Date(galleryTime.start).toISOString() : null,
          gallery_end_time: galleryTime.end ? new Date(galleryTime.end).toISOString() : null
        })
        .eq('id', selectedContestId);

      if (error) throw error;
      addLog("✅ 该赛季的截稿防线与数字展厅展期已成功锁定！");
      alert("时空大闸配置成功！");
    } catch (err) {
      addLog(`❌ 时间同步失败: ${err.message}`);
    }
  };

  const handleStartReviewEngine = async () => {
    setIsReviewing(true); addLog("⚡ 向中控台发送唤醒指令...");
    try {
      const res = await fetch(`${API_BASE}/admin/engine/start-review`, { method: 'POST' });
      const data = await res.json();
      if (data.status === 'success') addLog("🤖 [SUCCESS] Agent 正在消耗待审队列...");
    } catch (err) { addLog(`❌ 引擎唤醒失败: ${err.message}`); } 
    finally { setIsReviewing(false); setTimeout(() => fetchDashboardData(selectedContestId), 3000); }
  };

  const handleRunGlobalCuration = async () => {
    setIsCurating(true); addLog("📊 正在下达离线全局决算指令...");
    try {
      const res = await fetch(`${API_BASE}/admin/engine/run-curation`, { method: 'POST' });
      const data = await res.json();
      if (data.status === 'success') addLog("🏆 [SUCCESS] 动态策展执行完毕！");
    } catch (err) { addLog(`❌ 策展执行失败: ${err.message}`); } 
    finally { setIsCurating(false); fetchDashboardData(selectedContestId); }
  };

  const handleToggleManualRecommend = async (id, currentStatus) => {
    try {
      const nextStatus = !currentStatus;
      const { data, error = null } = await supabase.from('contest_submissions').update({ is_manual_recommended: nextStatus }).eq('id', id).select();
      if (error) throw error;
      if (!data || data.length === 0) { addLog(`❌ 推举失败：权限拦截。`); return; }
      addLog(`💎 作品 [${id.substring(0,8)}] 推举已变更为: ${nextStatus ? '开启' : '关闭'}`);
      fetchDashboardData(selectedContestId);
    } catch (err) { addLog(`❌ 推举失败: ${err.message}`); }
  };

  const handleUpdateRank = async (id, rankValue) => {
    try {
      const { data, error } = await supabase.from('contest_submissions').update({ manual_rank: parseInt(rankValue, 10) || 0 }).eq('id', id).select();
      if (error) throw error;
      if (!data || data.length === 0) { addLog(`❌ 权重修正失败：权限拦截。`); return; }
      addLog(`🎯 作品 [${id.substring(0,8)}] 权重修正为: ${rankValue}`);
      fetchDashboardData(selectedContestId);
    } catch (err) { console.error(err); }
  };

  const handleLogout = async () => { await supabase.auth.signOut(); window.location.reload(); };

  const handleContestSelectionChange = (e) => {
    const cid = e.target.value;
    setSelectedContestId(cid);
    fetchDashboardData(cid);
    syncTimeState(cid, contests);
  };

  // 提取已被推举的作品供画廊预览使用
  const curatedWorks = works.filter(w => w.is_manual_recommended);

  return (
    <div style={{ padding: '30px', backgroundColor: '#0a0a0a', minHeight: '100vh', color: '#e0e0e0', fontFamily: 'monospace', position: 'relative' }}>
      
      {/* =========================================================
          🚨 展厅全景沙盘预览弹窗
          ========================================================= */}
      {showGalleryPreview && !isGalleryActive && (
        <div style={styles.overlay} onClick={() => setShowGalleryPreview(false)}>
          <div style={{ ...styles.previewModal, width: '95%', maxWidth: '1400px', height: '95vh', padding: 0, overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #333', padding: '20px 30px', backgroundColor: '#111827' }}>
              <div>
                <h2 style={{ margin: 0, color: '#ebcb8b', fontSize: '24px' }}>👁️ 展厅全景沙盘 (预览模式)</h2>
                <p style={{ margin: '5px 0 0 0', color: '#888', fontSize: '13px' }}>
                  当前共推举出 <strong style={{ color: '#a3be8c' }}>{curatedWorks.length}</strong> 件入展作品。排版与排序完全对齐前台真实展厅效果。
                </p>
              </div>
              <button onClick={() => setShowGalleryPreview(false)} style={styles.closeBtn}>×</button>
            </div>
            
            <div style={{ padding: '30px', overflowY: 'auto', height: 'calc(100% - 90px)', backgroundColor: '#0a0a0a' }}>
              {curatedWorks.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '100px 0', color: '#4c566a', fontSize: '18px' }}>
                  📭 暂无入展作品。请在列表中点击“⚪ 选入展厅”。
                </div>
              ) : (
                <div style={styles.galleryGrid}>
                  {curatedWorks.map((work) => (
                    <div key={work.id} style={styles.galleryCard}>
                      {work.image_urls && work.image_urls.length > 0 && (
                        <div style={styles.galleryImageContainer}>
                          <img src={work.image_urls[0]} alt="cover" style={styles.galleryCardImage} />
                          {work.is_manual_recommended && (
                            <div style={styles.galleryGoldenBadge}>💎 主编推举</div>
                          )}
                        </div>
                      )}
                      <div style={styles.galleryCardBody}>
                        <div style={styles.galleryCardHeader}>
                          <span style={styles.galleryWorkId}>UUID: {work.id.substring(0, 8)}</span>
                          <span style={styles.galleryScoreBadge}>评级: {work.ai_total_score?.toFixed(1)}</span>
                        </div>
                        <p style={styles.galleryCardText}>
                          {work.text_content?.substring(0, 100)}
                          {work.text_content?.length > 100 ? '...' : ''}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* =========================================================
          🚨 单篇作品沉浸式审阅弹窗
          ========================================================= */}
      {previewWork && (
        <div style={styles.overlay} onClick={() => setPreviewWork(null)}>
          <div style={styles.previewModal} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #333', paddingBottom: '15px', marginBottom: '20px' }}>
              <h2 style={{ margin: 0, color: '#ebcb8b', fontSize: '20px' }}>
                📖 策展室单卷审阅 <span style={{ color: '#888', fontSize: '14px' }}>[{previewWork.id.substring(0,8)}]</span>
              </h2>
              <button onClick={() => setPreviewWork(null)} style={styles.closeBtn}>×</button>
            </div>
            
            <div style={{ display: 'flex', gap: '20px', marginBottom: '20px', backgroundColor: '#1a1a1a', padding: '15px', borderRadius: '8px', border: '1px solid #333' }}>
              <div><span style={{ color: '#888' }}>AI 综合分：</span> <strong style={{ color: '#a3be8c', fontSize: '16px' }}>{previewWork.ai_total_score?.toFixed(1)}</strong></div>
              <div><span style={{ color: '#888' }}>AI 方差：</span> <strong style={{ color: previewWork.ai_variance > 20 ? '#bf616a' : '#d8dee9' }}>{previewWork.ai_variance?.toFixed(2)}</strong></div>
              <div><span style={{ color: '#888' }}>作者字数：</span> <strong style={{ color: '#d8dee9' }}>{previewWork.word_count}</strong></div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxHeight: '55vh', overflowY: 'auto', paddingRight: '10px' }}>
              <div>
                <h4 style={{ color: '#88c0d0', margin: '0 0 10px 0', borderBottom: '1px dashed #444', paddingBottom: '5px' }}>📝 作者正文 / 故事大纲</h4>
                <div style={{ backgroundColor: '#111', padding: '20px', borderRadius: '8px', color: '#eceff4', whiteSpace: 'pre-wrap', lineHeight: '1.8', fontSize: '14px', border: '1px solid #222' }}>
                  {previewWork.text_content || <span style={{ color: '#4c566a' }}>[作者未提供正文描述]</span>}
                </div>
              </div>

              <div>
                <h4 style={{ color: '#b48ead', margin: '0 0 10px 0', borderBottom: '1px dashed #444', paddingBottom: '5px' }}>🎨 视觉附件 ({previewWork.image_urls?.length || 0} 张)</h4>
                {previewWork.image_urls && previewWork.image_urls.length > 0 ? (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '15px' }}>
                    {previewWork.image_urls.map((url, i) => (
                      <div key={i} style={{ border: '1px solid #333', borderRadius: '8px', overflow: 'hidden', backgroundColor: '#000' }}>
                        <img src={url} alt={`attachment-${i}`} style={{ width: '100%', height: 'auto', display: 'block', objectFit: 'contain', maxHeight: '400px' }} />
                        <div style={{ padding: '8px', textAlign: 'center', backgroundColor: '#222', fontSize: '12px', color: '#888' }}>图 {i + 1}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ color: '#4c566a', fontStyle: 'italic', padding: '10px' }}>[该作品无视觉附件]</div>
                )}
              </div>
            </div>

            <div style={{ marginTop: '25px', paddingTop: '15px', borderTop: '1px solid #333', display: 'flex', justifyContent: 'flex-end', gap: '15px' }}>
              <button onClick={() => setPreviewWork(null)} style={{ padding: '10px 20px', backgroundColor: 'transparent', color: '#888', border: '1px solid #444', borderRadius: '4px', cursor: 'pointer' }}>返回列表</button>
              <button 
                onClick={() => handleToggleManualRecommend(previewWork.id, previewWork.is_manual_recommended)} 
                style={{ padding: '10px 25px', backgroundColor: previewWork.is_manual_recommended ? '#bf616a' : '#5e81ac', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
              >
                {previewWork.is_manual_recommended ? "撤销展厅推举" : "💎 选入全球展厅"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================
          控制台主界面
          ========================================================= */}
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #333', paddingBottom: '15px', marginBottom: '30px' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '24px', color: '#fff' }}>🏛️ NAL 中央管理台</h1>
          <p style={{ margin: '5px 0 0 0', color: '#888', fontSize: '13px' }}>算法共治与离线全局策展</p>
        </div>
        <button onClick={handleLogout} style={{ padding: '8px 16px', backgroundColor: '#bf616a', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 'bold', borderRadius: '4px' }}>
          退出登入
        </button>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '25px', marginBottom: '30px' }}>
        
        {/* 多赛季全局中控 */}
        <div style={{ padding: '20px', background: '#111', border: '1px solid #222', borderRadius: '4px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '15px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <h3 style={{ margin: 0, color: '#ebcb8b' }}>📅 当前调度赛季视角:</h3>
              <select value={selectedContestId} onChange={handleContestSelectionChange} style={{ padding: '8px 12px', background: '#222', color: '#fff', border: '1px solid #444', fontFamily: 'monospace', cursor: 'pointer', fontSize: '14px', borderRadius: '4px' }}>
                {contests.map(c => <option key={c.id} value={c.id}>{c.name} {c.id === activeContestId ? " 🟢 [激活]" : ""}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', gap: '10px' }}>
              {selectedContestId !== activeContestId && (
                <button onClick={handleSwitchGlobalActiveContest} style={{ padding: '8px 16px', backgroundColor: '#d08770', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 'bold', borderRadius: '4px' }}>🚀 推举为全局主赛场</button>
              )}
              <button onClick={() => setShowCreateForm(!showCreateForm)} style={{ padding: '8px 16px', backgroundColor: '#5e81ac', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 'bold', borderRadius: '4px' }}>
                {showCreateForm ? "收起" : "➕ 筹备新赛季"}
              </button>
            </div>
          </div>

          {showCreateForm && (
            <form onSubmit={handleCreateNewContest} style={{ marginTop: '20px', borderTop: '1px dashed #333', paddingTop: '20px' }}>
              <div style={{ marginBottom: '15px' }}>
                <label style={{ display: 'block', marginBottom: '5px', color: '#888' }}>赛季名称:</label>
                <input type="text" value={newContestName} onChange={e => setNewContestName(e.target.value)} style={{ width: '100%', maxWidth: '600px', padding: '8px', background: '#222', color: '#fff', border: '1px solid #444', borderRadius: '4px' }} />
              </div>
              <div style={{ marginBottom: '15px' }}>
                <label style={{ display: 'block', marginBottom: '5px', color: '#888' }}>章程宣发文案:</label>
                <textarea value={newContestDesc} onChange={e => setNewContestDesc(e.target.value)} rows={3} style={{ width: '100%', maxWidth: '600px', padding: '8px', background: '#222', color: '#fff', border: '1px solid #444', borderRadius: '4px' }} />
              </div>
              <button type="submit" style={{ padding: '8px 24px', backgroundColor: '#a3be8c', color: '#000', border: 'none', cursor: 'pointer', fontWeight: 'bold', borderRadius: '4px' }}>🔨 确认铸造新赛季</button>
            </form>
          )}

          <div style={{ marginTop: '20px', paddingTop: '15px', borderTop: '1px solid #222', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: '#888', fontSize: '13px' }}>当前主赛场准入状态：<strong style={{ color: isContestActive ? '#a3be8c' : '#bf616a' }}>{isContestActive ? "🟢 大闸开启中" : "🔴 全网休眠中"}</strong></span>
            {selectedContestId === activeContestId && (
              <button onClick={handleToggleContestActive} style={{ padding: '5px 15px', backgroundColor: isContestActive ? '#bf616a' : '#a3be8c', color: isContestActive ? '#fff' : '#000', border: 'none', cursor: 'pointer', fontWeight: 'bold', fontSize: '12px', borderRadius: '4px' }}>
                {isContestActive ? "封印当前投稿大闸" : "激活当前投稿大闸"}
              </button>
            )}
          </div>
        </div>

        {/* 赛事时空大闸 */}
        <div style={{ padding: '20px', background: '#111', border: '1px solid #222', borderRadius: '4px' }}>
          <h3 style={{ margin: '0 0 20px 0', color: '#ebcb8b', display: 'flex', alignItems: 'center', gap: '8px' }}>⏳ 赛事生命周期与展厅时空大闸</h3>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
            <div style={{ display: 'flex', alignItems: 'center', paddingBottom: '15px', borderBottom: '1px dashed #333' }}>
              <label style={{ color: '#d08770', fontWeight: 'bold', display: 'flex', alignItems: 'center' }}>
                🔴 前台截稿死线 (截止后转入死库评审，不可提交新稿): 
                <input 
                  type="date"
                  value={galleryTime.deadline} 
                  onChange={e => setGalleryTime(prev => ({ ...prev, deadline: e.target.value }))} 
                  style={{ marginLeft: '15px', padding: '6px', background: '#222', color: '#fff', border: '1px solid #444', outline: 'none', borderRadius: '4px', fontFamily: 'monospace' }}
                />
              </label>
            </div>

            <div style={{ display: 'flex', gap: '25px', alignItems: 'center', flexWrap: 'wrap' }}>
              <label style={{ color: '#a3be8c', fontWeight: 'bold', display: 'flex', alignItems: 'center' }}>
                🏛️ 展厅启封日期: 
                <input 
                  type="date" 
                  value={galleryTime.start} 
                  onChange={e => setGalleryTime(prev => ({ ...prev, start: e.target.value }))} 
                  style={{ marginLeft: '10px', padding: '6px', background: '#222', color: '#fff', border: '1px solid #444', outline: 'none', borderRadius: '4px', fontFamily: 'monospace' }}
                />
              </label>
              
              <label style={{ color: '#a3be8c', fontWeight: 'bold', display: 'flex', alignItems: 'center' }}>
                展厅闭馆日期: 
                <input 
                  type="date" 
                  value={galleryTime.end} 
                  onChange={e => setGalleryTime(prev => ({ ...prev, end: e.target.value }))} 
                  style={{ marginLeft: '10px', padding: '6px', background: '#222', color: '#fff', border: '1px solid #444', outline: 'none', borderRadius: '4px', fontFamily: 'monospace' }}
                />
              </label>

              <button 
                onClick={handleSaveTime} 
                style={{ marginLeft: 'auto', padding: '8px 20px', backgroundColor: '#a3be8c', color: '#000', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
              >
                云端同步锁定
              </button>
            </div>
          </div>
        </div>

        {/* 评审引擎 */}
        <div style={{ padding: '20px', background: '#111', border: '1px solid #222', borderRadius: '4px' }}>
          <h3 style={{ margin: '0 0 15px 0', color: '#88c0d0' }}>⚡ 评审引擎与全局中控</h3>
          <div style={{ display: 'flex', gap: '20px', alignItems: 'center', marginBottom: '20px' }}>
            <div style={{ background: '#222', padding: '10px 20px', borderLeft: '4px solid #bf616a', borderRadius: '4px' }}>
              <span style={{ color: '#888' }}>当前视角下待审 (Pending): </span>
              <strong style={{ fontSize: '20px', color: '#bf616a', marginLeft: '10px' }}>{pendingCount}</strong> 篇
            </div>
            <button onClick={handleStartReviewEngine} disabled={isReviewing || pendingCount === 0} style={{ padding: '12px 24px', backgroundColor: pendingCount === 0 ? '#444' : '#5e81ac', color: '#fff', border: 'none', cursor: pendingCount === 0 ? 'not-allowed' : 'pointer', fontWeight: 'bold', borderRadius: '4px' }}>{isReviewing ? "🤖 会诊中..." : "⚡ 启动离线评审"}</button>
            <button onClick={handleRunGlobalCuration} disabled={isCurating || works.length === 0} style={{ padding: '12px 24px', backgroundColor: '#d08770', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 'bold', borderRadius: '4px' }}>{isCurating ? "📊 计算中..." : "📊 全局策展划线 (Top 5%)"}</button>
          </div>
          <div style={{ background: '#000', padding: '15px', borderRadius: '4px', height: '120px', overflowY: 'auto', border: '1px solid #333', fontSize: '12px', lineHeight: '1.6' }}>
            {logMessages.length === 0 ? <span style={{ color: '#4c566a' }}>&gt;_ 等待中控调度...</span> : logMessages.map((log, i) => <div key={i} style={{ color: log.includes('❌') ? '#bf616a' : log.includes('✅') || log.includes('SUCCESS') ? '#a3be8c' : '#d8dee9' }}>{log}</div>)}
          </div>
        </div>

        {/* 展厅推荐管理 */}
        <div style={{ padding: '20px', background: '#111', border: '1px solid #222', borderRadius: '4px' }}>
          
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: '20px', paddingBottom: '15px', borderBottom: '1px dashed #333' }}>
            <div>
              <h3 style={{ margin: '0 0 10px 0', color: '#b48ead' }}>🏆 展厅作品库人工策展（共 {works.length} 篇）</h3>
              <p style={{ margin: 0, color: '#64748b', fontSize: '12px', maxWidth: '600px', lineHeight: '1.5' }}>
                💡 <strong>工作流提示</strong>：您可以在下方列表中单独审阅并挑选作品。选定后，在【闭馆状态下】点击右侧的“预览展厅排版”，即可从上帝视角俯瞰最终展出效果。确认无误后，再开启全网展厅大闸。
              </p>
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                <span style={{ color: '#888', fontSize: '13px' }}>
                  全网展出状态：
                  <strong style={{ color: isGalleryActive ? '#a3be8c' : '#bf616a', marginLeft: '5px' }}>
                    {isGalleryActive ? "🟢 已公开" : "🔴 锁定中"}
                  </strong>
                </span>
                
                {/* 🚨 核心逻辑修复：展厅处于未公开（锁定）状态时，才显示预览按钮 */}
                {!isGalleryActive && (
                  <button 
                    onClick={() => setShowGalleryPreview(true)}
                    style={{ padding: '8px 16px', backgroundColor: 'transparent', color: '#ebcb8b', border: '1px solid #ebcb8b', cursor: 'pointer', fontWeight: 'bold', fontSize: '13px', borderRadius: '4px' }}
                  >
                    👁️ 预览展厅最终排版
                  </button>
                )}
              </div>

              <button 
                onClick={handleToggleGalleryActive} 
                style={{ padding: '8px 20px', backgroundColor: isGalleryActive ? '#bf616a' : '#a3be8c', color: isGalleryActive ? '#fff' : '#000', border: 'none', cursor: 'pointer', fontWeight: 'bold', fontSize: '13px', borderRadius: '4px', width: '100%' }}
              >
                {isGalleryActive ? "🔒 紧急闭馆 (隐藏入展信息)" : "📢 确认放行 (全网公开展厅)"}
              </button>
            </div>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #333', color: '#888' }}>
                  <th style={{ padding: '10px' }}>作品 UUID</th>
                  <th style={{ padding: '10px' }}>字数</th>
                  <th style={{ padding: '10px' }}>AI 综合均分</th>
                  <th style={{ padding: '10px' }}>专家分歧度 (方差)</th>
                  <th style={{ padding: '10px', textAlign: 'center' }}>策展审阅</th>
                  <th style={{ padding: '10px' }}>主编推举金标</th>
                  <th style={{ padding: '10px' }}>展厅展示权重</th>
                </tr>
              </thead>
              <tbody>
                {works.map((work) => (
                  <tr key={work.id} style={{ borderBottom: '1px solid #222' }}>
                    <td style={{ padding: '10px', color: '#a3be8c' }}>{work.id.substring(0, 12)}...</td>
                    <td style={{ padding: '10px' }}>{work.word_count} 字</td>
                    <td style={{ padding: '10px', fontWeight: 'bold', color: '#ebcb8b' }}>{work.ai_total_score?.toFixed(1)}分</td>
                    <td style={{ padding: '10px', color: work.ai_variance > 20 ? '#bf616a' : '#d8dee9' }}>{work.ai_variance?.toFixed(2)}</td>
                    <td style={{ padding: '10px', textAlign: 'center' }}>
                      <button 
                        onClick={() => setPreviewWork(work)} 
                        style={{ padding: '4px 10px', backgroundColor: 'transparent', color: '#88c0d0', border: '1px solid #88c0d0', cursor: 'pointer', fontSize: '12px', borderRadius: '4px' }}
                      >
                        👁️ 单卷审阅
                      </button>
                    </td>
                    <td style={{ padding: '10px' }}>
                      <button onClick={() => handleToggleManualRecommend(work.id, work.is_manual_recommended)} style={{ padding: '4px 10px', backgroundColor: work.is_manual_recommended ? '#5e81ac' : '#333', color: '#fff', border: 'none', cursor: 'pointer', fontSize: '11px', borderRadius: '4px' }}>
                        {work.is_manual_recommended ? "💎 已推举" : "⚪ 选入展厅"}
                      </button>
                    </td>
                    <td style={{ padding: '10px' }}>
                      <input type="number" defaultValue={work.manual_rank} onBlur={(e) => handleUpdateRank(work.id, e.target.value)} style={{ width: '50px', padding: '4px', background: '#222', color: '#fff', border: '1px solid #444', textAlign: 'center', borderRadius: '4px' }} placeholder="0"/>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </div>
  );
}

// 统一提取的样式对象
const styles = {
  overlay: {
    position: 'fixed',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.85)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 9999,
    backdropFilter: 'blur(5px)'
  },
  previewModal: {
    backgroundColor: '#0a0a0a',
    border: '1px solid #444',
    borderRadius: '12px',
    padding: '30px',
    width: '90%',
    maxWidth: '900px',
    maxHeight: '90vh',
    display: 'flex',
    flexDirection: 'column',
    boxShadow: '0 20px 50px rgba(0,0,0,0.5)'
  },
  modalHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    borderBottom: '1px solid #333', paddingBottom: '15px', marginBottom: '20px'
  },
  closeBtn: {
    background: 'none', border: 'none', color: '#bf616a', fontSize: '28px', cursor: 'pointer', fontWeight: 'bold'
  },
  galleryGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '25px' },
  galleryCard: { backgroundColor: '#111827', borderRadius: '12px', overflow: 'hidden', border: '1px solid #1f2937' },
  galleryImageContainer: { position: 'relative', width: '100%', height: '200px', backgroundColor: '#000' },
  galleryCardImage: { width: '100%', height: '100%', objectFit: 'cover', opacity: 0.9 },
  galleryGoldenBadge: { position: 'absolute', top: '12px', left: '12px', backgroundColor: '#fbbf24', color: '#000', padding: '4px 10px', fontSize: '11px', fontWeight: 'bold', borderRadius: '4px' },
  galleryCardBody: { padding: '20px' },
  galleryCardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' },
  galleryWorkId: { fontSize: '11px', color: '#6b7280', fontFamily: 'monospace' },
  galleryScoreBadge: { fontSize: '12px', fontWeight: 'bold', color: '#10b981', backgroundColor: 'rgba(16, 185, 129, 0.1)', padding: '3px 8px', borderRadius: '20px' },
  galleryCardText: { fontSize: '13px', lineHeight: '1.6', color: '#9ca3af', marginBottom: '10px', textAlign: 'justify' }
};
